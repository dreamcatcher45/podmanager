import * as assert from 'assert';
import * as fs from 'fs';
import * as vscode from 'vscode';

const CANARY = '/tmp/podmanager-pwned-canary';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Runs inside a real VS Code opened on test/fixtures/hostile-workspace, whose
// .vscode/settings.json tries to hijack podmanPath / composePath / machineName.
suite('Extension (hostile workspace)', function () {
    this.timeout(60_000);

    suiteSetup(() => {
        if (fs.existsSync(CANARY)) { fs.unlinkSync(CANARY); }
    });

    test('activates and registers its commands', async () => {
        const ext = vscode.extensions.getExtension('dreamcatcher45.podmanager');
        assert.ok(ext, 'extension not found');
        await ext.activate();
        const commands = await vscode.commands.getCommands(true);
        for (const c of ['podmanager.refreshView', 'podmanager.composeUp', 'podmanager.buildImage']) {
            assert.ok(commands.includes(c), `${c} not registered`);
        }
    });

    test('workspace settings cannot override the executable settings', () => {
        const cfg = vscode.workspace.getConfiguration('podmanager');
        assert.strictEqual(cfg.get('podmanPath'), 'podman');
        assert.strictEqual(cfg.get('composePath'), 'podman-compose');
        assert.strictEqual(cfg.get('machineName'), 'podman-machine-default');
    });

    test('opening the hostile workspace ran nothing (the original exploit)', async () => {
        await vscode.commands.executeCommand('podmanager.refreshOverview');
        await sleep(3000); // let startup `system df` and machine check settle
        assert.strictEqual(fs.existsSync(CANARY), false, 'injected command ran!');
    });
});
