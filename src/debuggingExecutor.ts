// Copyright (c) Microsoft Corporation.

import * as vscode from 'vscode';
import { DebugState } from './debugState';

/**
 * Interface for debugging execution operations
 */
export interface IDebuggingExecutor {
    startDebugging(workingDirectory: string, config: vscode.DebugConfiguration): Promise<boolean>;
    stopDebugging(session?: vscode.DebugSession): Promise<void>;
    stepOver(): Promise<void>;
    stepInto(): Promise<void>;
    stepOut(): Promise<void>;
    continue(): Promise<void>;
    restart(): Promise<void>;
    addBreakpoint(uri: vscode.Uri, line: number): Promise<void>;
    removeBreakpoint(uri: vscode.Uri, line: number): Promise<void>;
    getCurrentDebugState(numNextLines: number): Promise<DebugState>;
    getVariables(frameId: number, scope?: 'local' | 'global' | 'all'): Promise<any>;
    evaluateExpression(expression: string, frameId: number): Promise<any>;
    getBreakpoints(): readonly vscode.Breakpoint[];
    clearAllBreakpoints(): void;
    hasActiveSession(): Promise<boolean>;
    getActiveSession(): vscode.DebugSession | undefined;
}

/**
 * Responsible for executing VS Code debugging commands and managing debug sessions
 */
export class DebuggingExecutor implements IDebuggingExecutor {

    /**
     * Get the effective debug session for sending DAP requests.
     * When a parent-child session hierarchy exists (e.g. android-debug launching CodeLLDB
     * as a child session), vscode.debug.activeDebugSession may point to the parent session
     * which does not handle DAP requests like 'evaluate', 'scopes', 'stackTrace', etc.
     * This method traverses from the active session down to the deepest child session,
     * which is typically the one that actually handles debugging (e.g. CodeLLDB).
     * Falls back to the active session if no child sessions are found.
     */
    private getEffectiveDebugSession(): vscode.DebugSession | undefined {
        const activeSession = vscode.debug.activeDebugSession;
        if (!activeSession) {
            return undefined;
        }

        // Collect all debug sessions and find the deepest child of the active session
        const allSessions = this.getAllDebugSessions();
        return this.findDeepestChild(activeSession, allSessions);
    }

    /**
     * Get all currently active debug sessions by traversing the session tree.
     * Uses vscode.debug.activeDebugSession as the root and searches for sessions
     * that have it (or its descendants) as their parentSession.
     */
    private getAllDebugSessions(): vscode.DebugSession[] {
        // VSCode doesn't provide a direct API to list all sessions.
        // However, we can access child sessions through the onDidStartDebugSession event
        // or by checking parentSession relationships. Since we can't enumerate all sessions
        // directly, we'll use a workaround: check if the activeStackItem's session differs
        // from the activeDebugSession.
        const sessions: vscode.DebugSession[] = [];
        const activeSession = vscode.debug.activeDebugSession;
        if (activeSession) {
            sessions.push(activeSession);
        }

        // Check if activeStackItem belongs to a different (child) session
        const activeStackItem = vscode.debug.activeStackItem;
        if (activeStackItem && 'session' in activeStackItem) {
            const stackSession = (activeStackItem as any).session as vscode.DebugSession;
            if (stackSession && !sessions.find(s => s.id === stackSession.id)) {
                sessions.push(stackSession);
            }
        }

        return sessions;
    }

    /**
     * Find the deepest child session starting from the given session.
     * If a session in the list has `parentSession` matching the given session,
     * it is considered a child. We recurse until no more children are found.
     */
    private findDeepestChild(session: vscode.DebugSession, allSessions: vscode.DebugSession[]): vscode.DebugSession {
        const child = allSessions.find(
            s => s.parentSession && s.parentSession.id === session.id
        );
        if (child) {
            return this.findDeepestChild(child, allSessions);
        }
        return session;
    }

    /**
     * Start a debugging session
     */
    public async startDebugging(
        workingDirectory: string, 
        config: vscode.DebugConfiguration
    ): Promise<boolean> {
        try {
            if (config.type === 'coreclr') {
                // Open the specific test file instead of the workspace folder
                const testFileUri = vscode.Uri.file(config.program);
                await vscode.commands.executeCommand('vscode.open', testFileUri);
                vscode.commands.executeCommand('testing.debugCurrentFile');
                return true;
            }
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(workingDirectory));
            return await vscode.debug.startDebugging(workspaceFolder, config);
        } catch (error) {
            throw new Error(`Failed to start debugging: ${error}`);
        }
    }

    /**
     * Stop the debugging session
     */
    public async stopDebugging(session?: vscode.DebugSession): Promise<void> {
        try {
            // When stopping, we stop the top-level (parent) session which will
            // also tear down all child sessions.
            const activeSession = session || vscode.debug.activeDebugSession;
            if (activeSession) {
                await vscode.debug.stopDebugging(activeSession);
            }
        } catch (error) {
            throw new Error(`Failed to stop debugging: ${error}`);
        }
    }

    /**
     * Execute step over command
     */
    public async stepOver(): Promise<void> {
        try {
            await vscode.commands.executeCommand('workbench.action.debug.stepOver');
        } catch (error) {
            throw new Error(`Failed to step over: ${error}`);
        }
    }

    /**
     * Execute step into command
     */
    public async stepInto(): Promise<void> {
        try {
            await vscode.commands.executeCommand('workbench.action.debug.stepInto');
        } catch (error) {
            throw new Error(`Failed to step into: ${error}`);
        }
    }

    /**
     * Execute step out command
     */
    public async stepOut(): Promise<void> {
        try {
            await vscode.commands.executeCommand('workbench.action.debug.stepOut');
        } catch (error) {
            throw new Error(`Failed to step out: ${error}`);
        }
    }

    /**
     * Execute continue command
     */
    public async continue(): Promise<void> {
        try {
            await vscode.commands.executeCommand('workbench.action.debug.continue');
        } catch (error) {
            throw new Error(`Failed to continue: ${error}`);
        }
    }

    /**
     * Execute restart command
     */
    public async restart(): Promise<void> {
        try {
            await vscode.commands.executeCommand('workbench.action.debug.restart');
        } catch (error) {
            throw new Error(`Failed to restart: ${error}`);
        }
    }

    /**
     * Add a breakpoint at specified location
     */
    public async addBreakpoint(uri: vscode.Uri, line: number): Promise<void> {
        try {
            const breakpoint = new vscode.SourceBreakpoint(
                new vscode.Location(uri, new vscode.Position(line - 1, 0))
            );
            vscode.debug.addBreakpoints([breakpoint]);
        } catch (error) {
            throw new Error(`Failed to add breakpoint: ${error}`);
        }
    }

    /**
     * Remove a breakpoint from specified location
     */
    public async removeBreakpoint(uri: vscode.Uri, line: number): Promise<void> {
        try {
            const breakpoints = vscode.debug.breakpoints.filter(bp => {
                if (bp instanceof vscode.SourceBreakpoint) {
                    return bp.location.uri.toString() === uri.toString() && 
                           bp.location.range.start.line === line - 1;
                }
                return false;
            });
            
            if (breakpoints.length > 0) {
                vscode.debug.removeBreakpoints(breakpoints);
            }
        } catch (error) {
            throw new Error(`Failed to remove breakpoint: ${error}`);
        }
    }

    /**
     * Get current debugging state
     */
    public async getCurrentDebugState(numNextLines: number = 3): Promise<DebugState> {
        const state = new DebugState();
        
        try {
            const activeSession = vscode.debug.activeDebugSession;
            if (activeSession) {
                state.sessionActive = true;
                
                const activeStackItem = vscode.debug.activeStackItem;
                if (activeStackItem && 'frameId' in activeStackItem) {
                    state.updateContext(activeStackItem.frameId, activeStackItem.threadId);
                    
                    // Use the effective (child) session for DAP requests
                    const effectiveSession = this.getEffectiveDebugSession() || activeSession;
                    // Extract frame name from stack frame
                    await this.extractFrameName(effectiveSession, activeStackItem.frameId, state);
                    
                    // Get the active editor
                    const activeEditor = vscode.window.activeTextEditor;
                    if (activeEditor) {
                        const fileName = activeEditor.document.fileName.split(/[/\\]/).pop() || '';
                        const currentLine = activeEditor.selection.active.line + 1; // 1-based line number
                        const currentLineContent = activeEditor.document.lineAt(activeEditor.selection.active.line).text.trim();
                        
                        // Get next lines
                        const nextLines = [];
                        for (let i = 1; i <= numNextLines; i++) {
                            if (activeEditor.selection.active.line + i < activeEditor.document.lineCount) {
                                nextLines.push(activeEditor.document.lineAt(activeEditor.selection.active.line + i).text.trim());
                            }
                        }
                        
                        state.updateLocation(
                            activeEditor.document.fileName,
                            fileName,
                            currentLine,
                            currentLineContent,
                            nextLines
                        );
                    }
                }
            }
        } catch (error) {
            console.log('Unable to get debug state:', error);
        }
        
        return state;
    }

    /**
     * Extract frame name from the current stack frame
     */
    private async extractFrameName(session: vscode.DebugSession, frameId: number, state: DebugState): Promise<void> {
        try {
            // Get stack trace to extract frame name
            const stackTraceResponse = await session.customRequest('stackTrace', {
                threadId: state.threadId,
                startFrame: 0,
                levels: 1
            });

            if (stackTraceResponse?.stackFrames && stackTraceResponse.stackFrames.length > 0) {
                const currentFrame = stackTraceResponse.stackFrames[0];
                state.updateFrameName(currentFrame.name || null);
            }
        } catch (error) {
            console.log('Unable to extract frame name:', error);
            // Set empty frame name on error
            state.updateFrameName(null);
        }
    }

    /**
     * Get variables from the current debug context
     */
    public async getVariables(frameId: number, scope?: 'local' | 'global' | 'all'): Promise<any> {
        try {
            const activeSession = this.getEffectiveDebugSession();
            if (!activeSession) {
                throw new Error('No active debug session');
            }

            const response = await activeSession.customRequest('scopes', { frameId });
            
            if (!response || !response.scopes || response.scopes.length === 0) {
                return { scopes: [] };
            }

            const filteredScopes = response.scopes.filter((scopeItem: any) => {
                if (scope === 'all') {return true;}
                const scopeName = scopeItem.name.toLowerCase();
                if (scope === 'local') {return scopeName.includes('local');}
                if (scope === 'global') {return scopeName.includes('global');}
                return true;
            });

            // Get variables for each scope
            for (const scopeItem of filteredScopes) {
                try {
                    const variablesResponse = await activeSession.customRequest('variables', {
                        variablesReference: scopeItem.variablesReference
                    });
                    scopeItem.variables = variablesResponse.variables || [];
                } catch (scopeError) {
                    scopeItem.variables = [];
                    scopeItem.error = scopeError;
                }
            }

            return { scopes: filteredScopes };
        } catch (error) {
            throw new Error(`Failed to get variables: ${error}`);
        }
    }

    /**
     * Evaluate an expression in the current debug context
     */
    public async evaluateExpression(expression: string, frameId: number): Promise<any> {
        try {
            const activeSession = this.getEffectiveDebugSession();
            if (!activeSession) {
                throw new Error('No active debug session');
            }

            const response = await activeSession.customRequest('evaluate', {
                expression: expression,
                frameId: frameId,
                context: 'repl'
            });

            return response;
        } catch (error) {
            throw new Error(`Failed to evaluate expression: ${error}`);
        }
    }


    /**
     * Get all active breakpoints
     */
    public getBreakpoints(): readonly vscode.Breakpoint[] {
        return vscode.debug.breakpoints;
    }

    /**
     * Clear all breakpoints
     */
    public clearAllBreakpoints(): void {
        const breakpoints = vscode.debug.breakpoints;
        if (breakpoints.length > 0) {
            vscode.debug.removeBreakpoints(breakpoints);
        }
    }

    /**
     * Check if there's an active debug session that is ready for debugging operations
     */
    public async hasActiveSession(): Promise<boolean> {
        // Quick check first - no session at all
        if (!vscode.debug.activeDebugSession) {
            return false;
        }

        try {
            // Get the current debug state and check if it has location information
            // This is the most reliable way to determine if the debugger is truly ready
            const debugState = await this.getCurrentDebugState();
            
            // A session is ready when it has location info (file name and line number)
            // This means the debugger has attached and we can see where we are in the code
            return debugState.sessionActive;// && debugState.hasLocationInfo();
        } catch (error) {
            // Any error means session isn't ready (e.g., Python still initializing)
            console.log('Session readiness check failed:', error);
            return false;
        }
    }

    /**
     * Get the active debug session
     */
    public getActiveSession(): vscode.DebugSession | undefined {
        return vscode.debug.activeDebugSession;
    }
}
