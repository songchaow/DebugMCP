// Copyright (c) Microsoft Corporation.

import * as vscode from 'vscode';
import { DebugState } from './debugState';
import { logger } from './utils/logger';

/**
 * Captures DAP output events from debug adapter sessions.
 * Must be registered early (at extension activation time) via
 * registerDebugAdapterTrackerFactory so it captures events from all sessions.
 */
export class OutputCapturer {
    private outputBuffer: string = '';
    private capturing: boolean = false;
    private targetSessionId: string | null = null;
    private disposable: vscode.Disposable | null = null;
    private trackedSessions: Set<string> = new Set();

    /**
     * Register the debug adapter tracker factory globally.
     * Call this once during extension activation.
     */
    public register(): void {
        if (this.disposable) {
            return;  // Already registered
        }
        const self = this;
        this.disposable = vscode.debug.registerDebugAdapterTrackerFactory('*', {
            createDebugAdapterTracker(session: vscode.DebugSession) {
                self.trackedSessions.add(session.id);
                logger.info(`[OutputCapturer] Tracker created for session: id=${session.id}, type=${session.type}, name=${session.name}, parentSession=${session.parentSession?.id || 'none'}`);
                return {
                    onDidSendMessage(message: any) {
                        // Always log output events for diagnostics (regardless of capturing state)
                        if (message.type === 'event' && message.event === 'output') {
                            const body = message.body;
                            const outputText = body?.output || '';
                            const category = body?.category || 'unknown';
                            logger.info(`[OutputCapturer] OUTPUT EVENT from session ${session.id} (${session.name}), category=${category}, len=${outputText.length}: ${outputText.substring(0, 150).replace(/\n/g, '\\n')}`);
                            if (body && body.output) {
                                if (self.capturing) {
                                    if (!self.targetSessionId || session.id === self.targetSessionId) {
                                        self.outputBuffer += body.output;
                                    }
                                }
                            }
                        }
                        // Log other important DAP events for diagnostics
                        else if (message.type === 'event') {
                            // Log stopped, continued, exited, terminated events
                            if (['stopped', 'continued', 'exited', 'terminated', 'thread', 'module', 'process'].includes(message.event)) {
                                const bodyStr = message.body ? JSON.stringify(message.body).substring(0, 200) : 'no body';
                                logger.info(`[OutputCapturer] DAP EVENT from session ${session.id} (${session.name}): ${message.event} - ${bodyStr}`);
                            }
                        }
                        // Log evaluate responses
                        else if (message.type === 'response' && message.command === 'evaluate') {
                            const result = message.body?.result || '';
                            logger.info(`[OutputCapturer] EVALUATE RESPONSE from session ${session.id} (${session.name}): success=${message.success}, result_len=${result.length}, result="${result.substring(0, 150).replace(/\n/g, '\\n')}"`);
                        }
                    }
                };
            }
        });
    }

    /**
     * Get the set of tracked session IDs (for diagnostics).
     */
    public getTrackedSessions(): Set<string> {
        return this.trackedSessions;
    }

    /**
     * Start capturing output for a specific session.
     * If sessionId is null, captures from all tracked sessions.
     */
    public startCapture(sessionId: string | null): void {
        this.outputBuffer = '';
        this.targetSessionId = sessionId;
        this.capturing = true;
        logger.info(`[OutputCapturer] Started capture for session: ${sessionId || 'all'}, tracked sessions: [${Array.from(this.trackedSessions).join(', ')}]`);
    }

    /**
     * Stop capturing and return the captured output.
     */
    public stopCapture(): string {
        this.capturing = false;
        this.targetSessionId = null;
        const output = this.outputBuffer;
        this.outputBuffer = '';
        logger.info(`[OutputCapturer] Stopped capture. Captured ${output.length} chars total.`);
        return output;
    }

    /**
     * Dispose the tracker factory registration.
     */
    public dispose(): void {
        if (this.disposable) {
            this.disposable.dispose();
            this.disposable = null;
        }
    }
}

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

    private outputCapturer: OutputCapturer;

    constructor(outputCapturer: OutputCapturer) {
        this.outputCapturer = outputCapturer;
    }

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
            logger.info('[getEffectiveDebugSession] No active debug session');
            return undefined;
        }

        logger.info(`[getEffectiveDebugSession] activeDebugSession: id=${activeSession.id}, type=${activeSession.type}, name=${activeSession.name}`);

        // Collect all debug sessions and find the deepest child of the active session
        const allSessions = this.getAllDebugSessions();
        const effective = this.findDeepestChild(activeSession, allSessions);
        
        logger.info(`[getEffectiveDebugSession] Effective session: id=${effective.id}, type=${effective.type}, name=${effective.name}`);
        
        // Check if the effective session has a tracker registered
        const trackedSessions = this.outputCapturer.getTrackedSessions();
        if (!trackedSessions.has(effective.id)) {
            logger.info(`[getEffectiveDebugSession] WARNING: Effective session ${effective.id} does NOT have a tracker. Tracked sessions: [${Array.from(trackedSessions).join(', ')}]`);
        }
        
        return effective;
    }

    /**
     * Get all currently active debug sessions by traversing the session tree.
     * Uses vscode.debug.activeDebugSession as the root and searches for sessions
     * that have it (or its descendants) as their parentSession.
     */
    private getAllDebugSessions(): vscode.DebugSession[] {
        // VSCode doesn't provide a direct API to list all sessions.
        // We use multiple strategies to discover sessions:
        // 1. activeDebugSession
        // 2. activeStackItem's session (if available)
        // 3. All sessions tracked by OutputCapturer (most reliable)
        const sessions: vscode.DebugSession[] = [];
        const seenIds = new Set<string>();
        const activeSession = vscode.debug.activeDebugSession;
        if (activeSession) {
            sessions.push(activeSession);
            seenIds.add(activeSession.id);
        }

        // Check if activeStackItem belongs to a different (child) session
        const activeStackItem = vscode.debug.activeStackItem;
        if (activeStackItem) {
            logger.info(`[getAllDebugSessions] activeStackItem type: ${typeof activeStackItem}, keys: ${Object.keys(activeStackItem).join(', ')}`);
            if ('session' in activeStackItem) {
                const stackSession = (activeStackItem as any).session as vscode.DebugSession;
                if (stackSession && !seenIds.has(stackSession.id)) {
                    sessions.push(stackSession);
                    seenIds.add(stackSession.id);
                    logger.info(`[getAllDebugSessions] Found child session via activeStackItem: id=${stackSession.id}, type=${stackSession.type}, name=${stackSession.name}`);
                }
            }
        }

        logger.info(`[getAllDebugSessions] Found ${sessions.length} sessions: ${sessions.map(s => `${s.id}(${s.type}:${s.name})`).join(', ')}`);
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
                logger.info(`[getCurrentDebugState] Active session: id=${activeSession.id}, type=${activeSession.type}, name=${activeSession.name}`);
                
                const activeStackItem = vscode.debug.activeStackItem;
                if (activeStackItem && 'frameId' in activeStackItem) {
                    state.updateContext(activeStackItem.frameId, activeStackItem.threadId);
                    logger.info(`[getCurrentDebugState] activeStackItem: frameId=${activeStackItem.frameId}, threadId=${activeStackItem.threadId}`);
                    
                    // Use the effective (child) session for DAP requests
                    const effectiveSession = this.getEffectiveDebugSession() || activeSession;
                    // Extract frame name from stack frame
                    await this.extractFrameName(effectiveSession, activeStackItem.frameId, state);
                    
                    logger.info(`[getCurrentDebugState] After extractFrameName: frameName=${state.frameName}, stackFrames=${state.stackFrames?.length || 0}`);
                    
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
     * Extract frame name and full stack trace from the current stack frame
     */
    private async extractFrameName(session: vscode.DebugSession, frameId: number, state: DebugState): Promise<void> {
        try {
            logger.info(`[extractFrameName] Requesting stackTrace from session ${session.id} (${session.type}:${session.name}), threadId=${state.threadId}, frameId=${frameId}`);
            
            // Get full stack trace (up to 50 frames)
            const stackTraceResponse = await session.customRequest('stackTrace', {
                threadId: state.threadId,
                startFrame: 0,
                levels: 50
            });

            logger.info(`[extractFrameName] stackTrace response: ${stackTraceResponse?.stackFrames?.length || 0} frames, totalFrames=${stackTraceResponse?.totalFrames || 'unknown'}`);

            if (stackTraceResponse?.stackFrames && stackTraceResponse.stackFrames.length > 0) {
                const currentFrame = stackTraceResponse.stackFrames[0];
                state.updateFrameName(currentFrame.name || null);

                // Store full stack trace
                const frames = stackTraceResponse.stackFrames.map((frame: any) => ({
                    name: frame.name || '<unknown>',
                    source: frame.source?.path || frame.source?.name || undefined,
                    line: frame.line || undefined,
                    column: frame.column || undefined,
                    id: frame.id
                }));
                state.updateStackFrames(frames);
                
                // Log first few frames for diagnostics
                frames.slice(0, 5).forEach((f: any, i: number) => {
                    logger.info(`[extractFrameName]   #${i} ${f.name} at ${f.source || '<no source>'}:${f.line || '?'}`);
                });
                if (frames.length > 5) {
                    logger.info(`[extractFrameName]   ... and ${frames.length - 5} more frames`);
                }
            } else {
                logger.info('[extractFrameName] No stack frames returned');
                state.updateFrameName(null);
                state.updateStackFrames(null);
            }
        } catch (error) {
            logger.error(`[extractFrameName] Error requesting stackTrace: ${error}`);
            // Set empty frame name on error
            state.updateFrameName(null);
            state.updateStackFrames(null);
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
     * Evaluate an expression in the current debug context.
     * For CodeLLDB, LLDB commands (like bt, thread list) send their output
     * through DAP 'output' events rather than the 'evaluate' response result.
     * This method uses the OutputCapturer (registered at extension activation)
     * to intercept those output messages.
     */
    public async evaluateExpression(expression: string, frameId: number): Promise<any> {
        try {
            const activeSession = this.getEffectiveDebugSession();
            if (!activeSession) {
                throw new Error('No active debug session');
            }

            logger.info(`[evaluateExpression] Evaluating "${expression}" on session ${activeSession.id} (${activeSession.type}:${activeSession.name}), frameId=${frameId}`);

            // Start capturing output events from ALL sessions (not just the target),
            // because the session ID we send the request to might differ from the session
            // that actually sends the output events (e.g. in parent-child session setups).
            this.outputCapturer.startCapture(null);

            const response = await activeSession.customRequest('evaluate', {
                expression: expression,
                frameId: frameId,
                context: 'repl'
            });

            logger.info(`[evaluateExpression] evaluate response: result="${response?.result || ''}" (${(response?.result || '').length} chars), type=${response?.type || 'unknown'}`);

            // Give a brief moment for output events to arrive
            await new Promise(resolve => setTimeout(resolve, 300));

            // Stop capturing and get any captured output
            const capturedOutput = this.outputCapturer.stopCapture();

            logger.info(`[evaluateExpression] Captured output: ${capturedOutput.length} chars`);
            if (capturedOutput) {
                logger.info(`[evaluateExpression] Captured: "${capturedOutput.substring(0, 200)}${capturedOutput.length > 200 ? '...' : ''}"`);
            }

            // If response.result is empty but we captured output, use the captured output
            if ((!response.result || response.result === '') && capturedOutput) {
                response.result = capturedOutput.trim();
                logger.info(`[evaluateExpression] Using captured output as result`);
            }

            return response;
        } catch (error) {
            // Make sure to stop capturing on error
            this.outputCapturer.stopCapture();
            logger.error(`[evaluateExpression] Error: ${error}`);
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
