// src/createContainer.ts

import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import { showErrorWithCopy } from './utils/messageUtil'; // Assuming you have this utility from extension.ts

const execAsync = promisify(exec);

interface ImageInfo {
    repository: string;
    tag: string;
    id: string;
}

interface VolumeInfo {
    name: string;
    mountPoint: string;
}

interface AdvancedOptions {
    mounts?: string[];
}

function getPodmanPath(): string {
    const config = vscode.workspace.getConfiguration('podmanager');
    return config.get('podmanPath', 'podman');
}

export async function createContainer() {
    let command = ''; // Define command here to be accessible in catch block
    try {
        const mode = await vscode.window.showQuickPick(['Simple', 'Advanced'], { placeHolder: 'Select creation mode' });
        if (!mode) {
            return;
        }

        const images = await getImages();
        if (images.length === 0) {
            vscode.window.showInformationMessage('No Podman images found. Please pull or build an image first.');
            return;
        }

        const selectedImageInfo = await vscode.window.showQuickPick(
            images.map(img => ({ label: `${img.repository}:${img.tag}`, description: `ID: ${img.id.substring(0, 12)}`, imageInfo: img })),
            { placeHolder: 'Select an image' }
        );

        if (!selectedImageInfo) {
            return;
        }

        const name = await vscode.window.showInputBox({ prompt: 'Enter container name (optional)' });

        command = `${getPodmanPath()} run -d`;

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
            if (volumes.length > 0) {
                const selectedVolume = await vscode.window.showQuickPick(
                    volumes.map(vol => ({ label: vol.name, description: vol.mountPoint, volume: vol })),
                    { placeHolder: 'Select a volume to mount (optional)' }
                );

                if (selectedVolume) {
                    const containerPath = await vscode.window.showInputBox({
                        prompt: `Enter the path inside the container to mount the volume '${selectedVolume.label}'`,
                        placeHolder: '/data'
                    });
                    if (containerPath) {
                        command += ` -v ${selectedVolume.label}:${containerPath}`;
                    }
                }
            }

            const networks = await getNetworks();
            if (networks.length > 1) { // Only ask if there's more than the default
                 const selectedNetwork = await vscode.window.showQuickPick(networks, { placeHolder: 'Select a network (optional)' });
                 if (selectedNetwork && selectedNetwork !== 'podman') {
                    command += ` --network ${selectedNetwork}`;
                 }
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

            const advancedOptions = await getAdvancedOptions();
            if (advancedOptions?.mounts) {
                for (const mount of advancedOptions.mounts) {
                    command += ` --mount "${mount}"`;
                }
            }
        }

        // --- FIX APPLIED HERE ---
        // The "tail -f /dev/null" has been removed to allow the container
        // to run its default command, preventing errors on minimal images.
        command += ` ${selectedImageInfo.imageInfo.repository}:${selectedImageInfo.imageInfo.tag}`;
        // --- END OF FIX ---

        const { stdout, stderr } = await execAsync(command);

        if (stderr) {
            // Using showErrorWithCopy for better error handling, consistent with extension.ts
            await showErrorWithCopy(`Error creating container: ${stderr}`, command);
        } else {
            vscode.window.showInformationMessage(`Container created successfully: ${stdout.trim().substring(0,12)}`);
            vscode.commands.executeCommand('podmanager.refreshView');
        }
    } catch (error) {
        // Now using showErrorWithCopy in the catch block as well
        await showErrorWithCopy(`Failed to create container: ${error}`, command);
    }
}

async function getAdvancedOptions(): Promise<AdvancedOptions | undefined> {
    const mountsInput = await vscode.window.showInputBox({
        prompt: 'Advanced Mounts (optional, semicolon separated)',
        placeHolder: 'type=bind,src=/local/path,target=/container/path;type=bind,src=/another/path,target=/target',
        validateInput: (value) => {
            if (!value) {
                return null;
            }
            const mounts = value.split(';');
            for (const mount of mounts) {
                if (!mount.includes('type=') || !mount.includes('src=') || !mount.includes('target=')) {
                    return 'Invalid mount format. Use: type=bind,src=/path,target=/path';
                }
            }
            return null;
        }
    });

    return {
        mounts: mountsInput ? mountsInput.split(';').filter(m => m.trim()) : undefined,
    };
}

async function getImages(): Promise<ImageInfo[]> {
    try {
        const { stdout } = await execAsync(`${getPodmanPath()} images --format "{{.Repository}}|{{.Tag}}|{{.ID}}"`);
        return stdout.split('\n')
            .filter(line => line.trim() !== '')
            .map(line => {
                const [repository, tag, id] = line.split('|');
                return { repository: repository !== "<none>" ? repository : id, tag: tag !== "<none>" ? tag : "latest", id: id };
            })
            .filter(img => img.repository && img.tag);
    } catch (error) {
        await showErrorWithCopy(`Failed to get images: ${error}`, `${getPodmanPath()} images`);
        return [];
    }
}

async function getVolumes(): Promise<VolumeInfo[]> {
    try {
        const { stdout } = await execAsync(`${getPodmanPath()} volume ls --format "{{.Name}}|{{.Mountpoint}}"`);
        return stdout.split('\n')
            .filter(line => line.trim() !== '')
            .map(line => {
                const [name, mountPoint] = line.split('|');
                return { name, mountPoint };
            });
    } catch (error) {
        await showErrorWithCopy(`Failed to get volumes: ${error}`, `${getPodmanPath()} volume ls`);
        return [];
    }
}

async function getNetworks(): Promise<string[]> {
    try {
        const { stdout } = await execAsync(`${getPodmanPath()} network ls --format "{{.Name}}"`);
        return stdout.split('\n').filter(line => line.trim() !== '' && line.trim() !== 'none');
    } catch (error) {
        await showErrorWithCopy(`Failed to get networks: ${error}`, `${getPodmanPath()} network ls`);
        return [];
    }
}