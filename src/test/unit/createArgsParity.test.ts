import * as assert from 'assert';
import {
    ContainerSpec,
    buildRunArgs,
    buildPodCreateArgs,
    parseImages,
    parseVolumes,
    parseNetworks,
    parseMounts,
    validateMountsInput
} from '../../containerArgs';

// ORACLE: the original (pre-fix) command-string construction from createContainer.ts, verbatim.
function oldRunCommand(s: ContainerSpec): string {
    let command = 'podman run -d';
    if (s.name) { command += ` --name ${s.name}`; }
    if (s.mode === 'Simple') {
        if (s.port) { command += ` -p ${s.port}`; }
    } else {
        if (s.volume && s.volume.path) { command += ` -v ${s.volume.name}:${s.volume.path}`; }
        if (s.network && s.network !== 'podman') { command += ` --network ${s.network}`; }
        if (s.envVars) { s.envVars.split(',').forEach(env => { command += ` -e ${env.trim()}`; }); }
        if (s.cpus) { command += ` --cpus=${s.cpus}`; }
        if (s.memory) { command += ` -m ${s.memory}`; }
        for (const mount of s.mounts ?? []) { command += ` --mount "${mount}"`; }
    }
    command += ` ${s.image}`;
    return command;
}

/** POSIX-ish word splitting (whitespace + double quotes). */
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

// The new code uses the long --opt=value form; fold the old "--opt value" tokens into that form.
const LONG: Record<string, string> = {
    '--name': '--name', '-p': '--publish', '-v': '--volume', '--network': '--network',
    '-e': '--env', '-m': '--memory', '--mount': '--mount'
};
function canonical(tokens: string[]): string[] {
    const out: string[] = [];
    for (let i = 0; i < tokens.length; i++) {
        const long = LONG[tokens[i]];
        if (long) { out.push(`${long}=${tokens[++i]}`); } else { out.push(tokens[i]); }
    }
    return out;
}

suite('create container: parity with the original implementation', () => {
    const scenarios: Array<[string, ContainerSpec]> = [
        ['simple, image only', { mode: 'Simple', image: 'docker.io/library/nginx:latest' }],
        ['simple, name + port', { mode: 'Simple', image: 'nginx:latest', name: 'web', port: '8080:80' }],
        ['simple, port with ip and proto', { mode: 'Simple', image: 'nginx:1.27', port: '127.0.0.1:8080:80/tcp' }],
        ['advanced, nothing optional', { mode: 'Advanced', image: 'alpine:latest' }],
        ['advanced, volume', { mode: 'Advanced', image: 'alpine:latest', volume: { name: 'data', path: '/data' } }],
        ['advanced, volume without path is ignored', { mode: 'Advanced', image: 'alpine:latest', volume: { name: 'data', path: '' } }],
        ['advanced, custom network', { mode: 'Advanced', image: 'alpine:latest', network: 'mynet' }],
        ['advanced, default "podman" network is not passed', { mode: 'Advanced', image: 'alpine:latest', network: 'podman' }],
        ['advanced, env list', { mode: 'Advanced', image: 'alpine:latest', envVars: 'A=1, B=two,C=3' }],
        ['advanced, limits', { mode: 'Advanced', image: 'alpine:latest', cpus: '0.5', memory: '512m' }],
        ['advanced, mounts', { mode: 'Advanced', image: 'alpine:latest', mounts: ['type=bind,src=/a,target=/b', 'type=bind,src=/c,target=/d'] }],
        ['advanced, everything', {
            mode: 'Advanced', image: 'localhost/app:dev', name: 'app',
            volume: { name: 'data', path: '/var/data' }, network: 'mynet', envVars: 'MODE=prod,DEBUG=0',
            cpus: '2', memory: '1g', mounts: ['type=bind,src=/src,target=/app']
        }],
        ['image id used when repository is <none>', { mode: 'Simple', image: '3f2a1b9c8d7e:latest' }],
    ];

    for (const [label, spec] of scenarios) {
        test(label, () => {
            assert.deepStrictEqual(buildRunArgs(spec), canonical(shellSplit(oldRunCommand(spec))).slice(1));
        });
    }

    test('hostile input is one argument, never a command', () => {
        const args = buildRunArgs({ mode: 'Simple', image: 'alpine:latest', name: 'x; touch /tmp/pwned', port: '80:80 $(id)' });
        assert.deepStrictEqual(args, ['run', '-d', '--name=x; touch /tmp/pwned', '--publish=80:80 $(id)', 'alpine:latest']);
    });

    test('option-like name or image is rejected', () => {
        assert.throws(() => buildRunArgs({ mode: 'Simple', image: 'alpine', name: '--privileged' }));
        assert.throws(() => buildRunArgs({ mode: 'Simple', image: '--privileged' }));
    });

    test('intentional improvements: env values with spaces, empty env items, mount whitespace', () => {
        const args = buildRunArgs({ mode: 'Advanced', image: 'a:b', envVars: 'GREETING=hello world,,X=1,', mounts: ['  type=bind,src=/a,target=/b '] });
        assert.deepStrictEqual(args, ['run', '-d', '--env=GREETING=hello world', '--env=X=1', '--mount=type=bind,src=/a,target=/b', 'a:b']);
    });
});

suite('create pod', () => {
    test('name only matches the original command', () => {
        assert.deepStrictEqual(buildPodCreateArgs({ name: 'mypod' }), ['pod', 'create', '--name=mypod']);
    });
    test('no options', () => {
        assert.deepStrictEqual(buildPodCreateArgs({}), ['pod', 'create']);
    });
    test('all options (the original concatenated these without spaces, so they never worked)', () => {
        assert.deepStrictEqual(
            buildPodCreateArgs({ name: 'p', hostname: 'h.local', additionalHosts: 'a:10.0.0.1; b:10.0.0.2;', cpuShares: '512' }),
            ['pod', 'create', '--name=p', '--hostname=h.local', '--add-host=a:10.0.0.1', '--add-host=b:10.0.0.2', '--cpu-shares=512']);
    });
    test('hostile values stay literal; option-like values are rejected', () => {
        assert.deepStrictEqual(buildPodCreateArgs({ name: 'p; touch /tmp/x' }), ['pod', 'create', '--name=p; touch /tmp/x']);
        assert.throws(() => buildPodCreateArgs({ name: '--privileged' }));
    });
});

suite('create container: output parsing (unchanged logic)', () => {
    test('images: <none> repository falls back to id, <none> tag to latest', () => {
        assert.deepStrictEqual(parseImages('docker.io/library/nginx|1.27|aaa111\n<none>|<none>|bbb222\n\n'), [
            { repository: 'docker.io/library/nginx', tag: '1.27', id: 'aaa111' },
            { repository: 'bbb222', tag: 'latest', id: 'bbb222' }
        ]);
        assert.deepStrictEqual(parseImages(''), []);
    });
    test('volumes', () => {
        assert.deepStrictEqual(parseVolumes('data|/var/lib/x/data\n\nlogs|/var/lib/x/logs\n'),
            [{ name: 'data', mountPoint: '/var/lib/x/data' }, { name: 'logs', mountPoint: '/var/lib/x/logs' }]);
    });
    test('networks: drops blanks and "none"', () => {
        assert.deepStrictEqual(parseNetworks('podman\nmynet\nnone\n\n'), ['podman', 'mynet']);
    });
    test('mounts input', () => {
        assert.strictEqual(parseMounts(undefined), undefined);
        assert.strictEqual(parseMounts(''), undefined);
        assert.deepStrictEqual(parseMounts('type=bind,src=/a,target=/b;;  ;type=bind,src=/c,target=/d'),
            ['type=bind,src=/a,target=/b', 'type=bind,src=/c,target=/d']);
        assert.strictEqual(validateMountsInput(''), null);
        assert.strictEqual(validateMountsInput('type=bind,src=/a,target=/b'), null);
        assert.ok(validateMountsInput('src=/a,target=/b'));
        assert.ok(validateMountsInput('type=bind,src=/a'));
    });
});
