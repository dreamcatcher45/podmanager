import * as vscode from 'vscode';

export function getPodmanPath(): string {
    const config = vscode.workspace.getConfiguration('podmanager');
    return config.get('podmanPath', 'podman');
}
