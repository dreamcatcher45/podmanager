import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { PodmanTreeDataProvider } from './podmanTreeDataProvider';
import { PodmanItem } from './podmanItem';

const execAsync = promisify(exec);

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

    const podmanTreeDataProvider = new PodmanTreeDataProvider();
    const treeView = vscode.window.createTreeView('podmanView', { treeDataProvider: podmanTreeDataProvider });
    context.subscriptions.push(treeView);

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
        vscode.commands.registerCommand('podmanager.startPod', startPod),
        vscode.commands.registerCommand('podmanager.stopPod', stopPod),
        vscode.commands.registerCommand('podmanager.restartPod', restartPod),
        vscode.commands.registerCommand('podmanager.deletePod', deletePod),
    ];

    context.subscriptions.push(...commands);

    checkPodmanMachineStatus();
}

async function openToolsMenu() {
    const selected = await vscode.window.showQuickPick(
        [
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
    const answer = await vscode.window.showWarningMessage(`Are you sure you want to delete container ${item.id}?`, 'Yes', 'No');
    if (answer === 'Yes') {
        try {
            await execAsync(`${getPodmanPath()} container rm -f ${item.id}`);
            vscode.window.showInformationMessage(`Container ${item.id} deleted successfully`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to delete container ${item.id}: ` + error);
        }
    }
}

async function startContainer(item: PodmanItem) {
    try {
        await execAsync(`${getPodmanPath()} container start ${item.id}`);
        vscode.window.showInformationMessage(`Container ${item.id} started successfully`);
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to start container ${item.id}: ` + error);
    }
}

async function stopContainer(item: PodmanItem) {
    try {
        await execAsync(`${getPodmanPath()} container stop ${item.id}`);
        vscode.window.showInformationMessage(`Container ${item.id} stopped successfully`);
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to stop container ${item.id}: ` + error);
    }
}

async function restartContainer(item: PodmanItem) {
    try {
        await execAsync(`${getPodmanPath()} container restart ${item.id}`);
        vscode.window.showInformationMessage(`Container ${item.id} restarted successfully`);
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to restart container ${item.id}: ` + error);
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
            vscode.window.showInformationMessage(`Image ${item.id} deleted successfully`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to delete image ${item.id}: ` + error);
        }
    }
}

async function deleteVolume(item: PodmanItem) {
    const answer = await vscode.window.showWarningMessage(`Are you sure you want to delete volume ${item.id}?`, 'Yes', 'No');
    if (answer === 'Yes') {
        try {
            await execAsync(`${getPodmanPath()} volume rm -f ${item.id}`);
            vscode.window.showInformationMessage(`Volume ${item.id} deleted successfully`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to delete volume ${item.id}: ` + error);
        }
    }
}

async function deleteNetwork(item: PodmanItem) {
    const answer = await vscode.window.showWarningMessage(`Are you sure you want to delete network ${item.id}?`, 'Yes', 'No');
    if (answer === 'Yes') {
        try {
            await execAsync(`${getPodmanPath()} network rm -f ${item.id}`);
            vscode.window.showInformationMessage(`Network ${item.id} deleted successfully`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to delete network ${item.id}: ` + error);
        }
    }
}

async function composeUp(uri?: vscode.Uri) {
    await runComposeCommand('up -d', uri);
}

async function startPod(item: PodmanItem) {
    await runPodCommand('start', item.id!);
}

async function stopPod(item: PodmanItem) {
    await runPodCommand('stop', item.id!);
}

async function restartPod(item: PodmanItem) {
    await runPodCommand('restart', item.id!);
}

async function deletePod(item: PodmanItem) {
    const answer = await vscode.window.showWarningMessage(
        `Are you sure you want to forcefully delete pod ${item.id}?`,
        'Yes', 'No'
    );
    if (answer === 'Yes') {
        await runPodCommand('rm', item.id!, true);
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

async function runComposeCommand(command: string, uri?: vscode.Uri) {
    let composeFile: string | undefined;
    let projectName: string | undefined;

    if (uri) {
        composeFile = uri.fsPath;
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
        if (workspaceFolder) {
            const relativePath = path.relative(workspaceFolder.uri.fsPath, composeFile);
            const folderName = path.basename(workspaceFolder.uri.fsPath);
            const fileName = path.basename(composeFile, path.extname(composeFile));
            projectName = `${folderName}_${fileName}`;
        }
    } else {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('No workspace folder is open');
            return;
        }

        const rootPath = workspaceFolders[0].uri.fsPath;
        const composeFileNames = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];

        for (const fileName of composeFileNames) {
            const filePath = path.join(rootPath, fileName);
            if (fs.existsSync(filePath)) {
                composeFile = filePath;
                const folderName = path.basename(rootPath);
                projectName = `${folderName}_${path.basename(filePath, path.extname(filePath))}`;
                break;
            }
        }
    }

    if (!composeFile) {
        vscode.window.showErrorMessage('No compose file found');
        return;
    }

    vscode.window.showInformationMessage(`Starting Podman Compose ${command}...`);

    try {
        let cmd = `${getPodmanPath()}-compose -f "${composeFile}"`;
        if (projectName) {
            cmd += ` -p "${projectName}"`;
        }
        cmd += ` ${command}`;

        const { stdout, stderr } = await execAsync(cmd);
        vscode.window.showInformationMessage(`Podman Compose ${command} executed successfully`);
        if (stderr) {
            vscode.window.showWarningMessage(`Podman Compose ${command} completed with warnings: ${stderr}`);
        }
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

export function deactivate() {}