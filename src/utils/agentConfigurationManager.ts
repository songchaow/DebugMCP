// Copyright (c) Microsoft Corporation.

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface AgentInfo {
    id: string;
    name: string;
    displayName: string;
    configPath: string;
    mcpServerFieldName: string; 
}

export interface MCPServerConfig {
    autoApprove: string[];
    disabled: boolean;
    timeout: number;
    type: string;
    url: string;
}

export class AgentConfigurationManager {
    private context: vscode.ExtensionContext;
    private readonly POPUP_SHOWN_KEY = 'debugmcp.popupShown';
    private readonly SKIP_POPUP_KEY = 'debugmcp.skipPopup';
    private readonly timeoutInSeconds: number;
    private readonly serverPort: number;
    

    constructor(context: vscode.ExtensionContext, timeoutInSeconds: number, serverPort: number) {
        this.context = context;
        this.timeoutInSeconds = timeoutInSeconds;
        this.serverPort = serverPort;
    }

    /**
     * Check if we should show the post-install popup
     */
    public async shouldShowPopup(): Promise<boolean> {
        // Check if user chose to skip popup permanently
        const skipPopup = this.context.globalState.get<boolean>(this.SKIP_POPUP_KEY, false);
        if (skipPopup) {
            return false;
        }

        // Always show popup on every activation (unless user chose "Don't show again")
        return true;
    }

    /**
     * Show the agent selection popup
     */
    public async showAgentSelectionPopup(): Promise<void> {
        try {
            const agents = await this.getSupportedAgents();

            // Show selection popup for all agents
            await this.showAgentSelectionDialog(agents);
            
        } catch (error) {
            console.error('Error showing agent selection popup:', error);
            vscode.window.showErrorMessage(`Failed to show agent selection popup: ${error}`);
        }
    }

    /**
     * Reset popup state (for testing/debugging)
     */
    public async resetPopupState(): Promise<void> {
        await this.context.globalState.update(this.POPUP_SHOWN_KEY, false);
        await this.context.globalState.update(this.SKIP_POPUP_KEY, false);
    }

    /**
     * Show manual configuration options via command palette
     */
    public async showManualConfiguration(): Promise<void> {
        const agents = await this.getSupportedAgents();

        const items: vscode.QuickPickItem[] = agents.map(agent => ({
            label: agent.displayName,
            description: 'Configure DebugMCP for this agent',
            detail: `Add DebugMCP server configuration to ${agent.displayName}`
        }));

        const selected = await vscode.window.showQuickPick(items, {
            title: 'Configure DebugMCP for AI Agent', 
            placeHolder: 'Select an AI agent to configure with DebugMCP'
        });

        if (selected) {
            const agent = agents.find(a => a.displayName === selected.label);
            if (agent) {
                await this.configureAgent(agent);
            }
        }
    }

    /**
     * Get cross-platform configuration base path
     */
    private getConfigBasePath(): string {
        const platform = os.platform();
        const userHome = os.homedir();
        
        switch (platform) {
            case 'win32': // Windows
                return process.env.APPDATA || path.join(userHome, 'AppData', 'Roaming');
            case 'darwin': // MacOS
                return path.join(userHome, 'Library', 'Application Support');
            case 'linux': // Linux
                return process.env.XDG_CONFIG_HOME || path.join(userHome, '.config');
            default:
                // Fallback to Windows-style for unknown platforms
                console.warn(`Unknown platform: ${platform}, using Windows config path`);
                return process.env.APPDATA || path.join(userHome, 'AppData', 'Roaming');
        }
    }

    /**
     * Get list of supported agents
     */
    private async getSupportedAgents(): Promise<AgentInfo[]> {
        const configBasePath = this.getConfigBasePath();
        const platform = os.platform();
        
        console.log(`Detected platform: ${platform}, using config base path: ${configBasePath}`);
        
        const agents: AgentInfo[] = [
            {
                id: 'cline',
                name: 'cline',
                displayName: 'Cline',
                configPath: path.join(configBasePath, 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'),
                mcpServerFieldName: 'mcpServers'
            },
            {
                id: 'copilot',
                name: 'copilot',
                displayName: 'GitHub Copilot',
                configPath: path.join(configBasePath, 'Code', 'User', 'mcp.json'),
                mcpServerFieldName: 'servers'
            },
            {
                id: 'cursor',
                name: 'cursor',
                displayName: 'Cursor',
                configPath: path.join(configBasePath, 'Cursor', 'User', 'globalStorage', 'cursor.mcp', 'settings', 'mcp_settings.json'),
                mcpServerFieldName: 'mcpServers'
            }
        ];

        return agents;
    }

    /**
     * Get DebugMCP server configuration with current port and timeout settings
     */
    private getDebugMCPConfig(): MCPServerConfig {
        return {
            autoApprove: [],
            disabled: false,
            timeout: this.timeoutInSeconds,
            type: "sse",
            url: `http://localhost:${this.serverPort}/sse`
        };
    }

    /**
     * Add DebugMCP server configuration to the specified agent's config
     */
    private async addDebugMCPToAgent(agent: AgentInfo): Promise<boolean> {
        try {
            // Ensure the config directory exists
            const configDir = path.dirname(agent.configPath);
            if (!fs.existsSync(configDir)) {
                await fs.promises.mkdir(configDir, { recursive: true });
            }

            let config: any = {};
            
            // Read existing config if it exists
            if (fs.existsSync(agent.configPath)) {
                const configContent = await fs.promises.readFile(agent.configPath, 'utf8');
                try {
                    config = JSON.parse(configContent);
                } catch (parseError) {
                    console.warn(`Failed to parse existing config for ${agent.name}, creating new config`);
                    config = {};
                }
            }

            // Ensure the correct MCP servers object exists for this agent
            const fieldName = agent.mcpServerFieldName;
            if (!config[fieldName]) {
                config[fieldName] = {};
            }

            // Add or update DebugMCP configuration with current settings
            config[fieldName].debugmcp = this.getDebugMCPConfig();

            // Write the updated config back to file
            await fs.promises.writeFile(
                agent.configPath, 
                JSON.stringify(config, null, 2), 
                'utf8'
            );

            console.log(`Successfully added DebugMCP configuration to ${agent.name}`);
            return true;
        } catch (error) {
            console.error(`Error adding DebugMCP to ${agent.name}:`, error);
            vscode.window.showErrorMessage(`Failed to configure DebugMCP for ${agent.displayName}: ${error}`);
            return false;
        }
    }

    /** Show the actual agent selection dialog */
    private async showAgentSelectionDialog(agents: AgentInfo[]): Promise<void> {
        const items: vscode.QuickPickItem[] = [];

        // Add all agents as selectable items
        agents.forEach(agent => {
            items.push({
                label: `$(add) Configure ${agent.displayName}`,
                description: 'Add DebugMCP server to this agent',
                detail: agent.displayName,
                picked: false
            });
        });

        items.push({
            label: `$(circle-slash) Don't show again`,
            description: 'Skip setup and don\'t show this popup again',
            detail: 'You can still configure DebugMCP manually later',
            picked: false
        });

        const quickPick = vscode.window.createQuickPick();
        quickPick.title = 'DebugMCP Setup - Choose AI Agent to Configure';
        quickPick.placeholder = 'Select an AI agent to configure with DebugMCP';
        quickPick.items = items;
        quickPick.canSelectMany = true;
        quickPick.ignoreFocusOut = true;

        quickPick.onDidAccept(async () => {
            const selectedItem = quickPick.selectedItems[0];
            quickPick.hide();

            if (selectedItem) {
                if (selectedItem.label.includes('Skip for now')) {
                    // User chose to skip
                    return;
                } else if (selectedItem.label.includes('Don\'t show again')) {
                    // User chose to not show again
                    await this.context.globalState.update(this.SKIP_POPUP_KEY, true);
                    return;
                } else if (selectedItem.label.includes('Configure')) {
                    // User selected an agent to configure
                    const agentDisplayName = selectedItem.detail;
                    const agent = agents.find(a => a.displayName === agentDisplayName);
                    
                    if (agent) {
                        await this.configureAgent(agent);
                    }
                }
            }
        });

        quickPick.onDidHide(() => quickPick.dispose());
        quickPick.show();
    }

    /**
     * Configure a specific agent with DebugMCP
     */
    private async configureAgent(agent: AgentInfo): Promise<void> {
        try {
            
            const success = await this.addDebugMCPToAgent(agent);
            
            if (success) {
                const restartMessage = await vscode.window.showInformationMessage(
                    `✅ DebugMCP has been configured for ${agent.displayName}!`,
                    'Open Config File',
                    'Got it'
                );

                if (restartMessage === 'Open Config File') {
                    // Open the config file to show what was added
                    const doc = await vscode.workspace.openTextDocument(agent.configPath);
                    await vscode.window.showTextDocument(doc);
                }
            }
        } catch (error) {
            console.error(`Error configuring ${agent.name}:`, error);
            vscode.window.showErrorMessage(`Failed to configure ${agent.displayName}: ${error}`);
        }
    }
}
