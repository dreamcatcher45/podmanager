import * as vscode from 'vscode';

export class PodmanItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly contextValue: string,
        public readonly id?: string,
        public readonly status?: string,
        public readonly isRunning?: boolean,
        public readonly composeProject?: string,
        public children?: PodmanItem[],
        public readonly isUsed?: boolean,
        public readonly resourceName?: string,
        public readonly fsPath?: string
    ) {
        super(label, collapsibleState);
        this.contextValue = contextValue;
        this.iconPath = this.getIconPath();
        this.tooltip = this.getTooltip();
        this.command = this.getCommand();
    }

    private getIconPath(): vscode.ThemeIcon | { light: string; dark: string } | undefined {
        switch (this.contextValue) {
            case 'pod':
                return new vscode.ThemeIcon('symbol-namespace', new vscode.ThemeColor(this.status?.toLowerCase().includes('running') ? 'charts.green' : 'charts.red'));
            case 'container':
            case 'compose-container':
                return this.isRunning
                    ? new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('charts.green'))
                    : new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('charts.red'));
            case 'image':
            case 'image-tag':
                return this.isUsed
                    ? new vscode.ThemeIcon('file', new vscode.ThemeColor('charts.green'))
                    : new vscode.ThemeIcon('file', new vscode.ThemeColor('charts.red'));
            case 'volume':
                return new vscode.ThemeIcon('database');
            case 'network':
                return new vscode.ThemeIcon('globe');
            case 'compose-group':
                return new vscode.ThemeIcon('layers');
            default:
                return undefined;
        }
    }

    private getTooltip(): string | undefined {
        if (this.contextValue === 'pod') {
            return `ID: ${this.id}\n${this.status}`;
        }
        if (this.contextValue === 'container' || this.contextValue === 'compose-container') {
            return `ID: ${this.id}\nStatus: ${this.status}`;
        } else if (this.contextValue === 'image') {
            return `ID: ${this.id}\nUsed: ${this.isUsed ? 'Yes' : 'No'}`;
        } else if (this.contextValue === 'image-tag') {
            return `ID: ${this.id}\nTag: ${this.label}`;
        } else if (this.contextValue === 'compose-group') {
            return `Compose Project: ${this.composeProject}`;
        }
        return undefined;
    }

    private getCommand(): vscode.Command | undefined {
        if (this.contextValue === 'container' || this.contextValue === 'compose-container') {
            return {
                command: 'podmanager.openInTerminal',
                title: 'Open in Terminal',
                arguments: [this]
            };
        }
        return undefined;
    }
}