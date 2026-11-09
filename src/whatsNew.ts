import * as vscode from 'vscode';

/**
 * A "what changed" page that opens once after Pod Manager is installed or updated to a release that has notes.
 *
 * To show new notes in a later release: rewrite WHATS_NEW.md and change `id`. Users who already saw the previous
 * id see the page once more; everyone else is not bothered again.
 */
export const WHATS_NEW = { id: 'security-update-1', file: 'WHATS_NEW.md' };
const SEEN_KEY = 'podmanager.whatsNewSeen';

/** Open the page as a rendered Markdown preview (falls back to the plain file if the preview is unavailable). */
export async function openWhatsNew(extensionUri: vscode.Uri | undefined): Promise<void> {
    if (!extensionUri) {
        return;
    }
    const uri = vscode.Uri.joinPath(extensionUri, WHATS_NEW.file);
    try {
        await vscode.commands.executeCommand('markdown.showPreview', uri);
    } catch {
        try {
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc, { preview: true });
        } catch (error) {
            console.error('Unable to open the What\'s New page:', error);
        }
    }
}

/**
 * Open the page the first time this release's notes have not been seen, unless the user turned it off
 * (podmanager.showWhatsNew). Never throws, so it can never break activation. Returns true if it opened the page.
 */
export async function showWhatsNewOnce(context: vscode.ExtensionContext): Promise<boolean> {
    try {
        if (!context.extensionUri) {
            return false;
        }
        if (!vscode.workspace.getConfiguration('podmanager').get<boolean>('showWhatsNew', true)) {
            return false;
        }
        if (context.globalState.get(SEEN_KEY) === WHATS_NEW.id) {
            return false;
        }
        // Mark it as seen first: if anything below fails the page is not re-opened on every start.
        await context.globalState.update(SEEN_KEY, WHATS_NEW.id);
        await openWhatsNew(context.extensionUri);
        return true;
    } catch (error) {
        console.error('What\'s New check failed:', error);
        return false;
    }
}
