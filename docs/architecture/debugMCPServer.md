# DebugMCPServer

## Purpose

The MCP server component that exposes VS Code debugging capabilities to AI agents via the Model Context Protocol. This is the main entry point for all external AI agent communication.

## Motivation

AI coding agents need a standardized way to control debuggers programmatically. MCP provides this standard, and `DebugMCPServer` implements it using the official `@modelcontextprotocol/sdk` with Server-Sent Events (SSE) transport over an express HTTP server for real-time bidirectional communication.

## Responsibility

- Initialize and manage the MCP server lifecycle (using `McpServer` from `@modelcontextprotocol/sdk`)
- Register debugging tools that AI agents can invoke
- Register documentation resources for agent guidance
- Delegate all debugging operations to `DebuggingHandler`
- Manage SSE transport connections via `SSEServerTransport` on configurable port (default: 3001)

## Architecture Position

```
AI Agent (MCP Client)
        │
        ▼ SSE Connection (GET /sse + POST /messages)
┌───────────────────┐
│  DebugMCPServer   │  ◄── You are here
│  (express + SSE)  │
└───────────────────┘
        │
        ▼ Delegates to
┌───────────────────┐
│ DebuggingHandler  │
└───────────────────┘
```

## Key Concepts

### Tools vs Resources

- **Tools**: Actions the AI can perform (start debugging, step over, etc.)
- **Resources**: Documentation the AI can read for guidance

### SSE Transport

Uses HTTP with Server-Sent Events for persistent connections. The express server exposes two endpoints:
- `GET /sse` — Establishes the SSE stream and creates a session
- `POST /messages?sessionId=...` — Receives JSON-RPC messages from the client

Each client connection creates an `SSEServerTransport` instance that is connected to the `McpServer`. The server tracks active transports by session ID and cleans them up on disconnect.

## Key Code Locations

- Class definition: `src/debugMCPServer.ts`
- Tool registration: `setupTools()` method (uses `McpServer.registerTool()`)
- Resource registration: `setupResources()` method (uses `McpServer.registerResource()`)
- Server startup: `start()` method (creates express app with SSE/message routes)

## Exposed Tools

| Tool | Description |
|------|-------------|
| `start_debugging` | Start a debug session |
| `stop_debugging` | Stop current session |
| `step_over/into/out` | Stepping commands |
| `continue_execution` | Continue to next breakpoint |
| `restart_debugging` | Restart session |
| `add/remove_breakpoint` | Breakpoint management |
| `clear_all_breakpoints` | Remove all breakpoints |
| `list_breakpoints` | List active breakpoints |
| `get_variables_values` | Inspect variable values |
| `evaluate_expression` | Evaluate expressions |

## Exposed Resources

| URI | Content |
|-----|---------|
| `debugmcp://docs/debug_instructions` | General debugging guide |
| `debugmcp://docs/troubleshooting/*` | Language-specific tips |

## Configuration

- `debugmcp.serverPort`: Port number (default: 3001)
- `debugmcp.timeoutInSeconds`: Operation timeout (default: 180)