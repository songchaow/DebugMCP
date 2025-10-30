// Copyright (c) Microsoft Corporation.

import * as vscode from 'vscode';
import { z } from 'zod';
import * as path from 'path';
import * as fs from 'fs';
import { 
    DebuggingExecutor, 
    ConfigurationManager, 
    DebuggingHandler,
    IDebuggingHandler
} from '.';
import { logger } from './utils/logger';

// Dynamic import for FastMCP since it's an ES module
let FastMCP: any;

async function initializeFastMCP() {
    if (!FastMCP) {
        try {
            logger.info('Loading FastMCP module...');
            const fastmcpModule = await import('fastmcp');
            FastMCP = fastmcpModule.FastMCP;
            logger.info('FastMCP module loaded successfully');
        } catch (importError) {
            logger.error('Failed to load FastMCP module', importError);
            throw new Error(`Failed to import fastmcp module: ${importError}. This may be due to ES module compatibility issues in your environment.`);
        }
    }
}

/**
 * Main MCP server class that exposes debugging functionality as tools and resources
 */
export class DebugMCPServer {
    private server: any;
    private port: number;
    private initialized: boolean = false;
    private debuggingHandler: IDebuggingHandler;

    constructor(port: number, timeoutInSeconds: number) {
        // Initialize the debugging components with dependency injection
        const executor = new DebuggingExecutor();
        const configManager = new ConfigurationManager();
        this.debuggingHandler = new DebuggingHandler(executor, configManager, timeoutInSeconds);
        this.port = port;
    }

    /**
     * Initialize the MCP server
     */
    async initialize() {
        if (this.initialized) {
            return;
        }
        
        await initializeFastMCP();
        
        this.server = new FastMCP({
            name: 'debugmcp',
            version: '1.0.0',
        });

        this.setupTools();
        this.setupResources();
        this.initialized = true;
    }

    /**
     * Setup MCP tools that delegate to the debugging handler
     */
    private setupTools() {
        // Start debugging tool
        this.server.addTool({
            name: 'start_debugging',
            description: '⚠️ CRITICAL: First read debugmcp://docs/debug_instructions resource! Start a debug session for a source code file',
            parameters: z.object({
                fileFullPath: z.string().describe('Full path to the source code file to debug'),
                workingDirectory: z.string().optional().describe('Working directory for the debug session (optional)'),
            }),
            execute: async (args: { fileFullPath: string; workingDirectory?: string }) => {
                return await this.debuggingHandler.handleStartDebugging(args);
            },
        });

        // Stop debugging tool
        this.server.addTool({
            name: 'stop_debugging',
            description: 'Stop the current debug session',
            execute: async () => {
                return await this.debuggingHandler.handleStopDebugging();
            },
        });

        // Step over tool
        this.server.addTool({
            name: 'step_over',
            description: 'Execute the next line of code (step over function calls)',
            execute: async () => {
                return await this.debuggingHandler.handleStepOver();
            },
        });

        // Step into tool
        this.server.addTool({
            name: 'step_into',
            description: 'Step into the current function call',
            execute: async () => {
                return await this.debuggingHandler.handleStepInto();
            },
        });

        // Step out tool
        this.server.addTool({
            name: 'step_out',
            description: 'Step out of the current function',
            execute: async () => {
                return await this.debuggingHandler.handleStepOut();
            },
        });

        // Continue execution tool
        this.server.addTool({
            name: 'continue_execution',
            description: 'Continue execution until next breakpoint',
            execute: async () => {
                return await this.debuggingHandler.handleContinue();
            },
        });

        // Restart debugging tool
        this.server.addTool({
            name: 'restart_debugging',
            description: 'Restart the current debug session',
            execute: async () => {
                return await this.debuggingHandler.handleRestart();
            },
        });

        // Add breakpoint tool
        this.server.addTool({
            name: 'add_breakpoint',
            description: 'Add a breakpoint at a specific code line.',
            parameters: z.object({
                fileFullPath: z.string().describe('Full path to the file'),
                lineContent: z.string().describe('Line content'),
            }),
            execute: async (args: { fileFullPath: string; lineContent: string }) => {
                return await this.debuggingHandler.handleAddBreakpoint(args);
            },
        });

        // TODO clear breakpoints tool

        // Remove breakpoint tool
        this.server.addTool({
            name: 'remove_breakpoint',
            description: 'Remove a breakpoint from a specific line',
            parameters: z.object({
                fileFullPath: z.string().describe('Full path to the file'),
                line: z.number().describe('Line number (1-based)'),
            }),
            execute: async (args: { fileFullPath: string; line: number }) => {
                return await this.debuggingHandler.handleRemoveBreakpoint(args);
            },
        });

        // List breakpoints tool
        this.server.addTool({
            name: 'list_breakpoints',
            description: 'List all active breakpoints',
            execute: async () => {
                return await this.debuggingHandler.handleListBreakpoints();
            },
        });

        // Get variables tool
        this.server.addTool({
            name: 'get_variables_values',
            description: 'Get variables and their values at the current execution point',
            parameters: z.object({
                scope: z.enum(['local', 'global', 'all']).optional().describe("Variable scope: 'local', 'global', or 'all'"),
            }),
            execute: async (args: { scope?: 'local' | 'global' | 'all' }) => {
                return await this.debuggingHandler.handleGetVariables(args);
            },
        });

        // Evaluate expression tool
        this.server.addTool({
            name: 'evaluate_expression',
            description: 'Evaluate an expression in the current debug context (syntax depends on the programming language being debugged)',
            parameters: z.object({
                expression: z.string().describe('Expression to evaluate in the current programming language context'),
            }),
            execute: async (args: { expression: string }) => {
                return await this.debuggingHandler.handleEvaluateExpression(args);
            },
        });
    }

    /**
     * Setup MCP resources for documentation
     */
    private setupResources() {
        // Add MCP resources for debugging documentation
        this.server.addResource({
            uri: 'debugmcp://docs/debug_instructions',
            name: 'Debugging Instructions Guide',
            description: 'Step-by-step instructions for debugging with DebugMCP',
            mimeType: 'text/markdown',
            load: async () => {
                const content = await this.loadMarkdownFile('debug_instructions.md');
                return {
                    text: content
                };
            }
        });

        // Add language-specific resources
        const languages = ['python', 'javascript', 'java', 'csharp'];
        const languageTitles = {
            'python': 'Python Debugging Tips',
            'javascript': 'JavaScript Debugging Tips',
            'java': 'Java Debugging Tips',
            'csharp': 'C# Debugging Tips'
        };

        languages.forEach(language => {
            this.server.addResource({
                uri: `debugmcp://docs/troubleshooting/${language}`,
                name: languageTitles[language as keyof typeof languageTitles],
                description: `Debugging tips specific to ${language}`,
                mimeType: 'text/markdown',
                load: async () => {
                    const content = await this.loadMarkdownFile(`troubleshooting/${language}.md`);
                    return {
                        text: content
                    };
                }
            });
        });
    }

    /**
     * Load content from a Markdown file in the docs directory
     */
    private async loadMarkdownFile(relativePath: string): Promise<string> {
        try {
            // Get the extension's installation directory
            const extensionPath = __dirname; // This points to the compiled extension's directory
            const docsPath = path.join(extensionPath, '..', 'docs', relativePath);
            
            console.log(`Loading markdown file from: ${docsPath}`);
            
            // Read the file content
            const content = await fs.promises.readFile(docsPath, 'utf8');
            console.log(`Successfully loaded ${relativePath}, content length: ${content.length}`);
            
            return content;
        } catch (error) {
            console.error(`Failed to load ${relativePath}:`, error);
            return `Error loading documentation from ${relativePath}: ${error}`;
        }
    }

    /**
     * Check if the server is already running
     */
    private async isServerRunning(): Promise<boolean> {
        return new Promise<boolean>((resolve) => {
            const http = require('http');
            
            const request = http.request({
                hostname: 'localhost',
                port: this.port,
                path: '/',
                method: 'GET',
                timeout: 1000
            }, (response: any) => {
                resolve(true); // Server is responding
            });
            
            request.on('error', () => {
                resolve(false); // Server is not running
            });
            
            request.on('timeout', () => {
                request.destroy();
                resolve(false); // Server is not responding
            });
            
            request.end();
        });
    }

    /**
     * Start the MCP server
     */
    async start(): Promise<void> {
        // First check if server is already running
        const isRunning = await this.isServerRunning();
        if (isRunning) {
            logger.info(`DebugMCP server is already running on port ${this.port}`);
            return;
        }
        
        try {
            logger.info(`Starting DebugMCP server on port ${this.port}...`);
            
            await this.server.start({
                transportType: 'httpStream',
                httpStream: {
                    port: this.port,
                },
            });

            logger.info(`DebugMCP FastMCP server started successfully on port ${this.port}`);
            
        } catch (error) {
            logger.error(`Failed to start DebugMCP server`, error);
            throw new Error(`Failed to start DebugMCP server: ${error}`);
        }
    }

    /**
     * Stop the MCP server
     */
    async stop() {
        // FastMCP handles cleanup automatically
        console.log('DebugMCP FastMCP server stopped');
    }

    /**
     * Get the server endpoint
     */
    getEndpoint(): string {
        return `http://localhost:${this.port}`;
    }

    /**
     * Get the debugging handler (for testing purposes)
     */
    getDebuggingHandler(): IDebuggingHandler {
        return this.debuggingHandler;
    }

    /**
     * Check if the server is initialized
     */
    isInitialized(): boolean {
        return this.initialized;
    }
}
