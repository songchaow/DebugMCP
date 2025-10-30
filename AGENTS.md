# Agent Guidelines for DebugMCP

## File Header
Include the following header in each source file (adjust comment syntax as needed).
`// Copyright (c) Microsoft Corporation.`

## Build/Lint/Test Commands
- **Compile**: `npm run compile` - Compiles TypeScript to JavaScript in `out/` directory
- **Lint**: `npm run lint` - Runs ESLint on `src/` directory
- **Test**: `npm test` - Runs all tests (compiles + lints first via pretest)
- **Single Test**: Use VSCode Test Explorer or `npm test` (no CLI test filtering available)
- **Watch Mode**: `npm run watch` - Compiles TypeScript in watch mode

## Code Style & Conventions
- **TypeScript**: Strict mode enabled, target ES2022, Node16 modules
- **Imports**: Use camelCase/PascalCase naming. Import order: vscode → external → internal (e.g., `./utils/logger`)
- **Naming**: camelCase for variables/functions, PascalCase for classes/interfaces, prefix interfaces with `I` (e.g., `IDebuggingHandler`)
- **Types**: Explicit types preferred, use strict null checks, avoid `any` unless necessary
- **Error Handling**: Use try-catch with descriptive error messages, throw `Error` objects (not literals)
- **Formatting**: Use semicolons, curly braces for all control structures, consistent indentation (tabs)
- **Async**: Use async/await, handle promises properly, implement exponential backoff for retries
- **VSCode API**: Import as `import * as vscode from 'vscode'`, use proper disposal in `context.subscriptions`
- **Logging**: Use `logger` from `./utils/logger` for all logging (info/error/warn)
- **Dependencies**: fastmcp (MCP server), express (HTTP), zod (validation), @modelcontextprotocol/sdk

## Architecture Notes
- VSCode extension with MCP server for AI agent debugging capabilities
- Main entry: `extension.ts` → activates MCP server and registers commands
- Core: `debuggingHandler.ts` handles debug operations, `debuggingExecutor.ts` executes VSCode debug API calls
- State: `debugState.ts` tracks current debugging session state
