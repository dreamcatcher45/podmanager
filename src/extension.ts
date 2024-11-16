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
        vscode.commands.registerCommand('podmanager.buildImage', buildImage)
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
    const dockerfilePath = uri.fsPath;
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);

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

async function startPodmanMachine() {
    try {
        const isRunning = await checkPodmanMachineStatus();
        if (isRunning) {
            vscode.window.showInformationMessage('Podman machine is already running.');
        } else {
            const answer = await vscode.window.showInformationMessage(
                'Podman machine is not running. Do you want to start it?',
                'Yes', 'No'
            );
            if (answer === 'Yes') {
                await execAsync(`${getPodmanPath()} machine start`);
                vscode.window.showInformationMessage('Podman machine started successfully');
            }
        }
    } catch (error) {
        vscode.window.showErrorMessage('Failed to start Podman machine: ' + error);
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
            const terminal = vscode.window.createTerminal(`Podman: ${item.label}`);
            terminal.sendText(`${getPodmanPath()} exec -it ${item.id} /bin/sh`);
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

async function checkPodmanMachineStatus(): Promise<boolean> {
    try {
        const { stdout } = await execAsync(`${getPodmanPath()} machine list --format "{{.Name}}|{{.Running}}"`);
        const machines = stdout.split('\n').filter(line => line.trim() !== '');
        const runningMachine = machines.find(machine => machine.split('|')[1] === 'Running');
        return !!runningMachine;
    } catch (error) {
        vscode.window.showErrorMessage('Failed to check Podman machine status: ' + error);
        return false;
    }
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

async function runComposeCommand(command: string, input?: vscode.Uri | PodmanItem) {
    let composeFile: string | undefined;
    let projectName: string | undefined;
    let workingDir: string | undefined;

    if (input instanceof vscode.Uri) {
        composeFile = input.fsPath;
        workingDir = path.dirname(composeFile);
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(input);
        if (workspaceFolder) {
            const folderName = path.basename(workspaceFolder.uri.fsPath);
            const fileName = path.basename(composeFile, path.extname(composeFile));
            projectName = `${folderName}_${fileName}`;
        }
    } else if (input && 'contextValue' in input && input.contextValue === 'compose-group') {
        projectName = input.composeProject;
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('No workspace folder is open');
            return;
        }
        workingDir = workspaceFolders[0].uri.fsPath;
        composeFile = path.join(workingDir, 'docker-compose.yml');
    }

    if (!composeFile || !fs.existsSync(composeFile)) {
        vscode.window.showErrorMessage('Compose file not found');
        return;
    }

    if (!projectName) {
        vscode.window.showErrorMessage('Could not determine project name');
        return;
    }

    if (!workingDir) {
        vscode.window.showErrorMessage('Could not determine working directory');
        return;
    }

    try {
        const options = { cwd: workingDir };
        const cmd = `${getPodmanPath()}-compose -f "${composeFile}" -p "${projectName}" ${command}`;
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

export function deactivate() { }