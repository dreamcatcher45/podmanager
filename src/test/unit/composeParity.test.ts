import * as assert from 'assert';
import { buildComposeInvocation } from '../../composeCommand';

// ORACLE: the original (pre-fix) string-building logic, copied verbatim, then
// split the way a shell would. The new argument-array builder must produce
// the same program + arguments for every combination of settings.
function oldBuildComposeCommand(podmanPath: string, composePath: string, commandStyle: string, composeFile: string, projectName: string, command: string): string {
    const isRemoteFlag = podmanPath.includes('--remote');
    const cleanPodmanPath = podmanPath.replace('--remote', '').trim();
    if (composePath && composePath !== 'podman-compose') {
        return `${composePath} -f "${composeFile}" -p "${projectName}" ${command}`;
    }
    switch (commandStyle) {
        case 'podman-space-compose':
            return isRemoteFlag
                ? `${cleanPodmanPath} --remote compose -f "${composeFile}" -p "${projectName}" ${command}`
                : `${cleanPodmanPath} compose -f "${composeFile}" -p "${projectName}" ${command}`;
        case 'podman-compose':
        case 'default':
        default:
            return isRemoteFlag
                ? `${cleanPodmanPath}-compose --remote -f "${composeFile}" -p "${projectName}" ${command}`
                : `${cleanPodmanPath}-compose -f "${composeFile}" -p "${projectName}" ${command}`;
    }
}

/** Minimal POSIX-ish word splitting (whitespace + double quotes), enough for the old strings. */
function shellSplit(line: string): string[] {
    const out: string[] = [];
    let cur = '', inQ = false, has = false;
    for (const ch of line) {
        if (ch === '"') { inQ = !inQ; has = true; }
        else if (!inQ && /\s/.test(ch)) { if (has) { out.push(cur); cur = ''; has = false; } }
        else { cur += ch; has = true; }
    }
    if (has) { out.push(cur); }
    return out;
}

suite('compose command parity with the original implementation', () => {
    const podmanPaths = ['podman', '/usr/bin/podman', 'podman --remote', 'flatpak-spawn --host podman',
        'flatpak-spawn --host podman --remote', 'sudo podman', 'wsl podman'];
    const composePaths = ['podman-compose', 'docker-compose', 'docker compose', '/usr/local/bin/docker-compose',
        'docker-compose.exe', 'podman-compose --verbose'];
    const styles = ['default', 'podman-compose', 'podman-space-compose'];
    const commands: Array<[string[], string]> = [
        [['up', '-d'], 'up -d'], [['down'], 'down'], [['start'], 'start'], [['stop'], 'stop'], [['restart'], 'restart']
    ];
    const composeFiles = ['/home/u/proj/docker-compose.yml', '/home/u/My Project/compose.yaml'];
    const never = () => false;

    for (const podmanPath of podmanPaths) {
        for (const composePath of composePaths) {
            for (const style of styles) {
                test(`podman="${podmanPath}" compose="${composePath}" style=${style}`, () => {
                    for (const [argv, str] of commands) {
                        for (const file of composeFiles) {
                            const expected = shellSplit(oldBuildComposeCommand(podmanPath, composePath, style, file, 'my-proj', str));
                            const got = buildComposeInvocation({ podmanPath, composePath, commandStyle: style }, file, 'my-proj', argv, never);
                            assert.deepStrictEqual([got.file, ...got.args], expected);
                        }
                    }
                });
            }
        }
    }

    test('hostile folder / file names stay inside a single argument', () => {
        const evil = '/tmp/a"; touch /tmp/pwned; echo "/docker-compose.yml';
        const got = buildComposeInvocation({ podmanPath: 'podman', composePath: 'podman-compose', commandStyle: 'default' },
            evil, 'proj$(id)', ['up', '-d'], never);
        assert.deepStrictEqual(got, { file: 'podman-compose', args: ['-f', evil, '-p', 'proj$(id)', 'up', '-d'] });
    });
});
