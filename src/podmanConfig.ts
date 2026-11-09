import * as vscode from 'vscode';
import {
    runCommand,
    CommandResult,
    parseExecutableSetting,
    assertValidMachineName,
    formatCommand,
    terminalLaunch
} from './commandRunner';

/**
 * podmanPath, composePath and machineName are declared with "scope": "machine"
 * in package.json, so VS Code ignores them in workspace (.vscode/settings.json)
 * and folder settings. Only the user's own settings can change them.
 */
export function getPodmanPath(): string {
    const config = vscode.workspace.getConfiguration('podmanager');
    return config.get('podmanPath', 'podman');
}

export function getComposePath(): string {
    const config = vscode.workspace.getConfiguration('podmanager');
    return config.get('composePath', 'podman-compose');
}

export function getComposeCommandStyle(): string {
    const config = vscode.workspace.getConfiguration('podmanager');
    return config.get('composeCommandStyle', 'default');
}

export function getMachineName(): string {
    const config = vscode.workspace.getConfiguration('podmanager');
    return assertValidMachineName(config.get<string>('machineName') || 'podman-machine-default');
}

/** Resolve the configured podman command (program + leading args + legacy "--remote" flag). */
export function resolvePodman(): { file: string; baseArgs: string[] } {
    const { file, prefixArgs, remote } = parseExecutableSetting(getPodmanPath());
    return { file, baseArgs: [...prefixArgs, ...(remote ? ['--remote'] : [])] };
}

/** An interactive terminal running `podman <args>` that stays open afterwards. No shell string is built. */
export function createPodmanTerminal(name: string, args: string[]): vscode.Terminal {
    const { file, baseArgs } = resolvePodman();
    const { shellPath, shellArgs } = terminalLaunch(file, [...baseArgs, ...args]);
    return vscode.window.createTerminal({ name, shellPath, shellArgs });
}

/** Run `podman <args>` without a shell. */
export function runPodman(args: string[], options: { cwd?: string } = {}): Promise<CommandResult> {
    const { file, baseArgs } = resolvePodman();
    return runCommand(file, [...baseArgs, ...args], options);
}

/** `podman <args>` rendered for display / "Copy Command" only. Never executed. */
export function describePodman(args: string[]): string {
    try {
        const { file, baseArgs } = resolvePodman();
        return formatCommand(file, [...baseArgs, ...args]);
    } catch {
        return formatCommand('podman', args);
    }
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
