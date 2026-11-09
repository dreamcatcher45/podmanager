import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { installVscodeMock, ui, Uri } from './helpers/vscodeMock';

const root = path.resolve(__dirname, '../../..');

suite("What's New page", () => {
    let wn: typeof import('../../whatsNew');
    const makeContext = () => {
        const store = new Map<string, unknown>();
        return {
            extensionUri: Uri.file(root),
            globalState: { get: (k: string) => store.get(k), update: async (k: string, v: unknown) => { store.set(k, v); } },
            store,
        } as any;
    };

    suiteSetup(() => {
        installVscodeMock();
        wn = require('../../whatsNew');
    });
    setup(() => {
        ui.reset();
        ui.commands.delete('markdown.showPreview');
    });

    test('opens a rendered Markdown preview of WHATS_NEW.md on the first start, and remembers it', async () => {
        const ctx = makeContext();
        assert.strictEqual(await wn.showWhatsNewOnce(ctx), true);
        const call = ui.executed.find(e => e.id === 'markdown.showPreview');
        assert.ok(call, 'markdown.showPreview was executed');
        assert.ok(call!.args[0].fsPath.endsWith('/WHATS_NEW.md'), call!.args[0].fsPath);
        assert.strictEqual(ctx.store.get('podmanager.whatsNewSeen'), wn.WHATS_NEW.id);
    });

    test('does not open again once seen (later starts, later windows)', async () => {
        const ctx = makeContext();
        await wn.showWhatsNewOnce(ctx);
        ui.executed = [];
        assert.strictEqual(await wn.showWhatsNewOnce(ctx), false);
        assert.strictEqual(ui.executed.length, 0);
    });

    test('opens again when a later release changes the notes id', async () => {
        const ctx = makeContext();
        ctx.store.set('podmanager.whatsNewSeen', 'some-older-notes');
        assert.strictEqual(await wn.showWhatsNewOnce(ctx), true);
    });

    test('podmanager.showWhatsNew = false: nothing opens and nothing is marked as seen', async () => {
        ui.config.showWhatsNew = false;
        const ctx = makeContext();
        assert.strictEqual(await wn.showWhatsNewOnce(ctx), false);
        assert.strictEqual(ui.executed.length, 0);
        assert.strictEqual(ctx.store.size, 0);
    });

    test('the command reopens the page even after it was seen or switched off', async () => {
        ui.config.showWhatsNew = false;
        await wn.openWhatsNew(Uri.file(root) as any);
        assert.ok(ui.executed.some(e => e.id === 'markdown.showPreview'));
    });

    test('falls back to the plain file when the Markdown preview is unavailable', async () => {
        ui.commands.set('markdown.showPreview', () => { throw new Error('no markdown extension'); });
        await wn.openWhatsNew(Uri.file(root) as any);
        assert.strictEqual(ui.documents.length, 1);
        assert.ok(ui.documents[0].uri!.endsWith('/WHATS_NEW.md'));
        assert.strictEqual(ui.shownDocuments, 1);
    });

    test('never throws, even if everything fails (activation must not break)', async () => {
        ui.commands.set('markdown.showPreview', () => { throw new Error('boom'); });
        const ctx = makeContext();
        ctx.globalState.update = async () => { throw new Error('storage broken'); };
        assert.strictEqual(await wn.showWhatsNewOnce(ctx), false);
        const noUri = makeContext(); noUri.extensionUri = undefined;
        assert.strictEqual(await wn.showWhatsNewOnce(noUri), false);
    });

    suite('the page itself and how it ships', () => {
        const page = fs.readFileSync(path.join(root, 'WHATS_NEW.md'), 'utf8');
        const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

        test('WHATS_NEW.md exists and covers the security fix and every upgrade step', () => {
            assert.ok(fs.existsSync(path.join(root, wn.WHATS_NEW.file)));
            for (const must of ['Security update', 'user** settings', '.vscode/settings.json', '.bat', '.cmd', 'pipes', 'start with `-`', 'podmanager.showWhatsNew', 'Show What\'s New']) {
                assert.ok(page.includes(must) || page.includes(must.replace('start with', 'starts with')), `missing: ${must}`);
            }
        });
        test('it is packaged in the VSIX (not excluded by .vscodeignore)', () => {
            const ignore = fs.readFileSync(path.join(root, '.vscodeignore'), 'utf8').split(/\r?\n/);
            assert.ok(!ignore.some(l => /WHATS_NEW|\*\.md$|^\*\*\/\*\.md/.test(l.trim())), 'WHATS_NEW.md must not be ignored');
        });
        test('the command and the setting are declared (setting defaults to on)', () => {
            assert.ok(pkg.contributes.commands.some((c: any) => c.command === 'podmanager.showWhatsNew'));
            assert.strictEqual(pkg.contributes.configuration.properties['podmanager.showWhatsNew'].default, true);
            assert.strictEqual(pkg.contributes.configuration.properties['podmanager.showWhatsNew'].type, 'boolean');
        });
    });
});
