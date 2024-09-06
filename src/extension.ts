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

    // overview support 
    const refreshOverviewCommand = vscode.commands.registerCommand('podmanager.refreshOverview', () => {
        podmanTreeDataProvider.refreshOverview();
    });

    //additional utitilities option
    const openToolsMenuCommand = vscode.commands.registerCommand('podmanager.openToolsMenu', async () => {
        const selected = await vscode.window.showQuickPick(
            [
                { label: 'Prune Dangling Images', command: 'podmanager.pruneImages' },
                { label: 'Prune All Unused Images', command: 'podmanager.pruneAllImages' },
                { label: 'Prune Builder Cache', command: 'podmanager.pruneBuilderCache' }
            ],
            { placeHolder: 'Select a Podman tool' }
        );

        if (selected) {
            vscode.commands.executeCommand(selected.command);
        }
    });

    const pruneImagesCommand = vscode.commands.registerCommand('podmanager.pruneImages', async () => {
        await runPruneCommand('podman image prune -f', 'Remove all dangling images');
    });

    const pruneAllImagesCommand = vscode.commands.registerCommand('podmanager.pruneAllImages', async () => {
        await runPruneCommand('podman image prune -a -f', 'Remove all unused images');
    });

    const pruneBuilderCacheCommand = vscode.commands.registerCommand('podmanager.pruneBuilderCache', async () => {
        await runPruneCommand('podman builder prune -a -f', 'Remove Podman builder cache');
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

    const restartContainerCommand = vscode.commands.registerCommand('podmanager.restartContainer', async (item: PodmanItem) => {
        try {
            await execAsync(`podman container restart ${item.id}`);
            vscode.window.showInformationMessage(`Container ${item.id} restarted successfully`);
            podmanTreeDataProvider.refresh();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to restart container ${item.id}: ` + error);
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
    const composeUpCommand = vscode.commands.registerCommand('podmanager.composeUp', async (uri?: vscode.Uri) => {
        await runComposeCommand('up -d', uri);
        podmanTreeDataProvider.refresh();
    });


      // Add new pod-related commands
      const startPodCommand = vscode.commands.registerCommand('podmanager.startPod', async (item: PodmanItem) => {
        await runPodCommand('start', item.id!);
        podmanTreeDataProvider.refresh();
    });

    const stopPodCommand = vscode.commands.registerCommand('podmanager.stopPod', async (item: PodmanItem) => {
        await runPodCommand('stop', item.id!);
        podmanTreeDataProvider.refresh();
    });

    const restartPodCommand = vscode.commands.registerCommand('podmanager.restartPod', async (item: PodmanItem) => {
        await runPodCommand('restart', item.id!);
        podmanTreeDataProvider.refresh();
    });

    const deletePodCommand = vscode.commands.registerCommand('podmanager.deletePod', async (item: PodmanItem) => {
        const answer = await vscode.window.showWarningMessage(
            `Are you sure you want to forcefully delete pod ${item.id}?`,
            'Yes', 'No'
        );
        if (answer === 'Yes') {
            await runPodCommand('rm', item.id!, true);
            podmanTreeDataProvider.refresh();
        }
    });
    
    context.subscriptions.push(
        refreshCommand,
        startPodmanMachineCommand,
        deleteContainerCommand,
        startContainerCommand,
        stopContainerCommand,
        restartContainerCommand,
        openInTerminalCommand,
        deleteImageCommand,
        deleteVolumeCommand,
        deleteNetworkCommand,
        startPodCommand,
        stopPodCommand,
        restartPodCommand,
        deletePodCommand,
        refreshOverviewCommand,
        openToolsMenuCommand,
        pruneImagesCommand,
        pruneAllImagesCommand,
        pruneBuilderCacheCommand
    );

    checkPodmanMachineStatus();
}


async function runPruneCommand(command: string, description: string): Promise<void> {
    const answer = await vscode.window.showWarningMessage(
        `Are you sure you want to ${description.toLowerCase()}?`,
        'Yes', 'No'
    );

    if (answer === 'Yes') {
        try {
            vscode.window.showInformationMessage(`Starting to ${description.toLowerCase()}...`);
            const { stdout, stderr } = await execAsync(command);
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

async function runComposeCommand(command: string, uri?: vscode.Uri, composeProject?: string) {
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
    } else if (composeProject) {
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

    if (!composeFile && !composeProject) {
        vscode.window.showErrorMessage('No compose file found');
        return;
    }

    vscode.window.showInformationMessage(`Starting Podman Compose ${command}...`);

    try {
        let cmd = `podman-compose`;
        if (composeFile) {
            cmd += ` -f "${composeFile}"`;
        }
        if (projectName) {
            cmd += ` -p "${projectName}"`;
        } else if (composeProject) {
            cmd += ` -p "${composeProject}"`;
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
        const { stdout, stderr } = await execAsync(`podman pod ${command}${forceFlag} ${podId}`);
        vscode.window.showInformationMessage(`Pod ${command} executed successfully`);
        if (stderr) {
            vscode.window.showWarningMessage(`Pod ${command} completed with warnings: ${stderr}`);
        }
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to execute pod ${command}: ${error}`);
    }
}

class PodmanTreeDataProvider implements vscode.TreeDataProvider<PodmanItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<PodmanItem | undefined | null | void> = new vscode.EventEmitter<PodmanItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<PodmanItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private refreshTimeout: NodeJS.Timeout | null = null;

    private overviewData: string = '';

    refresh(): void {
        if (this.refreshTimeout) {
            clearTimeout(this.refreshTimeout);
        }
        this.refreshTimeout = setTimeout(() => {
            this._onDidChangeTreeData.fire();
            this.refreshTimeout = null;
        }, 300);
    }

    //overview support
    constructor() {
        this.refreshOverview();
    }
    async refreshOverview(): Promise<void> {
        try {
            const { stdout } = await execAsync('podman system df');
            this.overviewData = stdout;
            this.refresh();
        } catch (error) {
            vscode.window.showErrorMessage('Failed to fetch Podman system overview: ' + error);
        }
    }
    
    getTreeItem(element: PodmanItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: PodmanItem): Promise<PodmanItem[]> {
        if (!element) {
            return [
                new PodmanItem('Containers', vscode.TreeItemCollapsibleState.Collapsed, 'containers'),
                new PodmanItem('Pods', vscode.TreeItemCollapsibleState.Collapsed, 'pods'),
                new PodmanItem('Images', vscode.TreeItemCollapsibleState.Collapsed, 'images'),
                new PodmanItem('Volumes', vscode.TreeItemCollapsibleState.Collapsed, 'volumes'),
                new PodmanItem('Networks', vscode.TreeItemCollapsibleState.Collapsed, 'networks'),
                new PodmanItem('Overview', vscode.TreeItemCollapsibleState.Collapsed, 'overview'),
            ];
        }

        switch (element.contextValue) {
            case 'containers':
                return this.getContainers();
            case 'images':
                return this.getImages();
            case 'volumes':
                return this.getVolumes();
            case 'networks':
                return this.getNetworks();
            case 'image':
                return element.children || [];
            case 'overview':
                return this.getOverviewItems();
            case 'pods':
                return this.getPods();
            case 'pod':
                return this.getPodContainers(element.id!);
            default:
                return [];
        }
    }

    private async getPods(): Promise<PodmanItem[]> {
        try {
            const { stdout } = await execAsync('podman pod ps --format "{{.Name}}|{{.Status}}|{{.Created}}|{{.Id}}"');
            return stdout.split('\n')
                .filter(line => line.trim() !== '')
                .map(line => {
                    const [name, status, created, id] = line.split('|');
                    return new PodmanItem(
                        `Pod: ${name}`,
                        vscode.TreeItemCollapsibleState.Collapsed,
                        'pod',
                        id,
                        `Status: ${status}\nCreated: ${created}`
                    );
                });
        } catch (error) {
            vscode.window.showErrorMessage('Failed to get pods: ' + error);
            return [];
        }
    }

    private async getPodContainers(podName: string): Promise<PodmanItem[]> {
        try {
            const { stdout } = await execAsync(`podman ps --filter "pod=${podName}" --format "{{.ID}}|{{.Names}}|{{.Status}}|{{.CreatedAt}}"`);
            return stdout.split('\n')
                .filter(line => line.trim() !== '')
                .map(line => {
                    const [id, name, status, created] = line.split('|');
                    return new PodmanItem(
                        `${name} (${id})`,
                        vscode.TreeItemCollapsibleState.None,
                        'container',
                        id,
                        `Status: ${status}\nCreated: ${created}`,
                        status.toLowerCase().includes('up')
                    );
                });
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to get containers for pod ${podName}: ${error}`);
            return [];
        }
    }
    private getOverviewItems(): PodmanItem[] {
        const lines = this.overviewData.split('\n');
        return lines
            .filter(line => line.trim() !== '') // Filter out empty lines
            .map(line => new PodmanItem(line, vscode.TreeItemCollapsibleState.None, 'overview-item'));
    }

    private async getImages(): Promise<PodmanItem[]> {
        try {
            // Get all images
            const { stdout: imageStdout } = await execAsync('podman image ls --format "{{.ID}}|{{.Repository}}|{{.Tag}}"');
            const imageMap = new Map<string, string[]>();
    
            imageStdout.split('\n')
                .filter(line => line.trim() !== '')
                .forEach(line => {
                    const [id, repository, tag] = line.split('|');
                    if (!imageMap.has(id)) {
                        imageMap.set(id, []);
                    }
                    imageMap.get(id)!.push(`${repository}:${tag}`);
                });
    
            // Get all containers to check which images are in use
            const { stdout: containerStdout } = await execAsync('podman container ls -a --format "{{.ImageID}}"');
            const usedImageIds = new Set(containerStdout.split('\n').filter(line => line.trim() !== ''));
    
            return Array.from(imageMap.entries()).map(([id, names]) => {
                const isUsed = usedImageIds.has(id);
                const label = names.length > 1 
                    ? `Image: ${id} (${names.length} tags)`
                    : `Image: ${id} (${names[0]})`;
                const children = names.map((name, index) => 
                    new PodmanItem(name, vscode.TreeItemCollapsibleState.None, 'image-tag', `${id}-tag-${index}`, id)
                );
                return new PodmanItem(
                    label,
                    names.length > 1 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
                    'image',
                    id,
                    id,
                    undefined,
                    undefined,
                    children,
                    isUsed
                );
            });
        } catch (error) {
            vscode.window.showErrorMessage('Failed to get images: ' + error);
            return [];
        }
    }

    private async getContainers(): Promise<PodmanItem[]> {
        try {
            const { stdout: containerStdout } = await execAsync('podman container ls -a --format "{{.ID}}|{{.Names}}|{{.Status}}|{{.Labels}}"');
            const containers = containerStdout.split('\n')
                .filter(line => line.trim() !== '')
                .map(line => {
                    const [id, name, status, labels] = line.split('|');
                    const isRunning = status.startsWith('Up');
                    const isCompose = labels.includes('com.docker.compose.project');
                    const composeProject = isCompose ? this.extractComposeProject(labels) : '';
                    return { id, name, status, isRunning, isCompose, composeProject };
                });

            return containers
                .filter(c => !c.isCompose)
                .map(c => new PodmanItem(`${c.name} (${c.id})`, vscode.TreeItemCollapsibleState.None, 'container', c.id, c.status, c.isRunning));
        } catch (error) {
            vscode.window.showErrorMessage('Failed to get containers: ' + error);
            return [];
        }
    }
    
    

    //get compose group
    private async getComposeGroups(): Promise<PodmanItem[]> {
        try {
            const { stdout: containerStdout } = await execAsync('podman container ls -a --format "{{.ID}}|{{.Names}}|{{.Status}}|{{.Labels}}"');
            const composeContainers = containerStdout.split('\n')
                .filter(line => line.trim() !== '')
                .map(line => {
                    const [id, name, status, labels] = line.split('|');
                    const isRunning = status.startsWith('Up');
                    const isCompose = labels.includes('com.docker.compose.project');
                    const composeProject = isCompose ? this.extractComposeProject(labels) : '';
                    return { id, name, status, isRunning, isCompose, composeProject };
                })
                .filter(c => c.isCompose);

            const composeGroups = this.groupComposeContainers(composeContainers);
            
            return Object.entries(composeGroups).map(([project, containers], index) => {
                const groupItem = new PodmanItem(`Compose Group ${index + 1}: ${project}`, vscode.TreeItemCollapsibleState.Collapsed, 'compose-group', undefined, undefined, undefined, project);
                groupItem.children = containers.map(c => 
                    new PodmanItem(`${c.name} (${c.id})`, vscode.TreeItemCollapsibleState.None, 'compose-container', c.id, c.status, c.isRunning, project)
                );
                return groupItem;
            });
        } catch (error) {
            vscode.window.showErrorMessage('Failed to get compose groups: ' + error);
            return [];
        }
    }
    
    private extractComposeProject(labels: string): string {
        const projectLabel = labels.split(',').find(label => label.startsWith('com.docker.compose.project='));
        return projectLabel ? projectLabel.split('=')[1] : 'Unknown Project';
    }

    private groupComposeContainers(containers: any[]): { [key: string]: any[] } {
        return containers.reduce((groups: { [key: string]: any[] }, container) => {
            const project = container.composeProject;
            if (!groups[project]) {
                groups[project] = [];
            }
            groups[project].push(container);
            return groups;
        }, {});
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
        public readonly status?: string,
        public readonly isRunning?: boolean,
        public readonly composeProject?: string,
        public children?: PodmanItem[],
        public readonly isUsed?: boolean
    ) {
        super(label, collapsibleState);
        this.contextValue = contextValue;
        this.iconPath = this.getIconPath();
        this.tooltip = this.getTooltip();
        this.command = this.getCommand();
    }
    
    private getIconPath(): vscode.ThemeIcon | { light: string; dark: string } | undefined {
        switch (this.contextValue) {
            case 'pod':
                return new vscode.ThemeIcon('symbol-namespace', new vscode.ThemeColor(this.status?.toLowerCase().includes('running') ? 'charts.green' : 'charts.red'));
            case 'container':
                return this.isRunning
                    ? new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('charts.green'))
                    : new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('charts.red'));
            case 'image':
            case 'image-tag':
                return this.isUsed
                    ? new vscode.ThemeIcon('file', new vscode.ThemeColor('charts.green'))
                    : new vscode.ThemeIcon('file', new vscode.ThemeColor('charts.red'));
            case 'volume':
                return new vscode.ThemeIcon('database');
            case 'network':
                return new vscode.ThemeIcon('globe');
            case 'pod':
                return new vscode.ThemeIcon('symbol-namespace');
            default:
                return undefined;
        }
    
    }


    private getTooltip(): string | undefined {
        if (this.contextValue === 'pod') {
            return `ID: ${this.id}\n${this.status}`;
        }
        if (this.contextValue === 'container' || this.contextValue === 'compose-container') {
            return `ID: ${this.id}\nStatus: ${this.status}`;
        } else if (this.contextValue === 'image') {
            return `ID: ${this.id}\nUsed: ${this.isUsed ? 'Yes' : 'No'}`;
        } else if (this.contextValue === 'image-tag') {
            return `ID: ${this.id}\nTag: ${this.label}`;
        }
        return undefined;
    }

    private getCommand(): vscode.Command | undefined {
        if (this.contextValue === 'container' || this.contextValue === 'compose-container') {
            return {
                command: 'podmanager.openInTerminal',
                title: 'Open in Terminal',
                arguments: [this]
            };
        }
        return undefined;
    }
}

export function deactivate() {}