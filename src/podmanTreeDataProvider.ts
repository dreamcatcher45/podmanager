import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import { PodmanItem } from './podmanItem';

const execAsync = promisify(exec);

function getPodmanPath(): string {
    const config = vscode.workspace.getConfiguration('podmanager');
    return config.get('podmanPath', 'podman');
}

export class PodmanTreeDataProvider implements vscode.TreeDataProvider<PodmanItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<PodmanItem | undefined | null | void> = new vscode.EventEmitter<PodmanItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<PodmanItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private refreshTimeout: NodeJS.Timeout | null = null;
    private overviewData: string = '';

    constructor() {
        this.refreshOverview();
    }

    refresh(): void {
        if (this.refreshTimeout) {
            clearTimeout(this.refreshTimeout);
        }
        this.refreshTimeout = setTimeout(() => {
            this._onDidChangeTreeData.fire();
            this.refreshTimeout = null;
        }, 300);
    }

    async refreshOverview(): Promise<void> {
        try {
            const { stdout } = await execAsync(`${getPodmanPath()} system df`);
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
            return this.getRootItems();
        }

        switch (element.contextValue) {
            case 'containers':
                return this.getContainers();
            case 'pods':
                return this.getPods();
            case 'images':
                return this.getImages();
            case 'volumes':
                return this.getVolumes();
            case 'networks':
                return this.getNetworks();
            case 'overview':
                return this.getOverviewItems();
            case 'pod':
                return this.getPodContainers(element.id!);
            default:
                return [];
        }
    }

    private getRootItems(): PodmanItem[] {
        return [
            new PodmanItem('Containers', vscode.TreeItemCollapsibleState.Collapsed, 'containers'),
            new PodmanItem('Pods', vscode.TreeItemCollapsibleState.Collapsed, 'pods'),
            new PodmanItem('Images', vscode.TreeItemCollapsibleState.Collapsed, 'images'),
            new PodmanItem('Volumes', vscode.TreeItemCollapsibleState.Collapsed, 'volumes'),
            new PodmanItem('Networks', vscode.TreeItemCollapsibleState.Collapsed, 'networks'),
            new PodmanItem('Overview', vscode.TreeItemCollapsibleState.Collapsed, 'overview'),
        ];
    }

    private async getContainers(): Promise<PodmanItem[]> {
        try {
            const { stdout: containerStdout } = await execAsync(`${getPodmanPath()} container ls -a --format "{{.ID}}|{{.Names}}|{{.Status}}|{{.Labels}}"`);
            const containers = containerStdout.split('\n')
                .filter(line => line.trim() !== '')
                .map(line => {
                    const [id, name, status, labels] = line.split('|');
                    const isRunning = status.startsWith('Up');
                    const isCompose = labels.includes('com.docker.compose.project');
                    const composeProject = isCompose ? this.extractComposeProject(labels) : '';
                    return { id, name, status, isRunning, isCompose, composeProject };
                });

            const nonComposeContainers = containers
                .filter(c => !c.isCompose)
                .map(c => new PodmanItem(`${c.name} (${c.id})`, vscode.TreeItemCollapsibleState.None, 'container', c.id, c.status, c.isRunning));

            const composeGroups = this.getComposeGroups(containers);

            return [...nonComposeContainers, ...composeGroups];
        } catch (error) {
            vscode.window.showErrorMessage('Failed to get containers: ' + error);
            return [];
        }
    }

    private async getPods(): Promise<PodmanItem[]> {
        try {
            const { stdout } = await execAsync(`${getPodmanPath()} pod ps --format "{{.Name}}|{{.Status}}|{{.Created}}|{{.Id}}"`);
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

    private async getImages(): Promise<PodmanItem[]> {
        try {
            const { stdout: imageStdout } = await execAsync(`${getPodmanPath()} image ls --format "{{.ID}}|{{.Repository}}|{{.Tag}}"`);
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
    
            const { stdout: containerStdout } = await execAsync(`${getPodmanPath()} container ls -a --format "{{.ImageID}}"`);
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

    private async getVolumes(): Promise<PodmanItem[]> {
        try {
            const { stdout } = await execAsync(`${getPodmanPath()} volume ls --format "{{.Name}}|{{.Driver}}"`);
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
            const { stdout } = await execAsync(`${getPodmanPath()} network ls --format "{{.Name}}|{{.Driver}}"`);
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

    private getOverviewItems(): PodmanItem[] {
        const lines = this.overviewData.split('\n');
        return lines
            .filter(line => line.trim() !== '')
            .map(line => new PodmanItem(line, vscode.TreeItemCollapsibleState.None, 'overview-item'));
    }

    private async getPodContainers(podName: string): Promise<PodmanItem[]> {
        try {
            const { stdout } = await execAsync(`${getPodmanPath()} ps --filter "pod=${podName}" --format "{{.ID}}|{{.Names}}|{{.Status}}|{{.CreatedAt}}"`);
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

    private extractComposeProject(labels: string): string {
        const projectLabel = labels.split(',').find(label => label.startsWith('com.docker.compose.project='));
        return projectLabel ? projectLabel.split('=')[1] : 'Unknown Project';
    }

    private getComposeGroups(containers: any[]): PodmanItem[] {
        const composeGroups = containers.reduce((groups: { [key: string]: any[] }, container) => {
            if (container.isCompose) {
                const project = container.composeProject;
                if (!groups[project]) {
                    groups[project] = [];
                }
                groups[project].push(container);
            }
            return groups;
        }, {});

        return Object.entries(composeGroups).map(([project, containers], index) => {
            const groupItem = new PodmanItem(`Compose Group ${index + 1}: ${project}`, vscode.TreeItemCollapsibleState.Collapsed, 'compose-group', undefined, undefined, undefined, project);
            groupItem.children = containers.map((c: any) => 
                new PodmanItem(`${c.name} (${c.id})`, vscode.TreeItemCollapsibleState.None, 'compose-container', c.id, c.status, c.isRunning, project)
            );
            return groupItem;
        });
    }
}