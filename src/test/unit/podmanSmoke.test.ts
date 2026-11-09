import * as assert from 'assert';
import { runCommand } from '../../commandRunner';

// Talks to a REAL podman. Skipped automatically when podman isn't installed, so
// `npm run test:unit` still passes on a laptop without it. The container test
// harness (scripts/run-tests.js) always has podman and sets REQUIRE_PODMAN=1,
// which turns a missing podman into a failure instead of a silent skip.
const podman = (args: string[]) => runCommand('podman', args);

suite('real podman smoke', function () {
    this.timeout(120_000);
    const id = `pmtest${process.pid}`;
    let available = false;

    suiteSetup(async () => {
        try {
            await podman(['--version']);
            available = true;
        } catch {
            if (process.env.REQUIRE_PODMAN) {
                throw new Error('REQUIRE_PODMAN is set but podman is not available');
            }
        }
    });

    const requirePodman = function (this: Mocha.Context) {
        if (!available) { this.skip(); }
    };

    test('system df works (the call made at extension startup)', async function () {
        requirePodman.call(this);
        const { stdout } = await podman(['system', 'df']);
        assert.ok(stdout.length > 0);
    });

    test('volume lifecycle', async function () {
        requirePodman.call(this);
        await podman(['volume', 'create', `${id}-vol`]);
        const { stdout } = await podman(['volume', 'ls', '--format', '{{.Name}}|{{.Driver}}']);
        assert.ok(stdout.split('\n').some(l => l.startsWith(`${id}-vol|`)));
        await podman(['volume', 'rm', '-f', `${id}-vol`]);
    });

    test('network lifecycle', async function () {
        requirePodman.call(this);
        await podman(['network', 'create', `${id}-net`]);
        const { stdout } = await podman(['network', 'ls', '--format', '{{.Name}}']);
        assert.ok(stdout.split('\n').includes(`${id}-net`));
        await podman(['network', 'rm', '-f', `${id}-net`]);
    });

    test('pod lifecycle', async function () {
        requirePodman.call(this);
        await podman(['pod', 'create', `--name=${id}-pod`]);
        const { stdout } = await podman(['pod', 'ls', '--format', '{{.ID}}|{{.Name}}|{{.Status}}|{{.Created}}']);
        assert.ok(stdout.includes(`|${id}-pod|`));
        await podman(['pod', 'rm', '-f', `${id}-pod`]);
    });

    test('a hostile name is created literally, not executed', async function () {
        requirePodman.call(this);
        // Podman rejects the name; the point is that nothing else happens.
        await assert.rejects(() => podman(['volume', 'create', `x; touch /tmp/${id}-pwned`]));
        await assert.rejects(() => runCommand('test', ['-e', `/tmp/${id}-pwned`]));
    });
});
