import { assertSafeArg, parseExecutableSetting, splitCommandLine } from './commandRunner';

export interface ComposeInvocation {
    file: string;
    args: string[];
}

export interface ComposeSettings {
    podmanPath: string;
    composePath: string;
    commandStyle: string;
}

/**
 * Builds the compose invocation as a program + argument array.
 * Mirrors the original string-based behaviour exactly, minus the shell.
 */
export function buildComposeInvocation(
    settings: ComposeSettings,
    composeFile: string,
    projectName: string,
    command: string[],
    fileExists?: (p: string) => boolean
): ComposeInvocation {
    const common = [
        '-f', assertSafeArg(composeFile, 'compose file'),
        '-p', assertSafeArg(projectName, 'compose project name'),
        ...command
    ];

    // A custom compose program (may be a command line such as "docker compose").
    if (settings.composePath && settings.composePath.trim() !== '' && settings.composePath !== 'podman-compose') {
        const tokens = splitCommandLine(settings.composePath, fileExists);
        return { file: tokens[0], args: [...tokens.slice(1), ...common] };
    }

    const podman = parseExecutableSetting(settings.podmanPath, fileExists);
    const remoteArgs = podman.remote ? ['--remote'] : [];

    switch (settings.commandStyle) {
        case 'podman-space-compose':
            // `<podman...> [--remote] compose ...`
            return { file: podman.file, args: [...podman.prefixArgs, ...remoteArgs, 'compose', ...common] };
        case 'podman-compose':
        case 'default':
        default: {
            // `<podman...>-compose [--remote] ...` (the suffix goes on the last token, as before)
            const t = [...podman.tokens];
            t[t.length - 1] = `${t[t.length - 1]}-compose`;
            return { file: t[0], args: [...t.slice(1), ...remoteArgs, ...common] };
        }
    }
}
