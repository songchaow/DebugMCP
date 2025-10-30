// Copyright (c) Microsoft Corporation.

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';

export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3
}

export class Logger {
    private static instance: Logger;
    private logFilePath: string;
    private logLevel: LogLevel = LogLevel.INFO;
    private initialized: boolean = false;
    private readonly MAX_LOG_AGE_MS = 24 * 60 * 60 * 1000; // 1 day in milliseconds
    private readonly MAX_LOG_SIZE_MB = 10; // Maximum log file size in MB

    private constructor() {
        // Initialize log file path in user's temp directory
        const logDir = path.join(os.tmpdir(), 'DebugMCP');
        this.logFilePath = path.join(logDir, 'debugmcp.log');
        this.ensureLogDirectory();
        this.cleanupOldLogs();
    }

    public static getInstance(): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }

    private ensureLogDirectory(): void {
        try {
            const logDir = path.dirname(this.logFilePath);
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }
            this.initialized = true;
        } catch (error) {
            console.error('Failed to create log directory:', error);
            this.initialized = false;
        }
    }

    private formatLogEntry(level: LogLevel, message: string, error?: any): string {
        const timestamp = new Date().toISOString();
        const levelName = LogLevel[level];
        let logEntry = `[${timestamp}] [${levelName}] ${message}`;
        
        if (error) {
            if (error instanceof Error) {
                logEntry += `\nError Details: ${error.message}`;
                if (error.stack) {
                    logEntry += `\nStack Trace: ${error.stack}`;
                }
            } else {
                logEntry += `\nError Details: ${JSON.stringify(error, null, 2)}`;
            }
        }
        
        return logEntry + '\n';
    }

    private writeToFile(logEntry: string): void {
        if (!this.initialized) {
            return;
        }

        try {
            // Check if log file needs rotation before writing
            this.rotateLogIfNeeded();
            fs.appendFileSync(this.logFilePath, logEntry, 'utf8');
        } catch (error) {
            console.error('Failed to write to log file:', error);
        }
    }

    private cleanupOldLogs(): void {
        try {
            const logDir = path.dirname(this.logFilePath);
            if (!fs.existsSync(logDir)) {
                return;
            }

            const files = fs.readdirSync(logDir);
            const now = Date.now();

            files.forEach(file => {
                if (file.startsWith('debugmcp') && file.endsWith('.log')) {
                    const filePath = path.join(logDir, file);
                    try {
                        const stats = fs.statSync(filePath);
                        const fileAge = now - stats.mtime.getTime();
                        
                        if (fileAge > this.MAX_LOG_AGE_MS) {
                            fs.unlinkSync(filePath);
                            console.log(`Cleaned up old log file: ${file}`);
                        }
                    } catch (fileError) {
                        console.error(`Error checking file ${file}:`, fileError);
                    }
                }
            });
        } catch (error) {
            console.error('Failed to cleanup old logs:', error);
        }
    }

    private rotateLogIfNeeded(): void {
        try {
            if (!fs.existsSync(this.logFilePath)) {
                return;
            }

            const stats = fs.statSync(this.logFilePath);
            const fileSizeMB = stats.size / (1024 * 1024);

            if (fileSizeMB > this.MAX_LOG_SIZE_MB) {
                // Create backup file with timestamp
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const backupPath = this.logFilePath.replace('.log', `_${timestamp}.log`);
                
                fs.renameSync(this.logFilePath, backupPath);
                
                // Log rotation info to new file
                this.info(`Log rotated. Previous log saved as: ${path.basename(backupPath)}`);
                
                // Clean up old backups after rotation
                this.cleanupOldLogs();
            }
        } catch (error) {
            console.error('Failed to rotate log file:', error);
        }
    }

    private shouldLog(level: LogLevel): boolean {
        return level >= this.logLevel;
    }

    public debug(message: string, error?: any): void {
        if (this.shouldLog(LogLevel.DEBUG)) {
            const logEntry = this.formatLogEntry(LogLevel.DEBUG, message, error);
            console.log(`[DEBUG] ${message}`, error || '');
            this.writeToFile(logEntry);
        }
    }

    public info(message: string, error?: any): void {
        if (this.shouldLog(LogLevel.INFO)) {
            const logEntry = this.formatLogEntry(LogLevel.INFO, message, error);
            console.log(`[INFO] ${message}`, error || '');
            this.writeToFile(logEntry);
        }
    }

    public warn(message: string, error?: any): void {
        if (this.shouldLog(LogLevel.WARN)) {
            const logEntry = this.formatLogEntry(LogLevel.WARN, message, error);
            console.warn(`[WARN] ${message}`, error || '');
            this.writeToFile(logEntry);
        }
    }

    public error(message: string, error?: any): void {
        if (this.shouldLog(LogLevel.ERROR)) {
            const logEntry = this.formatLogEntry(LogLevel.ERROR, message, error);
            console.error(`[ERROR] ${message}`, error || '');
            this.writeToFile(logEntry);
        }
    }

    public setLogLevel(level: LogLevel): void {
        this.logLevel = level;
        this.info(`Log level set to ${LogLevel[level]}`);
    }

    public getLogFilePath(): string {
        return this.logFilePath;
    }

    public getLogContent(): string {
        try {
            if (fs.existsSync(this.logFilePath)) {
                return fs.readFileSync(this.logFilePath, 'utf8');
            }
            return 'Log file does not exist yet.';
        } catch (error) {
            return `Error reading log file: ${error}`;
        }
    }

    public clearLogs(): void {
        try {
            if (fs.existsSync(this.logFilePath)) {
                fs.unlinkSync(this.logFilePath);
                this.info('Log file cleared');
            }
        } catch (error) {
            this.error('Failed to clear log file', error);
        }
    }

    public logSystemInfo(): void {
        this.info('=== System Information ===');
        this.info(`VS Code Version: ${vscode.version}`);
        this.info(`Platform: ${process.platform}`);
        this.info(`Architecture: ${process.arch}`);
        this.info(`Node.js Version: ${process.version}`);
        this.info(`Extension Host PID: ${process.pid}`);
        this.info(`Log File Path: ${this.logFilePath}`);
        this.info('=== End System Information ===');
    }

    public logEnvironment(): void {
        this.info('=== Environment Variables ===');
        this.info(`HOME: ${process.env.HOME || 'undefined'}`);
        this.info(`USERPROFILE: ${process.env.USERPROFILE || 'undefined'}`);
        this.info(`APPDATA: ${process.env.APPDATA || 'undefined'}`);
        this.info(`PATH: ${process.env.PATH?.substring(0, 200) || 'undefined'}...`);
        this.info('=== End Environment Variables ===');
    }

    public getLogStats(): { 
        currentLogSize: string; 
        logAge: string; 
        totalLogFiles: number; 
        retentionPeriod: string;
        maxFileSize: string;
    } {
        try {
            const logDir = path.dirname(this.logFilePath);
            let currentLogSize = '0 KB';
            let logAge = 'N/A';
            let totalLogFiles = 0;

            // Check current log file
            if (fs.existsSync(this.logFilePath)) {
                const stats = fs.statSync(this.logFilePath);
                currentLogSize = `${(stats.size / 1024).toFixed(2)} KB`;
                const ageMs = Date.now() - stats.mtime.getTime();
                const ageHours = Math.floor(ageMs / (1000 * 60 * 60));
                const ageMinutes = Math.floor((ageMs % (1000 * 60 * 60)) / (1000 * 60));
                logAge = `${ageHours}h ${ageMinutes}m`;
            }

            // Count all log files
            if (fs.existsSync(logDir)) {
                const files = fs.readdirSync(logDir);
                totalLogFiles = files.filter(file => 
                    file.startsWith('debugmcp') && file.endsWith('.log')
                ).length;
            }

            return {
                currentLogSize,
                logAge,
                totalLogFiles,
                retentionPeriod: '24 hours',
                maxFileSize: `${this.MAX_LOG_SIZE_MB} MB`
            };
        } catch (error) {
            return {
                currentLogSize: 'Error',
                logAge: 'Error',
                totalLogFiles: 0,
                retentionPeriod: '24 hours',
                maxFileSize: `${this.MAX_LOG_SIZE_MB} MB`
            };
        }
    }
}

// Export a singleton instance for easy access
export const logger = Logger.getInstance();
