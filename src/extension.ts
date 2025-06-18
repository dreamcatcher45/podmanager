// src/extension.ts

import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { PodmanTreeDataProvider } from './podmanTreeDataProvider';
import { PodmanItem } from './podmanItem';
import { createContainer } from './createContainer';
import { createVolume, createNetwork } from './createResource';
import { withStatus } from './statusBarManager';
import { showErrorWithCopy } from './utils/messageUtil';
import { QuickLinksProvider } from './quickLinksProvider';

const execAsync = promisify(exec);
const podmanTreeDataProvider = new PodmanTreeDataProvider();

function getPodmanPath(): string {
    const config = vscode.workspace.getConfiguration('podmanager');
    return config.get('podmanPath', 'podman');
}

function getMachineName(): string {
    const config = vscode.workspace.getConfiguration('podmanager');
    return config.get<string>('machineName') || 'podman-machine-default';
}

async function checkPodmanMachineStatus(): Promise<boolean> {
    const machineName = getMachineName();
    try {
        const result = await execAsync('podman machine list --format json');
        const machines = JSON.parse(result.stdout);
        const machine = machines.find((m: any) => m.Name === machineName);
        return machine?.Running || false;
    } catch (error) {
        console.error('Error checking Podman machine status:', error);
        return false;
    }
}

async function startPodmanMachine() {
    const machineName = getMachineName();
    try {
        const cmd = `podman machine start ${machineName}`;
        await execAsync(cmd);
        vscode.window.showInformationMessage(`Podman machine '${machineName}' started successfully`);
    } catch (error) {
        await showErrorWithCopy(
            `Failed to start Podman machine '${machineName}': ${error}`,
            `podman machine start ${machineName}`
        );
    }
}

async function stopPodmanMachine() {
    const machineName = getMachineName();
    try {
        const cmd = `podman machine stop ${machineName}`;
        await execAsync(cmd);
        vscode.window.showInformationMessage(`Podman machine '${machineName}' stopped successfully`);
    } catch (error) {
        await showErrorWithCopy(
            `Failed to stop Podman machine '${machineName}': ${error}`,
            `podman machine stop ${machineName}`
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
    const treeView = vscode.window.createTreeView('podmanView', { treeDataProvider: podmanTreeDataProvider });
    const quickLinksProvider = new QuickLinksProvider();
    const quickLinksView = vscode.window.createTreeView('podmanLinks', { treeDataProvider: quickLinksProvider });

    context.subscriptions.push(treeView, quickLinksView);

    // Initialize and register the status bar manager for disposal
    const { StatusBarManager } = require('./statusBarManager');
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
        vscode.commands.registerCommand('podmanager.pruneImages', () => runPruneCommand('image prune -f', 'Remove all dangling images')),
        vscode.commands.registerCommand('podmanager.pruneAllImages', () => runPruneCommand('image prune -a -f', 'Remove all unused images')),
        vscode.commands.registerCommand('podmanager.pruneBuilderCache', () => runPruneCommand('builder prune -a -f', 'Remove Podman builder cache')),
        vscode.commands.registerCommand('podmanager.resetPodmanPath', resetPodmanPath),
        vscode.commands.registerCommand('podmanager.startPodmanMachine', startPodmanMachine),
        vscode.commands.registerCommand('podmanager.deleteContainer', deleteContainer),
        vscode.commands.registerCommand('podmanager.startContainer', startContainer),
        vscode.commands.registerCommand('podmanager.stopContainer', stopContainer),
        vscode.commands.registerCommand('podmanager.restartContainer', restartContainer),
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
                const answer = await vscode.window.showWarningMessage(`Are you sure you want to delete pod ${item.id}?`, 'Yes', 'No');
                if (answer === 'Yes') {
                    await runPodCommand('rm', item.id, true);
                    podmanTreeDataProvider.refresh();
                }
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
    checkPodmanMachineStatus();
}

async function openToolsMenu() {
    const selected = await vscode.window.showQuickPick(
        [
            { label: 'Create Container', command: 'podmanager.createContainer' },
            { label: 'Create Volume', command: 'podmanager.createVolume' },
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

    const imageName = await vscode.window.showInputBox({ prompt: 'Enter a name for the image', placeHolder: 'e.g., myapp:latest' });
    if (!imageName) {
        vscode.window.showInformationMessage('Image build cancelled');
        return;
    }
    const buildContext = path.dirname(dockerfilePath);
    vscode.window.showInformationMessage(`Building image ${imageName}...`);
    const cmd = `${getPodmanPath()} build -t ${imageName} -f "${dockerfilePath}" "${buildContext}"`;
    try {
        const { stdout, stderr } = await execAsync(cmd);
        if (stderr) {
            vscode.window.showWarningMessage(`Image build completed with warnings: ${stderr}`);
        } else {
            vscode.window.showInformationMessage(`Image ${imageName} built successfully`);
        }
        // Refresh the Podman view to show the new image
        vscode.commands.executeCommand('podmanager.refreshView');
    } catch (error) {
        await showErrorWithCopy(`Failed to build image: ${error}`, cmd);
    }
}

async function runPruneCommand(command: string, description: string): Promise<void> {
    const answer = await vscode.window.showWarningMessage(
        `Are you sure you want to ${description.toLowerCase()}?`,
        'Yes',
        'No'
    );
    if (answer === 'Yes') {
        await withStatus(description, async () => {
            const { stdout, stderr } = await execAsync(`${getPodmanPath()} ${command}`);
            if (stderr) {
                vscode.window.showErrorMessage(`Error while pruning: ${stderr}`);
            } else {
                vscode.window.showInformationMessage(`Successfully ${description.toLowerCase()}: ${stdout}`);
            }
        });
    }
}

async function deleteContainer(item: PodmanItem) {
    const containerId = item.originalId || item.id;
    const answer = await vscode.window.showWarningMessage(`Are you sure you want to delete container ${containerId}?`, 'Yes', 'No');
    if (answer === 'Yes') {
        await withStatus(`Deleting container ${containerId}`, async () => {
            await execAsync(`${getPodmanPath()} container rm -f ${containerId}`);
            podmanTreeDataProvider.refresh();
            vscode.window.showInformationMessage(`Container ${containerId} deleted successfully`);
        });
    }
}

async function startContainer(item: PodmanItem) {
    const containerId = item.originalId || item.id;
    await withStatus(`Starting container ${containerId}`, async () => {
        await execAsync(`${getPodmanPath()} container start ${containerId}`);
        podmanTreeDataProvider.refresh();
        vscode.window.showInformationMessage(`Container ${containerId} started successfully`);
    });
}

async function stopContainer(item: PodmanItem) {
    const containerId = item.originalId || item.id;
    await withStatus(`Stopping container ${containerId}`, async () => {
        await execAsync(`${getPodmanPath()} container stop ${containerId}`);
        podmanTreeDataProvider.refresh();
        vscode.window.showInformationMessage(`Container ${containerId} stopped successfully`);
    });
}

async function restartContainer(item: PodmanItem) {
    const containerId = item.originalId || item.id;
    await withStatus(`Restarting container ${containerId}`, async () => {
        await execAsync(`${getPodmanPath()} container restart ${containerId}`);
        podmanTreeDataProvider.refresh();
        vscode.window.showInformationMessage(`Container ${containerId} restarted successfully`);
    });
}

async function openInTerminal(item: PodmanItem) {
    if (item.id) {
        try {
            const containerId = extractContainerId(item.id);
            const terminal = vscode.window.createTerminal(`Podman: ${item.label}`);
            terminal.sendText(`${getPodmanPath()} exec -it ${containerId} /bin/sh`);
            terminal.show();
        } catch (error) {
            await showErrorWithCopy(`Failed to open terminal for container ${item.id}: ${error}`, `${getPodmanPath()} exec -it ${item.id} /bin/sh`);
        }
    }
}

async function deleteImage(item: PodmanItem) {
    const answer = await vscode.window.showWarningMessage(`Are you sure you want to delete image ${item.id}?`, 'Yes', 'No');
    if (answer === 'Yes') {
        await withStatus(`Deleting image ${item.id}`, async () => {
            await execAsync(`${getPodmanPath()} image rm -f ${item.id}`);
            podmanTreeDataProvider.refresh();
            vscode.window.showInformationMessage(`Image ${item.id} deleted successfully`);
        });
    }
}

async function deleteVolume(item: PodmanItem) {
    if (!item.resourceName) {
        await showErrorWithCopy('Unable to delete volume: Resource name is missing', `${getPodmanPath()} volume rm -f <volume-name>`);
        return;
    }
    const answer = await vscode.window.showWarningMessage(`Are you sure you want to delete volume ${item.resourceName}?`, 'Yes', 'No');
    if (answer === 'Yes') {
        await withStatus(`Deleting volume ${item.resourceName}`, async () => {
            await execAsync(`${getPodmanPath()} volume rm -f ${item.resourceName}`);
            vscode.window.showInformationMessage(`Volume ${item.resourceName} deleted successfully`);
            // Refresh the tree view
            vscode.commands.executeCommand('podmanager.refreshView');
        });
    }
}

async function deleteNetwork(item: PodmanItem) {
    if (!item.resourceName) {
        await showErrorWithCopy('Unable to delete network: Resource name is missing', `${getPodmanPath()} network rm -f <network-name>`);
        return;
    }
    const answer = await vscode.window.showWarningMessage(`Are you sure you want to delete network ${item.resourceName}?`, 'Yes', 'No');
    if (answer === 'Yes') {
        await withStatus(`Deleting network ${item.resourceName}`, async () => {
            await execAsync(`${getPodmanPath()} network rm -f ${item.resourceName}`);
            vscode.window.showInformationMessage(`Network ${item.resourceName} deleted successfully`);
            // Refresh the tree view
            vscode.commands.executeCommand('podmanager.refreshView');
        });
    }
}

function extractContainerId(fullId: string): string {
    // If the ID contains a hyphen followed by a hash-like string at the end
    const match = fullId.match(/-([a-f0-9]{12})$/i);
    if (match) {
        return match[1];
    }
    // If no match found, return the original ID
    return fullId;
}

async function composeUp(input?: vscode.Uri | PodmanItem) {
    await withStatus('Running compose up', async () => {
        await runComposeCommand('up -d', input);
    });
}
async function composeDown(input?: vscode.Uri | PodmanItem) {
    await withStatus('Running compose down', async () => {
        await runComposeCommand('down', input);
    });
}
async function composeStart(input?: vscode.Uri | PodmanItem) {
    await withStatus('Starting compose services', async () => {
        await runComposeCommand('start', input);
    });
}
async function composeStop(input?: vscode.Uri | PodmanItem) {
    await withStatus('Stopping compose services', async () => {
        await runComposeCommand('stop', input);
    });
}
async function composeRestart(input?: vscode.Uri | PodmanItem) {
    await withStatus('Restarting compose services', async () => {
        await runComposeCommand('restart', input);
    });
}

function getComposePath(): string {
    const config = vscode.workspace.getConfiguration('podmanager');
    return config.get('composePath', 'podman-compose');
}

function getComposeCommandStyle(): string {
    const config = vscode.workspace.getConfiguration('podmanager');
    return config.get('composeCommandStyle', 'default');
}

function buildComposeCommand(podmanPath: string, composeFile: string, projectName: string, command: string): string {
    try {
        const composePath = getComposePath();
        const commandStyle = getComposeCommandStyle();
        const isRemoteFlag = podmanPath.includes('--remote');
        // Remove --remote flag from podmanPath if present
        const cleanPodmanPath = podmanPath.replace('--remote', '').trim();
        // If a custom compose path is specified and not empty, use it directly
        if (composePath && composePath !== 'podman-compose') {
            return `${composePath} -f "${composeFile}" -p "${projectName}" ${command}`;
        }
        // Handle different command styles
        switch (commandStyle) {
            case 'podman-space-compose':
                return isRemoteFlag
                    ? `${cleanPodmanPath} --remote compose -f "${composeFile}" -p "${projectName}" ${command}`
                    : `${cleanPodmanPath} compose -f "${composeFile}" -p "${projectName}" ${command}`;
            case 'podman-compose':
            case 'default':
            default:
                // Maintain backward compatibility with existing behavior
                return isRemoteFlag
                    ? `${cleanPodmanPath}-compose --remote -f "${composeFile}" -p "${projectName}" ${command}`
                    : `${cleanPodmanPath}-compose -f "${composeFile}" -p "${projectName}" ${command}`;
        }
    } catch (error) {
        // If anything goes wrong, fall back to the original behavior
        return `${podmanPath}-compose -f "${composeFile}" -p "${projectName}" ${command}`;
    }
}

async function runComposeCommand(command: string, input?: vscode.Uri | PodmanItem) {
    let composeFile: string | undefined;
    let workingDir: string | undefined;
    let projectName: string = '';
    let cmd: string;

    try {
        // Try to use stored path first if available
        if (input instanceof vscode.Uri) {
            composeFile = input.fsPath;
            workingDir = path.dirname(composeFile);
            projectName = path.basename(workingDir);
            // Show status bar message and store path
            vscode.window.setStatusBarMessage('saving path to storage', 2000);
            storeComposeYamlPath(projectName, composeFile, extensionContext);
        } else if (input instanceof PodmanItem && input.contextValue === 'composeGroup') {
            projectName = input.label || '';
            // Try stored path first
            const stored = getComposeYamlPath(projectName, extensionContext);
            if (stored && fs.existsSync(stored)) {
                composeFile = stored;
                workingDir = path.dirname(composeFile);
            } else {
                const files = await vscode.workspace.findFiles(`**/${projectName}/**/docker-compose.{yml,yaml}`, '**/node_modules/**');
                if (files.length > 0) {
                    composeFile = files[0].fsPath;
                    workingDir = path.dirname(composeFile);
                    vscode.window.setStatusBarMessage('saving path to storage', 2000);
                    storeComposeYamlPath(projectName, composeFile, extensionContext);
                }
            }
        } else {
            // Try all stored paths
            const storedPaths = getAllComposeYamlPaths(extensionContext);
            const validPaths = Object.entries(storedPaths).filter(([_, p]) => fs.existsSync(p));
            if (validPaths.length === 1) {
                [projectName, composeFile] = validPaths[0];
                workingDir = path.dirname(composeFile);
            } else if (validPaths.length > 1) {
                const pick = await vscode.window.showQuickPick(validPaths.map(([proj, file]) => ({ label: proj, description: file })), { placeHolder: 'Select a compose project' });
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
                    const selected = await vscode.window.showQuickPick(quickPickItems, { placeHolder: 'Multiple Compose files found. Select one to use.' });
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
        if (!composeFile) {
            await showErrorWithCopy('No compose file specified or selected.', 'Please right-click a docker-compose.yml file or run the command from an open workspace.');
            return;
        }
        if (!workingDir) {
            await showErrorWithCopy('Could not determine working directory.', 'Please ensure your compose file is in a valid directory.');
            return;
        }
        cmd = buildComposeCommand(getPodmanPath(), composeFile, projectName, command);
        const options = {
            cwd: workingDir,
            shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh'
        };
        const { stdout, stderr } = await execAsync(cmd, options);
        if (stderr) {
            vscode.window.showWarningMessage(`Podman Compose command finished with messages: ${stderr}`);
        }
        if (stdout) {
            vscode.window.showInformationMessage(stdout);
        }
        podmanTreeDataProvider.refresh();
    } catch (error) {
        const errorCmd = buildComposeCommand(getPodmanPath(), composeFile || '', projectName || '', command);
        await showErrorWithCopy(
            `Failed to execute Podman Compose ${command}: ${error}`,
            errorCmd
        );
    }
}

async function runPodCommand(command: string, podId: string, force: boolean = false) {
    try {
        const forceFlag = force ? ' -f' : '';
        const cmd = `${getPodmanPath()} pod ${command}${forceFlag} ${podId}`;
        await execAsync(cmd);
        vscode.window.showInformationMessage(`Pod ${command} command for ${podId} executed successfully.`);
    } catch (error) {
        const cmd = `${getPodmanPath()} pod ${command}${force ? ' -f' : ''} ${podId}`;
        await showErrorWithCopy(`Failed to run pod command: ${error}`, cmd);
    }
}

async function viewContainerLogs(item: PodmanItem) {
    if (item.id) {
        try {
            const containerId = extractContainerId(item.id);
            const cmd = `${getPodmanPath()} logs ${containerId}`;
            const { stdout, stderr } = await execAsync(cmd);

            if (stderr) {
                vscode.window.showWarningMessage(`Error fetching logs for ${item.label}: ${stderr}`);
            }

            const outputChannel = vscode.window.createOutputChannel(`Podman Logs: ${item.label}`);
            outputChannel.appendLine(`--- Logs for container ${item.label} (${containerId}) ---`);
            outputChannel.append(stdout);
            outputChannel.append(stderr);
            outputChannel.show();
        } catch (error) {
            await showErrorWithCopy(`Failed to fetch logs for container ${item.id}: ${error}`, `${getPodmanPath()} logs ${item.id}`);
        }
    }
}


export function deactivate() {
    console.log('Podmanager extension is now deactivated.');
}