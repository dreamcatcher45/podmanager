import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

// Guards the security posture declared in package.json so it cannot silently regress.
const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8'));
const props = pkg.contributes.configuration.properties;

suite('package.json security manifest', () => {
    for (const key of ['podmanager.podmanPath', 'podmanager.composePath', 'podmanager.machineName']) {
        test(`${key} is machine-scoped`, () => {
            assert.strictEqual(props[key].scope, 'machine');
        });
    }

    test('declares limited untrusted-workspace support restricting those settings', () => {
        const uw = pkg.capabilities?.untrustedWorkspaces;
        assert.strictEqual(uw?.supported, 'limited');
        assert.ok(uw.description);
        for (const key of ['podmanager.podmanPath', 'podmanager.composePath', 'podmanager.machineName']) {
            assert.ok(uw.restrictedConfigurations.includes(key), key);
        }
    });
});

// ---------------------------------------------------------------------------------------------
// Backward compatibility and menu wiring.
const contributes = pkg.contributes;
const itemMenu: Array<{ command: string; when: string; group: string }> = contributes.menus['view/item/context'];
const declaredIds: string[] = contributes.commands.map((c: any) => c.command);
// The contextValues the tree provider really creates (podmanTreeDataProvider.ts).
const TREE_CONTEXT_VALUES = ['container', 'compose-container', 'compose-group', 'image', 'image-tag', 'volume', 'network', 'pod', 'overview', 'containers', 'pods', 'images', 'volumes', 'networks'];

suite('package.json: settings keep their defaults (backward compatibility)', () => {
    const defaults: Record<string, unknown> = {
        'podmanager.podmanPath': 'podman',
        'podmanager.composePath': 'podman-compose',
        'podmanager.composeCommandStyle': 'default',
        'podmanager.enablePushCommand': false,
        'podmanager.pushDefaultRegistry': '',
        'podmanager.machineName': 'podman-machine-default',
        'podmanager.confirmDeletions': true,
        'podmanager.logsOutput': 'outputChannel',
        'podmanager.autoRefreshInterval': 0, // new, and off, so nothing changes unless a user opts in
    };
    for (const [key, value] of Object.entries(defaults)) {
        test(`${key} defaults to ${JSON.stringify(value)}`, () => {
            assert.deepStrictEqual(props[key].default, value);
        });
    }
    test('the compose command styles are unchanged', () => {
        assert.deepStrictEqual(props['podmanager.composeCommandStyle'].enum, ['default', 'podman-compose', 'podman-space-compose']);
    });
    test('autoRefreshInterval is a non-negative number', () => {
        assert.strictEqual(props['podmanager.autoRefreshInterval'].type, 'number');
        assert.strictEqual(props['podmanager.autoRefreshInterval'].minimum, 0);
    });
});

suite('package.json: menus', () => {
    test('command ids are unique and every menu entry refers to a declared command', () => {
        assert.strictEqual(new Set(declaredIds).size, declaredIds.length);
        for (const menu of Object.values<any[]>(contributes.menus)) {
            for (const entry of menu) {
                assert.ok(declaredIds.includes(entry.command), `menu uses undeclared command ${entry.command}`);
            }
        }
    });
    test('menus only target tree items the provider really creates (the compose-group mix-up cannot return)', () => {
        for (const entry of itemMenu) {
            for (const m of entry.when.matchAll(/viewItem == ([\w-]+)/g)) {
                assert.ok(TREE_CONTEXT_VALUES.includes(m[1]), `${entry.command}: unknown viewItem ${m[1]}`);
            }
        }
    });
    test('no duplicate menu entries', () => {
        const keys = itemMenu.map(e => `${e.command}|${e.when}|${e.group}`);
        assert.deepStrictEqual(keys.filter((k, i) => keys.indexOf(k) !== i), []);
    });
    test('every inline action is also in the right-click menu (inline-only items never appear there)', () => {
        for (const entry of itemMenu.filter(e => e.group === 'inline')) {
            const twin = itemMenu.find(e => e.command === entry.command && e.when === entry.when && e.group.startsWith('1_podmanager'));
            assert.ok(twin, `no right-click entry for ${entry.command} (${entry.when})`);
        }
    });
    test('Push Image is only offered when podmanager.enablePushCommand is on (all entries gated)', () => {
        const pushes = itemMenu.filter(e => e.command === 'podmanager.pushImage');
        assert.ok(pushes.length >= 2);
        for (const e of pushes) {
            assert.ok(e.when.includes('config.podmanager.enablePushCommand'), e.when);
        }
    });
    test('new item actions are available on the right items', () => {
        const where = (cmd: string) => itemMenu.filter(e => e.command === cmd).map(e => e.when.match(/viewItem == ([\w-]+)/)![1]);
        assert.deepStrictEqual([...new Set(where('podmanager.viewDetails'))].sort(), ['compose-container', 'container', 'image', 'network', 'pod', 'volume']);
        assert.deepStrictEqual([...new Set(where('podmanager.execInContainer'))].sort(), ['compose-container', 'container']);
        assert.deepStrictEqual([...new Set(where('podmanager.addContainertToPod'))], ['container']);
    });
    test('stop machine sits next to start machine in the view title', () => {
        const title: string[] = contributes.menus['view/title'].map((e: any) => e.command);
        assert.ok(title.includes('podmanager.startPodmanMachine') && title.includes('podmanager.stopPodmanMachine'));
    });
    test('commands that need a tree item are hidden from the Command Palette', () => {
        const hidden = contributes.menus.commandPalette.filter((e: any) => e.when === 'false').map((e: any) => e.command);
        for (const id of ['podmanager.execInContainer', 'podmanager.viewDetails', 'podmanager.addContainertToPod', 'podmanager.pushImage']) {
            assert.ok(hidden.includes(id), id);
        }
    });
    test('Reset Podman Path is declared (README lists it as a command)', () => {
        assert.ok(declaredIds.includes('podmanager.resetPodmanPath'));
    });
});
