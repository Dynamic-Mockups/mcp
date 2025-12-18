#!/usr/bin/env node

/**
 * Dynamic Mockups MCP Server
 * Official MCP server for the Dynamic Mockups API
 * https://dynamicmockups.com
 *
 * Supports both stdio and HTTP/SSE transports:
 * - stdio: Default when run directly (for Claude Desktop, Cursor, etc.)
 * - HTTP/SSE: When imported and used with startHttpServer() (for web-based clients)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import axios from "axios";
import { ResponseFormatter } from "./response-formatter.js";

// =============================================================================
// Configuration
// =============================================================================

const API_BASE_URL = "https://app.dynamicmockups.com/api/v1";
const API_KEY = process.env.DYNAMIC_MOCKUPS_API_KEY;
const SERVER_NAME = "dynamic-mockups-mcp";
const SERVER_VERSION = "1.0.0";

// =============================================================================
// API Knowledge Base
// =============================================================================

const API_KNOWLEDGE_BASE = {
  overview: "Dynamic Mockups API allows you to generate product mockups programmatically.",

  integration: {
    base_url: "https://app.dynamicmockups.com/api/v1",
    required_headers: {
      "Accept": "application/json",
      "x-api-key": "<YOUR_DYNAMIC_MOCKUPS_API_KEY>"
    },
    get_api_key_at: "https://app.dynamicmockups.com/dashboard-api",
    example_endpoints: {
      "GET /catalogs": "List all catalogs",
      "GET /collections": "List collections",
      "POST /collections": "Create a collection",
      "GET /mockups": "List mockup templates",
      "GET /mockup/{uuid}": "Get mockup by UUID",
      "POST /renders": "Create a single render",
      "POST /renders/batch": "Create batch renders",
      "POST /renders/print-files": "Export print files",
      "POST /psd/upload": "Upload a PSD file",
      "POST /psd/delete": "Delete a PSD file"
    },
    code_examples: {
      javascript_fetch: `fetch('https://app.dynamicmockups.com/api/v1/mockups', {
  headers: { 'Accept': 'application/json', 'x-api-key': 'YOUR_API_KEY' }
})`,
      javascript_axios: `axios.create({
  baseURL: 'https://app.dynamicmockups.com/api/v1',
  headers: { 'Accept': 'application/json', 'x-api-key': 'YOUR_API_KEY' }
})`,
      python: `requests.get('https://app.dynamicmockups.com/api/v1/mockups',
  headers={'Accept': 'application/json', 'x-api-key': 'YOUR_API_KEY'})`,
      curl: `curl -H "Accept: application/json" -H "x-api-key: YOUR_API_KEY" https://app.dynamicmockups.com/api/v1/mockups`
    }
  },

  billing: {
    credits_per_image: 1,
    free_credits: 50,
    free_tier_watermark: true,
    pro_subscription_removes_watermark: true,
  },

  rate_limits: {
    requests_per_minute: 300,
  },

  rendered_images: {
    availability_hours: 24,
    note: "Rendered image links expire after 24 hours. Contact support to extend.",
  },

  supported_formats: {
    input: ["jpg", "jpeg", "png", "webp", "gif"],
    output: ["jpg", "png", "webp"],
  },

  asset_upload: {
    methods: ["URL", "binary file (form-data)"],
    note: "Binary files must be sent as multipart/form-data in render requests.",
  },

  best_practices: [
    "Use create_batch_render for multiple images (more efficient than single renders)",
    "Always include Accept: application/json header",
    "Always include x-api-key header with your API key",
    "Store rendered image URLs promptly as they expire in 24 hours",
    "Base URL for all API calls: https://app.dynamicmockups.com/api/v1",
  ],

  support: {
    email: "support@dynamicmockups.com",
    tutorials: "https://docs.dynamicmockups.com/knowledge-base/tutorials",
    api_docs: "https://docs.dynamicmockups.com",
  },
};

// =============================================================================
// Server Initialization
// =============================================================================

const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } }
);

// =============================================================================
// HTTP Client
// =============================================================================

/**
 * Creates an API client with the provided API key.
 * For stdio transport: uses environment variable
 * For HTTP transport: uses client-provided API key from Authorization header
 *
 * @param {string} apiKey - The API key to use for requests
 */
function createApiClient(apiKey) {
  return axios.create({
    baseURL: API_BASE_URL,
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "x-api-key": apiKey || "",
    },
    timeout: 60000, // 60 second timeout for render operations
    validateStatus: (status) => status < 500, // Only throw on 5xx errors
  });
}

/**
 * Validates that an API key is present.
 * @param {string} apiKey - The API key to validate
 */
function validateApiKey(apiKey) {
  if (!apiKey) {
    return ResponseFormatter.error(
        "API key not configured",
        {
          solution: "Provide your Dynamic Mockups API key. For HTTP transport, use the Authorization header (Bearer token). For stdio transport, set the DYNAMIC_MOCKUPS_API_KEY environment variable.",
          get_key_at: "https://app.dynamicmockups.com/dashboard-api",
        }
    );
  }
  return null;
}

/**
 * Extracts the API key from various sources.
 * Priority: requestInfo headers > environment variable
 *
 * @param {Object} extra - Extra info passed to handlers (contains requestInfo for HTTP transport)
 */
function getApiKey(extra) {
  // For HTTP transport: check Authorization header (Bearer token) or x-api-key header
  if (extra?.requestInfo?.headers) {
    const headers = extra.requestInfo.headers;

    // Check Authorization: Bearer <token>
    const authHeader = headers.authorization || headers.Authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      return authHeader.slice(7);
    }

    // Check x-api-key header
    const apiKeyHeader = headers["x-api-key"] || headers["X-Api-Key"];
    if (apiKeyHeader) {
      return apiKeyHeader;
    }
  }

  // Fallback to environment variable (for stdio transport)
  return API_KEY;
}

// =============================================================================
// Tool Definitions
// =============================================================================

// =============================================================================
// Tool Selection Guide (for LLM understanding)
// =============================================================================
//
// WORKFLOW FOR RENDERING MOCKUPS:
// 1. Call get_mockups to find available templates (returns mockup UUIDs AND smart_object UUIDs)
// 2. Use create_render (single) or create_batch_render (multiple) to generate images
// Note: get_mockups returns all data needed to render - no need to call get_mockup_by_uuid first!
//
// WHEN TO USE EACH TOOL:
// - get_api_info: First call when user asks about limits, pricing, or capabilities
// - get_catalogs: When user wants to see their workspace organization
// - get_collections: When user wants to browse mockup groups or find mockups by category
// - get_mockups: PRIMARY tool - lists templates WITH smart_object UUIDs ready for rendering
// - get_mockup_by_uuid: Only when user needs ONE specific template (already has UUID)
// - create_render: For generating 1 mockup image
// - create_batch_render: For generating 2+ mockup images (more efficient)
// - export_print_files: When user needs production-ready files with specific DPI
// - upload_psd: When user wants to add their own PSD mockup template
// - delete_psd: When user wants to remove an uploaded PSD
// - create_collection: When user wants to organize mockups into groups
//
// =============================================================================

const tools = [
  // ─────────────────────────────────────────────────────────────────────────────
  // KNOWLEDGE BASE TOOL
  // ─────────────────────────────────────────────────────────────────────────────
  {
    name: "get_api_info",
    description: `Get Dynamic Mockups API knowledge base including integration details, billing, rate limits, supported formats, and best practices.

WHEN TO USE: Call this FIRST when user asks about:
- How to integrate the API directly (base URL, headers, code examples)
- Pricing, credits, or billing
- Rate limits or API constraints
- Supported file formats (input/output)
- Best practices for rendering
- How to contact support

IMPORTANT FOR DIRECT API INTEGRATION:
When users want to integrate the Dynamic Mockups API into their own systems (not using MCP tools), use topic="integration" to get:
- Base URL: https://app.dynamicmockups.com/api/v1
- Required headers (Accept, x-api-key)
- Code examples for JavaScript, Python, cURL
- List of all available endpoints

This tool does NOT require an API call - returns cached knowledge instantly.`,
    inputSchema: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          enum: ["all", "integration", "billing", "rate_limits", "formats", "best_practices", "support"],
          description: "Specific topic to retrieve. Use 'integration' for API integration details (base URL, headers, code examples). Use 'all' for complete knowledge base.",
        },
      },
    },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // CATALOG & ORGANIZATION TOOLS
  // ─────────────────────────────────────────────────────────────────────────────
  {
    name: "get_catalogs",
    description: `Retrieve all available catalogs for the authenticated user.

API: GET /catalogs

WHEN TO USE: When user wants to:
- See their workspace organization structure
- Find a specific catalog UUID for filtering collections/mockups
- Understand how their mockups are organized

Catalogs are TOP-LEVEL containers that hold collections. Each catalog has a UUID, name, and type (custom or default).

RETURNS: Array of catalogs with uuid, name, type, created_at fields.`,
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_collections",
    description: `Retrieve collections with optional filtering by catalog.

API: GET /collections

WHEN TO USE: When user wants to:
- Browse available mockup groups/categories
- Find mockups organized by product type (e.g., "T-shirts", "Mugs")
- Get a collection UUID to filter mockups

Collections GROUP related mockups together within a catalog. By default, only returns collections from the default catalog.

RETURNS: Array of collections with uuid, name, mockup_count, created_at fields.`,
    inputSchema: {
      type: "object",
      properties: {
        catalog_uuid: {
          type: "string",
          description: "Filter collections by specific catalog UUID. Get catalog UUIDs from get_catalogs.",
        },
        include_all_catalogs: {
          type: "boolean",
          description: "Set to true to include collections from ALL catalogs. Default: false (only default catalog).",
        },
      },
    },
  },
  {
    name: "create_collection",
    description: `Create a new collection to organize mockups.

API: POST /collections

WHEN TO USE: When user wants to:
- Create a new group/category for mockups
- Organize mockups by project, client, or product type

RETURNS: The created collection with uuid, name, and metadata.`,
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Name for the new collection (e.g., 'Summer 2025 T-shirts', 'Client ABC Mockups').",
        },
        catalog_uuid: {
          type: "string",
          description: "Optional catalog UUID to place this collection in. If omitted, uses the default catalog.",
        },
      },
      required: ["name"],
    },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // MOCKUP DISCOVERY TOOLS
  // ─────────────────────────────────────────────────────────────────────────────
  {
    name: "get_mockups",
    description: `Retrieve mockups from My Templates with optional filtering. This is the PRIMARY tool for discovering mockups.

API: GET /mockups

WHEN TO USE: When user wants to:
- List all available mockup templates
- Search for mockups by name
- Find mockups in a specific collection or catalog
- Get mockup data needed for rendering

IMPORTANT: This returns EVERYTHING needed to render - both mockup UUIDs AND smart_object UUIDs. You do NOT need to call get_mockup_by_uuid before rendering.

WORKFLOW: get_mockups → create_render (that's it!)

RETURNS: Array of mockups, each containing:
- uuid: mockup template UUID (use in create_render)
- name, thumbnail
- smart_objects[]: array with uuid (use in smart_objects param), name, size, position, print_area_presets[]
- text_layers[]: uuid, name
- collections[]`,
    inputSchema: {
      type: "object",
      properties: {
        catalog_uuid: {
          type: "string",
          description: "Filter mockups by catalog UUID. Get from get_catalogs.",
        },
        collection_uuid: {
          type: "string",
          description: "Filter mockups by collection UUID. Get from get_collections.",
        },
        include_all_catalogs: {
          type: "boolean",
          description: "Set to true to include mockups from ALL catalogs. Default: false (only default catalog).",
        },
        name: {
          type: "string",
          description: "Filter mockups by name (partial match, case-insensitive). E.g., 'mug' finds 'Coffee Mug', 'Beer Mug'.",
        },
      },
    },
  },
  {
    name: "get_mockup_by_uuid",
    description: `Get detailed information about a SINGLE specific mockup by its UUID.

API: GET /mockup/{uuid}

WHEN TO USE: Only in specific scenarios:
- User already has a mockup UUID and wants details about that ONE template
- User provided a specific mockup UUID directly
- Need to refresh data for a single known mockup

NOT REQUIRED for rendering! The get_mockups tool already returns smart_object UUIDs. Only use this when you need info about ONE specific mockup and don't need to list/browse.

RETURNS: Single mockup with:
- uuid, name, thumbnail
- smart_objects[]: uuid, name, size (width/height), position (top/left), print_area_presets[]
- text_layers[]: uuid, name
- collections[], thumbnails[]`,
    inputSchema: {
      type: "object",
      properties: {
        uuid: {
          type: "string",
          description: "The mockup UUID. Get this from get_mockups response.",
        },
      },
      required: ["uuid"],
    },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER TOOLS
  // ─────────────────────────────────────────────────────────────────────────────
  {
    name: "create_render",
    description: `Render a SINGLE mockup with design assets. Returns an image URL.

API: POST /renders
COST: 1 credit per render

WHEN TO USE: When user wants to generate exactly ONE mockup image.
For 2+ images, use create_batch_render instead (more efficient, same cost).

PREREQUISITES: Call get_mockups first - it returns both mockup_uuid AND smart_object uuids needed for rendering.

SMART OBJECT OPTIONS:
- asset.url: Public URL to design image (jpg, jpeg, png, webp, gif)
- asset.fit: 'stretch' | 'contain' | 'cover' - how image fits the area
- asset.size: {width, height} - custom dimensions in pixels
- asset.position: {top, left} - custom positioning
- asset.rotate: rotation angle in degrees (0-360)
- color: hex color overlay (e.g., '#FF0000' for red)
- pattern: {enabled: true, scale_percent: 60} - repeat pattern mode
- blending_mode: Photoshop blend modes (NORMAL, MULTIPLY, SCREEN, OVERLAY, etc.)
- adjustment_layers: {brightness, contrast, opacity, saturation, vibrance, blur}
- print_area_preset_uuid: auto-position using preset (get from mockup details)

RETURNS: {export_label, export_path} - export_path is the rendered image URL (valid 24h).`,
    inputSchema: {
      type: "object",
      properties: {
        mockup_uuid: {
          type: "string",
          description: "UUID of the mockup template to render. Get from get_mockups.",
        },
        smart_objects: {
          type: "array",
          description: "Array of smart object configurations. Each mockup has one or more smart objects where you place your design.",
          items: {
            type: "object",
            required: ["uuid"],
            properties: {
              uuid: {
                type: "string",
                description: "REQUIRED. Smart object UUID. Get from get_mockups response.",
              },
              asset: {
                type: "object",
                description: "Design asset to place in this smart object. Provide at minimum the url field.",
                required: ["url"],
                properties: {
                  url: {
                    type: "string",
                    description: "REQUIRED. Public URL to the design image. Supported: jpg, jpeg, png, webp, gif.",
                  },
                  fit: {
                    type: "string",
                    enum: ["stretch", "contain", "cover"],
                    description: "Optional. How the asset fits: 'stretch' distorts to fill, 'contain' fits inside with padding, 'cover' fills and crops. Default: contain.",
                  },
                  size: {
                    type: "object",
                    description: "Optional. Custom asset size in pixels. Only use if you need specific dimensions.",
                    properties: {
                      width: { type: "integer", description: "Width in pixels" },
                      height: { type: "integer", description: "Height in pixels" },
                    },
                  },
                  position: {
                    type: "object",
                    description: "Optional. Custom asset position relative to smart object. Only use for manual positioning.",
                    properties: {
                      top: { type: "integer", description: "Top offset in pixels" },
                      left: { type: "integer", description: "Left offset in pixels" },
                    },
                  },
                  rotate: {
                    type: "number",
                    description: "Optional. Rotation angle in degrees (0-360).",
                  },
                },
              },
              color: {
                type: "string",
                description: "Optional. Color overlay in hex format (e.g., '#FF0000' for red). Use for solid color fills instead of an image.",
              },
              pattern: {
                type: "object",
                description: "Optional. Repeat the asset as a seamless pattern. Only use when pattern effect is needed.",
                properties: {
                  enabled: {
                    type: "boolean",
                    description: "Set to true to enable pattern mode.",
                  },
                  scale_percent: {
                    type: "number",
                    description: "Pattern scale as percentage (e.g., 60 = 60% of original size).",
                  },
                },
              },
              blending_mode: {
                type: "string",
                enum: [
                  "NORMAL", "DISSOLVE", "DARKEN", "MULTIPLY", "COLOR_BURN", "LINEAR_BURN", "DARKER_COLOR",
                  "LIGHTEN", "SCREEN", "COLOR_DODGE", "LINEAR_DODGE", "LIGHTER_COLOR",
                  "OVERLAY", "SOFT_LIGHT", "HARD_LIGHT", "VIVID_LIGHT", "LINEAR_LIGHT", "PIN_LIGHT", "HARD_MIX",
                  "DIFFERENCE", "EXCLUSION", "SUBTRACT", "DIVIDE", "HUE", "SATURATION", "COLOR", "LUMINOSITY"
                ],
                description: "Optional. Photoshop blending mode. Default: NORMAL. Use MULTIPLY for printing on colored surfaces.",
              },
              adjustment_layers: {
                type: "object",
                description: "Optional. Image adjustments. Only use when user needs specific image corrections.",
                properties: {
                  brightness: { type: "integer", description: "Brightness: -150 to 150" },
                  contrast: { type: "integer", description: "Contrast: -100 to 100" },
                  opacity: { type: "integer", description: "Opacity: 0 to 100" },
                  saturation: { type: "integer", description: "Saturation: -100 to 100" },
                  vibrance: { type: "integer", description: "Vibrance: -100 to 100" },
                  blur: { type: "integer", description: "Blur: 0 to 100" },
                },
              },
              print_area_preset_uuid: {
                type: "string",
                description: "Optional. UUID of print area preset for automatic positioning. Alternative to manual size/position.",
              },
            },
          },
        },
        text_layers: {
          type: "array",
          description: "Optional. Customize text layers in the mockup (if the mockup has text layers).",
          items: {
            type: "object",
            required: ["uuid", "text"],
            properties: {
              uuid: { type: "string", description: "REQUIRED. Text layer UUID. Get from get_mockups response." },
              text: { type: "string", description: "REQUIRED. Text content to display." },
              font_family: { type: "string", description: "Optional. Font family name (e.g., 'Arial', 'Helvetica')." },
              font_size: { type: "number", description: "Optional. Font size in pixels." },
              font_color: { type: "string", description: "Optional. Text color in hex format (e.g., '#FF5733')." },
            },
          },
        },
        export_label: {
          type: "string",
          description: "Optional. Custom label for the exported image. Appears in the filename.",
        },
        export_options: {
          type: "object",
          description: "Optional. Output image settings. If omitted, uses defaults (jpg, 1000px, view mode).",
          properties: {
            image_format: {
              type: "string",
              enum: ["jpg", "png", "webp"],
              description: "Optional. Output format. Default: jpg. Use png for transparency, webp for best compression.",
            },
            image_size: {
              type: "integer",
              description: "Optional. Output image size in pixels (width). Default: 1000.",
            },
            mode: {
              type: "string",
              enum: ["view", "download"],
              description: "Optional. Default: 'view' for browser display. Use 'download' for attachment header.",
            },
          },
        },
      },
      required: ["mockup_uuid", "smart_objects"],
    },
  },
  {
    name: "create_batch_render",
    description: `Render MULTIPLE mockups in a single request. Returns array of image URLs.

API: POST /renders/batch
COST: 1 credit per image

WHEN TO USE: When user wants to generate 2 or more mockup images.
MORE EFFICIENT than calling create_render multiple times - single API call, faster processing.

Use cases:
- Render same design on multiple mockup templates
- Render different designs on different mockups
- Generate a product catalog with many images

PREREQUISITES: Call get_mockups first - it returns both mockup_uuid AND smart_object uuids for all templates.

RETURNS: {total_renders, successful_renders, failed_renders, renders[]} where each render has {status, export_path, export_label, mockup_uuid}.`,
    inputSchema: {
      type: "object",
      properties: {
        renders: {
          type: "array",
          description: "REQUIRED. Array of render configurations. Each item renders one mockup image.",
          items: {
            type: "object",
            required: ["mockup_uuid", "smart_objects"],
            properties: {
              mockup_uuid: {
                type: "string",
                description: "REQUIRED. UUID of the mockup template. Get from get_mockups.",
              },
              smart_objects: {
                type: "array",
                description: "REQUIRED. Smart objects configuration. Same structure as create_render.",
                items: {
                  type: "object",
                  required: ["uuid"],
                  properties: {
                    uuid: { type: "string", description: "REQUIRED. Smart object UUID from get_mockups." },
                    asset: {
                      type: "object",
                      required: ["url"],
                      properties: {
                        url: { type: "string", description: "REQUIRED. Public URL to design image." },
                        fit: { type: "string", enum: ["stretch", "contain", "cover"], description: "Optional. Default: contain." },
                        size: { type: "object", description: "Optional.", properties: { width: { type: "integer" }, height: { type: "integer" } } },
                        position: { type: "object", description: "Optional.", properties: { top: { type: "integer" }, left: { type: "integer" } } },
                        rotate: { type: "number", description: "Optional." },
                      },
                    },
                    color: { type: "string", description: "Optional. Hex color overlay." },
                    pattern: {
                      type: "object",
                      description: "Optional.",
                      properties: {
                        enabled: { type: "boolean" },
                        scale_percent: { type: "number" },
                      },
                    },
                    blending_mode: {
                      type: "string",
                      description: "Optional. Default: NORMAL.",
                      enum: ["NORMAL", "DISSOLVE", "DARKEN", "MULTIPLY", "COLOR_BURN", "LINEAR_BURN", "DARKER_COLOR", "LIGHTEN", "SCREEN", "COLOR_DODGE", "LINEAR_DODGE", "LIGHTER_COLOR", "OVERLAY", "SOFT_LIGHT", "HARD_LIGHT", "VIVID_LIGHT", "LINEAR_LIGHT", "PIN_LIGHT", "HARD_MIX", "DIFFERENCE", "EXCLUSION", "SUBTRACT", "DIVIDE", "HUE", "SATURATION", "COLOR", "LUMINOSITY"],
                    },
                    adjustment_layers: {
                      type: "object",
                      description: "Optional.",
                      properties: {
                        brightness: { type: "integer" },
                        contrast: { type: "integer" },
                        opacity: { type: "integer" },
                        saturation: { type: "integer" },
                        vibrance: { type: "integer" },
                        blur: { type: "integer" },
                      },
                    },
                    print_area_preset_uuid: { type: "string", description: "Optional." },
                  },
                },
              },
              text_layers: {
                type: "array",
                description: "Optional. Text layer customizations.",
                items: {
                  type: "object",
                  required: ["uuid", "text"],
                  properties: {
                    uuid: { type: "string", description: "REQUIRED." },
                    text: { type: "string", description: "REQUIRED." },
                    font_family: { type: "string", description: "Optional." },
                    font_size: { type: "number", description: "Optional." },
                    font_color: { type: "string", description: "Optional." },
                  },
                },
              },
              export_label: {
                type: "string",
                description: "Optional. Label for this specific render in the batch.",
              },
            },
          },
        },
        export_options: {
          type: "object",
          description: "Optional. Export options applied to ALL renders in the batch. If omitted, uses defaults.",
          properties: {
            image_format: {
              type: "string",
              enum: ["jpg", "png", "webp"],
              description: "Optional. Output format for all renders. Default: jpg.",
            },
            image_size: {
              type: "integer",
              description: "Optional. Output image size in pixels for all renders. Default: 1000.",
            },
            mode: {
              type: "string",
              enum: ["view", "download"],
              description: "Optional. 'view' or 'download' mode for all renders. Default: view.",
            },
          },
        },
      },
      required: ["renders"],
    },
  },
  {
    name: "export_print_files",
    description: `Export high-resolution print files for production use.

API: POST /renders/print-files
COST: 1 credit per each print file

WHEN TO USE: When user needs:
- Production-ready files for printing
- High DPI output (e.g., 300 DPI for professional printing)
- Print files for each smart object separately

Unlike create_render which outputs the full mockup, this exports the design as it will appear when printed - useful for sending to print shops.

RETURNS: {print_files[]} where each has {export_path, smart_object_uuid, smart_object_name}.`,
    inputSchema: {
      type: "object",
      properties: {
        mockup_uuid: {
          type: "string",
          description: "REQUIRED. UUID of the mockup template. Get from get_mockups.",
        },
        smart_objects: {
          type: "array",
          description: "REQUIRED. Smart objects configuration. Same structure as create_render.",
          items: {
            type: "object",
            required: ["uuid"],
            properties: {
              uuid: { type: "string", description: "REQUIRED. Smart object UUID from get_mockups." },
              asset: {
                type: "object",
                required: ["url"],
                properties: {
                  url: { type: "string", description: "REQUIRED. Public URL to design image." },
                  fit: { type: "string", enum: ["stretch", "contain", "cover"], description: "Optional. Default: contain." },
                  size: { type: "object", description: "Optional.", properties: { width: { type: "integer" }, height: { type: "integer" } } },
                  position: { type: "object", description: "Optional.", properties: { top: { type: "integer" }, left: { type: "integer" } } },
                  rotate: { type: "number", description: "Optional." },
                },
              },
              color: { type: "string", description: "Optional." },
              pattern: { type: "object", description: "Optional.", properties: { enabled: { type: "boolean" }, scale_percent: { type: "number" } } },
              blending_mode: { type: "string", description: "Optional.", enum: ["NORMAL", "DISSOLVE", "DARKEN", "MULTIPLY", "COLOR_BURN", "LINEAR_BURN", "DARKER_COLOR", "LIGHTEN", "SCREEN", "COLOR_DODGE", "LINEAR_DODGE", "LIGHTER_COLOR", "OVERLAY", "SOFT_LIGHT", "HARD_LIGHT", "VIVID_LIGHT", "LINEAR_LIGHT", "PIN_LIGHT", "HARD_MIX", "DIFFERENCE", "EXCLUSION", "SUBTRACT", "DIVIDE", "HUE", "SATURATION", "COLOR", "LUMINOSITY"] },
              adjustment_layers: { type: "object", description: "Optional.", properties: { brightness: { type: "integer" }, contrast: { type: "integer" }, opacity: { type: "integer" }, saturation: { type: "integer" }, vibrance: { type: "integer" }, blur: { type: "integer" } } },
              print_area_preset_uuid: { type: "string", description: "Optional." },
            },
          },
        },
        text_layers: {
          type: "array",
          description: "Optional. Text layer customizations.",
          items: {
            type: "object",
            required: ["uuid", "text"],
            properties: {
              uuid: { type: "string", description: "REQUIRED." },
              text: { type: "string", description: "REQUIRED." },
              font_family: { type: "string", description: "Optional." },
              font_size: { type: "number", description: "Optional." },
              font_color: { type: "string", description: "Optional." },
            },
          },
        },
        export_label: {
          type: "string",
          description: "Optional. Label for the exported files.",
        },
        export_options: {
          type: "object",
          description: "Optional. Print file export settings.",
          properties: {
            image_format: { type: "string", enum: ["jpg", "png", "webp"], description: "Optional. Output format. PNG recommended for print." },
            image_size: { type: "integer", description: "Optional. Output size in pixels." },
            image_dpi: { type: "integer", description: "Optional. DPI for print output. Standard: 300 for professional printing, 150 for web-to-print." },
            mode: { type: "string", enum: ["view", "download"], description: "Optional. Default: view." },
          },
        },
      },
      required: ["mockup_uuid", "smart_objects"],
    },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // PSD MANAGEMENT TOOLS
  // ─────────────────────────────────────────────────────────────────────────────
  {
    name: "upload_psd",
    description: `Upload a PSD file to create custom mockup templates.

API: POST /psd/upload

WHEN TO USE: When user wants to:
- Add their own PSD mockup template
- Create custom mockups from their Photoshop files
- The PSD must contain smart object layers for design placement

WORKFLOW:
1. Upload PSD with create_after_upload: true to auto-create mockup template
2. Or upload PSD first, then manually create mockup template later

RETURNS: {uuid, name} of the uploaded PSD file.`,
    inputSchema: {
      type: "object",
      properties: {
        psd_file_url: {
          type: "string",
          description: "REQUIRED. Public URL to the PSD file. Must be directly downloadable (not a preview page).",
        },
        psd_name: {
          type: "string",
          description: "Optional. Custom name for the uploaded PSD. If omitted, uses filename from URL.",
        },
        psd_category_id: {
          type: "integer",
          description: "Optional. Category ID for organizing PSD files.",
        },
        mockup_template: {
          type: "object",
          description: "Optional. Settings for automatically creating a mockup template from the PSD.",
          properties: {
            create_after_upload: {
              type: "boolean",
              description: "Optional. Set to true to automatically create a mockup template after upload.",
            },
            collections: {
              type: "array",
              items: { type: "string" },
              description: "Optional. Collection UUIDs to add the new mockup to. Get from get_collections.",
            },
            catalog_uuid: {
              type: "string",
              description: "Optional. Catalog UUID to add the mockup to. If omitted, uses default catalog.",
            },
          },
        },
      },
      required: ["psd_file_url"],
    },
  },
  {
    name: "delete_psd",
    description: `Delete a PSD file and optionally all mockups created from it.

API: POST /psd/delete

    WHEN TO USE: When user wants to:
- Remove an uploaded PSD file
- Clean up unused PSD files
- Optionally remove all mockups derived from the PSD

WARNING: If delete_related_mockups is true, all mockups created from this PSD will be permanently deleted.

RETURNS: Success confirmation message.`,
    inputSchema: {
      type: "object",
      properties: {
        psd_uuid: {
          type: "string",
          description: "REQUIRED. UUID of the PSD file to delete.",
        },
        delete_related_mockups: {
          type: "boolean",
          description: "Optional. Set to true to also delete all mockups created from this PSD. Default: false (keeps mockups).",
        },
      },
      required: ["psd_uuid"],
    },
  },
];

// =============================================================================
// Tool Handlers
// =============================================================================

async function handleGetApiInfo(args) {
  const topic = args?.topic || "all";

  const topicMap = {
    integration: { integration: API_KNOWLEDGE_BASE.integration },
    billing: { billing: API_KNOWLEDGE_BASE.billing },
    rate_limits: { rate_limits: API_KNOWLEDGE_BASE.rate_limits },
    formats: { supported_formats: API_KNOWLEDGE_BASE.supported_formats, asset_upload: API_KNOWLEDGE_BASE.asset_upload },
    best_practices: { best_practices: API_KNOWLEDGE_BASE.best_practices },
    support: { support: API_KNOWLEDGE_BASE.support },
    all: API_KNOWLEDGE_BASE,
  };

  return ResponseFormatter.ok(topicMap[topic] || API_KNOWLEDGE_BASE);
}

async function handleGetCatalogs(args, extra) {
  const apiKey = getApiKey(extra);
  const error = validateApiKey(apiKey);
  if (error) return error;

  try {
    const response = await createApiClient(apiKey).get("/catalogs");
    return ResponseFormatter.fromApiResponse(response);
  } catch (err) {
    return ResponseFormatter.fromError(err, "Failed to get catalogs");
  }
}

async function handleGetCollections(args = {}, extra) {
  const apiKey = getApiKey(extra);
  const error = validateApiKey(apiKey);
  if (error) return error;

  try {
    const params = new URLSearchParams();
    if (args.catalog_uuid) params.append("catalog_uuid", args.catalog_uuid);
    if (args.include_all_catalogs !== undefined) {
      params.append("include_all_catalogs", args.include_all_catalogs);
    }

    const response = await createApiClient(apiKey).get(`/collections?${params}`);
    return ResponseFormatter.fromApiResponse(response);
  } catch (err) {
    return ResponseFormatter.fromError(err, "Failed to get collections");
  }
}

async function handleCreateCollection(args, extra) {
  const apiKey = getApiKey(extra);
  const error = validateApiKey(apiKey);
  if (error) return error;

  try {
    const payload = { name: args.name };
    if (args.catalog_uuid) payload.catalog_uuid = args.catalog_uuid;

    const response = await createApiClient(apiKey).post("/collections", payload);
    return ResponseFormatter.fromApiResponse(response, `Collection "${args.name}" created`);
  } catch (err) {
    return ResponseFormatter.fromError(err, "Failed to create collection");
  }
}

async function handleGetMockups(args = {}, extra) {
  const apiKey = getApiKey(extra);
  const error = validateApiKey(apiKey);
  if (error) return error;

  try {
    const params = new URLSearchParams();
    if (args.catalog_uuid) params.append("catalog_uuid", args.catalog_uuid);
    if (args.collection_uuid) params.append("collection_uuid", args.collection_uuid);
    if (args.include_all_catalogs !== undefined) {
      params.append("include_all_catalogs", args.include_all_catalogs);
    }
    if (args.name) params.append("name", args.name);

    const response = await createApiClient(apiKey).get(`/mockups?${params}`);
    return ResponseFormatter.fromApiResponse(response);
  } catch (err) {
    return ResponseFormatter.fromError(err, "Failed to get mockups");
  }
}

async function handleGetMockupByUuid(args, extra) {
  const apiKey = getApiKey(extra);
  const error = validateApiKey(apiKey);
  if (error) return error;

  try {
    const response = await createApiClient(apiKey).get(`/mockup/${args.uuid}`);
    return ResponseFormatter.fromApiResponse(response);
  } catch (err) {
    return ResponseFormatter.fromError(err, "Failed to get mockup");
  }
}

async function handleCreateRender(args, extra) {
  const apiKey = getApiKey(extra);
  const error = validateApiKey(apiKey);
  if (error) return error;

  try {
    const payload = {
      mockup_uuid: args.mockup_uuid,
      smart_objects: args.smart_objects,
    };
    if (args.export_label) payload.export_label = args.export_label;
    if (args.export_options) payload.export_options = args.export_options;
    if (args.text_layers) payload.text_layers = args.text_layers;

    const response = await createApiClient(apiKey).post("/renders", payload);
    return ResponseFormatter.fromApiResponse(response, "Render created (1 credit used)");
  } catch (err) {
    return ResponseFormatter.fromError(err, "Failed to create render");
  }
}

async function handleCreateBatchRender(args, extra) {
  const apiKey = getApiKey(extra);
  const error = validateApiKey(apiKey);
  if (error) return error;

  try {
    const payload = { renders: args.renders };
    if (args.export_options) payload.export_options = args.export_options;

    const response = await createApiClient(apiKey).post("/renders/batch", payload);
    const count = args.renders?.length || 0;
    return ResponseFormatter.fromApiResponse(response, `Batch render complete (${count} credits used)`);
  } catch (err) {
    return ResponseFormatter.fromError(err, "Failed to create batch render");
  }
}

async function handleExportPrintFiles(args, extra) {
  const apiKey = getApiKey(extra);
  const error = validateApiKey(apiKey);
  if (error) return error;

  try {
    const payload = {
      mockup_uuid: args.mockup_uuid,
      smart_objects: args.smart_objects,
    };
    if (args.export_label) payload.export_label = args.export_label;
    if (args.export_options) payload.export_options = args.export_options;
    if (args.text_layers) payload.text_layers = args.text_layers;

    const response = await createApiClient(apiKey).post("/renders/print-files", payload);
    return ResponseFormatter.fromApiResponse(response, "Print files exported");
  } catch (err) {
    return ResponseFormatter.fromError(err, "Failed to export print files");
  }
}

async function handleUploadPsd(args, extra) {
  const apiKey = getApiKey(extra);
  const error = validateApiKey(apiKey);
  if (error) return error;

  try {
    const payload = { psd_file_url: args.psd_file_url };
    if (args.psd_name) payload.psd_name = args.psd_name;
    if (args.psd_category_id) payload.psd_category_id = args.psd_category_id;
    if (args.mockup_template) payload.mockup_template = args.mockup_template;

    const response = await createApiClient(apiKey).post("/psd/upload", payload);
    return ResponseFormatter.fromApiResponse(response, "PSD uploaded successfully");
  } catch (err) {
    return ResponseFormatter.fromError(err, "Failed to upload PSD");
  }
}

async function handleDeletePsd(args, extra) {
  const apiKey = getApiKey(extra);
  const error = validateApiKey(apiKey);
  if (error) return error;

  try {
    const payload = { psd_uuid: args.psd_uuid };
    if (args.delete_related_mockups !== undefined) {
      payload.delete_related_mockups = args.delete_related_mockups;
    }

    const response = await createApiClient(apiKey).post("/psd/delete", payload);
    return ResponseFormatter.fromApiResponse(response, "PSD deleted successfully");
  } catch (err) {
    return ResponseFormatter.fromError(err, "Failed to delete PSD");
  }
}

// =============================================================================
// Tool Router
// =============================================================================

const toolHandlers = {
  get_api_info: handleGetApiInfo,
  get_catalogs: handleGetCatalogs,
  get_collections: handleGetCollections,
  create_collection: handleCreateCollection,
  get_mockups: handleGetMockups,
  get_mockup_by_uuid: handleGetMockupByUuid,
  create_render: handleCreateRender,
  create_batch_render: handleCreateBatchRender,
  export_print_files: handleExportPrintFiles,
  upload_psd: handleUploadPsd,
  delete_psd: handleDeletePsd,
};

// =============================================================================
// MCP Request Handlers
// =============================================================================

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  const { name, arguments: args } = request.params;

  const handler = toolHandlers[name];
  if (!handler) {
    return ResponseFormatter.error(`Unknown tool: ${name}`);
  }

  try {
    // Pass extra context (contains requestInfo with headers for HTTP transport)
    return await handler(args || {}, extra);
  } catch (err) {
    return ResponseFormatter.fromError(err, `Error executing ${name}`);
  }
});

// =============================================================================
// Server Startup
// =============================================================================

/**
 * Start the MCP server with stdio transport (default)
 * Used by: Claude Desktop, Claude Code, Cursor, Windsurf
 */
async function startStdioServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`Dynamic Mockups MCP Server v${SERVER_VERSION} running (stdio)`);
}

/**
 * Start the MCP server with Streamable HTTP transport
 * Used by: Web-based clients like Lovable that require a URL endpoint
 *
 * Uses the modern StreamableHTTPServerTransport which supports both
 * SSE streaming and direct HTTP responses per the MCP specification.
 *
 * @param {Object} options - Server options
 * @param {number} options.port - Port to listen on (default: 3000)
 * @param {string} options.host - Host to bind to (default: '0.0.0.0')
 * @param {string|string[]} options.corsOrigin - CORS origin(s) (default: '*')
 * @returns {Promise<{app: Express, httpServer: Server}>}
 */
async function startHttpServer(options = {}) {
  const {
    port = process.env.PORT || 3000,
    host = process.env.HOST || "0.0.0.0",
    corsOrigin = process.env.CORS_ORIGIN || "*",
  } = options;

  const app = express();

  // CORS configuration - must allow MCP-specific headers and auth headers
  app.use(cors({
    origin: corsOrigin,
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Accept",
      "Authorization",
      "x-api-key",
      "Mcp-Session-Id",
      "Last-Event-Id",
      "Mcp-Protocol-Version",
    ],
    exposedHeaders: ["Mcp-Session-Id"],
    credentials: true,
  }));

  // Note: We don't use express.json() globally because StreamableHTTPServerTransport
  // needs to read the raw body. We parse JSON only for non-MCP endpoints.

  // Store active transports by session ID for multi-session support
  const transports = new Map();

  // Health check endpoint
  app.get("/health", (req, res) => {
    res.json({
      status: "ok",
      server: SERVER_NAME,
      version: SERVER_VERSION,
      transport: "streamable-http",
      activeSessions: transports.size,
    });
  });

  // API info endpoint (convenience endpoint, not MCP)
  app.get("/api/info", (req, res) => {
    res.json({
      server: SERVER_NAME,
      version: SERVER_VERSION,
      api_key_configured: !!API_KEY,
      tools: tools.map((t) => ({ name: t.name, description: t.description })),
      endpoints: {
        mcp: "/mcp",
        health: "/health",
      },
    });
  });

  // MCP endpoint - handles all MCP communication (GET for SSE, POST for messages, DELETE for session termination)
  // Available at both "/" and "/mcp" for flexibility
  app.all(["/", "/mcp"], async (req, res) => {
    // Check for existing session
    const sessionId = req.headers["mcp-session-id"];

    if (sessionId && transports.has(sessionId)) {
      // Reuse existing transport for this session
      const { transport } = transports.get(sessionId);
      await transport.handleRequest(req, res);
      return;
    }

    // For new connections (no session ID or unknown session), create new transport
    if (req.method === "POST" || req.method === "GET") {
      // Create a new MCP server instance for this connection
      const connectionServer = new Server(
          { name: SERVER_NAME, version: SERVER_VERSION },
          { capabilities: { tools: {} } }
      );

      // Register the same handlers
      connectionServer.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
      connectionServer.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
        const { name, arguments: args } = request.params;
        const handler = toolHandlers[name];
        if (!handler) {
          return ResponseFormatter.error(`Unknown tool: ${name}`);
        }
        try {
          // Pass extra context (contains requestInfo with headers for API key extraction)
          return await handler(args || {}, extra);
        } catch (err) {
          return ResponseFormatter.fromError(err, `Error executing ${name}`);
        }
      });

      // Create Streamable HTTP transport with session support
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (newSessionId) => {
          console.error(`Session initialized: ${newSessionId}`);
          transports.set(newSessionId, { transport, server: connectionServer });
        },
        onsessionclosed: (closedSessionId) => {
          console.error(`Session closed: ${closedSessionId}`);
          transports.delete(closedSessionId);
        },
      });

      // Connect server to transport
      await connectionServer.connect(transport);

      // Handle the request
      await transport.handleRequest(req, res);
      return;
    }

    // Unknown session for DELETE or other methods
    res.status(400).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Bad Request: No valid session found",
      },
      id: null,
    });
  });

  // Legacy SSE endpoint for backwards compatibility
  app.get("/sse", (req, res) => {
    res.redirect(307, "/");
  });

  const httpServer = app.listen(port, host, () => {
    console.error(`Dynamic Mockups MCP Server v${SERVER_VERSION} running`);
    console.error(`Streamable HTTP transport available at http://${host}:${port}`);
    console.error(`  - MCP endpoint: http://${host}:${port}/mcp`);
    console.error(`  - Health check: http://${host}:${port}/health`);
    console.error(`  - API info: http://${host}:${port}/api/info`);
  });

  return { app, httpServer };
}

/**
 * Main entry point - determines transport based on command line args or environment
 */
async function main() {
  const args = process.argv.slice(2);
  const useHttp = args.includes("--http") || process.env.MCP_TRANSPORT === "http";

  if (useHttp) {
    await startHttpServer();
  } else {
    await startStdioServer();
  }
}

// Export for programmatic use
export { startHttpServer, startStdioServer, server, tools, toolHandlers };

// Run if executed directly
main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
