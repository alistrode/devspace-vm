import crypto from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { AccessDeniedError, InvalidGrantError, InvalidRequestError, InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, isInitializeRequest, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { checkResourceAllowed, resourceUrlFromServerUrl } from "@modelcontextprotocol/sdk/shared/auth-utils.js";
import express from "express";
import { loadConfig } from "./config.js";
import { readFileTool, writeFileTool, editFileTool, grepFilesTool, findFilesTool, listDirectoryTool, runShellTool } from "./pi-tools.js";
import { applyPatch } from "./apply-patch.js";
import { showChangesTool } from "./show-changes.js";
const text = (value) => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] });
function token() { return crypto.randomBytes(32).toString("base64url"); }
function same(left, right) {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function escapeHtml(value) {
    return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
function authorizationForm(client, params, error = "") {
    const fields = {
        response_type: "code", client_id: client.client_id, redirect_uri: params.redirectUri,
        code_challenge: params.codeChallenge, code_challenge_method: "S256", scope: params.scopes?.join(" "),
        state: params.state, resource: params.resource?.href,
    };
    const hidden = Object.entries(fields).filter(([, value]) => value !== undefined)
        .map(([key, value]) => `<input type="hidden" name="${key}" value="${escapeHtml(String(value))}">`).join("");
    return `<!doctype html><meta charset="utf-8"><title>Connect DevSpace</title><main><h1>Connect DevSpace</h1>${error ? `<p>${escapeHtml(error)}</p>` : ""}<form method="post">${hidden}<label>Owner password <input autofocus required name="owner_token" type="password"></label><button>Authorize DevSpace</button></form></main>`;
}
function createToolDefinitions() {
    return [
        {
            name: "open_workspace", title: "Open workspace",
            description: "Report the current local project directory used by this server.",
            inputSchema: { type: "object", properties: {}, additionalProperties: true },
            handler: async () => text(`Root: ${process.cwd()}`),
        },
        {
            name: "read", title: "Read file", description: "Read a file in the current working directory.",
            inputSchema: {
                type: "object",
                properties: {
                    path: { type: "string", description: "Path to the file to read." },
                    offset: { type: "number", description: "Line number to start reading from." },
                    limit: { type: "number", description: "Maximum number of lines to read." },
                },
                required: ["path"], additionalProperties: true,
            },
            handler: readFileTool,
        },
        {
            name: "write", title: "Write file", description: "Write complete content to a file.",
            inputSchema: {
                type: "object",
                properties: {
                    path: { type: "string", description: "Path to the file to write." },
                    content: { type: "string", description: "Complete file content." },
                },
                required: ["path", "content"], additionalProperties: true,
            },
            handler: writeFileTool,
        },
        {
            name: "edit", title: "Edit file", description: "Apply one or more exact text replacements to a file.",
            inputSchema: {
                type: "object",
                properties: {
                    path: { type: "string", description: "Path to the file to edit." },
                    edits: {
                        type: "array", description: "Exact text replacements.",
                        items: {
                            type: "object",
                            properties: {
                                oldText: { type: "string", description: "Exact original text." },
                                newText: { type: "string", description: "Replacement text." },
                            },
                            required: ["oldText", "newText"], additionalProperties: true,
                        },
                    },
                },
                required: ["path", "edits"], additionalProperties: true,
            },
            handler: editFileTool,
        },
        {
            name: "apply_patch", title: "Apply patch",
            description: "Apply the patch representation supported by the current server.",
            inputSchema: {
                type: "object",
                properties: { patch: { type: "string", description: "Patch content accepted by the current apply-patch handler." } },
                required: ["patch"], additionalProperties: true,
            },
            handler: async (input) => text(await applyPatch(process.cwd(), input.patch)),
        },
        {
            name: "show_changes", title: "Show changes",
            description: "Show Git working-tree changes since the previous call.",
            inputSchema: { type: "object", properties: {}, additionalProperties: true },
            handler: async () => showChangesTool(),
        },
        {
            name: "grep", title: "Grep", description: "Search file contents in the current working directory.",
            inputSchema: {
                type: "object",
                properties: {
                    pattern: { type: "string", description: "Search pattern." },
                    path: { type: "string", description: "Optional path scope." },
                },
                required: ["pattern"], additionalProperties: true,
            },
            handler: grepFilesTool,
        },
        {
            name: "glob", title: "Glob", description: "Find files by glob pattern.",
            inputSchema: {
                type: "object",
                properties: {
                    pattern: { type: "string", description: "File glob pattern." },
                    path: { type: "string", description: "Optional path scope." },
                },
                required: ["pattern"], additionalProperties: true,
            },
            handler: findFilesTool,
        },
        {
            name: "ls", title: "List directory", description: "List a directory in the current working directory.",
            inputSchema: {
                type: "object",
                properties: { path: { type: "string", description: "Directory path to list." } },
                required: ["path"], additionalProperties: true,
            },
            handler: listDirectoryTool,
        },
        {
            name: "bash", title: "Bash",
            description: "Run a shell command synchronously in the current working directory.",
            inputSchema: {
                type: "object",
                properties: {
                    command: { type: "string", description: "Shell command to execute." },
                    timeout: { type: "number", description: "Optional timeout in seconds." },
                },
                required: ["command"], additionalProperties: true,
            },
            handler: runShellTool,
        },
        {
            name: "exec_command", title: "Execute command",
            description: "Compatibility command runner that executes synchronously and does not retain a process session.",
            inputSchema: {
                type: "object",
                properties: {
                    command: { type: "string", description: "Shell command to execute." },
                    timeout: { type: "number", description: "Optional timeout in seconds." },
                },
                required: ["command"], additionalProperties: true,
            },
            handler: runShellTool,
        },
        {
            name: "write_stdin", title: "Write to process",
            description: "Interactive process sessions are not retained by this server.",
            inputSchema: { type: "object", properties: {}, additionalProperties: true },
            handler: async () => text("Interactive process sessions are not retained."),
        },
    ];
}
export async function createServer(config = loadConfig()) {
    const app = express();
    app.set("trust proxy", "loopback");
    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));
    const mcpUrl = new URL("/mcp", config.publicBaseUrl);
    const resourceServerUrl = resourceUrlFromServerUrl(mcpUrl);
    const clients = new Map();
    const codes = new Map();
    const accessTokens = new Map();
    const refreshTokens = new Map();
    const clientsStore = {
        async getClient(clientId) { return clients.get(clientId); },
        async registerClient(client) {
            clients.set(client.client_id, client);
            return client;
        },
    };
    const issue = (clientId, scopes, resource) => {
        const access = token();
        const refresh = token();
        const expiresAt = Math.floor(Date.now() / 1000) + 3600;
        const record = { clientId, scopes, expiresAt, resource: resource?.href };
        accessTokens.set(access, record);
        refreshTokens.set(refresh, record);
        return { access_token: access, token_type: "bearer", expires_in: 3600, refresh_token: refresh, scope: scopes.join(" ") };
    };
    const provider = {
        clientsStore,
        async authorize(client, params, res) {
            if (!params.resource || !checkResourceAllowed({ requestedResource: params.resource, configuredResource: resourceServerUrl }))
                throw new InvalidRequestError("Invalid OAuth resource");
            if (res.req.method !== "POST")
                return res.status(200).type("html").send(authorizationForm(client, params));
            if (!same(String(res.req.body?.owner_token ?? ""), config.ownerToken))
                return res.status(401).type("html").send(authorizationForm(client, params, "Owner password is incorrect."));
            const code = `code-${crypto.randomUUID()}`;
            codes.set(code, { clientId: client.client_id, params, expiresAt: Date.now() + 300000 });
            const redirect = new URL(params.redirectUri);
            redirect.searchParams.set("code", code);
            if (params.state !== undefined)
                redirect.searchParams.set("state", params.state);
            res.redirect(302, redirect.href);
        },
        async challengeForAuthorizationCode(client, code) {
            const record = codes.get(code);
            if (!record || record.clientId !== client.client_id || record.expiresAt < Date.now())
                throw new InvalidGrantError("Invalid authorization code");
            return record.params.codeChallenge;
        },
        async exchangeAuthorizationCode(client, code, _verifier, redirectUri, resource) {
            const record = codes.get(code);
            codes.delete(code);
            if (!record || record.clientId !== client.client_id || record.expiresAt < Date.now() || (redirectUri && redirectUri !== record.params.redirectUri))
                throw new InvalidGrantError("Invalid authorization code");
            if (!resource || !checkResourceAllowed({ requestedResource: resource, configuredResource: resourceServerUrl }))
                throw new InvalidGrantError("Invalid OAuth resource");
            return issue(client.client_id, record.params.scopes ?? ["devspace"], resource);
        },
        async exchangeRefreshToken(client, refresh, scopes, resource) {
            const record = refreshTokens.get(refresh);
            if (!record || record.clientId !== client.client_id || !resource || !checkResourceAllowed({ requestedResource: resource, configuredResource: resourceServerUrl }))
                throw new InvalidGrantError("Invalid refresh token");
            const requested = scopes ?? record.scopes;
            if (!requested.every((scope) => record.scopes.includes(scope)))
                throw new AccessDeniedError("Invalid scope");
            refreshTokens.delete(refresh);
            return issue(client.client_id, requested, resource);
        },
        async verifyAccessToken(value) {
            const record = accessTokens.get(value);
            if (!record || record.expiresAt < Math.floor(Date.now() / 1000))
                throw new InvalidTokenError("Invalid access token");
            return { token: value, clientId: record.clientId, scopes: record.scopes, expiresAt: record.expiresAt, resource: record.resource ? new URL(record.resource) : undefined };
        },
        async revokeToken(_client, request) { accessTokens.delete(request.token); refreshTokens.delete(request.token); },
    };
    app.use(mcpAuthRouter({ provider, issuerUrl: new URL(config.publicBaseUrl), baseUrl: new URL(config.publicBaseUrl), resourceServerUrl, scopesSupported: ["devspace"], resourceName: "DevSpace" }));
    app.get(["/.well-known/openid-configuration", "/mcp/.well-known/openid-configuration"], (_req, res) => res.json({
        issuer: config.publicBaseUrl, authorization_endpoint: `${config.publicBaseUrl}/authorize`, token_endpoint: `${config.publicBaseUrl}/token`, registration_endpoint: `${config.publicBaseUrl}/register`, response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"], token_endpoint_auth_methods_supported: ["client_secret_post", "none"], code_challenge_methods_supported: ["S256"], scopes_supported: ["devspace"],
    }));
    const bearerAuth = requireBearerAuth({ verifier: provider, requiredScopes: ["devspace"], resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(resourceServerUrl) });
    const transports = new Map();
    const servers = new Set();
    const createMcpServer = () => {
        const server = new Server({ name: "devspace", version: "1.0.0" }, {
            capabilities: { tools: {} },
            instructions: "Owner-authenticated direct local tools. Tool arguments are passed to handlers without Schema validation.",
        });
        const tools = createToolDefinitions();
        server.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: tools.map(({ handler: _handler, ...definition }) => definition),
        }));
        server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const tool = tools.find((candidate) => candidate.name === request.params.name);
            if (!tool)
                return { content: [{ type: "text", text: `Unknown tool: ${request.params.name}` }], isError: true };
            try {
                return await tool.handler(request.params.arguments ?? {});
            }
            catch (error) {
                return { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true };
            }
        });
        servers.add(server);
        return server;
    };
    app.all("/mcp", async (req, res) => {
        await new Promise((resolve, reject) => bearerAuth(req, res, (error) => error ? reject(error) : resolve()));
        if (res.headersSent)
            return;
        if (!req.auth?.resource || !checkResourceAllowed({ requestedResource: req.auth.resource, configuredResource: resourceServerUrl }))
            return res.status(401).json({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null });
        const sessionId = req.header("mcp-session-id");
        let transport = sessionId ? transports.get(sessionId) : undefined;
        if (!transport && req.method === "POST" && isInitializeRequest(req.body)) {
            transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => crypto.randomUUID(), onsessioninitialized: (id) => { transports.set(id, transport); } });
            transport.onclose = () => { if (transport?.sessionId)
                transports.delete(transport.sessionId); };
            await createMcpServer().connect(transport);
        }
        if (!transport)
            return res.status(400).json({ jsonrpc: "2.0", error: { code: -32000, message: "No valid MCP session" }, id: req.body?.id ?? null });
        await transport.handleRequest(req, res, req.body);
    });
    return { app, config, close: async () => { for (const transport of transports.values())
            await transport.close(); for (const server of servers)
            await server.close(); } };
}
