import { assertSafeArg } from './commandRunner';

/**
 * Pure builders/parsers for "Create Container" and "Create Pod". They hold no
 * VS Code state so they can be unit-tested against the original behaviour.
 */

export interface ImageInfo { repository: string; tag: string; id: string; }
export interface VolumeInfo { name: string; mountPoint: string; }

export interface ContainerSpec {
    /** repository:tag */
    image: string;
    name?: string;
    mode: 'Simple' | 'Advanced';
    // Simple
    port?: string;
    // Advanced
    volume?: { name: string; path: string };
    network?: string;
    /** Comma-separated KEY=value list, exactly as typed. */
    envVars?: string;
    cpus?: string;
    memory?: string;
    mounts?: string[];
}

export function buildRunArgs(spec: ContainerSpec): string[] {
    const args: string[] = ['run', '-d'];

    if (spec.name) {
        args.push(`--name=${assertSafeArg(spec.name, 'container name')}`);
    }

    if (spec.mode === 'Simple') {
        if (spec.port) {
            args.push(`--publish=${assertSafeArg(spec.port, 'port mapping')}`);
        }
    } else {
        if (spec.volume && spec.volume.path) {
            args.push(`--volume=${spec.volume.name}:${spec.volume.path}`);
        }
        if (spec.network && spec.network !== 'podman') {
            args.push(`--network=${spec.network}`);
        }
        if (spec.envVars) {
            for (const env of spec.envVars.split(',')) {
                const trimmed = env.trim();
                if (trimmed) {
                    args.push(`--env=${trimmed}`);
                }
            }
        }
        if (spec.cpus) {
            args.push(`--cpus=${spec.cpus}`);
        }
        if (spec.memory) {
            args.push(`--memory=${spec.memory}`);
        }
        for (const mount of spec.mounts ?? []) {
            args.push(`--mount=${mount.trim()}`);
        }
    }

    // The image goes last so the container runs its own default command.
    args.push(assertSafeArg(spec.image, 'image'));
    return args;
}

/** Validation used by the "Advanced Mounts" input box. Returns an error message or null. */
export function validateMountsInput(value: string): string | null {
    if (!value) {
        return null;
    }
    for (const mount of value.split(';')) {
        if (!mount.includes('type=') || !mount.includes('src=') || !mount.includes('target=')) {
            return 'Invalid mount format. Use: type=bind,src=/path,target=/path';
        }
    }
    return null;
}

export function parseMounts(input: string | undefined): string[] | undefined {
    return input ? input.split(';').filter(m => m.trim()) : undefined;
}

export function parseImages(stdout: string): ImageInfo[] {
    return stdout.split('\n')
        .filter(line => line.trim() !== '')
        .map(line => {
            const [repository, tag, id] = line.split('|');
            return { repository: repository !== '<none>' ? repository : id, tag: tag !== '<none>' ? tag : 'latest', id };
        })
        .filter(img => img.repository && img.tag);
}

export function parseVolumes(stdout: string): VolumeInfo[] {
    return stdout.split('\n')
        .filter(line => line.trim() !== '')
        .map(line => {
            const [name, mountPoint] = line.split('|');
            return { name, mountPoint };
        });
}

export function parseNetworks(stdout: string): string[] {
    return stdout.split('\n').filter(line => line.trim() !== '' && line.trim() !== 'none');
}

export interface PodSpec {
    name?: string;
    hostname?: string;
    /** Semicolon-separated, as typed. */
    additionalHosts?: string;
    cpuShares?: string;
}

export function buildPodCreateArgs(spec: PodSpec): string[] {
    const args: string[] = ['pod', 'create'];
    if (spec.name) {
        args.push(`--name=${assertSafeArg(spec.name, 'pod name')}`);
    }
    if (spec.hostname) {
        args.push(`--hostname=${assertSafeArg(spec.hostname, 'hostname')}`);
    }
    if (spec.additionalHosts) {
        for (const host of spec.additionalHosts.split(';').map(h => h.trim()).filter(h => h)) {
            args.push(`--add-host=${assertSafeArg(host, 'additional host')}`);
        }
    }
    if (spec.cpuShares) {
        args.push(`--cpu-shares=${assertSafeArg(spec.cpuShares, 'cpu shares')}`);
    }
    return args;
}
