import * as vscode from 'vscode';

export class StatusBarManager {
    private static instance: StatusBarManager;
    private statusBarItem: vscode.StatusBarItem;
    private timeout: NodeJS.Timeout | undefined;

    private constructor() {
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
    }

    public static getInstance(): StatusBarManager {
        if (!StatusBarManager.instance) {
            StatusBarManager.instance = new StatusBarManager();
        }
        return StatusBarManager.instance;
    }

    public showStatus(text: string, isLoading: boolean = true): void {
        this.statusBarItem.text = isLoading ? `$(sync~spin) ${text}` : `$(check) ${text}`;
        this.statusBarItem.show();

        // Clear any existing timeout
        if (this.timeout) {
            clearTimeout(this.timeout);
        }

        // If it's a completion message (not loading), hide after 3 seconds
        if (!isLoading) {
            this.timeout = setTimeout(() => {
                this.statusBarItem.hide();
            }, 3000);
        }
    }

    public hideStatus(): void {
        this.statusBarItem.hide();
    }

    public dispose(): void {
        if (this.timeout) {
            clearTimeout(this.timeout);
        }
        this.statusBarItem.dispose();
    }
}

export async function withStatus<T>(
    operation: string,
    task: () => Promise<T>
): Promise<T> {
    const statusBar = StatusBarManager.getInstance();
    try {
        statusBar.showStatus(`Podman: ${operation}...`);
        const result = await task();
        statusBar.showStatus(`Podman: ${operation} completed`, false);
        return result;
    } catch (error) {
        statusBar.showStatus(`Podman: ${operation} failed`, false);
        throw error;
    }
}
