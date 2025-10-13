/**
 * Represents the current state of a debugging session
 */
export class DebugState {
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

    /**
     * Reset the debug state to initial values
     */
    public reset(): void {
        this.sessionActive = false;
        this.fileFullPath = null;
        this.fileName = null;
        this.currentLine = null;
        this.currentLineContent = null;
        this.nextLines = [];
        this.frameId = null;
        this.threadId = null;
    }

    /**
     * Check if the debug session has valid execution context
     */
    public hasValidContext(): boolean {
        return this.sessionActive && 
               this.frameId !== null && 
               this.threadId !== null;
    }

    /**
     * Check if location information is available
     */
    public hasLocationInfo(): boolean {
        return this.fileName !== null && 
               this.currentLine !== null;
    }

    /**
     * Update the current execution location
     */
    public updateLocation(
        fileFullPath: string,
        fileName: string,
        currentLine: number,
        currentLineContent: string,
        nextLines: string[]
    ): void {
        this.fileFullPath = fileFullPath;
        this.fileName = fileName;
        this.currentLine = currentLine;
        this.currentLineContent = currentLineContent;
        this.nextLines = [...nextLines];
    }

    /**
     * Update the debugging context (frame and thread IDs)
     */
    public updateContext(frameId: number, threadId: number): void {
        this.frameId = frameId;
        this.threadId = threadId;
    }

    /**
     * Clone the current state
     */
    public clone(): DebugState {
        const cloned = new DebugState();
        cloned.sessionActive = this.sessionActive;
        cloned.fileFullPath = this.fileFullPath;
        cloned.fileName = this.fileName;
        cloned.currentLine = this.currentLine;
        cloned.currentLineContent = this.currentLineContent;
        cloned.nextLines = [...this.nextLines];
        cloned.frameId = this.frameId;
        cloned.threadId = this.threadId;
        return cloned;
    }
}
