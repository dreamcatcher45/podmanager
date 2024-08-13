import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';

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
            await execAsync('podman machine start');
            vscode.window.showInformationMessage('Podman machine started successfully');
            podmanTreeDataProvider.refresh();
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

    const powerOnPodmanMachineCommand = vscode.commands.registerCommand('podmanager.powerOnPodmanMachine', async () => {
        try {
            const { stdout } = await execAsync('podman machine list --format "{{.Name}}|{{.Running}}"');
            const machines = stdout.split('\n').filter(line => line.trim() !== '');
            const runningMachine = machines.find(machine => machine.split('|')[1] === 'Running');
    
            if (runningMachine) {
                vscode.window.showInformationMessage('Podman machine is already running.');
            } else {
                await execAsync('podman machine start');
                vscode.window.showInformationMessage('Podman machine started successfully');
                podmanTreeDataProvider.refresh();
            }
        } catch (error) {
            vscode.window.showErrorMessage('Failed to start Podman machine: ' + error);
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

    context.subscriptions.push(
        refreshCommand,
        powerOnPodmanMachineCommand,
        startPodmanMachineCommand,
        deleteContainerCommand,
        deleteImageCommand,
        deleteVolumeCommand,
        deleteNetworkCommand,
        startContainerCommand,
        stopContainerCommand,
        openInTerminalCommand
    );

    checkPodmanMachineStatus();
}

async function checkPodmanMachineStatus() {
    try {
        const { stdout } = await execAsync('podman machine list --format "{{.Name}}|{{.Running}}"');
        const machines = stdout.split('\n').filter(line => line.trim() !== '');
        const runningMachine = machines.find(machine => machine.split('|')[1] === 'Running');

        if (!runningMachine) {
            const answer = await vscode.window.showInformationMessage(
                'Podman machine is not running. Do you want to start it?',
                'Yes', 'No'
            );
            if (answer === 'Yes') {
                vscode.commands.executeCommand('podmanager.powerOnPodmanMachine');
            }
        }
    } catch (error) {
        vscode.window.showErrorMessage('Failed to check Podman machine status: ' + error);
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
                new PodmanItem('Networks', vscode.TreeItemCollapsibleState.Collapsed, 'networks')
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
                    return new PodmanItem(`${name} (${id})`, vscode.TreeItemCollapsibleState.None, 'container', id, status);
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
}

class PodmanItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly contextValue: string,
        public readonly id?: string,
        public readonly status?: string
    ) {
        super(label, collapsibleState);
        this.contextValue = contextValue;
        this.iconPath = this.getIconPath();
    }

    private getIconPath(): vscode.ThemeIcon | undefined {
        switch (this.contextValue) {
            case 'container':
                return new vscode.ThemeIcon(this.status?.startsWith('Up') ? 'vm-running' : 'vm');
            case 'image':
                return new vscode.ThemeIcon('file-media');
            case 'volume':
                return new vscode.ThemeIcon('database');
            case 'network':
                return new vscode.ThemeIcon('globe');
            default:
                return undefined;
        }
    }
}

export function deactivate() {}