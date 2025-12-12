# Dynamic Mockups MCP Server

Official MCP server for [Dynamic Mockups](https://dynamicmockups.com) — a product mockup generator API. Create professional mockups directly from AI assistants like Claude, Cursor, and Windsurf.

## Requirements

- Node.js 18 or higher
- Dynamic Mockups API key — [get one here](https://app.dynamicmockups.com/dashboard-api)

## Installation

Add the following to your MCP client configuration file:

```json
{
  "mcpServers": {
    "dynamic-mockups": {
      "command": "npx",
      "args": ["-y", "@dynamic-mockups/mcp"],
      "env": {
        "DYNAMIC_MOCKUPS_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

### Config File Locations

| Client | Config File Path |
|--------|------------------|
| Claude Desktop (macOS) | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Claude Desktop (Windows) | `%APPDATA%\Claude\claude_desktop_config.json` |
| Claude Code (CLI) | `.mcp.json` in project root |
| Cursor | `.cursor/mcp.json` in project |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |

## Tools

| Tool | Description |
|------|-------------|
| `get_api_info` | Get API knowledge base (billing, rate limits, formats, best practices, support) |
| `get_catalogs` | Retrieve all available catalogs |
| `get_collections` | Retrieve collections (optionally filter by catalog) |
| `create_collection` | Create a new collection |
| `get_mockups` | Get list of available mockups with optional filters |
| `get_mockup_by_uuid` | Retrieve a specific mockup by UUID |
| `create_render` | Create a single mockup render with design assets (1 credit) |
| `create_batch_render` | Render multiple mockups in one request (1 credit per image) |
| `export_print_files` | Export high-resolution print files for production |
| `upload_psd` | Upload a PSD file and optionally create a mockup template |
| `delete_psd` | Delete a PSD file with optional related mockups deletion |

## Usage Examples

Ask your AI assistant:

| Use Case | Example Prompt |
|----------|----------------|
| List catalogs | "Get my Dynamic Mockups catalogs" |
| Browse mockups | "Show me all mockups in my T-shirt collection" |
| Single render | "Create a mockup render using any T-shirt mockup with my artwork from url: https://example.com/my-design.png" |
| Batch render | "Render my artwork from url: https://example.com/my-design.png on all mockups in the Winter T-shirt collection" |
| Create collection | "Create a new collection called Summer 2025 Hoodies" |
| Upload PSD | "Upload my PSD mockup from url: https://example.com/my-mockup.psd and create a template from it" |
| API info | "What are the rate limits and supported file formats for Dynamic Mockups?" |
| Print files | "Export print-ready files at 300 DPI for my poster mockup" |

## HTTP/SSE Transport (for web-based clients)

For web-based MCP clients like Lovable that require a URL endpoint instead of stdio, the server supports HTTP/SSE transport.

### Running HTTP Server Locally

```bash
DYNAMIC_MOCKUPS_API_KEY=your_key npm run start:http
```

The server will start on `http://localhost:3000` by default.

### HTTP Server Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `PORT` | 3000 | HTTP server port |
| `HOST` | 0.0.0.0 | Host to bind to |
| `CORS_ORIGIN` | * | Allowed CORS origins |
| `MCP_TRANSPORT` | stdio | Set to `http` to use HTTP transport |

### HTTP Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET, POST, DELETE | Main MCP endpoint (Streamable HTTP transport) |
| `/mcp` | GET, POST, DELETE | Alias for `/` |
| `/health` | GET | Health check endpoint |
| `/api/info` | GET | Server info and available tools |

### Connecting from Lovable (or similar clients)

1. **Deploy the server** to a hosting service (Railway, Render, Fly.io, etc.)
2. **Set environment variables** on your hosting platform:
   - `MCP_TRANSPORT`: `http`
   - _(No API key needed server-side - users provide their own)_
3. **In Lovable, enter:**
   - **Server URL**: `https://mcp.dynamicmockups.com` (or your own domain)
   - **API Key**: User's own Dynamic Mockups API key (get one at [app.dynamicmockups.com/dashboard-api](https://app.dynamicmockups.com/dashboard-api))

### API Key Authentication

For HTTP transport, each user provides their own Dynamic Mockups API key. The server accepts the API key via:

1. **Authorization header** (recommended): `Authorization: Bearer <api_key>`
2. **x-api-key header**: `x-api-key: <api_key>`

This means:
- **Users use their own credits** - each user's renders are charged to their account
- **No shared API key** - you don't need to configure an API key on the server
- **Secure** - API keys are sent per-request, not stored on the server

### Example: Deploy to Railway

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login and deploy
railway login
railway init
railway up
```

Set environment variables in Railway dashboard:
- `MCP_TRANSPORT=http`

That's it! Users will provide their own API keys when connecting.

## Development

### Local Installation

```bash
git clone https://github.com/dynamic-mockups/mcp.git
cd mcp-server
npm install
```

### Run Locally (stdio mode - default)

```bash
DYNAMIC_MOCKUPS_API_KEY=your_key npm start
```

### Run Locally (HTTP mode)

```bash
DYNAMIC_MOCKUPS_API_KEY=your_key npm run start:http
```

### Development Mode (with auto-reload)

```bash
# stdio mode
DYNAMIC_MOCKUPS_API_KEY=your_key npm run dev

# HTTP mode
DYNAMIC_MOCKUPS_API_KEY=your_key npm run dev:http
```

### Use Local Version in MCP Client

```json
{
  "mcpServers": {
    "dynamic-mockups": {
      "command": "node",
      "args": ["/path/to/mcp-server/src/index.js"],
      "env": {
        "DYNAMIC_MOCKUPS_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

## Error Handling

The server returns clear error messages for common issues:

- **API key not configured** - Set `DYNAMIC_MOCKUPS_API_KEY` in your environment
- **Invalid UUID** - Ensure UUIDs are in correct format
- **API errors** - Check the returned message for details

## Links

- [Dynamic Mockups Website](https://dynamicmockups.com)
- [API Documentation](https://docs.dynamicmockups.com)
- [Get API Key](https://app.dynamicmockups.com/dashboard-api)
- [GitHub Repository](https://github.com/dynamic-mockups/mcp)
- [GitHub Issues](https://github.com/dynamic-mockups/mcp/issues)

## License

MIT
