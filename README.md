# Dynamic Mockups MCP Server

Official MCP (Model Context Protocol) server for the [Dynamic Mockups API](https://dynamicmockups.com). Generate product mockups directly from AI assistants like Claude, Cursor, Windsurf, and more.

## Installation

### Quick Start with npx

No installation required - just configure your MCP client:

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

### Get Your API Key

1. Go to [Dynamic Mockups Dashboard](https://app.dynamicmockups.com/account/api-keys)
2. Create a new API key
3. Add it to your MCP client configuration

## Configuration by Client

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

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

### Claude Code (CLI)

Add to `.mcp.json` in your project root:

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

### Cursor

Add to `.cursor/mcp.json` in your project:

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

### Windsurf

Add to `~/.codeium/windsurf/mcp_config.json`:

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

## Available Tools

### API Information
- **`get_api_info`** - Get API knowledge base (billing, rate limits, formats, best practices, support)

### Catalogs
- **`get_catalogs`** - Retrieve all available catalogs

### Collections
- **`get_collections`** - Retrieve collections (optionally filter by catalog)
- **`create_collection`** - Create a new collection

### Mockups
- **`get_mockups`** - Get list of available mockups with optional filters
- **`get_mockup_by_uuid`** - Retrieve a specific mockup by UUID

### Rendering
- **`create_render`** - Create a single mockup render with design assets
- **`create_batch_render`** - Render multiple mockups in one request
- **`export_print_files`** - Export print files for smart objects

### PSD Files
- **`upload_psd`** - Upload a PSD file with optional mockup template creation
- **`delete_psd`** - Delete a PSD file with optional related mockups deletion

## Usage Examples

### Get Your Catalogs

Ask your AI assistant:
> "Get my Dynamic Mockups catalogs"

### Get Mockups from a Collection

> "Show me all mockups in my T-shirt collection"

### Create a Render

> "Create a mockup render using mockup UUID abc123 with my logo from https://example.com/logo.png"

### Batch Render

> "Render my design on all mockups in the Summer collection"

## Development

### Local Installation

```bash
git clone https://github.com/dynamicmockups/mcp-server.git
cd mcp-server
npm install
```

### Run Locally

```bash
DYNAMIC_MOCKUPS_API_KEY=your_key npm start
```

### Development Mode (with auto-reload)

```bash
DYNAMIC_MOCKUPS_API_KEY=your_key npm run dev
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
- [Get API Key](https://app.dynamicmockups.com/account/api-keys)
- [GitHub Issues](https://github.com/dynamicmockups/mcp-server/issues)

## License

MIT
