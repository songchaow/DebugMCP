// Copyright (c) Microsoft Corporation.

import * as vscode from 'vscode';
import { DebugMCPServer } from './debugMCPServer';
import { AgentConfigurationManager } from './utils/agentConfigurationManager';
import { logger, LogLevel } from './utils/logger';

let mcpServer: DebugMCPServer | null = null;
let agentConfigManager: AgentConfigurationManager | null = null;

export async function activate(context: vscode.ExtensionContext) {
    // Initialize logging first
    logger.info('DebugMCP extension is now active!');
    logger.logSystemInfo();
    logger.logEnvironment();

    const config = vscode.workspace.getConfiguration('debugmcp');
    const timeoutInSeconds = config.get<number>('timeoutInSeconds', 180);
    const serverPort = config.get<number>('serverPort', 3001);

    logger.info(`Using timeoutInSeconds: ${timeoutInSeconds} seconds`);
    logger.info(`Using serverPort: ${serverPort}`);

    // Initialize Agent Configuration Manager
    agentConfigManager = new AgentConfigurationManager(context, timeoutInSeconds, serverPort);

    // Initialize MCP Server
    try {
        logger.info('Starting MCP server initialization...');
        
        mcpServer = new DebugMCPServer(serverPort, timeoutInSeconds);
        await mcpServer.initialize();
        await mcpServer.start();
        
        const endpoint = mcpServer.getEndpoint();
        logger.info(`DebugMCP server running at: ${endpoint}`);
        vscode.window.showInformationMessage(`DebugMCP server running on ${endpoint}`);
    } catch (error) {
        logger.error('Failed to initialize MCP server', error);
        vscode.window.showErrorMessage(`Failed to initialize MCP server: ${error}`);
    }

    // Register commands
    registerCommands(context);

    // Show post-install popup if needed (with slight delay to allow VS Code to fully load)
    setTimeout(async () => {
        try {
            if (agentConfigManager && await agentConfigManager.shouldShowPopup()) {
                await agentConfigManager.showAgentSelectionPopup();
            }
        } catch (error) {
            logger.error('Error showing post-install popup', error);
        }
    }, 2000);

    logger.info('DebugMCP extension activated successfully');
}

/**
 * Register extension commands
 */
function registerCommands(context: vscode.ExtensionContext) {
    // Command to manually configure DebugMCP for agents
    const configureAgentsCommand = vscode.commands.registerCommand(
        'debugmcp.configureAgents',
        async () => {
            if (agentConfigManager) {
                await agentConfigManager.showManualConfiguration();
            }
        }
    );

    // Command to show agent selection popup again
    const showPopupCommand = vscode.commands.registerCommand(
        'debugmcp.showAgentSelectionPopup',
        async () => {
            if (agentConfigManager) {
                await agentConfigManager.showAgentSelectionPopup();
            }
        }
    );

    // Command to reset popup state (for development/testing)
    const resetPopupCommand = vscode.commands.registerCommand(
        'debugmcp.resetPopupState',
        async () => {
            if (agentConfigManager) {
                await agentConfigManager.resetPopupState();
                vscode.window.showInformationMessage('DebugMCP popup state has been reset.');
            }
        }
    );

    // Command to open log file
    const openLogFileCommand = vscode.commands.registerCommand(
        'debugmcp.openLogFile',
        async () => {
            try {
                const logPath = logger.getLogFilePath();
                const uri = vscode.Uri.file(logPath);
                await vscode.window.showTextDocument(uri);
            } catch (error) {
                logger.error('Failed to open log file', error);
                vscode.window.showErrorMessage(`Failed to open log file: ${error}`);
            }
        }
    );

    // Command to clear logs
    const clearLogsCommand = vscode.commands.registerCommand(
        'debugmcp.clearLogs',
        async () => {
            const choice = await vscode.window.showWarningMessage(
                'Are you sure you want to clear all DebugMCP logs?',
                'Clear Logs',
                'Cancel'
            );
            
            if (choice === 'Clear Logs') {
                logger.clearLogs();
                vscode.window.showInformationMessage('DebugMCP logs have been cleared.');
            }
        }
    );

    // Command to show server status
    const showServerStatusCommand = vscode.commands.registerCommand(
        'debugmcp.showServerStatus',
        async () => {
            const outputChannel = vscode.window.createOutputChannel('DebugMCP Status');
            outputChannel.clear();
            
            const stats = logger.getLogStats();
            
            outputChannel.appendLine('DebugMCP Server Status');
            outputChannel.appendLine('====================');
            
            if (mcpServer) {
                const isInitialized = mcpServer.isInitialized();
                const endpoint = mcpServer.getEndpoint();
                
                outputChannel.appendLine(`Server Initialized: ${isInitialized}`);
                outputChannel.appendLine(`Server Endpoint: ${endpoint}`);
                
                // Test if server is responding on MCP endpoint
                const checkServerStatus = (): Promise<string> => {
                    return new Promise((resolve, reject) => {
                        const http = require('http');
                        
                        const config = vscode.workspace.getConfiguration('debugmcp');
                        const serverPort = config.get<number>('serverPort', 3001);
                        
                        const request = http.request({
                            hostname: 'localhost',
                            port: serverPort,
                            path: '/sse',  // FastMCP uses /sse endpoint for Server-Sent Events
                            method: 'GET',
                            headers: {
                                'Accept': 'text/event-stream',
                                'Cache-Control': 'no-cache'
                            }
                        }, (response: any) => {
                            if (response.statusCode === 200) {
                                resolve('✅ Running and responding correctly');
                            } else if (response.statusCode === 404) {
                                resolve('⚠️ Running but root path not found (this is normal for MCP servers)');
                            } else {
                                resolve(`Running (HTTP ${response.statusCode})`);
                            }
                        });
                        
                        request.on('error', (error: any) => {
                            if (error.code === 'ECONNREFUSED') {
                                reject('❌ Not running (connection refused)');
                            } else if (error.code === 'ETIMEDOUT') {
                                reject('⏱️ Timeout - server may not be responding');
                            } else {
                                reject(`❌ Not responding (${error.message})`);
                            }
                        });
                        
                        // Set timeout using setTimeout for proper cleanup
                        const timeoutHandle = setTimeout(() => {
                            request.destroy();
                            reject('⏱️ Timeout - server may not be responding');
                        }, 2000);
                        
                        // Clear timeout if request completes normally
                        request.on('response', () => {
                            clearTimeout(timeoutHandle);
                        });
                        
                        request.on('error', () => {
                            clearTimeout(timeoutHandle);
                        });
                        
                        request.end();
                    });
                };
                
                try {
                    const status = await checkServerStatus();
                    outputChannel.appendLine(`Server Status: ${status}`);
                } catch (error) {
                    outputChannel.appendLine(`Server Status: ${error}`);
                }
                outputChannel.show();
            } else {
                outputChannel.appendLine('Server Status: Not initialized');
                outputChannel.show();
            }
        }
    );

    context.subscriptions.push(
        configureAgentsCommand,
        showPopupCommand,
        resetPopupCommand,
        openLogFileCommand,
        clearLogsCommand,
        showServerStatusCommand
    );
}

export async function deactivate() {
    logger.info('DebugMCP extension deactivating...');
    
    // Clean up MCP server
    if (mcpServer) {
        mcpServer.stop().catch(error => {
            logger.error('Error stopping MCP server', error);
        });
        mcpServer = null;
    }
    
    logger.info('DebugMCP extension deactivated');
}
