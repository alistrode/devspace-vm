# DevSpace

DevSpace is an Owner-password-authenticated MCP server for direct local development tools.

Run `devspace init` to create the Owner password, then `devspace serve`. Visit `/authorize`, enter that password, exchange the returned authorization code at `/token`, and send the resulting Bearer token to `/mcp`.
