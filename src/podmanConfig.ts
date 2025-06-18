import * as vscode from 'vscode';

export function getPodmanPath(): string {
    const config = vscode.workspace.getConfiguration('podmanager');
    return config.get('podmanPath', 'podman');
}

export async function storeComposeFilePath(projectName: string, filePath: string, context: vscode.ExtensionContext) {
    const composePaths = context.workspaceState.get<{ [key: string]: string }>('podmanComposePaths', {});
    composePaths[projectName] = filePath;
    await context.workspaceState.update('podmanComposePaths', composePaths);
}

export function getComposeFilePath(projectName: string, context: vscode.ExtensionContext): string | undefined {
    const composePaths = context.workspaceState.get<{ [key: string]: string }>('podmanComposePaths', {});
    return composePaths[projectName];
}

export function getStoredComposePaths(context: vscode.ExtensionContext): { [key: string]: string } {
    return context.workspaceState.get<{ [key: string]: string }>('podmanComposePaths', {});
}
