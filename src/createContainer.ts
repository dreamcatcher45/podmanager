// src/createContainer.ts

import * as vscode from 'vscode';
import { showErrorWithCopy } from './utils/messageUtil';
import { runPodman, describePodman } from './podmanConfig';
import {
    ContainerSpec,
    ImageInfo,
    VolumeInfo,
    buildRunArgs,
    parseImages,
    parseMounts,
    parseNetworks,
    parseVolumes,
    validateMountsInput
} from './containerArgs';

interface AdvancedOptions {
    mounts?: string[];
}

export async function createContainer() {
    let args: string[] = ['run', '-d']; // Defined here so it is available in the catch block
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

        const spec: ContainerSpec = {
            mode: mode as 'Simple' | 'Advanced',
            image: `${selectedImageInfo.imageInfo.repository}:${selectedImageInfo.imageInfo.tag}`
        };

        spec.name = await vscode.window.showInputBox({ prompt: 'Enter container name (optional)' });

        if (mode === 'Simple') {
            spec.port = await vscode.window.showInputBox({ prompt: 'Enter port mapping (e.g., 8080:80) or leave empty' });
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
                        spec.volume = { name: selectedVolume.label, path: containerPath };
                    }
                }
            }

            const networks = await getNetworks();
            if (networks.length > 1) { // Only ask if there's more than the default
                spec.network = await vscode.window.showQuickPick(networks, { placeHolder: 'Select a network (optional)' });
            }

            spec.envVars = await vscode.window.showInputBox({ prompt: 'Enter environment variables (comma-separated, e.g., VAR1=value1,VAR2=value2)' });
            spec.cpus = await vscode.window.showInputBox({ prompt: 'Enter CPU limit (e.g., 0.5 for half a CPU, leave empty for no limit)' });
            spec.memory = await vscode.window.showInputBox({ prompt: 'Enter memory limit (e.g., 512m for 512 MB, leave empty for no limit)' });

            const advancedOptions = await getAdvancedOptions();
            spec.mounts = advancedOptions?.mounts;
        }

        args = buildRunArgs(spec);

        const { stdout, stderr } = await runPodman(args);

        if (stderr) {
            // Using showErrorWithCopy for better error handling, consistent with extension.ts
            await showErrorWithCopy(`Error creating container: ${stderr}`, describePodman(args));
        } else {
            vscode.window.showInformationMessage(`Container created successfully: ${stdout.trim().substring(0,12)}`);
            vscode.commands.executeCommand('podmanager.refreshView');
        }
    } catch (error) {
        // Now using showErrorWithCopy in the catch block as well
        await showErrorWithCopy(`Failed to create container: ${error}`, describePodman(args));
    }
}

async function getAdvancedOptions(): Promise<AdvancedOptions | undefined> {
    const mountsInput = await vscode.window.showInputBox({
        prompt: 'Advanced Mounts (optional, semicolon separated)',
        placeHolder: 'type=bind,src=/local/path,target=/container/path;type=bind,src=/another/path,target=/target',
        validateInput: validateMountsInput
    });

    return { mounts: parseMounts(mountsInput) };
}

async function getImages(): Promise<ImageInfo[]> {
    try {
        const { stdout } = await runPodman(['images', '--format', '{{.Repository}}|{{.Tag}}|{{.ID}}']);
        return parseImages(stdout);
    } catch (error) {
        await showErrorWithCopy(`Failed to get images: ${error}`, describePodman(['images']));
        return [];
    }
}

async function getVolumes(): Promise<VolumeInfo[]> {
    try {
        const { stdout } = await runPodman(['volume', 'ls', '--format', '{{.Name}}|{{.Mountpoint}}']);
        return parseVolumes(stdout);
    } catch (error) {
        await showErrorWithCopy(`Failed to get volumes: ${error}`, describePodman(['volume', 'ls']));
        return [];
    }
}

async function getNetworks(): Promise<string[]> {
    try {
        const { stdout } = await runPodman(['network', 'ls', '--format', '{{.Name}}']);
        return parseNetworks(stdout);
    } catch (error) {
        await showErrorWithCopy(`Failed to get networks: ${error}`, describePodman(['network', 'ls']));
        return [];
    }
}
