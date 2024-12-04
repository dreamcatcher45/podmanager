import * as vscode from 'vscode';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { PodmanItem } from './podmanItem';

const execAsync = promisify(exec);

function getPodmanPath(): string {
    const config = vscode.workspace.getConfiguration('podmanager');
    return config.get('podmanPath', 'podman');
}

export class PodmanTreeDataProvider implements vscode.TreeDataProvider<PodmanItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<PodmanItem | undefined | null | void> = 
        new vscode.EventEmitter<PodmanItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<PodmanItem | undefined | null | void> = 
        this._onDidChangeTreeData.event;

    private refreshTimeout: NodeJS.Timeout | null = null;
    private overviewData: string = '';
    private cache: Map<string, PodmanItem[]> = new Map();
    private registeredIds: Set<string> = new Set();

    constructor() {
        this.refreshOverview();
    }

    refresh(): void {
        if (this.refreshTimeout) {
            clearTimeout(this.refreshTimeout);
        }
        this.refreshTimeout = setTimeout(() => {
            this.cache.clear();
            this.registeredIds.clear();
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

        const cacheKey = `${element.contextValue}-${element.id}`;
        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey)!;
        }

        let children: PodmanItem[] = [];
        switch (element.contextValue) {
            case 'containers':
                children = await this.getContainers();
                break;
            case 'images':
                children = await this.getImages();
                break;
            case 'volumes':
                children = await this.getVolumes();
                break;
            case 'networks':
                children = await this.getNetworks();
                break;
            case 'overview':
                children = this.getOverviewItems();
                break;
            case 'pod':
                children = await this.getPodContainers(element.id!);
                break;
            case 'compose-group':
                children = element?.children || [];
                break;
        }

        this.cache.set(cacheKey, children);
        return children;
    }

    private getRootItems(): PodmanItem[] {
        return [
            new PodmanItem('Containers', vscode.TreeItemCollapsibleState.Collapsed, 'containers'),
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
                    const containerStatus = status || 'Unknown';
                    const isRunning = containerStatus && typeof containerStatus === 'string' ? 
                        containerStatus.startsWith('Up') : false;
                    const containerLabels = labels || '';
                    const isCompose = containerLabels.includes('com.docker.compose.project');
                    const composeProject = isCompose ? this.extractComposeProject(containerLabels) : '';
                    const composeFile = isCompose ? this.extractComposeFile(containerLabels) : '';
                    
                    return { 
                        id: id || '', 
                        name: name || id || 'unnamed', 
                        status: containerStatus, 
                        isRunning, 
                        isCompose, 
                        composeProject, 
                        composeFile 
                    };
                });

            const nonComposeContainers = containers
                .filter(c => !c.isCompose && c.id) 
                .map(c => new PodmanItem(
                    `${c.name} (${c.id})`,
                    vscode.TreeItemCollapsibleState.None,
                    'container',
                    c.id,
                    c.status,
                    c.isRunning
                ));

            const composeGroups = this.getComposeGroups(containers);

            return [...nonComposeContainers, ...composeGroups];
        } catch (error) {
            console.error('Failed to get containers:', error);
            vscode.window.showErrorMessage(`Failed to get containers: ${error}`);
            return [];
        }
    }

    private async getImages(): Promise<PodmanItem[]> {
        try {
            const { stdout } = await execAsync(`${getPodmanPath()} image ls --format "{{.ID}}|{{.Repository}}|{{.Tag}}"`);
            const imageMap = new Map<string, string[]>();

            stdout.split('\n')
                .filter(line => line.trim() !== '')
                .forEach(line => {
                    const [id, repository, tag] = line.split('|');
                    if (repository !== "<none>" && tag !== "<none>") {
                        if (!imageMap.has(id)) {
                            imageMap.set(id, []);
                        }
                        imageMap.get(id)!.push(`${repository}:${tag}`);
                    }
                });

            const { stdout: containerStdout } = await execAsync(`${getPodmanPath()} container ls -a --format "{{.ImageID}}"`);
            const usedImageIds = new Set(containerStdout.split('\n').filter(line => line.trim() !== ''));

            return Array.from(imageMap.entries()).map(([id, names]) => {
                const isUsed = usedImageIds.has(id);
                const label = names.length > 1
                    ? `${id} (${names.length} tags)`
                    : `${names[0]} (${id})`;
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
                    return new PodmanItem(
                        `${name} (${driver})`,
                        vscode.TreeItemCollapsibleState.None,
                        'volume',
                        `volume-${name}`,
                        undefined,
                        undefined,
                        undefined,
                        undefined,
                        undefined,
                        name  // Pass the actual volume name as resourceName
                    );
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
                    return new PodmanItem(
                        `${name} (${driver})`,
                        vscode.TreeItemCollapsibleState.None,
                        'network',
                        `network-${name}`,
                        undefined,
                        undefined,
                        undefined,
                        undefined,
                        undefined,
                        name  // Pass the actual network name as resourceName
                    );
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

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return [];
        }

        const workingDir = workspaceFolders[0].uri.fsPath;
        const composeFile = path.join(workingDir, 'docker-compose.yml');

        return Object.entries(composeGroups).map(([project, containers]) => {
            const children = containers.map((c: any) => {
                const uniqueId = `compose-${project}-${c.id}`;
                if (this.registeredIds.has(uniqueId)) {
                    return null;
                }
                this.registeredIds.add(uniqueId);
                
                return new PodmanItem(
                    `${c.name} (${c.id})`,
                    vscode.TreeItemCollapsibleState.None,
                    'compose-container',
                    c.id,
                    c.status,
                    c.isRunning,
                    project
                );
            }).filter(Boolean) as PodmanItem[];

            return new PodmanItem(
                `${project}`,
                vscode.TreeItemCollapsibleState.Collapsed,
                'compose-group',
                `compose-group-${project}`,
                undefined,
                undefined,
                project,
                children,
                undefined,
                undefined,
                composeFile
            );
        });
    }

    private extractComposeProject(labels: string): string {
        const projectPattern = /com\.docker\.compose\.project(=|:)/;
        return this.extractLabelValue(labels, projectPattern, 'Unknown Project');
    }

    private extractComposeFile(labels: string): string {
        const directoryPattern = /com\.docker\.compose\.project\.working_dir(=|:)/;
        const path = this.extractLabelValue(labels, directoryPattern, '');
        if (path.length > 0) {
            const filePattern = /com\.docker\.compose\.project\.config_files(=|:)/;
            const composeFile = this.extractLabelValue(labels, filePattern, '');
            return composeFile.length > 0 ? `${path}/${composeFile}` : '';
        }
        return '';
    }

    private extractLabelValue(labels: string, labelKeyPattern: RegExp, defaultValue: string): string {
        const splitLabels = labels.split(/,| /);
        const projectLabel = splitLabels.find(label => labelKeyPattern.test(label));
        return projectLabel ? projectLabel.split(labelKeyPattern)[2] : defaultValue;
    }
}