// src/createContainer.ts

import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import { showErrorWithCopy } from './utils/messageUtil'; // Assuming you have this utility from extension.ts

const execAsync = promisify(exec)

interface PodInfo {
    name: string;
    id: string;
    hostname: string;
    additionalhosts: string;
    cpuShare: string
}

function getPodmanPath(): string {
    const config = vscode.workspace.getConfiguration('podmanager');
    return config.get('podmanPath', 'podman');
}

export async function createPod() {
    let command = ''; // Define command here to be accessible in catch block
    try {
        const name = await vscode.window.showInputBox({ prompt: 'Enter pod name' });

        command = `${getPodmanPath()} pod create`;

        if(name) {
            command += ` --name ${name}`;
        }

        const hostname = await vscode.window.showInputBox({ prompt: 'Enter hostname or leave empty'})
        if(hostname) {
            command += `--hostname ${hostname}`
        }

        const additionalhosts = await vscode.window.showInputBox({ prompt: 'Enter semicolon separated hostnames to additionaly add or leave empty' })
        if (additionalhosts) {
            command += `--add-host ${additionalhosts}`;
        } 

        const cpuShare = await vscode.window.showInputBox({ prompt: 'Enter cpu share (default is 1024) or leave empty' })
        if (cpuShare) {
            command += `--cpu-shares`
        }

        const { stdout, stderr } = await execAsync(command);
        
        if (stderr) {
            // Using showErrorWithCopy for better error handling, consistent with extension.ts
            await showErrorWithCopy(`Error creating pod: ${stderr}`, command);
        } else {
            vscode.window.showInformationMessage(`Pod created successfully: ${stdout.trim().substring(0,12)}`);
            vscode.commands.executeCommand('podmanager.refreshView');
        }




    } catch (error) {
        // Now using showErrorWithCopy in the catch block as well
        await showErrorWithCopy(`Failed to create container: ${error}`, command);
    }
}