import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execAsync = promisify(exec);

export function activate(context: vscode.ExtensionContext) {
    console.log('Podmanager extension is now active!');

    const podmanTreeDataProvider = new PodmanTreeDataProvider();
    const treeView = vscode.window.createTreeView('podmanView', { treeDataProvider: podmanTreeDataProvider });
    context.subscriptions.push(treeView);

    const refreshCommand = vscode.commands.registerCommand('podmanager.refreshView', () => {
        podmanTreeDataProvider.refresh();
    });

    const startPodmanMachineCommand = vscode.commands.registerCommand('podmanager.startPodmanMachine', async () => {
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
                    await execAsync('podman machine start');
                    vscode.window.showInformationMessage('Podman machine started successfully');
                    podmanTreeDataProvider.refresh();
                }
            }
        } catch (error) {
            vscode.window.showErrorMessage('Failed to start Podman machine: ' + error);
        }
    });

    const deleteContainerCommand = vscode.commands.registerCommand('podmanager.deleteContainer', async (item: PodmanItem) => {
        const answer = await vscode.window.showWarningMessage(`Are you sure you want to delete container ${item.id}?`, 'Yes', 'No');
        if (answer === 'Yes') {
            try {
                await execAsync(`podman container rm -f ${item.id}`);
                vscode.window.showInformationMessage(`Container ${item.id} deleted successfully`);
                podmanTreeDataProvider.refresh();
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to delete container ${item.id}: ` + error);
            }
        }
    });

    const deleteImageCommand = vscode.commands.registerCommand('podmanager.deleteImage', async (item: PodmanItem) => {
        const answer = await vscode.window.showWarningMessage(`Are you sure you want to delete image ${item.id}?`, 'Yes', 'No');
        if (answer === 'Yes') {
            try {
                await execAsync(`podman image rm -f ${item.id}`);
                vscode.window.showInformationMessage(`Image ${item.id} deleted successfully`);
                podmanTreeDataProvider.refresh();
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to delete image ${item.id}: ` + error);
            }
        }
    });

    const deleteVolumeCommand = vscode.commands.registerCommand('podmanager.deleteVolume', async (item: PodmanItem) => {
        const answer = await vscode.window.showWarningMessage(`Are you sure you want to delete volume ${item.id}?`, 'Yes', 'No');
        if (answer === 'Yes') {
            try {
                await execAsync(`podman volume rm -f ${item.id}`);
                vscode.window.showInformationMessage(`Volume ${item.id} deleted successfully`);
                podmanTreeDataProvider.refresh();
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to delete volume ${item.id}: ` + error);
            }
        }
    });

    const deleteNetworkCommand = vscode.commands.registerCommand('podmanager.deleteNetwork', async (item: PodmanItem) => {
        const answer = await vscode.window.showWarningMessage(`Are you sure you want to delete network ${item.id}?`, 'Yes', 'No');
        if (answer === 'Yes') {
            try {
                await execAsync(`podman network rm -f ${item.id}`);
                vscode.window.showInformationMessage(`Network ${item.id} deleted successfully`);
                podmanTreeDataProvider.refresh();
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to delete network ${item.id}: ` + error);
            }
        }
    });

    const startContainerCommand = vscode.commands.registerCommand('podmanager.startContainer', async (item: PodmanItem) => {
        try {
            await execAsync(`podman container start ${item.id}`);
            vscode.window.showInformationMessage(`Container ${item.id} started successfully`);
            podmanTreeDataProvider.refresh();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to start container ${item.id}: ` + error);
        }
    });

    const stopContainerCommand = vscode.commands.registerCommand('podmanager.stopContainer', async (item: PodmanItem) => {
        try {
            await execAsync(`podman container stop ${item.id}`);
            vscode.window.showInformationMessage(`Container ${item.id} stopped successfully`);
            podmanTreeDataProvider.refresh();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to stop container ${item.id}: ` + error);
        }
    });

    const openInTerminalCommand = vscode.commands.registerCommand('podmanager.openInTerminal', async (item: PodmanItem) => {
        if (item.id) {
            try {
                const terminal = vscode.window.createTerminal(`Podman: ${item.label}`);
                terminal.sendText(`podman exec -it ${item.id} /bin/sh`);
                terminal.show();
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to open terminal for container ${item.id}: ${error}`);
            }
        }
    });

    // Updated Compose commands
    const composeUpCommand = vscode.commands.registerCommand('podmanager.composeUp', async () => {
        await runComposeCommand('up -d');
    });

    const composeStartCommand = vscode.commands.registerCommand('podmanager.composeStart', async () => {
        await runComposeCommand('start');
    });

    const composeStopCommand = vscode.commands.registerCommand('podmanager.composeStop', async () => {
        await runComposeCommand('stop');
    });

    const composeDownCommand = vscode.commands.registerCommand('podmanager.composeDown', async () => {
        const answer = await vscode.window.showWarningMessage(
            'Are you sure you want to stop and remove all compose containers?',
            'Yes', 'No'
        );
        if (answer === 'Yes') {
            await runComposeCommand('down');
        }
    });

    context.subscriptions.push(
        refreshCommand,
        startPodmanMachineCommand,
        deleteContainerCommand,
        deleteImageCommand,
        deleteVolumeCommand,
        deleteNetworkCommand,
        startContainerCommand,
        stopContainerCommand,
        openInTerminalCommand,
        composeUpCommand,
        composeStartCommand,
        composeStopCommand,
        composeDownCommand
    );

    checkPodmanMachineStatus();
}

async function checkPodmanMachineStatus(): Promise<boolean> {
    try {
        const { stdout } = await execAsync('podman machine list --format "{{.Name}}|{{.Running}}"');
        const machines = stdout.split('\n').filter(line => line.trim() !== '');
        const runningMachine = machines.find(machine => machine.split('|')[1] === 'Running');
        return !!runningMachine;
    } catch (error) {
        vscode.window.showErrorMessage('Failed to check Podman machine status: ' + error);
        return false;
    }
}

async function runComposeCommand(command: string) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        vscode.window.showErrorMessage('No workspace folder is open');
        return;
    }

    const rootPath = workspaceFolders[0].uri.fsPath;
    const composeFileNames = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];
    let composeFile: string | undefined;

    for (const fileName of composeFileNames) {
        const filePath = path.join(rootPath, fileName);
        if (fs.existsSync(filePath)) {
            composeFile = filePath;
            break;
        }
    }

    if (!composeFile) {
        vscode.window.showErrorMessage('No compose file found in the current directory');
        return;
    }

    vscode.window.showInformationMessage(`Starting Podman Compose ${command}...`);

    try {
        const { stdout, stderr } = await execAsync(`podman-compose -f "${composeFile}" ${command}`);
        vscode.window.showInformationMessage(`Podman Compose ${command} executed successfully`);
        console.log(stdout);
        if (stderr) {
            console.error(stderr);
        }
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to execute Podman Compose ${command}: ${error}`);
    }
}

class PodmanTreeDataProvider implements vscode.TreeDataProvider<PodmanItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<PodmanItem | undefined | null | void> = new vscode.EventEmitter<PodmanItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<PodmanItem | undefined | null | void> = this._onDidChangeTreeData.event;

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: PodmanItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: PodmanItem): Promise<PodmanItem[]> {
        if (!element) {
            return [
                new PodmanItem('Containers', vscode.TreeItemCollapsibleState.Collapsed, 'containers'),
                new PodmanItem('Images', vscode.TreeItemCollapsibleState.Collapsed, 'images'),
                new PodmanItem('Volumes', vscode.TreeItemCollapsibleState.Collapsed, 'volumes'),
                new PodmanItem('Networks', vscode.TreeItemCollapsibleState.Collapsed, 'networks'),
                new PodmanItem('Compose', vscode.TreeItemCollapsibleState.Collapsed, 'compose')
            ];
        }

        switch (element.label) {
            case 'Containers':
                return this.getContainers();
            case 'Images':
                return this.getImages();
            case 'Volumes':
                return this.getVolumes();
            case 'Networks':
                return this.getNetworks();
            case 'Compose':
                return this.getComposeItems();
            default:
                return [];
        }
    }

    private async getContainers(): Promise<PodmanItem[]> {
        try {
            const { stdout } = await execAsync('podman container ls -a --format "{{.ID}}|{{.Names}}|{{.Status}}"');
            return stdout.split('\n')
                .filter(line => line.trim() !== '')
                .map(line => {
                    const [id, name, status] = line.split('|');
                    const isRunning = status.startsWith('Up');
                    return new PodmanItem(`${name} (${id})`, vscode.TreeItemCollapsibleState.None, 'container', id, status, isRunning);
                });
        } catch (error) {
            vscode.window.showErrorMessage('Failed to get containers: ' + error);
            return [];
        }
    }

    private async getImages(): Promise<PodmanItem[]> {
        try {
            const { stdout } = await execAsync('podman image ls --format "{{.ID}}|{{.Repository}}:{{.Tag}}"');
            return stdout.split('\n')
                .filter(line => line.trim() !== '')
                .map(line => {
                    const [id, name] = line.split('|');
                    return new PodmanItem(`${name} (${id})`, vscode.TreeItemCollapsibleState.None, 'image', id);
                });
        } catch (error) {
            vscode.window.showErrorMessage('Failed to get images: ' + error);
            return [];
        }
    }

    private async getVolumes(): Promise<PodmanItem[]> {
        try {
            const { stdout } = await execAsync('podman volume ls --format "{{.Name}}|{{.Driver}}"');
            return stdout.split('\n')
                .filter(line => line.trim() !== '')
                .map(line => {
                    const [name, driver] = line.split('|');
                    return new PodmanItem(`${name} (${driver})`, vscode.TreeItemCollapsibleState.None, 'volume', name);
                });
        } catch (error) {
            vscode.window.showErrorMessage('Failed to get volumes: ' + error);
            return [];
        }
    }

    private async getNetworks(): Promise<PodmanItem[]> {
        try {
            const { stdout } = await execAsync('podman network ls --format "{{.Name}}|{{.Driver}}"');
            return stdout.split('\n')
                .filter(line => line.trim() !== '')
                .map(line => {
                    const [name, driver] = line.split('|');
                    return new PodmanItem(`${name} (${driver})`, vscode.TreeItemCollapsibleState.None, 'network', name);
                });
        } catch (error) {
            vscode.window.showErrorMessage('Failed to get networks: ' + error);
            return [];
        }
    }

    private async getComposeItems(): Promise<PodmanItem[]> {
        const composeItems = [
            new PodmanItem('Up', vscode.TreeItemCollapsibleState.None, 'compose-up'),
            new PodmanItem('Start', vscode.TreeItemCollapsibleState.None, 'compose-start'),
            new PodmanItem('Stop', vscode.TreeItemCollapsibleState.None, 'compose-stop'),
            new PodmanItem('Down', vscode.TreeItemCollapsibleState.None, 'compose-down')
        ];

        const composeContainers = await this.getComposeContainers();
        return [...composeItems, ...composeContainers];
    }

    private async getComposeContainers(): Promise<PodmanItem[]> {
        try {
            const { stdout } = await execAsync('podman-compose ps --format "{{.ID}}|{{.Name}}|{{.Status}}"');
            return stdout.split('\n')
                .filter(line => line.trim() !== '')
               .map(line => {
                    const [id, name, status] = line.split('|');
                    const isRunning = status.startsWith('Up');
                    return new PodmanItem(`${name} (${id})`, vscode.TreeItemCollapsibleState.None, 'compose-container', id, status, isRunning);
                });
        } catch (error) {
            console.error('Failed to get compose containers: ' + error);
            return [];
        }
    }
}

class PodmanItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly contextValue: string,
        public readonly id?: string,
        public readonly status?: string,
        public readonly isRunning?: boolean
    ) {
        super(label, collapsibleState);
        this.contextValue = contextValue;
        this.iconPath = this.getIconPath();
        this.command = this.getCommand();
    }

    private getIconPath(): vscode.ThemeIcon | { light: string; dark: string } | undefined {
        const extensionPath = vscode.extensions.getExtension('your-extension-id')?.extensionPath || '';
        switch (this.contextValue) {
            case 'container':
            case 'compose-container':
                return this.isRunning
                    ? new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('charts.green'))
                    : new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('charts.red'));
            case 'image':
                return new vscode.ThemeIcon('file-media');
            case 'volume':
                return new vscode.ThemeIcon('database');
            case 'network':
                return new vscode.ThemeIcon('globe');
            case 'compose-up':
                return new vscode.ThemeIcon('arrow-up');
            case 'compose-start':
                return new vscode.ThemeIcon('play');
            case 'compose-stop':
                return new vscode.ThemeIcon('stop');
            case 'compose-down':
                return new vscode.ThemeIcon('trash');
            default:
                return undefined;
        }
    }

    private getCommand(): vscode.Command | undefined {
        switch (this.contextValue) {
            case 'compose-up':
                return { command: 'podmanager.composeUp', title: 'Compose Up' };
            case 'compose-start':
                return { command: 'podmanager.composeStart', title: 'Compose Start' };
            case 'compose-stop':
                return { command: 'podmanager.composeStop', title: 'Compose Stop' };
            case 'compose-down':
                return { command: 'podmanager.composeDown', title: 'Compose Down' };
            default:
                return undefined;
        }
    }
}

export function deactivate() {}