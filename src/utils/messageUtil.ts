import * as vscode from 'vscode';

/**
 * Strips internal formatting flags from podman commands
 */
function stripFormatFlags(command: string): string {
    return command
        .replace(/--format "[^"]*"/g, '')        // Remove --format "..."
        .replace(/--format '[^']*'/g, '')        // Remove --format '...'
        .replace(/--format=[^ ]*/g, '')          // Remove --format=...
        .replace(/-f "[^"]*"/g, '')             // Remove -f "..."
        .replace(/-f '[^']*'/g, '')             // Remove -f '...'
        .replace(/-f=[^ ]*/g, '')               // Remove -f=...
        .replace(/\s+/g, ' ')                   // Replace multiple spaces with single space
        .trim();                                // Remove leading/trailing spaces
}

export async function showErrorWithCopy(errorMessage: string, command?: string): Promise<void> {
    const items: string[] = ['Copy Error'];
    if (command) {
        items.push('Copy Command');
    }

    const result = await vscode.window.showErrorMessage(
        errorMessage,
        ...items
    );

    if (result === 'Copy Error') {
        await vscode.env.clipboard.writeText(errorMessage);
        vscode.window.showInformationMessage('Error message copied to clipboard');
    } else if (result === 'Copy Command' && command) {
        await vscode.env.clipboard.writeText(stripFormatFlags(command));
        vscode.window.showInformationMessage('Command copied to clipboard');
    }
}
