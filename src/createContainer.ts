import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface ImageInfo {
    repository: string;
    tag: string;
    id: string;
}

function getPodmanPath(): string {
    const config = vscode.workspace.getConfiguration('podmanager');
    return config.get('podmanPath', 'podman');
}

export async function createContainer() {
    try {
        const mode = await vscode.window.showQuickPick(['Simple', 'Advanced'], { placeHolder: 'Select creation mode' });
        if (!mode) {
            return;
        }

        const images = await getImages();
        const selectedImageInfo = await vscode.window.showQuickPick(
            images.map(img => ({
                label: `${img.repository}:${img.tag}`,
                description: img.id,
                imageInfo: img
            })),
            { placeHolder: 'Select an image' }
        );

        if (!selectedImageInfo) {
            return;
        }

        const name = await vscode.window.showInputBox({ prompt: 'Enter container name (optional)' });

        let command = `${getPodmanPath()} run -d`; // Added -d to run in detached mode
        if (name) {
            command += ` --name ${name}`;
        }

        if (mode === 'Simple') {
            const port = await vscode.window.showInputBox({ prompt: 'Enter port mapping (e.g., 8080:80) or leave empty' });
            if (port) {
                command += ` -p ${port}`;
            }
        } else if (mode === 'Advanced') {
            const volumes = await getVolumes();
            const selectedVolume = await vscode.window.showQuickPick(volumes, { placeHolder: 'Select a volume (optional)' });
            if (selectedVolume) {
                command += ` -v ${selectedVolume}`;
            }

            const networks = await getNetworks();
            const selectedNetwork = await vscode.window.showQuickPick(networks, { placeHolder: 'Select a network (optional)' });
            if (selectedNetwork) {
                command += ` --network ${selectedNetwork}`;
            }

            const envVars = await vscode.window.showInputBox({ prompt: 'Enter environment variables (comma-separated, e.g., VAR1=value1,VAR2=value2)' });
            if (envVars) {
                const envArray = envVars.split(',');
                envArray.forEach(env => {
                    command += ` -e ${env.trim()}`;
                });
            }

            const cpuLimit = await vscode.window.showInputBox({ prompt: 'Enter CPU limit (e.g., 0.5 for half a CPU, leave empty for no limit)' });
            if (cpuLimit) {
                command += ` --cpus=${cpuLimit}`;
            }

            const memoryLimit = await vscode.window.showInputBox({ prompt: 'Enter memory limit (e.g., 512m for 512 MB, leave empty for no limit)' });
            if (memoryLimit) {
                command += ` -m ${memoryLimit}`;
            }

            const securityOpt = await vscode.window.showInputBox({ prompt: 'Enter security options (e.g., no-new-privileges, leave empty for default)' });
            if (securityOpt) {
                command += ` --security-opt ${securityOpt}`;
            }
        }

        // Use the full image name without the ID and add tail -f /dev/null command
        command += ` ${selectedImageInfo.imageInfo.repository}:${selectedImageInfo.imageInfo.tag} tail -f /dev/null`;

        const { stdout, stderr } = await execAsync(command);
        if (stderr) {
            vscode.window.showErrorMessage(`Error creating container: ${stderr}`);
        } else {
            vscode.window.showInformationMessage(`Container created successfully: ${stdout.trim()}`);
        }
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to create container: ${error}`);
    }
}

async function getImages(): Promise<ImageInfo[]> {
    try {
        const { stdout } = await execAsync(`${getPodmanPath()} images --format "{{.Repository}}|{{.Tag}}|{{.ID}}"`);
        return stdout.split('\n')
            .filter(line => line.trim() !== '')
            .map(line => {
                const [repository, tag, id] = line.split('|');
                return {
                    repository: repository !== "<none>" ? repository : id,
                    tag: tag !== "<none>" ? tag : "latest",
                    id: id
                };
            })
            .filter(img => img.repository && img.tag);
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to get images: ${error}`);
        return [];
    }
}

async function getVolumes(): Promise<string[]> {
    try {
        const { stdout } = await execAsync(`${getPodmanPath()} volume ls --format "{{.Name}}"`);
        return stdout.split('\n').filter(line => line.trim() !== '');
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to get volumes: ${error}`);
        return [];
    }
}

async function getNetworks(): Promise<string[]> {
    try {
        const { stdout } = await execAsync(`${getPodmanPath()} network ls --format "{{.Name}}"`);
        return stdout.split('\n').filter(line => line.trim() !== '');
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to get networks: ${error}`);
        return [];
    }
}