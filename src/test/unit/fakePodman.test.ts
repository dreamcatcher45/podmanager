import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runCommand } from '../../commandRunner';
import { fakeInvocation } from './helpers/fakeProgram';

// Drives the real runner against test/fake-podman/podman.js and checks the
// exact argv that arrives. Hostile input must arrive as ONE literal argument.
// Runs the fake directly (through node on Windows, where a .js file cannot be executed).
const runFake = (args: string[]) => { const f = fakeInvocation(args); return runCommand(f.file, f.args); };

suite('fake podman (argv fidelity)', () => {
    let log: string;
    setup(() => {
        log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fakepodman-')), 'calls.log');
        process.env.FAKE_PODMAN_LOG = log;
        delete process.env.FAKE_PODMAN_FAIL;
    });
    teardown(() => {
        delete process.env.FAKE_PODMAN_LOG;
        delete process.env.FAKE_PODMAN_FAIL;
    });
    const calls = (): string[][] =>
        fs.readFileSync(log, 'utf8').trim().split('\n').map(l => JSON.parse(l).argv);

    test('canned output is returned', async () => {
        const { stdout } = await runFake(['system', 'df']);
        assert.ok(stdout.includes('Images'));
    });

    test('hostile names reach podman as a single literal argument', async () => {
        const canary = path.join(os.tmpdir(), `fp-canary-${process.pid}`);
        const hostile = `a; touch ${canary} #$(id)\`id\`"'`;
        await runFake(['build', `--tag=${hostile}`, '--file=/x/Dockerfile', '/x']);
        assert.deepStrictEqual(calls()[0], ['build', `--tag=${hostile}`, '--file=/x/Dockerfile', '/x']);
        assert.strictEqual(fs.existsSync(canary), false);
    });

    test('failures surface stderr and a non-zero code', async () => {
        process.env.FAKE_PODMAN_FAIL = 'boom';
        await assert.rejects(() => runFake(['ps']), (e: any) => {
            assert.strictEqual(e.stderr, 'boom');
            assert.strictEqual(e.code, 1);
            return true;
        });
    });
});
