import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    expandToken,
    runCommand,
    assertSafeArg,
    assertValidMachineName,
    parseExecutableSetting,
    terminalLaunch,
    formatCommand
} from '../../commandRunner';

// These tests do not need VS Code, so they can run with plain mocha as well.
suite('commandRunner (no shell)', () => {
    const node = process.execPath;

    test('shell metacharacters in an argument are passed literally', async () => {
        const canary = path.join(os.tmpdir(), `podmanager-canary-${process.pid}`);
        const payloads = [
            `x; touch ${canary}`,
            `x && touch ${canary}`,
            `$(touch ${canary})`,
            '`touch ' + canary + '`',
            `x | touch ${canary}`,
            `"; touch ${canary}; "`
        ];
        for (const payload of payloads) {
            const { stdout } = await runCommand(node, ['-e', 'process.stdout.write(process.argv[1])', payload]);
            assert.strictEqual(stdout, payload);
        }
        assert.strictEqual(fs.existsSync(canary), false, 'injected command must not have run');
    });

    test('a hostile executable path is never interpreted by a shell', async () => {
        const canary = path.join(os.tmpdir(), `podmanager-canary2-${process.pid}`);
        await assert.rejects(() => runCommand(`podman; touch ${canary}`, ['system', 'df']));
        await assert.rejects(() => runCommand(`podman && touch ${canary}`, ['system', 'df']));
        assert.strictEqual(fs.existsSync(canary), false);
    });

    test('shell option cannot be re-enabled by callers', async () => {
        const canary = path.join(os.tmpdir(), `podmanager-canary3-${process.pid}`);
        await assert.rejects(() =>
            runCommand(`echo hi; touch ${canary}`, [], { shell: true } as any)
        );
        assert.strictEqual(fs.existsSync(canary), false);
    });

    test('assertSafeArg rejects option-like, empty and control-character values', () => {
        assert.throws(() => assertSafeArg('--privileged'));
        assert.throws(() => assertSafeArg('-v'));
        assert.throws(() => assertSafeArg(''));
        assert.throws(() => assertSafeArg('a\nb'));
        assert.throws(() => assertSafeArg('a\u0000b'));
        assert.strictEqual(assertSafeArg('my-app_1.0'), 'my-app_1.0');
        assert.strictEqual(assertSafeArg('My Project (copy)'), 'My Project (copy)');
    });

    test('machine names are strictly validated', () => {
        assert.strictEqual(assertValidMachineName('podman-machine-default'), 'podman-machine-default');
        for (const bad of ['x; rm -rf ~', '$(id)', '-f', 'a b', 'a`b`', '', 'a\nb']) {
            assert.throws(() => assertValidMachineName(bad), bad);
        }
    });

    test('executable setting: command lines, quotes and --remote are understood', () => {
        const none = () => false;
        const p = (v: string) => parseExecutableSetting(v, none);
        assert.deepStrictEqual(p('podman'), { file: 'podman', prefixArgs: [], tokens: ['podman'], remote: false });
        assert.deepStrictEqual(p('podman --remote'), { file: 'podman', prefixArgs: [], tokens: ['podman'], remote: true });
        assert.deepStrictEqual(p('--remote podman').file, 'podman');
        assert.deepStrictEqual(p('flatpak-spawn --host podman'),
            { file: 'flatpak-spawn', prefixArgs: ['--host', 'podman'], tokens: ['flatpak-spawn', '--host', 'podman'], remote: false });
        assert.deepStrictEqual(p('"C:\\Program Files\\RedHat\\podman.exe" --remote').file, 'C:\\Program Files\\RedHat\\podman.exe');
        // An unquoted path with spaces is one token when it really is a file.
        assert.deepStrictEqual(parseExecutableSetting('/opt/my tools/podman', () => true).tokens, ['/opt/my tools/podman']);
        assert.throws(() => p('   '));
        assert.throws(() => p('podman "oops'));
    });

    test('a hostile executable setting still cannot run a second command', async () => {
        const canary = path.join(os.tmpdir(), `podmanager-canary4-${process.pid}`);
        const { file, prefixArgs } = parseExecutableSetting(`podman; touch ${canary}`, () => false);
        await assert.rejects(() => runCommand(file, [...prefixArgs, 'system', 'df']));
        assert.strictEqual(fs.existsSync(canary), false);
    });

    test('terminalLaunch passes arguments as positional parameters (never re-parsed)', async function () {
        if (process.platform === 'win32') { this.skip(); }
        const canary = path.join(os.tmpdir(), `podmanager-canary5-${process.pid}`);
        const hostile = `x'; touch ${canary}; echo "$(id)" \`id\``;
        const { shellPath, shellArgs } = terminalLaunch(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', hostile], 'linux');
        const { stdout } = await runCommand(shellPath, shellArgs, { env: { ...process.env, SHELL: '/bin/true' } });
        assert.ok(stdout.startsWith(hostile), 'argument must arrive intact');
        assert.strictEqual(fs.existsSync(canary), false);
        assert.deepStrictEqual(terminalLaunch('podman', ['ps'], 'win32'), { shellPath: 'podman', shellArgs: ['ps'] });
    });

    test('formatCommand quotes for display only', () => {
        assert.strictEqual(formatCommand('podman', ['ps', '--format', '{{.ID}}'], 'linux'), "podman ps --format '{{.ID}}'");
        assert.strictEqual(formatCommand('podman', ['x; id'], 'linux'), "podman 'x; id'");
    });
    test('expandToken: ~ and variables are substituted (what the shell used to do), nothing is executed', () => {
        const env = { HOME: '/home/me', TOOLS: '/opt/tools' } as NodeJS.ProcessEnv;
        assert.strictEqual(expandToken('~/bin/podman', env, '/home/me', 'linux'), '/home/me/bin/podman');
        assert.strictEqual(expandToken('~', env, '/home/me', 'linux'), '/home/me');
        assert.strictEqual(expandToken('$HOME/bin/podman', env, '/home/me', 'linux'), '/home/me/bin/podman');
        assert.strictEqual(expandToken('${TOOLS}/podman', env, '/home/me', 'linux'), '/opt/tools/podman');
        assert.strictEqual(expandToken('%TOOLS%\\podman.exe', env, 'C:\\Users\\me', 'win32'), '/opt/tools\\podman.exe');
        assert.strictEqual(expandToken('~\\bin\\podman.exe', env, 'C:\\Users\\me', 'win32'), 'C:\\Users\\me\\bin\\podman.exe');
        // unknown variables, other users' homes and command substitution stay literal
        assert.strictEqual(expandToken('$NOPE/podman', env, '/home/me', 'linux'), '$NOPE/podman');
        assert.strictEqual(expandToken('~other/podman', env, '/home/me', 'linux'), '~other/podman');
        assert.strictEqual(expandToken('$(touch x)', env, '/home/me', 'linux'), '$(touch x)');
        assert.strictEqual(expandToken('`touch x`', env, '/home/me', 'linux'), '`touch x`');
        assert.strictEqual(expandToken('%TOOLS%/podman', env, '/home/me', 'linux'), '%TOOLS%/podman'); // % is only special on Windows
    });

    test('executable settings use the expansion (e.g. "~/bin/podman --remote", "$PM_TEST_DIR/podman")', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-expand-'));
        process.env.PM_TEST_DIR = dir;
        try {
            assert.deepStrictEqual(parseExecutableSetting('$PM_TEST_DIR/podman --remote', () => false),
                { file: `${dir}/podman`, prefixArgs: [], tokens: [`${dir}/podman`], remote: true });
            assert.strictEqual(parseExecutableSetting('~/bin/podman', () => false).file, `${os.homedir()}/bin/podman`);
            // an unquoted path with spaces that only exists after expansion is still one program
            const spaced = path.join(dir, 'with space');
            fs.mkdirSync(spaced);
            fs.writeFileSync(path.join(spaced, 'podman'), '');
            assert.strictEqual(path.normalize(parseExecutableSetting('$PM_TEST_DIR/with space/podman').file), path.join(spaced, 'podman'));
        } finally {
            delete process.env.PM_TEST_DIR;
        }
    });
});
