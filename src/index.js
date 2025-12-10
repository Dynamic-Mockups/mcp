#!/usr/bin/env node

/**
 * Dynamic Mockups MCP Server
 * Official MCP server for the Dynamic Mockups API
 * https://dynamicmockups.com
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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
    "Always include Accept: application/json header (handled automatically by this MCP)",
    "Store rendered image URLs promptly as they expire in 24 hours",
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

function createApiClient() {
  return axios.create({
    baseURL: API_BASE_URL,
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "x-api-key": API_KEY || "",
    },
    timeout: 60000, // 60 second timeout for render operations
    validateStatus: (status) => status < 500, // Only throw on 5xx errors
  });
}

function validateApiKey() {
  if (!API_KEY) {
    return ResponseFormatter.error(
      "API key not configured",
      {
        solution: "Set the DYNAMIC_MOCKUPS_API_KEY environment variable in your MCP client configuration.",
        get_key_at: "https://app.dynamicmockups.com/dashboard-api",
      }
    );
  }
  return null;
}

// =============================================================================
// Tool Definitions
// =============================================================================

const tools = [
  // Knowledge Base Tool
  {
    name: "get_api_info",
    description: "Get Dynamic Mockups API information including billing, rate limits, supported formats, and best practices. Use this to understand API capabilities and constraints.",
    inputSchema: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          enum: ["all", "billing", "rate_limits", "formats", "best_practices", "support"],
          description: "Specific topic to get info about, or 'all' for complete knowledge base",
        },
      },
    },
  },

  // Catalog Tools
  {
    name: "get_catalogs",
    description: "Retrieve all available catalogs. Catalogs are top-level containers for organizing collections and mockups.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },

  // Collection Tools
  {
    name: "get_collections",
    description: "Retrieve collections, optionally filtered by catalog. Collections group related mockups together.",
    inputSchema: {
      type: "object",
      properties: {
        catalog_uuid: {
          type: "string",
          description: "Filter collections by catalog UUID",
        },
        include_all_catalogs: {
          type: "boolean",
          description: "Include collections from all catalogs (default: false, returns only default catalog)",
        },
      },
    },
  },
  {
    name: "create_collection",
    description: "Create a new collection to organize mockups",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Name for the new collection",
        },
        catalog_uuid: {
          type: "string",
          description: "Catalog UUID to create collection in (uses default catalog if not specified)",
        },
      },
      required: ["name"],
    },
  },

  // Mockup Tools
  {
    name: "get_mockups",
    description: "Retrieve mockups from My Templates with optional filtering. Returns mockup UUIDs needed for rendering.",
    inputSchema: {
      type: "object",
      properties: {
        catalog_uuid: {
          type: "string",
          description: "Filter by catalog UUID",
        },
        collection_uuid: {
          type: "string",
          description: "Filter by collection UUID",
        },
        include_all_catalogs: {
          type: "boolean",
          description: "Include mockups from all catalogs (default: false)",
        },
        name: {
          type: "string",
          description: "Filter mockups by name (partial match)",
        },
      },
    },
  },
  {
    name: "get_mockup_by_uuid",
    description: "Get detailed information about a specific mockup including its smart objects and configuration",
    inputSchema: {
      type: "object",
      properties: {
        uuid: {
          type: "string",
          description: "The mockup UUID",
        },
      },
      required: ["uuid"],
    },
  },

  // Render Tools
  {
    name: "create_render",
    description: "Render a single mockup with design assets. Costs 1 credit per render. For multiple renders, use create_batch_render instead.",
    inputSchema: {
      type: "object",
      properties: {
        mockup_uuid: {
          type: "string",
          description: "UUID of the mockup template to render",
        },
        smart_objects: {
          type: "array",
          description: "Smart objects configuration with design assets",
          items: {
            type: "object",
            properties: {
              uuid: {
                type: "string",
                description: "Smart object UUID (get from mockup details)",
              },
              asset: {
                type: "object",
                description: "Design asset configuration",
                properties: {
                  url: {
                    type: "string",
                    description: "URL to the design image (jpg, jpeg, png, webp, gif)",
                  },
                  fit: {
                    type: "string",
                    enum: ["stretch", "contain", "cover"],
                    description: "How to fit the asset in the smart object area",
                  },
                  size: {
                    type: "object",
                    properties: {
                      width: { type: "integer" },
                      height: { type: "integer" },
                    },
                  },
                  position: {
                    type: "object",
                    properties: {
                      top: { type: "integer" },
                      left: { type: "integer" },
                    },
                  },
                  rotate: {
                    type: "number",
                    description: "Rotation angle in degrees",
                  },
                },
              },
              color: {
                type: "string",
                description: "Color overlay in hex format (e.g., #FF0000)",
              },
              print_area_preset_uuid: {
                type: "string",
                description: "Print area preset UUID for automatic positioning",
              },
            },
          },
        },
        export_label: {
          type: "string",
          description: "Label for the exported image (appears in filename)",
        },
        export_options: {
          type: "object",
          properties: {
            image_format: {
              type: "string",
              enum: ["jpg", "png", "webp"],
              description: "Output image format (default: jpg)",
            },
            image_size: {
              type: "integer",
              description: "Output image size in pixels (default: 1000)",
            },
            mode: {
              type: "string",
              enum: ["view", "download"],
              description: "URL mode - 'view' for browser display, 'download' for attachment",
            },
          },
        },
        text_layers: {
          type: "array",
          description: "Text layer customizations",
          items: {
            type: "object",
            properties: {
              uuid: { type: "string", description: "Text layer UUID" },
              text: { type: "string", description: "Text content" },
              font_family: { type: "string" },
              font_size: { type: "number" },
              font_color: { type: "string", description: "Hex color code" },
            },
          },
        },
      },
      required: ["mockup_uuid", "smart_objects"],
    },
  },
  {
    name: "create_batch_render",
    description: "Render multiple mockups in a single request. RECOMMENDED for rendering more than one image - more efficient and faster than individual renders. Costs 1 credit per image.",
    inputSchema: {
      type: "object",
      properties: {
        renders: {
          type: "array",
          description: "Array of render configurations",
          items: {
            type: "object",
            properties: {
              mockup_uuid: {
                type: "string",
                description: "UUID of the mockup template",
              },
              smart_objects: {
                type: "array",
                description: "Smart objects configuration (same as create_render)",
              },
              text_layers: {
                type: "array",
                description: "Text layer customizations",
              },
              export_label: {
                type: "string",
                description: "Label for this specific render",
              },
            },
            required: ["mockup_uuid", "smart_objects"],
          },
        },
        export_options: {
          type: "object",
          description: "Export options applied to all renders in the batch",
          properties: {
            image_format: {
              type: "string",
              enum: ["jpg", "png", "webp"],
            },
            image_size: {
              type: "integer",
            },
            mode: {
              type: "string",
              enum: ["view", "download"],
            },
          },
        },
      },
      required: ["renders"],
    },
  },
  {
    name: "export_print_files",
    description: "Export high-resolution print files for production. Supports custom DPI settings.",
    inputSchema: {
      type: "object",
      properties: {
        mockup_uuid: {
          type: "string",
          description: "UUID of the mockup template",
        },
        smart_objects: {
          type: "array",
          description: "Smart objects configuration",
        },
        text_layers: {
          type: "array",
          description: "Text layer customizations",
        },
        export_label: {
          type: "string",
          description: "Label for the export",
        },
        export_options: {
          type: "object",
          properties: {
            image_format: { type: "string", enum: ["jpg", "png", "webp"] },
            image_size: { type: "integer" },
            image_dpi: { type: "integer", description: "DPI for print (e.g., 300)" },
            mode: { type: "string", enum: ["view", "download"] },
          },
        },
      },
      required: ["mockup_uuid", "smart_objects"],
    },
  },

  // PSD Management Tools
  {
    name: "upload_psd",
    description: "Upload a PSD file to create custom mockup templates. The PSD should contain smart object layers.",
    inputSchema: {
      type: "object",
      properties: {
        psd_file_url: {
          type: "string",
          description: "Public URL to the PSD file",
        },
        psd_name: {
          type: "string",
          description: "Name for the uploaded PSD",
        },
        psd_category_id: {
          type: "integer",
          description: "Category ID for organization",
        },
        mockup_template: {
          type: "object",
          description: "Automatically create a mockup template from the PSD",
          properties: {
            create_after_upload: {
              type: "boolean",
              description: "Create mockup template after upload",
            },
            collections: {
              type: "array",
              items: { type: "string" },
              description: "Collection UUIDs to add the mockup to",
            },
            catalog_uuid: {
              type: "string",
              description: "Catalog UUID for the mockup",
            },
          },
        },
      },
      required: ["psd_file_url"],
    },
  },
  {
    name: "delete_psd",
    description: "Delete a PSD file and optionally all mockups created from it",
    inputSchema: {
      type: "object",
      properties: {
        psd_uuid: {
          type: "string",
          description: "UUID of the PSD to delete",
        },
        delete_related_mockups: {
          type: "boolean",
          description: "Also delete all mockups created from this PSD (default: false)",
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
    billing: { billing: API_KNOWLEDGE_BASE.billing },
    rate_limits: { rate_limits: API_KNOWLEDGE_BASE.rate_limits },
    formats: { supported_formats: API_KNOWLEDGE_BASE.supported_formats, asset_upload: API_KNOWLEDGE_BASE.asset_upload },
    best_practices: { best_practices: API_KNOWLEDGE_BASE.best_practices },
    support: { support: API_KNOWLEDGE_BASE.support },
    all: API_KNOWLEDGE_BASE,
  };

  return ResponseFormatter.ok(topicMap[topic] || API_KNOWLEDGE_BASE);
}

async function handleGetCatalogs() {
  const error = validateApiKey();
  if (error) return error;

  try {
    const response = await createApiClient().get("/catalogs");
    return ResponseFormatter.fromApiResponse(response);
  } catch (err) {
    return ResponseFormatter.fromError(err, "Failed to get catalogs");
  }
}

async function handleGetCollections(args = {}) {
  const error = validateApiKey();
  if (error) return error;

  try {
    const params = new URLSearchParams();
    if (args.catalog_uuid) params.append("catalog_uuid", args.catalog_uuid);
    if (args.include_all_catalogs !== undefined) {
      params.append("include_all_catalogs", args.include_all_catalogs);
    }

    const response = await createApiClient().get(`/collections?${params}`);
    return ResponseFormatter.fromApiResponse(response);
  } catch (err) {
    return ResponseFormatter.fromError(err, "Failed to get collections");
  }
}

async function handleCreateCollection(args) {
  const error = validateApiKey();
  if (error) return error;

  try {
    const payload = { name: args.name };
    if (args.catalog_uuid) payload.catalog_uuid = args.catalog_uuid;

    const response = await createApiClient().post("/collections", payload);
    return ResponseFormatter.fromApiResponse(response, `Collection "${args.name}" created`);
  } catch (err) {
    return ResponseFormatter.fromError(err, "Failed to create collection");
  }
}

async function handleGetMockups(args = {}) {
  const error = validateApiKey();
  if (error) return error;

  try {
    const params = new URLSearchParams();
    if (args.catalog_uuid) params.append("catalog_uuid", args.catalog_uuid);
    if (args.collection_uuid) params.append("collection_uuid", args.collection_uuid);
    if (args.include_all_catalogs !== undefined) {
      params.append("include_all_catalogs", args.include_all_catalogs);
    }
    if (args.name) params.append("name", args.name);

    const response = await createApiClient().get(`/mockups?${params}`);
    return ResponseFormatter.fromApiResponse(response);
  } catch (err) {
    return ResponseFormatter.fromError(err, "Failed to get mockups");
  }
}

async function handleGetMockupByUuid(args) {
  const error = validateApiKey();
  if (error) return error;

  try {
    const response = await createApiClient().get(`/mockup/${args.uuid}`);
    return ResponseFormatter.fromApiResponse(response);
  } catch (err) {
    return ResponseFormatter.fromError(err, "Failed to get mockup");
  }
}

async function handleCreateRender(args) {
  const error = validateApiKey();
  if (error) return error;

  try {
    const payload = {
      mockup_uuid: args.mockup_uuid,
      smart_objects: args.smart_objects,
    };
    if (args.export_label) payload.export_label = args.export_label;
    if (args.export_options) payload.export_options = args.export_options;
    if (args.text_layers) payload.text_layers = args.text_layers;

    const response = await createApiClient().post("/renders", payload);
    return ResponseFormatter.fromApiResponse(response, "Render created (1 credit used)");
  } catch (err) {
    return ResponseFormatter.fromError(err, "Failed to create render");
  }
}

async function handleCreateBatchRender(args) {
  const error = validateApiKey();
  if (error) return error;

  try {
    const payload = { renders: args.renders };
    if (args.export_options) payload.export_options = args.export_options;

    const response = await createApiClient().post("/renders/batch", payload);
    const count = args.renders?.length || 0;
    return ResponseFormatter.fromApiResponse(response, `Batch render complete (${count} credits used)`);
  } catch (err) {
    return ResponseFormatter.fromError(err, "Failed to create batch render");
  }
}

async function handleExportPrintFiles(args) {
  const error = validateApiKey();
  if (error) return error;

  try {
    const payload = {
      mockup_uuid: args.mockup_uuid,
      smart_objects: args.smart_objects,
    };
    if (args.export_label) payload.export_label = args.export_label;
    if (args.export_options) payload.export_options = args.export_options;
    if (args.text_layers) payload.text_layers = args.text_layers;

    const response = await createApiClient().post("/renders/print-files", payload);
    return ResponseFormatter.fromApiResponse(response, "Print files exported");
  } catch (err) {
    return ResponseFormatter.fromError(err, "Failed to export print files");
  }
}

async function handleUploadPsd(args) {
  const error = validateApiKey();
  if (error) return error;

  try {
    const payload = { psd_file_url: args.psd_file_url };
    if (args.psd_name) payload.psd_name = args.psd_name;
    if (args.psd_category_id) payload.psd_category_id = args.psd_category_id;
    if (args.mockup_template) payload.mockup_template = args.mockup_template;

    const response = await createApiClient().post("/psd/upload", payload);
    return ResponseFormatter.fromApiResponse(response, "PSD uploaded successfully");
  } catch (err) {
    return ResponseFormatter.fromError(err, "Failed to upload PSD");
  }
}

async function handleDeletePsd(args) {
  const error = validateApiKey();
  if (error) return error;

  try {
    const payload = { psd_uuid: args.psd_uuid };
    if (args.delete_related_mockups !== undefined) {
      payload.delete_related_mockups = args.delete_related_mockups;
    }

    const response = await createApiClient().post("/psd/delete", payload);
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

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  const handler = toolHandlers[name];
  if (!handler) {
    return ResponseFormatter.error(`Unknown tool: ${name}`);
  }

  try {
    return await handler(args || {});
  } catch (err) {
    return ResponseFormatter.fromError(err, `Error executing ${name}`);
  }
});

// =============================================================================
// Server Startup
// =============================================================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`Dynamic Mockups MCP Server v${SERVER_VERSION} running`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
