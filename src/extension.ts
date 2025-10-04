import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DebugMCPServer } from './mcpServer';

let mcpServer: DebugMCPServer | null = null;

export async function activate(context: vscode.ExtensionContext) {
    console.log('DebugMCP extension is now active!');

    // Initialize MCP Server
    try {
        mcpServer = new DebugMCPServer();
        await mcpServer.initialize();
        await mcpServer.start();
        
        const endpoint = mcpServer.getEndpoint();
        console.log(`DebugMCP server running at: ${endpoint}`);
    } catch (error) {
        console.error('Failed to initialize MCP server:', error);
        vscode.window.showErrorMessage(`Failed to initialize MCP server: ${error}`);
    }

    console.log('DebugMCP extension activated successfully');
}

export async function deactivate() {
    // Clean up MCP server
    if (mcpServer) {
        mcpServer.stop().catch(error => {
            console.error('Error stopping MCP server:', error);
        });
        mcpServer = null;
    }
    console.log('DebugMCP extension deactivated');
}
