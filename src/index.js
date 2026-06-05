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

// Transport mode tracking (set during server startup)
let currentTransportMode = "stdio";

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
// Embed Editor Knowledge Base
// =============================================================================

const EMBED_EDITOR_KNOWLEDGE_BASE = {
  overview: `Dynamic Mockups Embed Editor lets you add a powerful mockup editor directly to your website or app via iFrame.
Choose between the Classic Editor (template-based mockups) or MockAnything Editor (AI-powered, turn any image into a mockup).
No API implementation required - just embed with a few lines of JavaScript.`,

  editor_types: {
    classic: {
      description: "Template-based mockup editor with catalog of pre-made mockup templates",
      use_case: "Best for consistent, professional product mockups from your template library",
      features: ["Browse mockup catalog", "Upload artwork", "Customize colors", "Export mockups"],
    },
    mockanything: {
      description: "AI-powered editor that turns any image into a customizable mockup",
      use_case: "Best for creative flexibility - generate mockups from any product photo",
      features: ["AI scene generation", "Ethnicity/pose changes", "Environment replacement", "AI photoshoot", "Smart product detection"],
      ai_credits: {
        prompt_generation: "3 credits (SeeDream 4.0)",
        ai_tools: "5 credits (NanoBanana) - scene change, ethnicity, camera angle, environment",
        ai_photoshoot: "3 credits per variation",
        free_features: ["Artwork placement", "Product color changes", "Smart detection", "Exports"],
      },
    },
  },

  quick_start: {
    step_1_iframe: `<iframe
  id="dm-iframe"
  src="https://embed.dynamicmockups.com"
  style="width: 100%; height: 90vh"
></iframe>`,
    step_2_cdn_script: `<script src="https://cdn.jsdelivr.net/npm/@dynamic-mockups/mockup-editor-sdk@latest/dist/index.js"></script>`,
    step_3_init: `<script>
  document.addEventListener("DOMContentLoaded", function () {
    DynamicMockups.initDynamicMockupsIframe({
      iframeId: "dm-iframe",
      data: { "x-website-key": "YOUR_WEBSITE_KEY" },
      mode: "download",
    });
  });
</script>`,
    get_website_key: "https://app.dynamicmockups.com/mockup-editor-embed-integrations",
  },

  npm_integration: {
    install: "npm install @dynamic-mockups/mockup-editor-sdk@latest",
    usage: `import { initDynamicMockupsIframe } from "@dynamic-mockups/mockup-editor-sdk";

initDynamicMockupsIframe({
  iframeId: "dm-iframe",
  data: { "x-website-key": "YOUR_WEBSITE_KEY" },
  mode: "download",
});`,
  },

  specific_mockup: {
    description: "Open a specific mockup directly instead of showing the full catalog",
    iframe_src: "https://embed.dynamicmockups.com/mockup/{MOCKUP_UUID}/",
    example: `<iframe
  id="dm-iframe"
  src="https://embed.dynamicmockups.com/mockup/43981bf4-3f1a-46cd-985e-3d9bb40cef36/"
  style="width: 100%; height: 90vh"
></iframe>`,
    get_uuid: "Use get_mockups API or find in the web app editor URL",
  },

  init_function_params: {
    iframeId: { type: "string", required: true, default: "dm-iframe", description: "ID of the iframe element" },
    data: { type: "object", required: true, description: "Configuration object for editor behavior" },
    mode: { type: "string", required: true, options: ["download", "custom"], description: "download: user downloads image directly. custom: use callback to handle export" },
    callback: { type: "function", required: false, description: "Required when mode='custom'. Receives export data when user exports mockup" },
  },

  data_options: {
    "x-website-key": { type: "string", required: true, description: "Your website key from Dynamic Mockups dashboard" },
    editorType: { type: "string", required: false, default: "classic", options: ["classic", "mockanything"], description: "Editor type to display" },
    themeAppearance: { type: "string", required: false, default: "light", options: ["light", "dark"], description: "UI theme" },
    showColorPicker: { type: "boolean", required: false, default: true, description: "Show color picker" },
    showColorPresets: { type: "boolean", required: false, default: false, description: "Show color presets from your account" },
    showCollectionsWidget: { type: "boolean", required: false, default: true, description: "Show collections widget" },
    showSmartObjectArea: { type: "boolean", required: false, default: false, description: "Display smart object boundaries" },
    showTransformControls: { type: "boolean", required: false, default: true, description: "Show width/height/rotate inputs" },
    showArtworkLibrary: { type: "boolean", required: false, default: false, description: "Show artwork library" },
    showUploadYourArtwork: { type: "boolean", required: false, default: true, description: "Show 'Upload your artwork' button" },
    showArtworkEditor: { type: "boolean", required: false, default: true, description: "Show artwork editor" },
    oneColorPerSmartObject: { type: "boolean", required: false, default: false, description: "Restrict to one color per smart object" },
    enableColorOptions: { type: "boolean", required: false, default: true, description: "Display color options" },
    enableCreatePrintFiles: { type: "boolean", required: false, default: false, description: "Enable print file export" },
    enableCollectionExport: { type: "boolean", required: false, default: false, description: "Export all mockups in collection at once" },
    exportMockupsButtonText: { type: "string", required: false, default: "Export Mockups", description: "Custom export button text" },
    designUrl: { type: "string", required: false, description: "Pre-load design URL (disables user upload)" },
    customFields: { type: "object", required: false, description: "Custom data to receive back in callback" },
    mockupExportOptions: {
      image_format: { type: "string", default: "webp", options: ["webp", "jpg", "png"] },
      image_size: { type: "number", default: 1080, description: "Output width in pixels" },
      mode: { type: "string", default: "download", options: ["download", "view"] },
    },
    colorPresets: {
      type: "array",
      required: false,
      description: "Custom color presets for the color picker",
      structure: {
        name: "string (optional) - preset name",
        autoApplyColors: "boolean (optional) - auto-apply colors when selected",
        colors: "array (required) - array of { hex: string, name?: string }",
      },
      example: `[
  {
    name: "Brand Colors",
    autoApplyColors: true,
    colors: [
      { hex: "#FF5733", name: "Primary" },
      { hex: "#33FF57", name: "Secondary" }
    ]
  }
]`,
    },
  },

  integration_steps: {
    classic_cdn: {
      description: "Classic Editor with CDN (simplest setup)",
      steps: [
        "1. Add iframe element with id='dm-iframe' and src='https://embed.dynamicmockups.com'",
        "2. Add SDK script tag from CDN: https://cdn.jsdelivr.net/npm/@dynamic-mockups/mockup-editor-sdk@latest/dist/index.js",
        "3. Call DynamicMockups.initDynamicMockupsIframe() after DOMContentLoaded",
        "4. Pass your x-website-key in the data object",
      ],
    },
    classic_npm: {
      description: "Classic Editor with NPM (for React, Vue, etc.)",
      steps: [
        "1. Install package: npm install @dynamic-mockups/mockup-editor-sdk@latest",
        "2. Add iframe element with id='dm-iframe' and src='https://embed.dynamicmockups.com'",
        "3. Import and call initDynamicMockupsIframe() after component mounts",
        "4. Pass your x-website-key in the data object",
      ],
    },
    mockanything_static: {
      description: "MockAnything Editor with static iframe (same as Classic but with editorType)",
      steps: [
        "1. Add iframe element with id='dm-iframe' and src='https://embed.dynamicmockups.com'",
        "2. Add SDK script or install NPM package",
        "3. Call initDynamicMockupsIframe() with editorType: 'mockanything' in data object",
      ],
      example: `DynamicMockups.initDynamicMockupsIframe({
  iframeId: "dm-iframe",
  data: {
    "x-website-key": "YOUR_WEBSITE_KEY",
    editorType: "mockanything",
    themeAppearance: "dark"
  },
  mode: "download"
});`,
    },
    mockanything_api: {
      description: "MockAnything Editor with API initialization (dynamic, supports prompts)",
      steps: [
        "1. Install SDK: npm install @dynamic-mockups/mockup-editor-sdk@latest",
        "2. IMPORTANT: Expose initDynamicMockupsIframe globally: window.initDynamicMockupsIframe = initDynamicMockupsIframe",
        "3. Call POST /api/v1/mock-anything/embed/initialize with prompt/image_url/artwork_url",
        "4. Inject the returned iframe_editor HTML into your DOM",
        "5. Execute the returned init_function (use eval() or new Function())",
        "6. Set up window message event listener using the returned event_listener_name",
      ],
      critical_note: "You MUST expose initDynamicMockupsIframe globally (step 2) before executing init_function, otherwise the editor won't initialize.",
    },
  },

  callback_response: {
    description: "When mode='custom', the callback receives this data on export",
    fields: {
      "mockupsExport[].export_label": "Export identifier/label",
      "mockupsExport[].export_path": "URL to the rendered mockup image",
      "customFields": "Your custom fields echoed back",
    },
    example: `initDynamicMockupsIframe({
  iframeId: "dm-iframe",
  data: {
    "x-website-key": "YOUR_KEY",
    customFields: { userId: "123", productId: "456" }
  },
  mode: "custom",
  callback: (callbackData) => {
    console.log(callbackData.mockupsExport[0].export_path); // Image URL
    console.log(callbackData.customFields); // { userId: "123", productId: "456" }
  },
});`,
  },

  mockanything_api_integration: {
    description: "Initialize MockAnything editor dynamically via API (for React, Vue, etc.)",
    endpoint: "POST https://app.dynamicmockups.com/api/v1/mock-anything/embed/initialize",
    headers: { "Content-Type": "application/json", "x-api-key": "YOUR_API_KEY" },
    request_body: {
      prompt: "Optional. AI prompt to generate initial mockup (e.g., 'A guy wearing a Gildan 5000 in Belgrade')",
      image_url: "Optional. URL to product image to use as base",
      artwork_url: "Optional. URL to artwork/logo to pre-load",
    },
    response: {
      iframe_editor: "Complete iframe HTML to inject into DOM",
      init_function: "JavaScript code to initialize the editor",
      event_listener_name: "Unique event name for this editor instance",
    },
    usage: `// 1. Call API
const response = await fetch("https://app.dynamicmockups.com/api/v1/mock-anything/embed/initialize", {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-api-key": "YOUR_API_KEY" },
  body: JSON.stringify({
    prompt: "A guy wearing a Gildan 5000 t-shirt",
    artwork_url: "https://example.com/logo.png"
  })
});
const { data } = await response.json();

// 2. Inject iframe
document.getElementById("editor-container").innerHTML = data.iframe_editor;

// 3. Initialize editor
eval(data.init_function);

// 4. Listen for events
window.addEventListener("message", (event) => {
  if (event.data.eventListenerName === data.event_listener_name) {
    console.log("Editor event:", event.data.data);
  }
});`,
  },

  mockanything_events: {
    description: "Events emitted by MockAnything editor via postMessage",
    events: ["editor_ready", "export_completed", "photoshoot_completed", "artwork_updated", "variant_changed"],
    listening: `window.addEventListener("message", (event) => {
  if (event.data.eventListenerName === "YOUR_EVENT_LISTENER_NAME") {
    const payload = event.data.data;
    console.log("Event received:", payload);
  }
});`,
  },

  react_example: `import { useState, useEffect } from "react";
import { initDynamicMockupsIframe } from "@dynamic-mockups/mockup-editor-sdk";

// Expose globally for iframe communication
window.initDynamicMockupsIframe = initDynamicMockupsIframe;

export default function MockAnythingEditor() {
  const [iframeData, setIframeData] = useState({ event_listener_name: "", iframe_editor: "", init_function: "" });

  const launchEditor = async () => {
    const response = await fetch("https://app.dynamicmockups.com/api/v1/mock-anything/embed/initialize", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": "YOUR_API_KEY" },
      body: JSON.stringify({ prompt: "A person wearing a t-shirt", artwork_url: "https://example.com/logo.png" })
    });
    const { data } = await response.json();
    setIframeData(data);
    setTimeout(() => eval(data.init_function), 100);
  };

  useEffect(() => {
    const handleMessage = (event) => {
      if (event.data?.eventListenerName === iframeData.event_listener_name) {
        console.log("Editor event:", event.data.data);
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [iframeData.event_listener_name]);

  return (
    <div>
      <button onClick={launchEditor}>Load MockAnything Editor</button>
      <div dangerouslySetInnerHTML={{ __html: iframeData.iframe_editor }} />
    </div>
  );
}`,

  docs_url: "https://docs.dynamicmockups.com/mockup-editor-sdk",
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
 * Returns MCP tracking headers for API requests.
 * @param {string} toolName - The name of the MCP tool being called
 * @returns {Object} Headers object with tracking information
 */
function getMcpTrackingHeaders(toolName) {
  return {
    "x-mcp-server": "true",
    "x-mcp-tool": toolName,
    "x-mcp-transport-mode": currentTransportMode,
  };
}

/**
 * Tracks MCP tool usage by sending event to /mcp/track endpoint (fire and forget).
 * Called after every tool execution with success/error status.
 *
 * @param {string} toolName - The name of the MCP tool
 * @param {string} apiKey - The API key for the request
 * @param {Object} result - The tool execution result
 * @param {boolean} result.success - Whether the tool executed successfully
 * @param {string|null} result.error - Error message if failed, null otherwise
 */
function trackToolUsage(toolName, apiKey, { success, error }) {
  if (!apiKey) return; // Skip tracking if no API key

  try {
    // Fire and forget - don't await or handle errors
    axios.post(
        `${API_BASE_URL}/mcp/track`,
        {
          tool: toolName,
          success,
          error: error || null,
        },
        {
          headers: {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            ...getMcpTrackingHeaders(toolName),
          },
          timeout: 5000, // Short timeout for tracking
        }
    ).catch(() => {}); // Silently ignore errors
  } catch {
    // Silently ignore any errors - tracking should never break functionality
  }
}

/**
 * Creates an API client with the provided API key.
 * For stdio transport: uses environment variable
 * For HTTP transport: uses client-provided API key from Authorization header
 *
 * @param {string} apiKey - The API key to use for requests
 * @param {string} toolName - The name of the MCP tool (for tracking)
 */
function createApiClient(apiKey, toolName) {
  return axios.create({
    baseURL: API_BASE_URL,
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "x-api-key": apiKey || "",
      ...getMcpTrackingHeaders(toolName),
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
// WORKFLOW FOR CREATING NEW MOCKUPS WITH AI (MockAnything):
// 1. (Optional) Call search_products to find a POD product UUID for grounding. For generic t-shirt requests, prefer the Gildan 5000 (verified, fully-mapped decoration areas).
// 2. (Optional) To place artwork on a SPECIFIC location (left chest, back, sleeve...), call get_product_details with the product uuid to list its decoration areas, then pass the chosen location as product.decorations in create_mockup.
// 3. (Optional, prompt flow only) Call get_styles to list visual styles for a model, then pass the style id in create_mockup
// 4. Call create_mockup with prompt or image_url -> returns task_id
// 5. Poll get_mockup_creation_status with task_id until state=SUCCESS -> returns mockup payload (smart_objects carry their decoration {location, name})
// 6. Use mockup.uuid as mockup_uuid in create_render (works exactly like classic mockups)
//
// WHEN TO USE EACH TOOL:
// - get_api_info: First call when user asks about limits, pricing, or capabilities
// - embed_mockup_editor: When user wants to embed the mockup editor in their website/app
// - get_catalogs: When user wants to see their workspace organization
// - get_collections: When user wants to browse mockup groups or find mockups by category
// - get_mockups: PRIMARY tool - lists templates WITH smart_object UUIDs ready for rendering
// - get_mockup_by_uuid: Only when user needs ONE specific template (already has UUID)
// - search_products: Find a POD product UUID to ground MockAnything AI generations (prefer Gildan 5000 for t-shirts)
// - get_product_details: List a product's decoration areas (e.g. Full Chest, Left Chest, Left Sleeve, Full Back) so artwork can target a specific spot
// - get_styles: List visual styles available for a MockAnything AI model (e.g. polaroid-etsy, ugc, fashion)
// - create_mockup: Create a brand-new mockup on the fly via AI prompt or image URL
// - get_mockup_creation_status: Poll a MockAnything task until the mockup is ready for rendering
// - create_render: For generating 1 mockup image
// - create_batch_render: For generating 2+ mockup images (more efficient)
// - export_print_files: When user needs production-ready files with specific DPI
// - upload_psd: When user wants to add their own PSD mockup template
// - delete_psd: When user wants to remove an uploaded PSD
// - create_collection: When user wants to organize mockups into groups
// - tool_create_embroidery_effect: When user wants to transform an image into embroidery/stitched effect
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
  {
    name: "embed_mockup_editor",
    description: `Get comprehensive knowledge for embedding the Dynamic Mockups Editor into websites and apps.

WHEN TO USE: Call this when user asks about:
- Embedding a mockup editor in their website/app
- Adding product customization/personalization features
- Integrating the Classic Editor or MockAnything (AI) Editor
- iFrame integration for mockup editing
- Handling editor events and callbacks
- React/Vue/JavaScript integration examples

TWO EDITOR TYPES:
1. Classic Editor: Template-based mockups from your catalog
2. MockAnything Editor: AI-powered - turn any image into a mockup

INTEGRATION APPROACHES:
- CDN: Quick setup with script tag from jsdelivr
- NPM: @dynamic-mockups/mockup-editor-sdk package for frameworks
- API: Dynamic initialization via /mock-anything/embed/initialize endpoint

TOPICS AVAILABLE:
- quick_start: Basic iframe + SDK setup (CDN method)
- npm_integration: NPM package installation and usage
- data_options: All configuration options for customizing editor behavior
- callback_response: Handling export events when mode="custom"
- mockanything_api: Dynamic editor initialization via API
- mockanything_events: Event system for MockAnything editor
- react_example: Complete React component example
- all: Complete knowledge base

This tool does NOT require an API call - returns cached knowledge instantly.`,
    inputSchema: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          enum: ["all", "quick_start", "npm_integration", "data_options", "callback_response", "mockanything_api", "mockanything_events", "react_example", "editor_types", "specific_mockup", "integration_steps"],
          description: "Specific topic to retrieve. Use 'quick_start' for basic setup, 'integration_steps' for step-by-step guides, 'data_options' for configuration, 'mockanything_api' for AI editor API integration, 'react_example' for React code. Use 'all' for complete knowledge base.",
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
  // MOCKANYTHING AI TOOLS
  // ─────────────────────────────────────────────────────────────────────────────
  {
    name: "search_products",
    description: `Search the Print-on-Demand (POD) product catalog used to ground MockAnything AI generations.

API: GET /mock-anything/products

WHEN TO USE: When user wants to anchor an AI-generated mockup around a specific product (e.g., "Gildan 5000 t-shirt", "ceramic mug") instead of letting the model pick a generic one.

WORKFLOW:
1. Call this tool with a search term (matched against POD product names). For generic t-shirt requests, prefer the Gildan 5000 - a verified, fully-mapped t-shirt.
2. Pick the desired product from the response
3. Pass its uuid as product.uuid when calling create_mockup
4. To place artwork on a SPECIFIC location (left chest, back, sleeve...), call get_product_details with that uuid to discover its decoration-area locations first.

NOTE: Grounding is OPTIONAL. Skip this tool if you want the AI to compose freely from the prompt alone.

RETURNS: Array of {name, uuid} POD product entries matching the query.`,
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "REQUIRED. Search term matched against POD product names (e.g., 'gildan', 'mug', 'hoodie'). Must be non-empty.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_product_details",
    description: `Get the full detail of a single POD product - its identity, available DECORATION AREAS (where artwork can be placed, e.g. front_full_chest, left_chest, back_full), colors, and supported sizes.

API: GET /mock-anything/products/{uuid}

WHEN TO USE: When the user wants artwork/a design placed on a SPECIFIC location of a product (e.g. "put this logo on the left chest", "print on the back"). Use this to discover the product's real decoration-area "location" ids, then pass the chosen one(s) as product.decorations in create_mockup.

WORKFLOW (place artwork on a specific location):
1. Find the product uuid with search_products. For generic t-shirt requests, prefer the Gildan 5000 (verified, fully-mapped t-shirt with all decoration areas).
2. Call this tool with that uuid to list its decoration areas (each has location, name, surface).
3. Match the user's intent to an area (e.g. "left chest" -> location "left_chest"; "back" -> "back_full").
4. Pass it to create_mockup as product.decorations: [{ location: "<location>" }]. Omit decorations to use the product's default (primary) area.

RETURNS: { uuid, name, brand, style_code, category, subcategory, decorations: [{location, name, surface}], colors, supported_sizes }.`,
    inputSchema: {
      type: "object",
      properties: {
        uuid: {
          type: "string",
          description: "REQUIRED. POD product UUID (from search_products).",
        },
      },
      required: ["uuid"],
    },
  },
  {
    name: "get_styles",
    description: `List visual styles that can be applied to a MockAnything AI generation (e.g. polaroid-etsy, ugc, fashion, urban).

API: GET /mock-anything/styles

WHEN TO USE: When user wants the AI output to land in a specific aesthetic (warm Polaroid, editorial flash, casual UGC, etc.) instead of the default photographic look. Call this BEFORE create_mockup to discover which styles are valid for the chosen model - not every model supports every style.

WORKFLOW:
1. Call this tool with the model you intend to pass to create_mockup
2. Read each style's description to pick the look you want
3. Pass the chosen style id as 'style' in create_mockup (along with the same model)

NOTES:
- Style only applies to the prompt flow (ignored for image_url).
- When style is provided to create_mockup, model is REQUIRED.
- Omit the model param here to list every known style across all models (broadest set).

RETURNS: Array of {id, description, available_with} style entries.`,
    inputSchema: {
      type: "object",
      properties: {
        model: {
          type: "string",
          enum: ["seedream_4_0", "seedream_4_5", "nano_banana_2"],
          description: "Optional. Filter styles to those supported by this model. Omit to list every style across all models.",
        },
      },
    },
  },
  {
    name: "create_mockup",
    description: `Create a new MockAnything AI mockup template on the fly. The resulting mockup behaves exactly like one returned by get_mockups - pass its uuid to create_render to print artwork on it.

API: POST /mock-anything/create
COST:
- prompt flow: 5 credits (seedream_4_0, default), 6 credits (seedream_4_5), 14 credits (nano_banana_2). Charged on SUCCESS, free on FAILURE.
- image_url flow: 4 credits per generation.

WHEN TO USE: When user wants to:
- Generate a brand-new mockup from a text prompt (e.g., "a person wearing a t-shirt in Tokyo")
- Convert an existing public image URL into a usable mockup template
- Create custom mockups not available in their existing template catalog

EXACTLY ONE of these must be provided:
- prompt: text used to AI-generate the mockup image. Asynchronous - returns task_id to poll.
- image_url: public URL to an existing image. The task usually completes on the first status poll.

WORKFLOW:
1. (Optional) Call search_products to find a product UUID for grounding the AI
2. (Optional, prompt flow only) Call get_styles to pick a visual style for a given model
3. Call this tool with prompt OR image_url
4. Use the returned task_id with get_mockup_creation_status, polling every ~2 seconds until state=SUCCESS
5. Use the returned mockup.uuid as mockup_uuid in create_render

MODELS (only apply to the prompt flow):
- seedream_4_0 (default, 5 credits, ~20s, medium quality) - quick iterations
- seedream_4_5 (6 credits, ~40s, good quality) - higher fidelity without the pro price
- nano_banana_2 (14 credits, ~30s, high quality) - production-ready final mockups

NOTES:
- product.uuid, model, style, and enhance_prompt only apply to the prompt flow (ignored otherwise).
- product.decorations targets specific print locations (e.g. left chest, back). Discover valid locations via get_product_details, then pass product.decorations: [{ location }]. Omit to use the product's default area. For generic t-shirt requests, prefer the Gildan 5000.
- style applies a visual aesthetic (e.g. polaroid-etsy, ugc, fashion). Discover valid values via get_styles. When style is set, model is REQUIRED — not every model supports every style.
- collections accepts existing collections (by uuid) or new ones (by name, find-or-create).
- Rate limit: 50 requests/minute on this endpoint.
- File uploads (multipart image_file) are not supported via MCP - host the image and pass image_url.

RETURNS: {task_id, status} - the task_id will also be the mockup.uuid once the task succeeds.`,
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Text prompt used to AI-generate the mockup image. Required unless image_url is provided. Triggers asynchronous generation - poll status with the returned task_id.",
        },
        image_url: {
          type: "string",
          description: "Public URL of an existing image to use as the mockup. Required unless prompt is provided. Completes on the first status poll.",
        },
        enhance_prompt: {
          type: "boolean",
          description: "Optional. Run prompt enhancement before generation. Only applies to the prompt flow.",
        },
        product: {
          type: "object",
          description: "Optional. Product context used to ground the AI generation around a specific POD product type. Only applies to the prompt flow.",
          properties: {
            uuid: {
              type: "string",
              description: "POD product UUID. Get from search_products.",
            },
            decorations: {
              type: "array",
              description: "Optional. Decoration areas to place artwork on. Each targets a location from get_product_details. Omit to use the product's default (primary) area. Use this when the user wants artwork on a SPECIFIC spot (e.g. left chest, back).",
              items: {
                type: "object",
                properties: {
                  location: {
                    type: "string",
                    description: "Decoration-area location id from get_product_details (e.g. 'front_full_chest', 'left_chest', 'back_full').",
                  },
                  decoration_method: {
                    type: "string",
                    description: "Optional. Decoration method (e.g. 'dtg', 'screen_print', 'embroidery', 'dtf', 'heat_transfer').",
                  },
                  imprint_size: {
                    type: "object",
                    description: "Optional. Desired physical imprint size.",
                    properties: {
                      width: { type: "number" },
                      height: { type: "number" },
                      unit: { type: "string", description: "e.g. 'in' or 'mm'." },
                    },
                  },
                },
              },
            },
          },
        },
        model: {
          type: "string",
          enum: ["seedream_4_0", "seedream_4_5", "nano_banana_2"],
          description: "Optional. AI model used for generation. Default: seedream_4_0. Only applies to the prompt flow. REQUIRED when style is provided.",
        },
        style: {
          type: "string",
          description: "Optional. Visual style applied to the AI generation (e.g. 'polaroid-etsy', 'ugc', 'fashion'). Discover valid ids via get_styles. Only applies to the prompt flow. When set, model is REQUIRED and must support this style (use get_styles?model=... to verify).",
        },
        name: {
          type: "string",
          description: "Optional. Mockup name shown in the dashboard (max 255 chars). Defaults to the prompt or a generic fallback.",
        },
        collections: {
          type: "array",
          description: "Optional. Collections to attach the mockup to. Each item must have either uuid (existing collection) or name (new collection - find-or-create).",
          items: {
            type: "object",
            properties: {
              uuid: {
                type: "string",
                description: "UUID of an existing collection.",
              },
              name: {
                type: "string",
                description: "Name of a new collection to create and attach (max 255 chars).",
              },
            },
          },
        },
        catalog_uuid: {
          type: "string",
          description: "Optional. UUID of the catalog to place the mockup in. Defaults to the workspace's default catalog.",
        },
      },
    },
  },
  {
    name: "get_mockup_creation_status",
    description: `Poll the status of a MockAnything AI mockup creation task.

API: GET /mock-anything/status/{taskId}

WHEN TO USE: After calling create_mockup, use this to track progress until the mockup is ready for rendering.

POLLING STRATEGY:
- Poll every ~2 seconds (recommended)
- prompt flow: AI generations typically finish in 10-30 seconds
- image_url flow: usually ready on the very first status call

STATES:
- PROGRESS / PENDING: Task is still running. image_url and mockup are null. Poll again shortly.
- SUCCESS: Task complete. image_url is populated and mockup contains everything needed for create_render.
- FAILURE: Task terminated without producing a mockup. No credits are charged.

ON SUCCESS - the mockup field has the same shape as a get_mockups entry (with type "mockanything"):
- mockup.uuid: pass as mockup_uuid in create_render
- mockup.smart_objects[].uuid: pass as smart_objects[].uuid in create_render to place artwork on each detected print area
- mockup.smart_objects[].decoration: {location, name} - the decoration area this smart object covers. Use it to pick the RIGHT smart object when the user asked for a specific location (e.g. render on the one whose decoration.location is "left_chest").
- mockup.unrendered_decorations: [{location, reason}] - requested areas that were NOT placed (e.g. not visible in the generated image); do not try to render artwork there.

From here, render the mockup exactly like a classic one - the Render API handles both types through the same endpoint.

RETURNS: {task_id, state, image_url, status, mockup}.`,
    inputSchema: {
      type: "object",
      properties: {
        task_id: {
          type: "string",
          description: "REQUIRED. The task_id returned from create_mockup.",
        },
      },
      required: ["task_id"],
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

RETURNS: {total_renders, successful_renders, failed_renders, renders[]} where each render has {status, export_path, export_label, mockup_uuid, mockup_type}.`,
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

  // ─────────────────────────────────────────────────────────────────────────────
  // EFFECT TOOLS
  // ─────────────────────────────────────────────────────────────────────────────
  {
    name: "tool_create_embroidery_effect",
    description: `Transform any image into a realistic embroidery/stitched effect.

API: POST /tools/embroidery
COST: 6 credits per request

WHEN TO USE: When user wants to:
- Convert artwork/designs into embroidery style
- Create stitched/embroidered versions of logos or images
- Prepare designs for print-on-demand embroidery products
- Transform existing artwork to look like embroidery before rendering on mockups

INPUT: Provide image via EITHER:
- image_url: Public URL to the image (PNG, JPG, WEBP supported)
- image_data_b64: Base64-encoded image data
Only ONE input method is required per request.

TIPS FOR BEST RESULTS:
- Use high-contrast images with clean edges
- Simpler designs with fewer colors produce more realistic embroidery effects
- The output can be used directly in mockup renders or saved to asset library

RETURNS: {export_path} - URL to the generated embroidery image (temporary, should be downloaded or saved to permanent storage).`,
    inputSchema: {
      type: "object",
      properties: {
        image_url: {
          type: "string",
          description: "Public URL to the image to transform. Supported formats: PNG, JPG, WEBP. Either image_url OR image_data_b64 must be provided.",
        },
        image_data_b64: {
          type: "string",
          description: "Base64-encoded image data. Either image_url OR image_data_b64 must be provided.",
        },
      },
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

async function handleGetEmbedEditorInfo(args) {
  const topic = args?.topic || "all";

  const topicMap = {
    quick_start: {
      overview: EMBED_EDITOR_KNOWLEDGE_BASE.overview,
      quick_start: EMBED_EDITOR_KNOWLEDGE_BASE.quick_start,
      init_function_params: EMBED_EDITOR_KNOWLEDGE_BASE.init_function_params,
      integration_steps: EMBED_EDITOR_KNOWLEDGE_BASE.integration_steps,
    },
    npm_integration: {
      npm_integration: EMBED_EDITOR_KNOWLEDGE_BASE.npm_integration,
      init_function_params: EMBED_EDITOR_KNOWLEDGE_BASE.init_function_params,
      integration_steps: {
        classic_npm: EMBED_EDITOR_KNOWLEDGE_BASE.integration_steps.classic_npm,
      },
    },
    data_options: {
      data_options: EMBED_EDITOR_KNOWLEDGE_BASE.data_options,
    },
    callback_response: {
      callback_response: EMBED_EDITOR_KNOWLEDGE_BASE.callback_response,
    },
    mockanything_api: {
      mockanything_api_integration: EMBED_EDITOR_KNOWLEDGE_BASE.mockanything_api_integration,
      mockanything_events: EMBED_EDITOR_KNOWLEDGE_BASE.mockanything_events,
      integration_steps: {
        mockanything_static: EMBED_EDITOR_KNOWLEDGE_BASE.integration_steps.mockanything_static,
        mockanything_api: EMBED_EDITOR_KNOWLEDGE_BASE.integration_steps.mockanything_api,
      },
    },
    mockanything_events: {
      mockanything_events: EMBED_EDITOR_KNOWLEDGE_BASE.mockanything_events,
    },
    react_example: {
      react_example: EMBED_EDITOR_KNOWLEDGE_BASE.react_example,
      integration_steps: {
        mockanything_api: EMBED_EDITOR_KNOWLEDGE_BASE.integration_steps.mockanything_api,
      },
    },
    editor_types: {
      editor_types: EMBED_EDITOR_KNOWLEDGE_BASE.editor_types,
    },
    specific_mockup: {
      specific_mockup: EMBED_EDITOR_KNOWLEDGE_BASE.specific_mockup,
    },
    integration_steps: {
      integration_steps: EMBED_EDITOR_KNOWLEDGE_BASE.integration_steps,
    },
    all: EMBED_EDITOR_KNOWLEDGE_BASE,
  };

  return ResponseFormatter.ok(topicMap[topic] || EMBED_EDITOR_KNOWLEDGE_BASE);
}

async function handleGetCatalogs(args, extra) {
  const apiKey = getApiKey(extra);
  const error = validateApiKey(apiKey);
  if (error) return error;

  try {
    const response = await createApiClient(apiKey, "get_catalogs").get("/catalogs");
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

    const response = await createApiClient(apiKey, "get_collections").get(`/collections?${params}`);
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

    const response = await createApiClient(apiKey, "create_collection").post("/collections", payload);
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

    const response = await createApiClient(apiKey, "get_mockups").get(`/mockups?${params}`);
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
    const response = await createApiClient(apiKey, "get_mockup_by_uuid").get(`/mockup/${args.uuid}`);
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

    const response = await createApiClient(apiKey, "create_render").post("/renders", payload);
    if (response.data?.data) response.data = response.data.data;
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

    const response = await createApiClient(apiKey, "create_batch_render").post("/renders/batch", payload);
    if (response.data?.data) response.data = response.data.data;
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

    const response = await createApiClient(apiKey, "export_print_files").post("/renders/print-files", payload);
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

    const response = await createApiClient(apiKey, "upload_psd").post("/psd/upload", payload);
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

    const response = await createApiClient(apiKey, "delete_psd").post("/psd/delete", payload);
    return ResponseFormatter.fromApiResponse(response, "PSD deleted successfully");
  } catch (err) {
    return ResponseFormatter.fromError(err, "Failed to delete PSD");
  }
}

async function handleCreateEmbroideryEffect(args, extra) {
  const apiKey = getApiKey(extra);
  const error = validateApiKey(apiKey);
  if (error) return error;

  // Validate that at least one input method is provided
  if (!args.image_url && !args.image_data_b64) {
    return ResponseFormatter.error(
        "Missing required input",
        { solution: "Provide either image_url (public URL) or image_data_b64 (base64-encoded image data)." }
    );
  }

  try {
    const payload = {};
    if (args.image_url) payload.image_url = args.image_url;
    if (args.image_data_b64) payload.image_data_b64 = args.image_data_b64;

    const response = await createApiClient(apiKey, "tool_create_embroidery_effect").post("/tools/embroidery", payload);
    return ResponseFormatter.fromApiResponse(response, "Embroidery effect created (6 credits used)");
  } catch (err) {
    return ResponseFormatter.fromError(err, "Failed to create embroidery effect");
  }
}

async function handleSearchMockanythingProducts(args, extra) {
  const apiKey = getApiKey(extra);
  const error = validateApiKey(apiKey);
  if (error) return error;

  if (!args.query || !String(args.query).trim()) {
    return ResponseFormatter.error(
        "Missing required parameter",
        { solution: "Provide a non-empty query string to search POD product names." }
    );
  }

  try {
    const params = new URLSearchParams();
    params.append("query", args.query);

    const response = await createApiClient(apiKey, "search_products").get(`/mock-anything/products?${params}`);
    return ResponseFormatter.fromApiResponse(response);
  } catch (err) {
    return ResponseFormatter.fromError(err, "Failed to search MockAnything products");
  }
}

async function handleGetMockanythingProductDetails(args, extra) {
  const apiKey = getApiKey(extra);
  const error = validateApiKey(apiKey);
  if (error) return error;

  if (!args.uuid || !String(args.uuid).trim()) {
    return ResponseFormatter.error(
        "Missing required parameter",
        { solution: "Provide the POD product uuid (from search_products)." }
    );
  }

  try {
    const response = await createApiClient(apiKey, "get_product_details").get(`/mock-anything/products/${args.uuid}`);
    return ResponseFormatter.fromApiResponse(response);
  } catch (err) {
    return ResponseFormatter.fromError(err, "Failed to fetch POD product details");
  }
}

async function handleCreateMockanythingMockup(args, extra) {
  const apiKey = getApiKey(extra);
  const error = validateApiKey(apiKey);
  if (error) return error;

  const hasPrompt = !!args.prompt;
  const hasImageUrl = !!args.image_url;

  if (!hasPrompt && !hasImageUrl) {
    return ResponseFormatter.error(
        "Missing required input",
        { solution: "Provide exactly one of prompt (for AI generation) or image_url (for an existing image)." }
    );
  }
  if (hasPrompt && hasImageUrl) {
    return ResponseFormatter.error(
        "Conflicting inputs",
        { solution: "Provide exactly one of prompt or image_url, not both." }
    );
  }

  try {
    const payload = {};
    if (hasPrompt) payload.prompt = args.prompt;
    if (hasImageUrl) payload.image_url = args.image_url;
    if (args.enhance_prompt !== undefined) payload.enhance_prompt = args.enhance_prompt;
    if (args.product) payload.product = args.product;
    if (args.model) payload.model = args.model;
    if (args.style) payload.style = args.style;
    if (args.name) payload.name = args.name;
    if (args.collections) payload.collections = args.collections;
    if (args.catalog_uuid) payload.catalog_uuid = args.catalog_uuid;

    const response = await createApiClient(apiKey, "create_mockup").post("/mock-anything/create", payload);

    const successMessage = hasPrompt
        ? "MockAnything AI generation started. Poll get_mockup_creation_status with the returned task_id (every ~2s) until state=SUCCESS, then use mockup.uuid in create_render."
        : "MockAnything mockup creation started from image_url. Poll get_mockup_creation_status with the returned task_id - it usually completes on the first call.";

    return ResponseFormatter.fromApiResponse(response, successMessage);
  } catch (err) {
    return ResponseFormatter.fromError(err, "Failed to create MockAnything mockup");
  }
}

async function handleGetMockanythingStyles(args, extra) {
  const apiKey = getApiKey(extra);
  const error = validateApiKey(apiKey);
  if (error) return error;

  try {
    const params = new URLSearchParams();
    if (args && args.model) params.append("model", args.model);

    const qs = params.toString();
    const url = qs ? `/mock-anything/styles?${qs}` : "/mock-anything/styles";

    const response = await createApiClient(apiKey, "get_styles").get(url);
    return ResponseFormatter.fromApiResponse(response);
  } catch (err) {
    return ResponseFormatter.fromError(err, "Failed to fetch MockAnything styles");
  }
}

async function handleGetMockanythingStatus(args, extra) {
  const apiKey = getApiKey(extra);
  const error = validateApiKey(apiKey);
  if (error) return error;

  if (!args.task_id) {
    return ResponseFormatter.error(
        "Missing required parameter",
        { solution: "Provide the task_id returned from create_mockup." }
    );
  }

  try {
    const response = await createApiClient(apiKey, "get_mockup_creation_status").get(`/mock-anything/status/${args.task_id}`);
    return ResponseFormatter.fromApiResponse(response);
  } catch (err) {
    return ResponseFormatter.fromError(err, "Failed to get MockAnything mockup status");
  }
}

// =============================================================================
// Tool Router
// =============================================================================

const toolHandlers = {
  get_api_info: handleGetApiInfo,
  embed_mockup_editor: handleGetEmbedEditorInfo,
  get_catalogs: handleGetCatalogs,
  get_collections: handleGetCollections,
  create_collection: handleCreateCollection,
  get_mockups: handleGetMockups,
  get_mockup_by_uuid: handleGetMockupByUuid,
  search_products: handleSearchMockanythingProducts,
  get_product_details: handleGetMockanythingProductDetails,
  get_styles: handleGetMockanythingStyles,
  create_mockup: handleCreateMockanythingMockup,
  get_mockup_creation_status: handleGetMockanythingStatus,
  create_render: handleCreateRender,
  create_batch_render: handleCreateBatchRender,
  export_print_files: handleExportPrintFiles,
  upload_psd: handleUploadPsd,
  delete_psd: handleDeletePsd,
  tool_create_embroidery_effect: handleCreateEmbroideryEffect,
};

// =============================================================================
// MCP Request Handlers
// =============================================================================

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  const { name, arguments: args } = request.params;
  const apiKey = getApiKey(extra);

  const handler = toolHandlers[name];
  if (!handler) {
    const result = ResponseFormatter.error(`Unknown tool: ${name}`);
    trackToolUsage(name, apiKey, { success: false, error: `Unknown tool: ${name}` });
    return result;
  }

  try {
    // Pass extra context (contains requestInfo with headers for HTTP transport)
    const result = await handler(args || {}, extra);

    // Track tool usage (fire and forget)
    const isError = result.isError || false;
    const errorMessage = isError && result.content?.[0]?.text ? result.content[0].text : null;
    trackToolUsage(name, apiKey, { success: !isError, error: errorMessage });

    return result;
  } catch (err) {
    const result = ResponseFormatter.fromError(err, `Error executing ${name}`);
    trackToolUsage(name, apiKey, { success: false, error: err.message || `Error executing ${name}` });
    return result;
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
  currentTransportMode = "stdio";
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
  currentTransportMode = "http";

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
        const apiKey = getApiKey(extra);

        const handler = toolHandlers[name];
        if (!handler) {
          const result = ResponseFormatter.error(`Unknown tool: ${name}`);
          trackToolUsage(name, apiKey, { success: false, error: `Unknown tool: ${name}` });
          return result;
        }

        try {
          // Pass extra context (contains requestInfo with headers for API key extraction)
          const result = await handler(args || {}, extra);

          // Track tool usage (fire and forget)
          const isError = result.isError || false;
          const errorMessage = isError && result.content?.[0]?.text ? result.content[0].text : null;
          trackToolUsage(name, apiKey, { success: !isError, error: errorMessage });

          return result;
        } catch (err) {
          const result = ResponseFormatter.fromError(err, `Error executing ${name}`);
          trackToolUsage(name, apiKey, { success: false, error: err.message || `Error executing ${name}` });
          return result;
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
