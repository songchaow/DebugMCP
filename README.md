# DebugMCP - VSCode Extension with MCP Server Integration

A VSCode extension that provides multi-language debugging capabilities and automatically exposes itself as an MCP (Model Context Protocol) server for integration with AI assistants.

## Features

### VSCode Extension Features
- **Multi-Language Debugging Controls**: Start, stop, step over, step into, step out, continue, pause, and restart debugging sessions
- **Breakpoint Management**: Add, remove, and list breakpoints  
- **Variables Inspection**: View local, global, and all variable scopes during debugging
- **Launch Configuration Support**: Uses existing launch.json configurations or creates appropriate defaults

### MCP Server Features
- **Automatic Registration**: When the extension is installed, it automatically becomes available as an MCP server
- **Full Debug Control**: All debugging operations are accessible via MCP tools
- **No Additional Setup**: No need to clone repositories or install separate servers

## Installation

1. Install the extension in VSCode, the extension will automatically activate itself as an MCP server.
2. Configure the MCP server in your AI assistant's settings:

> **Note**: No additional debugging rule instructions are needed - the extension works out of the box.

> **Tip**: For efficient debugging sessions, it's recommended to enable auto-approval for all tools in your AI assistant to avoid interruptions during step-by-step debugging operations.

### For Cline (VSCode Extension)
Add to your Cline settings or `cline_mcp_settings.json`:
```json
{
  "mcpServers": {
    "debugmcp": {
      "transport": "sse",
      "url": "http://localhost:3001/sse"
    }
  }
}
```

### For GitHub Copilot
Add to your Copilot workspace settings (`.vscode/settings.json`):
```json
{
  "github.copilot.mcp.servers": {
    "debugmcp": {
      "type": "sse",
      "url": "http://localhost:3001/sse"
    }
  }
}
```

### For Roo Code
Add to Roo's MCP settings:
```json
{
  "mcp": {
    "servers": {
      "debugmcp": {
        "type": "sse",
        "url": "http://localhost:3001/sse"
      }
    }
  }
}
```

## MCP Server Usage

Once installed, the extension provides the following MCP tools:

### Available Tools

1. **start_debugging** - Start a debug session for a source code file
   - Parameters: `filePath` (required), `workingDirectory` (optional), `configurationName` (optional)
   - Supports: Python, Node.js/JavaScript/TypeScript, Java, C#/.NET, C/C++, Go, Rust, PHP, Ruby

2. **stop_debugging** - Stop the current debug session

3. **step_over** - Execute the next line of code (step over function calls)

4. **step_into** - Step into function calls

5. **step_out** - Step out of the current function

6. **continue_execution** - Continue execution until next breakpoint

7. **restart_debugging** - Restart the current debug session

8. **add_breakpoint** - Add a breakpoint at a specific line
   - Parameters: `filePath` (required), `line` (required)

9. **remove_breakpoint** - Remove a breakpoint from a specific line
    - Parameters: `filePath` (required), `line` (required)

10. **list_breakpoints** - List all active breakpoints

11. **get_debug_status** - Get the current debug session status

12. **get_variables** - Get variables and their values at the current execution point
    - Parameters: `scope` (optional: 'local', 'global', or 'all')

13. **evaluate_expression** - Evaluate an expression in the current debug context (syntax depends on language)
    - Parameters: `expression` (required)

## How It Works

### Launch Configuration Integration
The extension handles debug configurations intelligently:

1. **Existing launch.json**: If a `.vscode/launch.json` file exists, it will:
   - Search for a relevant configuarion
   - Use a specific configuration if found

2. **Default Configuration**: If no launch.json exists or no relevant config, it creates an appropriate default configurations for each language based on file extension detection


## Requirements

- VSCode with appropriate language extensions installed:
  - **Python**: [Python extension](vscode:extension/ms-python.debugpy) for `.py` files
  - **JavaScript/TypeScript**: Built-in Node.js debugger or [JavaScript Debugger extension](vscode:extension/ms-vscode.js-debug)
  - **Java**: [Extension Pack for Java](vscode:extension/vscjava.vscode-java-pack)
  - **C#/.NET [Currenly Unsupported]**: [C# extension](vscode:extension/ms-dotnettools.csharp)
  - **C/C++**: [C/C++ extension](vscode:extension/ms-vscode.cpptools)
  - **Go**: [Go extension](vscode:extension/golang.go)
  - **Rust**: [rust-analyzer extension](vscode:extension/rust-lang.rust-analyzer)
  - **PHP**: [PHP Debug extension](vscode:extension/xdebug.php-debug)
  - **Ruby**: [Ruby extension](vscode:extension/rebornix.ruby) with debug support
- MCP-compatible AI assistant (Copilot, Cline, Roo..)

## Simplified Design

This extension is designed to be minimal - it only starts the MCP server when activated. All debugging functionality is accessed through the MCP interface, not through VSCode commands.

## Demo

<video width="800" controls>
  <source src="assets/DebugMCP.mp4" type="video/mp4">
  Your browser does not support the video tag. <a href="assets/DebugMCP.mp4">Download the demo video</a>
</video>

> Watch to see DebugMCP in action, showing the integration between the VSCode extension and an AI assistant using the MCP protocol.

## Architecture

The extension consists of several key components:

1. **Main Extension** (`src/extension.ts`) - Handles VSCode integration and command registration
2. **MCP Server** (`src/mcpServer.ts`) - Implements the MCP protocol with full VSCode API access

## Development

To build the extension:

```bash
npm install
npm run compile
```

## Contributing

This project welcomes contributions and suggestions. Most contributions require you to agree to a
Contributor License Agreement (CLA) declaring that you have the right to, and actually do, grant us
the rights to use your contribution. For details, visit https://cla.opensource.microsoft.com.

When you submit a pull request, a CLA bot will automatically determine whether you need to provide
a CLA and decorate the PR appropriately (e.g., status check, comment). Simply follow the instructions
provided by the bot. You will only need to do this once across all repos using our CLA.

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/).
For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or
contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

## Security

Security vulnerabilities should be reported following the guidance at [https://aka.ms/SECURITY.md](https://aka.ms/SECURITY.md).
Please do not report security vulnerabilities through public GitHub issues.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft 
trademarks or logos is subject to and must follow 
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.

## License

MIT License - See [LICENSE](LICENSE.txt) for details
