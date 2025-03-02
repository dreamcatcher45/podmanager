import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { PodmanTreeDataProvider } from './podmanTreeDataProvider';
import { PodmanItem } from './podmanItem';
import { createContainer } from './createContainer';
import { createVolume, createNetwork } from './createResource';

const execAsync = promisify(exec);
const podmanTreeDataProvider = new PodmanTreeDataProvider();

function getPodmanPath(): string {
    const config = vscode.workspace.getConfiguration('podmanager');
    return config.get('podmanPath', 'podman');
}

async function resetPodmanPath() {
    const config = vscode.workspace.getConfiguration('podmanager');
    await config.update('podmanPath', undefined, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage('Podman path has been reset to default.');
}

export function activate(context: vscode.ExtensionContext) {
    console.log('Podmanager extension is now active!');

    const treeView = vscode.window.createTreeView('podmanView', { treeDataProvider: podmanTreeDataProvider });
    context.subscriptions.push(treeView);

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
        vscode.commands.registerCommand('podmanager.pushImage', async (item: PodmanItem) => {
            if (item.id) {
                try {
                    const config = vscode.workspace.getConfiguration('podmanager');
                    if (!config.get('enablePushCommand')) {
                        vscode.window.showInformationMessage('Push command is disabled in settings');
                        return;
                    }

                    const imageName = item.label.split(' ')[0];
                    const terminal = vscode.window.createTerminal(`Push Image: ${item.label}`);
                    
                    const defaultRegistry = config.get('pushDefaultRegistry');
                    let pushCmd = `${getPodmanPath()} push`;

                    if (defaultRegistry) {
                        pushCmd += ` ${imageName} ${defaultRegistry}/${imageName}`;
                    } else {
                        pushCmd += ` ${imageName}`;
                    }
                    
                    terminal.sendText(pushCmd);
                    terminal.show();
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to push image ${item.id}: ${error}`);
                }
            }
        })
    ];

    context.subscriptions.push(...commands);

    function getMachineName(): string {
        const config = vscode.workspace.getConfiguration('podmanager');
        return config.get<string>('machineName') || 'podman-machine-default';
    }

    async function checkPodmanMachineStatus(): Promise<boolean> {
        const machineName = getMachineName();
        try {
            const result = await executeCommand('podman', ['machine', 'list', '--format', 'json']);
            const machines = JSON.parse(result);
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
            await executeCommand('podman', ['machine', 'start', machineName]);
            vscode.window.showInformationMessage(`Podman machine '${machineName}' started successfully`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to start Podman machine '${machineName}': ${error}`);
        }
    }

    async function stopPodmanMachine() {
        const machineName = getMachineName();
        try {
            await executeCommand('podman', ['machine', 'stop', machineName]);
            vscode.window.showInformationMessage(`Podman machine '${machineName}' stopped successfully`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to stop Podman machine '${machineName}': ${error}`);
        }
    }

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
        vscode.window.showErrorMessage('No Dockerfile path could be determined. Please open the dockerfile');
        return;
    }
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(dockerfilePath));

    if (!workspaceFolder) {
        vscode.window.showErrorMessage('Unable to determine workspace folder');
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

    try {
        const cmd = `${getPodmanPath()} build -t ${imageName} -f "${dockerfilePath}" "${buildContext}"`;
        const { stdout, stderr } = await execAsync(cmd);

        if (stderr) {
            vscode.window.showWarningMessage(`Image build completed with warnings: ${stderr}`);
        } else {
            vscode.window.showInformationMessage(`Image ${imageName} built successfully`);
        }

        // Refresh the Podman view to show the new image
        vscode.commands.executeCommand('podmanager.refreshView');
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to build image: ${error}`);
    }
}

async function runPruneCommand(command: string, description: string): Promise<void> {
    const answer = await vscode.window.showWarningMessage(
        `Are you sure you want to ${description.toLowerCase()}?`,
        'Yes', 'No'
    );

    if (answer === 'Yes') {
        try {
            vscode.window.showInformationMessage(`Starting to ${description.toLowerCase()}...`);
            const { stdout, stderr } = await execAsync(`${getPodmanPath()} ${command}`);
            if (stderr) {
                vscode.window.showErrorMessage(`Error while pruning: ${stderr}`);
            } else {
                vscode.window.showInformationMessage(`Successfully ${description.toLowerCase()}: ${stdout}`);
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to ${description.toLowerCase()}: ${error}`);
        }
    }
}

async function deleteContainer(item: PodmanItem) {
    const containerId = item.originalId || item.id;
    const answer = await vscode.window.showWarningMessage(`Are you sure you want to delete container ${containerId}?`, 'Yes', 'No');
    if (answer === 'Yes') {
        try {
            await execAsync(`${getPodmanPath()} container rm -f ${containerId}`);
            podmanTreeDataProvider.refresh();
            vscode.window.showInformationMessage(`Container ${containerId} deleted successfully`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to delete container ${item.originalId || item.id}: ` + error);
        }
    }
}

async function startContainer(item: PodmanItem) {
    try {
        const containerId = item.originalId || item.id;
        await execAsync(`${getPodmanPath()} container start ${containerId}`);
        podmanTreeDataProvider.refresh();
        vscode.window.showInformationMessage(`Container ${containerId} started successfully`);
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to start container ${item.originalId || item.id}: ` + error);
    }
}

async function stopContainer(item: PodmanItem) {
    try {
        const containerId = item.originalId || item.id;
        await execAsync(`${getPodmanPath()} container stop ${containerId}`);
        podmanTreeDataProvider.refresh();
        vscode.window.showInformationMessage(`Container ${containerId} stopped successfully`);
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to stop container ${item.originalId || item.id}: ` + error);
    }
}

async function restartContainer(item: PodmanItem) {
    try {
        const containerId = item.originalId || item.id;
        await execAsync(`${getPodmanPath()} container restart ${containerId}`);
        podmanTreeDataProvider.refresh();
        vscode.window.showInformationMessage(`Container ${containerId} restarted successfully`);
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to restart container ${item.originalId || item.id}: ` + error);
    }
}

async function openInTerminal(item: PodmanItem) {
    if (item.id) {
        try {
            const containerId = extractContainerId(item.id);
            const terminal = vscode.window.createTerminal(`Podman: ${item.label}`);
            terminal.sendText(`${getPodmanPath()} exec -it ${containerId} /bin/sh`);
            terminal.show();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to open terminal for container ${item.id}: ${error}`);
        }
    }
}

async function deleteImage(item: PodmanItem) {
    const answer = await vscode.window.showWarningMessage(`Are you sure you want to delete image ${item.id}?`, 'Yes', 'No');
    if (answer === 'Yes') {
        try {
            await execAsync(`${getPodmanPath()} image rm -f ${item.id}`);
            podmanTreeDataProvider.refresh();
            vscode.window.showInformationMessage(`Image ${item.id} deleted successfully`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to delete image ${item.id}: ` + error);
        }
    }
}

async function deleteVolume(item: PodmanItem) {
    if (!item.resourceName) {
        vscode.window.showErrorMessage('Unable to delete volume: Resource name is missing');
        return;
    }
    const answer = await vscode.window.showWarningMessage(`Are you sure you want to delete volume ${item.resourceName}?`, 'Yes', 'No');
    if (answer === 'Yes') {
        try {
            await execAsync(`${getPodmanPath()} volume rm -f ${item.resourceName}`);
            vscode.window.showInformationMessage(`Volume ${item.resourceName} deleted successfully`);
            // Refresh the tree view
            vscode.commands.executeCommand('podmanager.refreshView');
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to delete volume ${item.resourceName}: ` + error);
        }
    }
}

async function deleteNetwork(item: PodmanItem) {
    if (!item.resourceName) {
        vscode.window.showErrorMessage('Unable to delete network: Resource name is missing');
        return;
    }
    const answer = await vscode.window.showWarningMessage(`Are you sure you want to delete network ${item.resourceName}?`, 'Yes', 'No');
    if (answer === 'Yes') {
        try {
            await execAsync(`${getPodmanPath()} network rm -f ${item.resourceName}`);
            vscode.window.showInformationMessage(`Network ${item.resourceName} deleted successfully`);
            // Refresh the tree view
            vscode.commands.executeCommand('podmanager.refreshView');
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to delete network ${item.resourceName}: ` + error);
        }
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
    await runComposeCommand('up -d', input);
}

async function composeDown(input?: vscode.Uri | PodmanItem) {
    await runComposeCommand('down', input);
}

async function composeStart(input?: vscode.Uri | PodmanItem) {
    await runComposeCommand('start', input);
}

async function composeStop(input?: vscode.Uri | PodmanItem) {
    await runComposeCommand('stop', input);
}

async function composeRestart(input?: vscode.Uri | PodmanItem) {
    await runComposeCommand('restart', input);
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
    let projectName: string;

    try {
        if (input instanceof vscode.Uri) {
            composeFile = input.fsPath;
            workingDir = path.dirname(composeFile);
            projectName = path.basename(workingDir);
        } else if (input && input.composeProject && input.fsPath) {
            composeFile = input.fsPath;
            workingDir = path.dirname(composeFile);
            projectName = input.composeProject;
        } else {
            const files = await vscode.workspace.findFiles('**/docker-compose.{yml,yaml}', '**/node_modules/**');
            if (files.length === 0) {
                vscode.window.showErrorMessage('No docker-compose.yml file found in the workspace');
                return;
            }
            composeFile = files[0].fsPath;
            workingDir = path.dirname(composeFile);
            projectName = path.basename(workingDir);
        }

        if (!composeFile) {
            vscode.window.showErrorMessage('No compose file specified');
            return;
        }

        if (!workingDir) {
            vscode.window.showErrorMessage('Could not determine working directory');
            return;
        }

        const options = { cwd: workingDir };
        const cmd = buildComposeCommand(getPodmanPath(), composeFile, projectName, command);
        
        const { stdout, stderr } = await execAsync(cmd, options);

        if (stderr) {
            vscode.window.showWarningMessage(`Podman Compose ${command} completed with warnings: ${stderr}`);
        } else {
            vscode.window.showInformationMessage(`Podman Compose ${command} executed successfully`);
        }
        podmanTreeDataProvider.refresh();
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to execute Podman Compose ${command}: ${error}`);
    }
}

async function runPodCommand(command: string, podId: string, force: boolean = false) {
    try {
        const forceFlag = force ? ' -f' : '';
        const { stdout, stderr } = await execAsync(`${getPodmanPath()} pod ${command}${forceFlag} ${podId}`);
        vscode.window.showInformationMessage(`Pod ${command} executed successfully`);
        if (stderr) {
            vscode.window.showWarningMessage(`Pod ${command} completed with warnings: ${stderr}`);
        }
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to execute pod ${command}: ${error}`);
    }
}

async function viewContainerLogs(item: PodmanItem) {
    if (item.id) {
        try {
            const containerId = extractContainerId(item.id);
            const terminal = vscode.window.createTerminal(`Podman Logs: ${item.label}`);
            terminal.sendText(`${getPodmanPath()} logs -f ${containerId}`);
            terminal.show();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to view logs for container ${item.id}: ${error}`);
        }
    }
}

async function executeCommand(command: string, args: string[] = []): Promise<string> {
    try {
        const { stdout, stderr } = await execAsync(`${command} ${args.join(' ')}`);
        if (stderr) {
            console.warn('Command warning:', stderr);
        }
        return stdout.trim();
    } catch (error) {
        console.error('Command error:', error);
        throw error;
    }
}

export function deactivate() { }