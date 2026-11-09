// src/extension.ts
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { PodmanTreeDataProvider } from './podmanTreeDataProvider';
import { PodmanItem } from './podmanItem';
import { createContainer } from './createContainer';
import { createPod } from './createPod';
import { createVolume, createNetwork } from './createResource';
import { withStatus, StatusBarManager } from './statusBarManager';
import { showErrorWithCopy } from './utils/messageUtil';
import { QuickLinksProvider } from './quickLinksProvider';
import {
    runPodman,
    describePodman,
    createPodmanTerminal,
    getPodmanPath,
    getComposePath,
    getComposeCommandStyle,
    getMachineName
} from './podmanConfig';
import { runCommand, assertSafeArg, formatCommand } from './commandRunner';
import { buildComposeInvocation, ComposeInvocation } from './composeCommand';
import { openWhatsNew, showWhatsNewOnce } from './whatsNew';
import { extractContainerId, execInContainer, pushImage, viewDetails, addContainerToPod } from './resourceActions';

const podmanTreeDataProvider = new PodmanTreeDataProvider();

function shouldConfirmDeletions(): boolean {
    const config = vscode.workspace.getConfiguration('podmanager');
    return config.get<boolean>('confirmDeletions', true);
}

/** true/false when the configured machine exists, undefined when it does not (e.g. on Linux) or podman failed. */
async function getPodmanMachineState(): Promise<boolean | undefined> {
    try {
        const machineName = getMachineName();
        const result = await runPodman(['machine', 'list', '--format', 'json']);
        const machines = JSON.parse(result.stdout);
        const machine = Array.isArray(machines) ? machines.find((m: any) => m.Name === machineName) : undefined;
        return machine ? Boolean(machine.Running) : undefined;
    } catch (error) {
        console.error('Error checking Podman machine status:', error);
        return undefined;
    }
}

/** Briefly show the machine state in the status bar (silent when there is no such machine). */
async function reportPodmanMachineStatus(): Promise<void> {
    const state = await getPodmanMachineState();
    if (state !== undefined) {
        StatusBarManager.getInstance().showStatus(`Podman machine '${getMachineName()}': ${state ? 'running' : 'stopped'}`, false);
    }
}

async function showPodmanMachineStatus(): Promise<void> {
    let machineName: string;
    try {
        machineName = getMachineName();
    } catch (error) {
        await showErrorWithCopy(`Failed to check Podman machine status: ${error}`);
        return;
    }
    const state = await getPodmanMachineState();
    if (state === undefined) {
        vscode.window.showInformationMessage(`No Podman machine named '${machineName}' was found (Podman machines are used on macOS and Windows).`);
    } else {
        vscode.window.showInformationMessage(`Podman machine '${machineName}' is ${state ? 'running' : 'stopped'}.`);
    }
}

async function startPodmanMachine() {
    try {
        const machineName = getMachineName();
        await runPodman(['machine', 'start', machineName]);
        vscode.window.showInformationMessage(`Podman machine '${machineName}' started successfully`);
    } catch (error) {
        await showErrorWithCopy(
            `Failed to start Podman machine: ${error}`,
            describePodman(['machine', 'start', '<machine-name>'])
        );
    }
}

async function stopPodmanMachine() {
    try {
        const machineName = getMachineName();
        await runPodman(['machine', 'stop', machineName]);
        vscode.window.showInformationMessage(`Podman machine '${machineName}' stopped successfully`);
    } catch (error) {
        await showErrorWithCopy(
            `Failed to stop Podman machine: ${error}`,
            describePodman(['machine', 'stop', '<machine-name>'])
        );
    }
}

async function resetPodmanPath() {
    const config = vscode.workspace.getConfiguration('podmanager');
    await config.update('podmanPath', undefined, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage('Podman path has been reset to default.');
}

// Persistent storage helpers for compose YAML paths
function storeComposeYamlPath(projectName: string, filePath: string, context: vscode.ExtensionContext) {
    const composePaths = context.globalState.get<{ [key: string]: string }>('podmanComposePaths', {});
    composePaths[projectName] = filePath;
    context.globalState.update('podmanComposePaths', composePaths);
}

function getComposeYamlPath(projectName: string, context: vscode.ExtensionContext): string | undefined {
    const composePaths = context.globalState.get<{ [key: string]: string }>('podmanComposePaths', {});
    return composePaths[projectName];
}

function getAllComposeYamlPaths(context: vscode.ExtensionContext): { [key: string]: string } {
    return context.globalState.get<{ [key: string]: string }>('podmanComposePaths', {});
}

// Patch activate to capture context
let extensionContext: vscode.ExtensionContext;

export function activate(context: vscode.ExtensionContext) {
    extensionContext = context;
    console.log('Podmanager extension is now active!');

    // Initialize tree view providers
    const treeView = vscode.window.createTreeView('podmanView', {
        treeDataProvider: podmanTreeDataProvider
    });

    const quickLinksProvider = new QuickLinksProvider();
    const quickLinksView = vscode.window.createTreeView('podmanLinks', {
        treeDataProvider: quickLinksProvider
    });

    context.subscriptions.push(treeView, quickLinksView);

    // Initialize and register the status bar manager for disposal
    context.subscriptions.push(StatusBarManager.getInstance());

    const collapseAllCommand = vscode.commands.registerCommand('podmanager.collapseAll', () => {
        if (treeView.visible) {
            // Collapse all expandable elements
            vscode.commands.executeCommand('workbench.actions.treeView.podmanView.collapseAll');
        }
    });
    context.subscriptions.push(collapseAllCommand);

    const commands = [
        vscode.commands.registerCommand('podmanager.refreshView', () => podmanTreeDataProvider.refresh()),
        vscode.commands.registerCommand('podmanager.refreshOverview', () => podmanTreeDataProvider.refreshOverview()),
        vscode.commands.registerCommand('podmanager.openToolsMenu', openToolsMenu),
        vscode.commands.registerCommand('podmanager.pruneImages', () => runPruneCommand(['image', 'prune', '-f'], 'Remove all dangling images')),
        vscode.commands.registerCommand('podmanager.pruneAllImages', () => runPruneCommand(['image', 'prune', '-a', '-f'], 'Remove all unused images')),
        vscode.commands.registerCommand('podmanager.pruneBuilderCache', () => runPruneCommand(['builder', 'prune', '-a', '-f'], 'Remove Podman builder cache')),
        vscode.commands.registerCommand('podmanager.resetPodmanPath', resetPodmanPath),
        vscode.commands.registerCommand('podmanager.startPodmanMachine', startPodmanMachine),
        vscode.commands.registerCommand('podmanager.stopPodmanMachine', stopPodmanMachine),
        vscode.commands.registerCommand('podmanager.showMachineStatus', showPodmanMachineStatus),
        vscode.commands.registerCommand('podmanager.showWhatsNew', () => openWhatsNew(context.extensionUri)),
        vscode.commands.registerCommand('podmanager.registerComposeFiles', registerComposeFiles),
        vscode.commands.registerCommand('podmanager.execInContainer', execInContainer),
        vscode.commands.registerCommand('podmanager.pushImage', pushImage),
        vscode.commands.registerCommand('podmanager.viewDetails', viewDetails),
        vscode.commands.registerCommand('podmanager.deleteContainer', deleteContainer),
        vscode.commands.registerCommand('podmanager.startContainer', startContainer),
        vscode.commands.registerCommand('podmanager.stopContainer', stopContainer),
        vscode.commands.registerCommand('podmanager.restartContainer', restartContainer),
        vscode.commands.registerCommand('podmanager.addContainertToPod', addContainerToPod),
        vscode.commands.registerCommand('podmanager.openInTerminal', openInTerminal),
        vscode.commands.registerCommand('podmanager.deleteImage', deleteImage),
        vscode.commands.registerCommand('podmanager.deleteVolume', deleteVolume),
        vscode.commands.registerCommand('podmanager.deleteNetwork', deleteNetwork),
        vscode.commands.registerCommand('podmanager.composeUp', composeUp),
        vscode.commands.registerCommand('podmanager.composeDown', composeDown),
        vscode.commands.registerCommand('podmanager.composeStart', composeStart),
        vscode.commands.registerCommand('podmanager.composeStop', composeStop),
        vscode.commands.registerCommand('podmanager.composeRestart', composeRestart),
        vscode.commands.registerCommand('podmanager.createContainer', createContainer),
        vscode.commands.registerCommand('podmanager.createPod', createPod),
        vscode.commands.registerCommand('podmanager.createVolume', createVolume),
        vscode.commands.registerCommand('podmanager.createNetwork', createNetwork),
        vscode.commands.registerCommand('podmanager.buildImage', buildImage),
        vscode.commands.registerCommand('podmanager.viewContainerLogs', viewContainerLogs),

        // Add pod commands
        vscode.commands.registerCommand('podmanager.startPod', async (item: PodmanItem) => {
            if (item.id) {
                await runPodCommand('start', item.id);
                podmanTreeDataProvider.refresh();
            }
        }),
        vscode.commands.registerCommand('podmanager.stopPod', async (item: PodmanItem) => {
            if (item.id) {
                await runPodCommand('stop', item.id);
                podmanTreeDataProvider.refresh();
            }
        }),
        vscode.commands.registerCommand('podmanager.restartPod', async (item: PodmanItem) => {
            if (item.id) {
                await runPodCommand('restart', item.id);
                podmanTreeDataProvider.refresh();
            }
        }),
        vscode.commands.registerCommand('podmanager.deletePod', async (item: PodmanItem) => {
            if (item.id) {
                if (shouldConfirmDeletions()) {
                    const answer = await vscode.window.showWarningMessage(`Are you sure you want to delete pod ${item.id}?`, 'Yes', 'No');
                    if (answer !== 'Yes') {
                        return;
                    }
                }
                await runPodCommand('rm', item.id, true);
                podmanTreeDataProvider.refresh();
            }
        }),
        vscode.commands.registerCommand('podmanager.openSettings', () => {
            vscode.commands.executeCommand('workbench.action.openSettings', '@ext:dreamcatcher45.podmanager');
        }),
        vscode.commands.registerCommand('podmanager.openWebsite', () => {
            vscode.env.openExternal(vscode.Uri.parse('https://pod-manager.pages.dev'));
        }),
        vscode.commands.registerCommand('podmanager.openDocs', () => {
            vscode.env.openExternal(vscode.Uri.parse('https://pod-manager.pages.dev/docs'));
        }),
        vscode.commands.registerCommand('podmanager.openGitHub', () => {
            vscode.env.openExternal(vscode.Uri.parse('https://github.com/dreamcatcher45/podmanager'));
        }),
    ];

    context.subscriptions.push(...commands);

    setupAutoRefresh(context, treeView);

    void reportPodmanMachineStatus();
    void showWhatsNewOnce(context);
}

// Opt-in polling (podmanager.autoRefreshInterval seconds, 0 = off). Only refreshes while the view is visible.
let autoRefreshTimer: NodeJS.Timeout | undefined;

function stopAutoRefresh(): void {
    if (autoRefreshTimer) {
        clearInterval(autoRefreshTimer);
        autoRefreshTimer = undefined;
    }
}

function setupAutoRefresh(context: vscode.ExtensionContext, treeView: vscode.TreeView<PodmanItem>): void {
    const apply = () => {
        stopAutoRefresh();
        const seconds = Number(vscode.workspace.getConfiguration('podmanager').get<number>('autoRefreshInterval', 0));
        if (Number.isFinite(seconds) && seconds > 0) {
            autoRefreshTimer = setInterval(() => {
                if (treeView.visible) {
                    podmanTreeDataProvider.refresh();
                }
            }, Math.max(5, seconds) * 1000);
        }
    };
    apply();
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('podmanager.autoRefreshInterval')) {
                apply();
            }
        }),
        { dispose: stopAutoRefresh }
    );
}

async function openToolsMenu() {
    const selected = await vscode.window.showQuickPick(
        [
            { label: 'Create Container', command: 'podmanager.createContainer' },
            { label: 'Create Volume', command: 'podmanager.createVolume' },
            { label: 'Create Pod', command: 'podmanager.createPod' },
            { label: 'Create Network', command: 'podmanager.createNetwork' },
            { label: 'Prune Dangling Images', command: 'podmanager.pruneImages' },
            { label: 'Prune All Unused Images', command: 'podmanager.pruneAllImages' },
            { label: 'Prune Builder Cache', command: 'podmanager.pruneBuilderCache' },
            { label: 'Reset Podman Path to Default', command: 'podmanager.resetPodmanPath' }
        ],
        { placeHolder: 'Select a Podman tool' }
    );

    if (selected) {
        vscode.commands.executeCommand(selected.command);
    }
}

async function buildImage(uri: vscode.Uri) {
    let dockerfilePath: string;
    if (uri && uri.fsPath) {
        dockerfilePath = uri.fsPath;
    } else if (vscode.window.activeTextEditor) {
        dockerfilePath = vscode.window.activeTextEditor.document.uri.fsPath;
    } else {
        await showErrorWithCopy('No Dockerfile path could be determined', 'Please open a Dockerfile in the editor');
        return;
    }

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(dockerfilePath));
    if (!workspaceFolder) {
        await showErrorWithCopy('Unable to determine workspace folder', 'Please open a workspace folder containing your Dockerfile');
        return;
    }

    const imageName = await vscode.window.showInputBox({
        prompt: 'Enter a name for the image',
        placeHolder: 'e.g., myapp:latest'
    });

    if (!imageName) {
        vscode.window.showInformationMessage('Image build cancelled');
        return;
    }

    const buildContext = path.dirname(dockerfilePath);
    vscode.window.showInformationMessage(`Building image ${imageName}...`);

    // Passed as an argument array (no shell), so folder/file names can never be interpreted as commands.
    const args = ['build', `--tag=${imageName}`, `--file=${dockerfilePath}`, buildContext];

    try {
        assertSafeArg(imageName, 'image name');
        const { stdout, stderr } = await runPodman(args);
        if (stderr) {
            vscode.window.showWarningMessage(`Image build completed with warnings: ${stderr}`);
        } else {
            vscode.window.showInformationMessage(`Image ${imageName} built successfully`);
        }
        // Refresh the Podman view to show the new image
        vscode.commands.executeCommand('podmanager.refreshView');
    } catch (error) {
        await showErrorWithCopy(`Failed to build image: ${error}`, describePodman(args));
    }
}

async function runPruneCommand(args: string[], description: string): Promise<void> {
    if (shouldConfirmDeletions()) {
        const answer = await vscode.window.showWarningMessage(
            `Are you sure you want to ${description.toLowerCase()}?`,
            'Yes',
            'No'
        );
        if (answer !== 'Yes') {
            return;
        }
    }

    await withStatus(description, async () => {
        const { stdout, stderr } = await runPodman(args);
        if (stderr) {
            vscode.window.showErrorMessage(`Error while pruning: ${stderr}`);
        } else {
            vscode.window.showInformationMessage(`Successfully ${description.toLowerCase()}: ${stdout}`);
        }
    });
}

async function deleteContainer(item: PodmanItem) {
    const containerId = item.originalId || item.id;
    
    if (shouldConfirmDeletions()) {
        const answer = await vscode.window.showWarningMessage(`Are you sure you want to delete container ${containerId}?`, 'Yes', 'No');
        if (answer !== 'Yes') {
            return;
        }
    }

    await withStatus(`Deleting container ${containerId}`, async () => {
        await runPodman(['container', 'rm', '-f', assertSafeArg(containerId ?? '', 'container id')]);
        podmanTreeDataProvider.refresh();
        vscode.window.showInformationMessage(`Container ${containerId} deleted successfully`);
    });
}

async function startContainer(item: PodmanItem) {
    const containerId = item.originalId || item.id;
    await withStatus(`Starting container ${containerId}`, async () => {
        await runPodman(['container', 'start', assertSafeArg(containerId ?? '', 'container id')]);
        podmanTreeDataProvider.refresh();
        vscode.window.showInformationMessage(`Container ${containerId} started successfully`);
    });
}

async function stopContainer(item: PodmanItem) {
    const containerId = item.originalId || item.id;
    await withStatus(`Stopping container ${containerId}`, async () => {
        await runPodman(['container', 'stop', assertSafeArg(containerId ?? '', 'container id')]);
        podmanTreeDataProvider.refresh();
        vscode.window.showInformationMessage(`Container ${containerId} stopped successfully`);
    });
}

async function restartContainer(item: PodmanItem) {
    const containerId = item.originalId || item.id;
    await withStatus(`Restarting container ${containerId}`, async () => {
        await runPodman(['container', 'restart', assertSafeArg(containerId ?? '', 'container id')]);
        podmanTreeDataProvider.refresh();
        vscode.window.showInformationMessage(`Container ${containerId} restarted successfully`);
    });
}

async function openInTerminal(item: PodmanItem) {
    if (item.id) {
        try {
            const containerId = extractContainerId(item.id);
            const terminal = createPodmanTerminal(`Podman: ${item.label}`, ['exec', '-it', assertSafeArg(containerId, 'container id'), '/bin/sh']);
            terminal.show();
        } catch (error) {
            await showErrorWithCopy(`Failed to open terminal for container ${item.id}: ${error}`, describePodman(['exec', '-it', String(item.id), '/bin/sh']));
        }
    }
}

async function deleteImage(item: PodmanItem) {
    if (shouldConfirmDeletions()) {
        const answer = await vscode.window.showWarningMessage(`Are you sure you want to delete image ${item.id}?`, 'Yes', 'No');
        if (answer !== 'Yes') {
            return;
        }
    }

    await withStatus(`Deleting image ${item.id}`, async () => {
        await runPodman(['image', 'rm', '-f', assertSafeArg(String(item.id), 'image id')]);
        podmanTreeDataProvider.refresh();
        vscode.window.showInformationMessage(`Image ${item.id} deleted successfully`);
    });
}

async function deleteVolume(item: PodmanItem) {
    if (!item.resourceName) {
        await showErrorWithCopy('Unable to delete volume: Resource name is missing', describePodman(['volume', 'rm', '-f', '<volume-name>']));
        return;
    }
    
    if (shouldConfirmDeletions()) {
        const answer = await vscode.window.showWarningMessage(`Are you sure you want to delete volume ${item.resourceName}?`, 'Yes', 'No');
        if (answer !== 'Yes') {
            return;
        }
    }

    await withStatus(`Deleting volume ${item.resourceName}`, async () => {
        await runPodman(['volume', 'rm', '-f', assertSafeArg(item.resourceName!, 'volume name')]);
        vscode.window.showInformationMessage(`Volume ${item.resourceName} deleted successfully`);
        // Refresh the tree view
        vscode.commands.executeCommand('podmanager.refreshView');
    });
}

async function deleteNetwork(item: PodmanItem) {
    if (!item.resourceName) {
        await showErrorWithCopy('Unable to delete network: Resource name is missing', describePodman(['network', 'rm', '-f', '<network-name>']));
        return;
    }

    if (shouldConfirmDeletions()) {
        const answer = await vscode.window.showWarningMessage(`Are you sure you want to delete network ${item.resourceName}?`, 'Yes', 'No');
        if (answer !== 'Yes') {
            return;
        }
    }

    await withStatus(`Deleting network ${item.resourceName}`, async () => {
        await runPodman(['network', 'rm', '-f', assertSafeArg(item.resourceName!, 'network name')]);
        vscode.window.showInformationMessage(`Network ${item.resourceName} deleted successfully`);
        // Refresh the tree view
        vscode.commands.executeCommand('podmanager.refreshView');
    });
}

async function composeUp(input?: vscode.Uri | PodmanItem) {
    await withStatus('Running compose up', async () => {
        await runComposeCommand(['up', '-d'], input);
    });
}

async function composeDown(input?: vscode.Uri | PodmanItem) {
    await withStatus('Running compose down', async () => {
        await runComposeCommand(['down'], input);
    });
}

async function composeStart(input?: vscode.Uri | PodmanItem) {
    await withStatus('Starting compose services', async () => {
        await runComposeCommand(['start'], input);
    });
}

async function composeStop(input?: vscode.Uri | PodmanItem) {
    await withStatus('Stopping compose services', async () => {
        await runComposeCommand(['stop'], input);
    });
}

async function composeRestart(input?: vscode.Uri | PodmanItem) {
    await withStatus('Restarting compose services', async () => {
        await runComposeCommand(['restart'], input);
    });
}

function buildComposeCommand(composeFile: string, projectName: string, command: string[]): ComposeInvocation {
    return buildComposeInvocation(
        { podmanPath: getPodmanPath(), composePath: getComposePath(), commandStyle: getComposeCommandStyle() },
        composeFile,
        projectName,
        command
    );
}

async function registerComposeFiles() {
    const picked = await vscode.window.showOpenDialog({
        canSelectMany: true,
        canSelectFiles: true,
        canSelectFolders: false,
        filters: { 'Compose files': ['yml', 'yaml'] },
        openLabel: 'Register Compose Files',
        title: 'Select the compose files to register'
    });
    if (!picked || picked.length === 0) {
        return;
    }
    const projects: string[] = [];
    for (const uri of picked) {
        const projectName = path.basename(path.dirname(uri.fsPath));
        storeComposeYamlPath(projectName, uri.fsPath, extensionContext);
        projects.push(projectName);
    }
    vscode.window.showInformationMessage(`Registered ${picked.length} compose file(s): ${projects.join(', ')}`);
}

async function runComposeCommand(command: string[], input?: vscode.Uri | PodmanItem) {
    let composeFile: string | undefined;
    let workingDir: string | undefined;
    let projectName: string = '';
    let invocation: ComposeInvocation | undefined;

    try {
        // Try to use stored path first if available
        if (input instanceof vscode.Uri) {
            composeFile = input.fsPath;
            workingDir = path.dirname(composeFile);
            projectName = path.basename(workingDir);
            // Show status bar message and store path
            vscode.window.setStatusBarMessage('saving path to storage', 2000);
            storeComposeYamlPath(projectName, composeFile, extensionContext);
        } else {
            if (input instanceof PodmanItem && input.contextValue === 'compose-group') {
                // The tree creates 'compose-group' items (this used to check 'composeGroup', which never matched).
                projectName = input.composeProject || (typeof input.label === 'string' ? input.label : '');
                // Stored path first, then the path from the container labels, then a search by project folder.
                const stored = getComposeYamlPath(projectName, extensionContext);
                if (stored && fs.existsSync(stored)) {
                    composeFile = stored;
                } else if (input.fsPath && fs.existsSync(input.fsPath)) {
                    composeFile = input.fsPath;
                } else if (projectName) {
                    const files = await vscode.workspace.findFiles(`**/${projectName}/**/docker-compose.{yml,yaml}`, '**/node_modules/**');
                    if (files.length > 0) {
                        composeFile = files[0].fsPath;
                    }
                }
                if (composeFile) {
                    workingDir = path.dirname(composeFile);
                    vscode.window.setStatusBarMessage('saving path to storage', 2000);
                    storeComposeYamlPath(projectName, composeFile, extensionContext);
                }
            }
            if (!composeFile) {
                // Try all stored paths
                const storedPaths = getAllComposeYamlPaths(extensionContext);
                const validPaths = Object.entries(storedPaths).filter(([_, p]) => fs.existsSync(p));

                if (validPaths.length === 1) {
                    [projectName, composeFile] = validPaths[0];
                    workingDir = path.dirname(composeFile);
                } else if (validPaths.length > 1) {
                    const pick = await vscode.window.showQuickPick(validPaths.map(([proj, file]) => ({ label: proj, description: file })), {
                        placeHolder: 'Select a compose project'
                    });
                    if (pick) {
                        projectName = pick.label;
                        composeFile = pick.description;
                        workingDir = path.dirname(composeFile);
                    }
                }

                if (!composeFile) {
                    // Fallback to old logic
                    const files = await vscode.workspace.findFiles('**/docker-compose.{yml,yaml}', '**/node_modules/**');
                    if (files.length === 0) {
                        await showErrorWithCopy('No docker-compose.yml file found in the workspace', 'Please create a docker-compose.yml or docker-compose.yaml file in your workspace');
                        return;
                    } else if (files.length > 1) {
                        const quickPickItems = files.map(file => ({ label: vscode.workspace.asRelativePath(file), uri: file }));
                        const selected = await vscode.window.showQuickPick(quickPickItems, {
                            placeHolder: 'Multiple Compose files found. Select one to use.'
                        });
                        if (selected) {
                            composeFile = selected.uri.fsPath;
                        } else {
                            return;
                        }
                    } else {
                        composeFile = files[0].fsPath;
                    }

                    if (composeFile) {
                        workingDir = path.dirname(composeFile);
                        projectName = path.basename(workingDir);
                        vscode.window.setStatusBarMessage('saving path to storage', 2000);
                        storeComposeYamlPath(projectName, composeFile, extensionContext);
                    }
                }
            }
        }

        if (!composeFile) {
            await showErrorWithCopy('No compose file specified or selected.', 'Please right-click a docker-compose.yml file or run the command from an open workspace.');
            return;
        }

        if (!workingDir) {
            await showErrorWithCopy('Could not determine working directory.', 'Please ensure your compose file is in a valid directory.');
            return;
        }

        invocation = buildComposeCommand(composeFile, projectName, command);

        // No shell: the compose file path and project name (derived from folder names) are plain arguments.
        const { stdout, stderr } = await runCommand(invocation.file, invocation.args, { cwd: workingDir });
        if (stderr) {
            vscode.window.showWarningMessage(`Podman Compose command finished with messages: ${stderr}`);
        }
        if (stdout) {
            vscode.window.showInformationMessage(stdout);
        }
        podmanTreeDataProvider.refresh();
    } catch (error) {
        const errorCmd = invocation
            ? formatCommand(invocation.file, invocation.args)
            : `compose ${command.join(' ')}`;
        await showErrorWithCopy(
            `Failed to execute Podman Compose ${command.join(' ')}: ${error}`,
            errorCmd
        );
    }
}

async function runPodCommand(command: string, podId: string, force: boolean = false) {
    try {
        await runPodman(['pod', command, ...(force ? ['-f'] : []), assertSafeArg(podId, 'pod id')]);
        vscode.window.showInformationMessage(`Pod ${command} command for ${podId} executed successfully.`);
    } catch (error) {
        await showErrorWithCopy(`Failed to run pod command: ${error}`, describePodman(['pod', command, ...(force ? ['-f'] : []), podId]));
    }
}

async function viewContainerLogs(item: PodmanItem) {
    if (item.id) {
        try {
            const containerId = extractContainerId(item.id);

            const config = vscode.workspace.getConfiguration('podmanager');
            const outputMode = config.get<string>('logsOutput', 'outputChannel');

            if (outputMode === 'terminal') {
                const terminal = createPodmanTerminal(`Podman Logs: ${item.label}`, ['logs', '-f', assertSafeArg(containerId, 'container id')]);
                terminal.show();
            } else {
                const { stdout, stderr } = await runPodman(['logs', assertSafeArg(containerId ?? '', 'container id')]);

                if (stderr) {
                    vscode.window.showWarningMessage(`Error fetching logs for ${item.label}: ${stderr}`);
                }

                const outputChannel = vscode.window.createOutputChannel(`Podman Logs: ${item.label}`);
                outputChannel.appendLine(`--- Logs for container ${item.label} (${containerId}) ---`);
                outputChannel.append(stdout);
                outputChannel.append(stderr);
                outputChannel.show();
            }
        } catch (error) {
            await showErrorWithCopy(`Failed to fetch/open logs for container ${item.id}: ${error}`, describePodman(['logs', String(item.id)]));
        }
    }
}

export function deactivate() {
    console.log('Podmanager extension is now deactivated.');
}