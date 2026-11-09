import * as vscode from 'vscode';
import { runPodman } from './podmanConfig';
import { assertSafeArg } from './commandRunner';

export async function createVolume() {
    const volumeName = await vscode.window.showInputBox({
        prompt: 'Enter the name for the new volume',
        placeHolder: 'my-volume'
    });

    if (volumeName) {
        try {
            await runPodman(['volume', 'create', assertSafeArg(volumeName, 'volume name')]);
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
            await runPodman(['network', 'create', assertSafeArg(networkName, 'network name')]);
            vscode.window.showInformationMessage(`Network '${networkName}' created successfully`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create network: ${error}`);
        }
    }
}
