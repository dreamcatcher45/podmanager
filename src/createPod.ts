// src/createPod.ts

import * as vscode from 'vscode';
import { showErrorWithCopy } from './utils/messageUtil';
import { runPodman, describePodman } from './podmanConfig';
import { PodSpec, buildPodCreateArgs } from './containerArgs';

export async function createPod() {
    let args: string[] = ['pod', 'create']; // Defined here so it is available in the catch block
    try {
        const spec: PodSpec = {};
        spec.name = await vscode.window.showInputBox({ prompt: 'Enter pod name' });
        spec.hostname = await vscode.window.showInputBox({ prompt: 'Enter hostname or leave empty' });
        spec.additionalHosts = await vscode.window.showInputBox({ prompt: 'Enter semicolon separated hostnames to additionaly add or leave empty' });
        spec.cpuShares = await vscode.window.showInputBox({ prompt: 'Enter cpu share (default is 1024) or leave empty' });

        args = buildPodCreateArgs(spec);

        const { stdout, stderr } = await runPodman(args);

        if (stderr) {
            await showErrorWithCopy(`Error creating pod: ${stderr}`, describePodman(args));
        } else {
            vscode.window.showInformationMessage(`Pod created successfully: ${stdout.trim().substring(0, 12)}`);
            vscode.commands.executeCommand('podmanager.refreshView');
        }
    } catch (error) {
        await showErrorWithCopy(`Failed to create pod: ${error}`, describePodman(args));
    }
}
