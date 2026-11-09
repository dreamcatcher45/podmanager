// Container/image/pod actions that were advertised (README, package.json) but never implemented.
// Every command is run through runPodman(): an argument array, never a shell string.
import * as vscode from 'vscode';
import { runPodman, describePodman } from './podmanConfig';
import { assertSafeArg } from './commandRunner';
import { showErrorWithCopy } from './utils/messageUtil';
import { withStatus } from './statusBarManager';
import { PodmanItem } from './podmanItem';

/** "compose-<project>-<12 hex>" -> "<12 hex>"; anything else is returned unchanged. */
export function extractContainerId(fullId: string): string {
    const match = fullId.match(/-([a-f0-9]{12})$/i);
    return match ? match[1] : fullId;
}

function containerIdOf(item: PodmanItem): string {
    return item.originalId || extractContainerId(String(item.id ?? ''));
}

/** Tree labels look like "name (id)"; return just the name. */
function containerNameOf(item: PodmanItem): string | undefined {
    const m = String(item.label).match(/^(.*) \([^()]*\)$/);
    return m && m[1] ? m[1] : undefined;
}

const channels = new Map<string, vscode.OutputChannel>();
function channelFor(name: string): vscode.OutputChannel {
    let channel = channels.get(name);
    if (!channel) {
        channel = vscode.window.createOutputChannel(name);
        channels.set(name, channel);
    }
    channel.clear();
    return channel;
}

// ---------------------------------------------------------------- execute a command in a container
export async function execInContainer(item?: PodmanItem): Promise<void> {
    if (!item || !item.id) {
        return;
    }
    const label = String(item.label);
    let containerId: string;
    try {
        containerId = assertSafeArg(containerIdOf(item), 'container id');
    } catch (error) {
        await showErrorWithCopy(`Cannot run a command in ${label}: ${error}`);
        return;
    }

    const command = await vscode.window.showInputBox({
        prompt: `Command to run in ${label}`,
        placeHolder: 'e.g. ls -la /app'
    });
    if (!command || !command.trim()) {
        return;
    }

    // The text is handed to /bin/sh *inside the container* as a single argument.
    // No shell on the host ever sees it.
    const args = ['exec', containerId, '/bin/sh', '-c', command.trim()];
    const channel = channelFor(`Podman Exec: ${label}`);
    channel.appendLine(`$ ${command.trim()}`);
    try {
        await withStatus(`Running command in ${label}`, async () => {
            const { stdout, stderr } = await runPodman(args);
            channel.append(stdout);
            channel.append(stderr);
            channel.show(true);
        });
    } catch (error: any) {
        if (error?.stdout) { channel.append(String(error.stdout)); }
        if (error?.stderr) { channel.append(String(error.stderr)); }
        channel.show(true);
        await showErrorWithCopy(`Command failed in ${label}: ${error?.message ?? error}`, describePodman(args));
    }
}

// ---------------------------------------------------------------- push an image
function imageReferences(item: PodmanItem): string[] {
    const labels = item.contextValue === 'image-tag'
        ? [String(item.label)]
        : (item.children ?? []).map(c => String(c.label));
    return labels.filter(l => l && !l.startsWith('<none>'));
}

export async function pushImage(item?: PodmanItem): Promise<void> {
    const config = vscode.workspace.getConfiguration('podmanager');
    if (!config.get<boolean>('enablePushCommand', false)) {
        vscode.window.showInformationMessage('Push Image is disabled. Turn on "podmanager.enablePushCommand" in the settings to use it.');
        return;
    }
    if (!item) {
        return;
    }

    const refs = imageReferences(item);
    if (refs.length === 0) {
        await showErrorWithCopy('This image has no tag, so it cannot be pushed. Tag it first, for example: podman tag <image> <registry>/<name>:<tag>');
        return;
    }

    let ref = refs[0];
    if (refs.length > 1) {
        const picked = await vscode.window.showQuickPick(refs.map(r => ({ label: r })), { placeHolder: 'Select the image tag to push' });
        if (!picked) {
            return;
        }
        ref = picked.label;
    }

    // Pre-fill the destination: <default registry>/<name:tag> when a default registry is configured.
    const registry = (config.get<string>('pushDefaultRegistry', '') || '').trim().replace(/\/+$/, '');
    const suggested = registry ? `${registry}/${ref.split('/').pop()}` : ref;
    const destination = await vscode.window.showInputBox({
        prompt: `Push ${ref} to (registry/repository:tag)`,
        value: suggested,
        placeHolder: 'e.g. quay.io/username/myimage:latest'
    });
    if (!destination || !destination.trim()) {
        return;
    }

    const target = destination.trim();
    let args: string[] = ['push', ref];
    try {
        assertSafeArg(ref, 'image');
        if (target !== ref) {
            args = ['push', ref, assertSafeArg(target, 'destination')];
        }
        await withStatus(`Pushing image ${ref}`, async () => {
            await runPodman(args);
            vscode.window.showInformationMessage(`Image ${ref} pushed to ${target}`);
        });
    } catch (error) {
        await showErrorWithCopy(`Failed to push image: ${error}`, describePodman(args));
    }
}

// ---------------------------------------------------------------- view details (podman inspect)
export async function viewDetails(item?: PodmanItem): Promise<void> {
    if (!item) {
        return;
    }
    let args: string[];
    try {
        switch (item.contextValue) {
            case 'volume':
                args = ['volume', 'inspect', assertSafeArg(item.resourceName ?? '', 'volume name')];
                break;
            case 'network':
                args = ['network', 'inspect', assertSafeArg(item.resourceName ?? '', 'network name')];
                break;
            case 'pod':
                args = ['pod', 'inspect', assertSafeArg(String(item.id ?? ''), 'pod id')];
                break;
            case 'container':
            case 'compose-container':
                args = ['container', 'inspect', assertSafeArg(containerIdOf(item), 'container id')];
                break;
            case 'image':
                args = ['image', 'inspect', assertSafeArg(String(item.id ?? ''), 'image id')];
                break;
            default:
                return;
        }
    } catch (error) {
        await showErrorWithCopy(`Unable to show details: ${error}`);
        return;
    }

    try {
        await withStatus(`Inspecting ${item.contextValue}`, async () => {
            const { stdout } = await runPodman(args);
            const doc = await vscode.workspace.openTextDocument({ content: stdout, language: 'json' });
            await vscode.window.showTextDocument(doc, { preview: true });
        });
    } catch (error) {
        await showErrorWithCopy(`Failed to get details: ${error}`, describePodman(args));
    }
}

// ---------------------------------------------------------------- add a container to a pod
const POD_LS_ARGS = ['pod', 'ls', '--format', '{{.ID}}|{{.Name}}|{{.Status}}|{{.Created}}'];

export async function addContainerToPod(item?: PodmanItem): Promise<void> {
    if (!item || !item.id) {
        return;
    }
    const containerId = containerIdOf(item);
    const name = containerNameOf(item);
    const display = name ?? containerId;

    if (item.isRunning) {
        vscode.window.showInformationMessage(`Stop container ${display} first: Podman has to re-create it inside the pod.`);
        return;
    }

    let pods: Array<{ label: string; description: string }>;
    try {
        const { stdout } = await runPodman(POD_LS_ARGS);
        pods = stdout.split('\n')
            .filter(line => line.trim() !== '')
            .map(line => {
                const [, podName, status] = line.split('|');
                return { label: podName, description: status };
            });
    } catch (error) {
        await showErrorWithCopy(`Failed to list pods: ${error}`, describePodman(POD_LS_ARGS));
        return;
    }
    if (pods.length === 0) {
        vscode.window.showInformationMessage('No pods found. Create a pod first.');
        return;
    }

    const pod = await vscode.window.showQuickPick(pods, { placeHolder: `Select the pod to add ${display} to` });
    if (!pod) {
        return;
    }

    // Podman cannot attach an existing container to a pod; `container clone --pod` re-creates it there.
    const answer = await vscode.window.showWarningMessage(
        `Podman cannot attach an existing container to a pod, so '${display}' will be re-created inside pod '${pod.label}' (the original is removed and the new container gets a new ID). Continue?`,
        'Yes',
        'No'
    );
    if (answer !== 'Yes') {
        return;
    }

    let args: string[] = ['container', 'clone', '--destroy'];
    try {
        args.push(`--pod=${assertSafeArg(pod.label, 'pod name')}`);
        if (name) {
            args.push(`--name=${assertSafeArg(name, 'container name')}`);
        }
        args.push(assertSafeArg(containerId, 'container id'));
        await withStatus(`Adding ${display} to pod ${pod.label}`, async () => {
            await runPodman(args);
            vscode.window.showInformationMessage(`Container ${display} was re-created in pod ${pod.label}`);
            await vscode.commands.executeCommand('podmanager.refreshView');
        });
    } catch (error) {
        await showErrorWithCopy(`Failed to add container to pod: ${error}`, describePodman(args));
    }
}
