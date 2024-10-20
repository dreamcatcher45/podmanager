import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

function getPodmanPath(): string {
    const config = vscode.workspace.getConfiguration('podmanager');
    return config.get('podmanPath', 'podman');
}

export async function createVolume() {
    const volumeName = await vscode.window.showInputBox({
        prompt: 'Enter the name for the new volume',
        placeHolder: 'my-volume'
    });

    if (volumeName) {
        try {
            await execAsync(`${getPodmanPath()} volume create ${volumeName}`);
            vscode.window.showInformationMessage(`Volume '${volumeName}' created successfully`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create volume: ${error}`);
        }
    }
}

export async function createNetwork() {
    const networkName = await vscode.window.showInputBox({
        prompt: 'Enter the name for the new network',
        placeHolder: 'my-network'
    });

    if (networkName) {
        try {
            await execAsync(`${getPodmanPath()} network create ${networkName}`);
            vscode.window.showInformationMessage(`Network '${networkName}' created successfully`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create network: ${error}`);
        }
    }
}