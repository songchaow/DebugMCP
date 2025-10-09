import * as vscode from 'vscode';
import { z } from 'zod';
import * as path from 'path';
import * as fs from 'fs';

// Dynamic import for FastMCP since it's an ES module
let FastMCP: any;

async function initializeFastMCP() {
    if (!FastMCP) {
        const fastmcpModule = await import('fastmcp');
        FastMCP = fastmcpModule.FastMCP;
    }
}

class DebugState {
    public sessionActive: boolean;
    public fileFullPath: string | null;
    public fileName: string | null;
    public currentLine: number | null;
    public currentLineContent: string | null;
    public nextLines: string[];
    public frameId: number | null;
    public threadId: number | null;

    constructor() {
        this.sessionActive = false;
        this.fileFullPath = null;
        this.fileName = null;
        this.currentLine = null;
        this.currentLineContent = null;
        this.nextLines = [];
        this.frameId = null;
        this.threadId = null;
    }
}

const AutoLaunchConfig = 'Default Configuration';
export class DebugMCPServer {
    private server: any;
    private port: number = 3001;
    private initialized: boolean = false;
    private readonly numNextLines: number = 3;


    constructor() {
        // Initialization will happen in initialize() method
    }

    /**
     * Load content from a Markdown file in the docs directory
     * @param relativePath - Path relative to the docs directory (e.g., 'debug_instructions.md')
     * @returns Promise<string> - The file content or error message
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

    private setupTools() {
        // Start debugging tool
        this.server.addTool({
            name: 'start_debugging',
            description: 'Start a debug session for a source code file. Before using this tool, make sure to read debugmcp://docs/debug_instructions for step-by-step instructions.',
            parameters: z.object({
                fileFullPath: z.string().describe('Full path to the source code file to debug'),
                workingDirectory: z.string().optional().describe('Working directory for the debug session (optional)'),
            }),
            execute: async (args: { fileFullPath: string; workingDirectory?: string; configurationName?: string }) => {
                return await this.handleStartDebugging(args);
            },
        });

        // Stop debugging tool
        this.server.addTool({
            name: 'stop_debugging',
            description: 'Stop the current debug session',
            execute: async () => {
                return await this.handleStopDebugging();
            },
        });

        // Step over tool
        this.server.addTool({
            name: 'step_over',
            description: 'Execute the next line(s) of code (step over function calls)',
            parameters: z.object({
                steps: z.number().max(this.numNextLines).optional().default(1).describe('Number of steps to step over, default 1'),
            }),
            execute: async (args: { steps?: number }) => {
                return await this.handleStepOver(args);
            },
        });

        // Step into tool
        this.server.addTool({
            name: 'step_into',
            description: 'Step into the current function call',
            execute: async () => {
                return await this.handleStepInto();
            },
        });

        // Step out tool
        this.server.addTool({
            name: 'step_out',
            description: 'Step out of the current function',
            execute: async () => {
                return await this.handleStepOut();
            },
        });

        // Continue execution tool
        this.server.addTool({
            name: 'continue_execution',
            description: 'Continue execution until next breakpoint',
            execute: async () => {
                return await this.handleContinue();
            },
        });

        // Restart debugging tool
        this.server.addTool({
            name: 'restart_debugging',
            description: 'Restart the current debug session',
            execute: async () => {
                return await this.handleRestart();
            },
        });

        // Add breakpoint tool
        this.server.addTool({
            name: 'add_breakpoint',
            description: 'Add a breakpoint at a specific code line.',
            parameters: z.object({
                fileFullPath: z.string().describe('Full path to the file'),
                line: z.string().describe('Line content'),
            }),
            execute: async (args: { fileFullPath: string; line: string }) => {
                // find the line number containing the line content
                const document = await vscode.workspace.openTextDocument(vscode.Uri.file(args.fileFullPath));
                const text = document.getText();
                const lines = text.split(/\r?\n/);
                let lineNumber = -1;
                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].includes(args.line)) {
                        lineNumber = i + 1;
                        break;
                    }
                }
                return await this.handleAddBreakpoint({ ...args, lineNumber: lineNumber });
            },
        });

        // Remove breakpoint tool
        this.server.addTool({
            name: 'remove_breakpoint',
            description: 'Remove a breakpoint from a specific line',
            parameters: z.object({
                fileFullPath: z.string().describe('Full path to the file'),
                line: z.number().describe('Line number (1-based)'),
            }),
            execute: async (args: { fileFullPath: string; line: number }) => {
                return await this.handleRemoveBreakpoint(args);
            },
        });

        // List breakpoints tool
        this.server.addTool({
            name: 'list_breakpoints',
            description: 'List all active breakpoints',
            execute: async () => {
                return await this.handleListBreakpoints();
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
                return await this.handleGetVariables(args);
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
                return await this.handleEvaluateExpression(args);
            },
        });
    }

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

        this.server.addResource({
            uri: 'debugmcp://docs/troubleshooting',
            name: 'Debugging Troubleshooting Guide',
            description: 'Common issues and solutions for debugging problems',
            mimeType: 'text/markdown',
            load: async () => {
                const content = await this.loadMarkdownFile('troubleshooting.md');
                return {
                    text: content
                };
            }
        });

        // Add language-specific resources
        const languages = ['python', 'javascript', 'java'];
        const languageTitles = {
            'python': 'Python Debugging Tips',
            'javascript': 'JavaScript Debugging Tips',
            'java': 'Java Debugging Tips'
        };

        languages.forEach(language => {
            this.server.addResource({
                uri: `debugmcp://docs/languages/${language}`,
                name: languageTitles[language as keyof typeof languageTitles],
                description: `Debugging tips specific to ${language}`,
                mimeType: 'text/markdown',
                load: async () => {
                    const content = await this.loadMarkdownFile(`languages/${language}.md`);
                    return {
                        text: content
                    };
                }
            });
        });
    }

    private detectLanguageFromFilePath(fileFullPath: string): string {
        const extension = path.extname(fileFullPath).toLowerCase();
        
        const languageMap: { [key: string]: string } = {
            '.py': 'python',
            '.js': 'node',
            '.ts': 'node',
            '.jsx': 'node',
            '.tsx': 'node',
            '.java': 'java',
            '.cs': 'coreclr',
            '.cpp': 'cppdbg',
            '.cc': 'cppdbg',
            '.c': 'cppdbg',
            '.go': 'go',
            '.rs': 'lldb',
            '.php': 'php',
            '.rb': 'ruby'
        };

        return languageMap[extension] || 'python'; // Default to python if unknown
    }

    private async handleStartDebugging(args: any): Promise<string> {
        const { fileFullPath, workingDirectory } = args;
        
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                throw new Error('No workspace folder found');
            }
            
            let selectedConfigName = await this.promptForConfiguration(workspaceFolder);
            
            // Get debug configuration from launch.json or create default
            const debugConfig = await this.getDebugConfig(workspaceFolder, fileFullPath, workingDirectory, selectedConfigName);

            const started = await vscode.debug.startDebugging(workspaceFolder, debugConfig);
            if (started) {
                const configInfo = selectedConfigName ? ` using configuration '${selectedConfigName}'` : ' with default configuration';
                return `Debug session started successfully for: ${fileFullPath}${configInfo}`;
            } else {
                throw new Error('Failed to start debug session. Make sure the appropriate language extension is installed.');
            }
        } catch (error) {
            throw new Error(`Error starting debug session: ${error}`);
        }
    }

    private async handleStopDebugging(): Promise<string> {
        try {
            const activeSession = vscode.debug.activeDebugSession;
            if (activeSession) {
                await vscode.debug.stopDebugging(activeSession);

                // Clear breakpoints option
                const breakpointCount = vscode.debug.breakpoints.length;
                if (breakpointCount > 0) {
                    vscode.debug.removeBreakpoints(vscode.debug.breakpoints);
                    return `Debug session stopped successfully. Cleared ${breakpointCount} breakpoint(s).`;
                } else {
                    return 'Debug session stopped successfully';
                }
            } else {
                return 'No active debug session to stop';
            }
        } catch (error) {
            throw new Error(`Error stopping debug session: ${error}`);
        }
    }

    private async handleStepOver(args?: { steps?: number }): Promise<string> {
        try {
            const activeSession = vscode.debug.activeDebugSession;
            if (!activeSession) {
                throw new Error('No active debug session');
            }

            const steps = args?.steps || 1;
            
            // Execute step over command the specified number of times
            for (let i = 0; i < steps; i++) {
                await vscode.commands.executeCommand('workbench.action.debug.stepOver');
                
                // Wait a bit for the debugger to update the position
                await new Promise(resolve => setTimeout(resolve, 300));
            }
            
            // Get the current debug state
            const debugState = await this.getCurrentDebugState();
            
            // Format the debug state as a string
            return this.formatDebugState(debugState);
        } catch (error) {
            throw new Error(`Error executing step over: ${error}`);
        }
    }

    private async handleStepInto(): Promise<string> {
        try {
            const activeSession = vscode.debug.activeDebugSession;
            if (!activeSession) {
                throw new Error('No active debug session');
            }

            // Execute step into command
            await vscode.commands.executeCommand('workbench.action.debug.stepInto');
            
            // Wait a bit for the debugger to update the position
            await new Promise(resolve => setTimeout(resolve, 300));
            
            // Get the current debug state
            const debugState = await this.getCurrentDebugState();
            
            // Format the debug state as a string
            return this.formatDebugState(debugState);
        } catch (error) {
            throw new Error(`Error executing step into: ${error}`);
        }
    }

    private async handleStepOut(): Promise<string> {
        try {
            const activeSession = vscode.debug.activeDebugSession;
            if (!activeSession) {
                throw new Error('No active debug session');
            }

            // Execute step out command
            await vscode.commands.executeCommand('workbench.action.debug.stepOut');
            
            // Wait a bit for the debugger to update the position
            await new Promise(resolve => setTimeout(resolve, 300));
            
            // Get the current debug state
            const debugState = await this.getCurrentDebugState();
            
            // Format the debug state as a string
            return this.formatDebugState(debugState);
        } catch (error) {
            throw new Error(`Error executing step out: ${error}`);
        }
    }

    private async handleContinue(): Promise<string> {
        try {
            const activeSession = vscode.debug.activeDebugSession;
            if (activeSession) {
                await vscode.commands.executeCommand('workbench.action.debug.continue');
                
                // Wait a bit for the debugger to update the position
                await new Promise(resolve => setTimeout(resolve, 300));
                
                // Get the current debug state
                const debugState = await this.getCurrentDebugState();
                
                // Format the debug state as a string
                return this.formatDebugState(debugState);
            } else {
                throw new Error('No active debug session');
            }
        } catch (error) {
            throw new Error(`Error executing continue: ${error}`);
        }
    }

    private async handleRestart(): Promise<string> {
        try {
            const activeSession = vscode.debug.activeDebugSession;
            if (activeSession) {
                await vscode.commands.executeCommand('workbench.action.debug.restart');
                return 'Debug session restarted successfully';
            } else {
                throw new Error('No active debug session to restart');
            }
        } catch (error) {
            throw new Error(`Error restarting debug session: ${error}`);
        }
    }

    private async handleAddBreakpoint(args: any): Promise<string> {
        const { fileFullPath, lineNumber } = args;
        
        try {
            const uri = vscode.Uri.file(fileFullPath);
            const breakpoint = new vscode.SourceBreakpoint(
                new vscode.Location(uri, new vscode.Position(lineNumber - 1, 0))
            );
            
            vscode.debug.addBreakpoints([breakpoint]);
            return `Breakpoint added at ${fileFullPath}:${lineNumber}`;
        } catch (error) {
            throw new Error(`Error adding breakpoint: ${error}`);
        }
    }

    private async handleRemoveBreakpoint(args: any): Promise<string> {
        const { fileFullPath, line } = args;
        
        try {
            const uri = vscode.Uri.file(fileFullPath);
            const breakpoints = vscode.debug.breakpoints.filter(bp => {
                if (bp instanceof vscode.SourceBreakpoint) {
                    return bp.location.uri.toString() === uri.toString() && 
                           bp.location.range.start.line === line - 1;
                }
                return false;
            });
            
            if (breakpoints.length > 0) {
                vscode.debug.removeBreakpoints(breakpoints);
                return `Breakpoint removed from ${fileFullPath}:${line}`;
            } else {
                return `No breakpoint found at ${fileFullPath}:${line}`;
            }
        } catch (error) {
            throw new Error(`Error removing breakpoint: ${error}`);
        }
    }

    private async handleListBreakpoints(): Promise<string> {
        try {
            const breakpoints = vscode.debug.breakpoints;
            if (breakpoints.length === 0) {
                return 'No breakpoints currently set';
            }

            let breakpointList = 'Active Breakpoints:\n';
            breakpoints.forEach((bp, index) => {
                if (bp instanceof vscode.SourceBreakpoint) {
                    const fileName = bp.location.uri.fsPath.split(/[/\\]/).pop();
                    const line = bp.location.range.start.line + 1;
                    breakpointList += `${index + 1}. ${fileName}:${line}\n`;
                } else if (bp instanceof vscode.FunctionBreakpoint) {
                    breakpointList += `${index + 1}. Function: ${bp.functionName}\n`;
                }
            });

            return breakpointList;
        } catch (error) {
            throw new Error(`Error listing breakpoints: ${error}`);
        }
    }

    private async handleGetVariables(args: any): Promise<string> {
        const { scope = 'all' } = args;
        
        try {
            const activeSession = vscode.debug.activeDebugSession;
            if (!activeSession) {
                throw new Error('No active debug session. Start debugging first.');
            }

            const activeStackItem = vscode.debug.activeStackItem;
            if (!activeStackItem || !('frameId' in activeStackItem)) {
                throw new Error('No active stack frame. Make sure execution is paused at a breakpoint.');
            }

            const response = await activeSession.customRequest('scopes', {
                frameId: activeStackItem.frameId
            });

            if (!response || !response.scopes || response.scopes.length === 0) {
                return 'No variable scopes available at current execution point.';
            }

            let variablesInfo = 'Variables:\n==========\n\n';

            for (const scopeItem of response.scopes) {
                // Filter scopes based on the requested scope
                if (scope !== 'all') {
                    const scopeName = scopeItem.name.toLowerCase();
                    if (scope === 'local' && !scopeName.includes('local')) {
                        continue;
                    }
                    if (scope === 'global' && !scopeName.includes('global')) {
                        continue;
                    }
                }

                variablesInfo += `${scopeItem.name}:\n`;
                
                try {
                    const variablesResponse = await activeSession.customRequest('variables', {
                        variablesReference: scopeItem.variablesReference
                    });

                    if (variablesResponse && variablesResponse.variables) {
                        for (const variable of variablesResponse.variables) {
                            variablesInfo += `  ${variable.name}: ${variable.value}`;
                            if (variable.type) {
                                variablesInfo += ` (${variable.type})`;
                            }
                            variablesInfo += '\n';
                        }
                    }
                } catch (scopeError) {
                    variablesInfo += `  Error retrieving variables: ${scopeError}\n`;
                }
                
                variablesInfo += '\n';
            }

            return variablesInfo;
        } catch (error) {
            throw new Error(`Error getting variables: ${error}`);
        }
    }

    private async handleEvaluateExpression(args: any): Promise<string> {
        const { expression } = args;
        
        try {
            const activeSession = vscode.debug.activeDebugSession;
            if (!activeSession) {
                throw new Error('No active debug session. Start debugging first.');
            }

            const activeStackItem = vscode.debug.activeStackItem;
            if (!activeStackItem || !('frameId' in activeStackItem)) {
                throw new Error('No active stack frame. Make sure execution is paused at a breakpoint.');
            }

            const response = await activeSession.customRequest('evaluate', {
                expression: expression,
                frameId: activeStackItem.frameId,
                context: 'repl'
            });

            if (response && response.result !== undefined) {
                let resultText = `Expression: ${expression}\n`;
                resultText += `Result: ${response.result}`;
                if (response.type) {
                    resultText += ` (${response.type})`;
                }

                return resultText;
            } else {
                throw new Error('Failed to evaluate expression');
            }
        } catch (error) {
            throw new Error(`Error evaluating expression: ${error}`);
        }
    }

    private async promptForConfiguration(workspaceFolder: vscode.WorkspaceFolder): Promise<string | undefined> {
        try {
            // Look for launch.json in .vscode folder
            const launchJsonPath = vscode.Uri.joinPath(workspaceFolder.uri, '.vscode', 'launch.json');
            
            let configurations: any[] = [];
            
            try {
                const launchJsonDoc = await vscode.workspace.openTextDocument(launchJsonPath);
                const launchJsonContent = launchJsonDoc.getText();
                
                // Parse the JSON (removing comments first)
                const cleanJson = launchJsonContent.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
                const launchConfig = JSON.parse(cleanJson);
                
                if (launchConfig.configurations && Array.isArray(launchConfig.configurations)) {
                    configurations = launchConfig.configurations;
                }
            } catch (launchJsonError) {
                console.log('Could not read or parse launch.json:', launchJsonError);
            }
            
            if (configurations.length === 0) {
                // No configurations available, will use default
                return undefined;
            }
            
            // Create configuration options for user selection
            const configOptions: vscode.QuickPickItem[] = [
                {
                    label: AutoLaunchConfig,
                    description: 'Use auto-detected default configuration',
                    detail: 'DebugMCP will create a default configuration based on file extension'
                },
                ...configurations.map(config => ({
                    label: config.name || 'Unnamed Configuration',
                    description: config.type ? `Type: ${config.type}` : '',
                    detail: config.request ? `Request: ${config.request}` : ''
                }))
            ];
            
            // Show quick pick to user
            const selected = await vscode.window.showQuickPick(configOptions, {
                placeHolder: 'Select a debug configuration to use',
                title: 'Choose Debug Configuration'
            });
            
            if (!selected) {
                // User cancelled the selection
                throw new Error('Debug configuration selection cancelled by user');
            }
                        
            return selected.label;
        } catch (error) {
            console.log('Error prompting for configuration:', error);
            throw error;
        }
    }

    private async getDebugConfig(workspaceFolder: vscode.WorkspaceFolder, fileFullPath: string, workingDirectory?: string, configurationName?: string): Promise<vscode.DebugConfiguration> {
       
        if (configurationName === AutoLaunchConfig) {
            return this.createDefaultDebugConfig(fileFullPath, workingDirectory, workspaceFolder);
        }

        // Look for launch.json in .vscode folder
        const launchJsonPath = vscode.Uri.joinPath(workspaceFolder.uri, '.vscode', 'launch.json');
        
        const launchJsonDoc = await vscode.workspace.openTextDocument(launchJsonPath);
        const launchJsonContent = launchJsonDoc.getText();
        
        // Parse the JSON (removing comments first)
        const cleanJson = launchJsonContent.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
        const launchConfig = JSON.parse(cleanJson);
        
        if (launchConfig.configurations && Array.isArray(launchConfig.configurations) && launchConfig.configurations.length > 0) {
            // If a specific configuration name is provided, find it
            if (configurationName) {
                const namedConfig = launchConfig.configurations.find((config: any) => 
                    config.name === configurationName
                );
                if (namedConfig) {
                    return {
                        ...namedConfig,
                        program: fileFullPath, // Override program to our specific file
                        cwd: workingDirectory || namedConfig.cwd || workspaceFolder.uri.fsPath,
                        name: `DebugMCP Launch (${configurationName})`
                    };
                }
                console.log(`No configuration named '${configurationName}' found in launch.json`);
            }
        }

        // Fallback: always return a default configuration if nothing else matched
        return this.createDefaultDebugConfig(fileFullPath, workingDirectory, workspaceFolder);
    }

    private createDefaultDebugConfig(fileFullPath: string, workingDirectory: string | undefined, workspaceFolder: vscode.WorkspaceFolder): vscode.DebugConfiguration {
        const detectedLanguage = this.detectLanguageFromFilePath(fileFullPath);
        
        const configs: { [key: string]: vscode.DebugConfiguration } = {
            python: {
                type: 'python',
                request: 'launch',
                name: 'DebugMCP Python Launch',
                program: fileFullPath,
                console: 'integratedTerminal',
                cwd: workingDirectory || workspaceFolder.uri.fsPath,
                env: {},
                stopOnEntry: false
            },
            node: {
                type: 'pwa-node',
                request: 'launch',
                name: 'DebugMCP Node.js Launch',
                program: fileFullPath,
                console: 'integratedTerminal',
                cwd: workingDirectory || workspaceFolder.uri.fsPath,
                env: {},
                stopOnEntry: false
            },
            java: {
                type: 'java',
                request: 'launch',
                name: 'DebugMCP Java Launch',
                mainClass: path.basename(fileFullPath, path.extname(fileFullPath)),
                console: 'integratedTerminal',
                cwd: workingDirectory || workspaceFolder.uri.fsPath
            },
            coreclr: {
                type: 'coreclr',
                request: 'launch',
                name: 'DebugMCP .NET Launch',
                program: fileFullPath,
                console: 'integratedTerminal',
                cwd: workingDirectory || workspaceFolder.uri.fsPath,
                stopAtEntry: false
            },
            cppdbg: {
                type: 'cppdbg',
                request: 'launch',
                name: 'DebugMCP C++ Launch',
                program: fileFullPath.replace(/\.(cpp|cc|c)$/, ''),
                cwd: workingDirectory || workspaceFolder.uri.fsPath,
                console: 'integratedTerminal'
            },
            go: {
                type: 'go',
                request: 'launch',
                name: 'DebugMCP Go Launch',
                mode: 'debug',
                program: fileFullPath,
                cwd: workingDirectory || workspaceFolder.uri.fsPath
            }
        };

        return configs[detectedLanguage] || configs.python; // Fallback to Python if unknown
    }

    private async getCurrentDebugState(): Promise<DebugState> {
        const state = new DebugState();
        
        try {
            const activeSession = vscode.debug.activeDebugSession;
            if (activeSession) {
                state.sessionActive = true;
                
                const activeStackItem = vscode.debug.activeStackItem;
                if (activeStackItem && 'frameId' in activeStackItem) {
                    state.frameId = activeStackItem.frameId;
                    state.threadId = activeStackItem.threadId;
                    
                    // Get the active editor
                    const activeEditor = vscode.window.activeTextEditor;
                    if (activeEditor) {
                        state.fileFullPath = activeEditor.document.fileName;
                        state.fileName = activeEditor.document.fileName.split(/[/\\]/).pop() || null;
                        state.currentLine = activeEditor.selection.active.line + 1; // 1-based line number
                        state.currentLineContent = activeEditor.document.lineAt(activeEditor.selection.active.line).text.trim();
                        
                        // Get next lines
                        const nextLines = [];
                        for (let i = 1; i <= this.numNextLines; i++) {
                            if (activeEditor.selection.active.line + i < activeEditor.document.lineCount) {
                                nextLines.push(activeEditor.document.lineAt(activeEditor.selection.active.line + i).text.trim());
                            }
                        }
                        state.nextLines = nextLines;
                    }
                }
            }
        } catch (error) {
            console.log('Unable to get debug state:', error);
        }
        
        return state;
    }

    private formatDebugState(state: DebugState): string {
        if (!state.sessionActive) {
            return 'Debug session is not active';
        }

        let output = 'Debug State:\n==========\n\n';
        
        if (state.fileName && state.currentLine) {
            output += `Frame ID: ${state.frameId}\n`;
            output += `File: ${state.fileName}\n`;
            output += `Line: ${state.currentLine}\n`;
            output += `${state.currentLine}: ${state.currentLineContent}\n`;
            
            // Show next few lines for context
            if (state.nextLines && state.nextLines.length > 0) {
                output += '\nNext lines:\n';
                state.nextLines.forEach((line, index) => {
                    const lineNumber = (state.currentLine || 0) + index + 1;
                    output += `   ${lineNumber}: ${line}\n`;
                });
            }
        }
                
        return output;
    }

    async start() {
        await this.server.start({
            transportType: 'httpStream',
            httpStream: {
                port: this.port,
            },
        });

        console.log(`DebugMCP FastMCP server started on port ${this.port}`);
        vscode.window.showInformationMessage(`DebugMCP server running on http://localhost:${this.port}`);
    }

    async stop() {
        // FastMCP handles cleanup automatically
        console.log('DebugMCP FastMCP server stopped');
    }

    getEndpoint(): string {
        return `http://localhost:${this.port}`;
    }
}
