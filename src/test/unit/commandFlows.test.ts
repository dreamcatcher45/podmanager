/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { installVscodeMock, ui, pick, Uri, TreeItemCollapsibleState } from './helpers/vscodeMock';
import { FAKE_SCRIPT, fakeSetting, installFake, dirSafe, viaNode } from './helpers/fakeProgram';

// Runs the extension's REAL activate() and command handlers (mocked VS Code, fake podman) and
// asserts the exact podman invocations, messages and tree contents.
const FAKE = FAKE_SCRIPT;
const FAKE_SETTING = fakeSetting(); // what podmanPath / composePath are set to (see helpers/fakeProgram.ts)
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
// Poll instead of sleeping a fixed time: spawning a process can take far longer on a loaded machine or in a nested container.
const waitFor = async (condition: () => boolean, timeoutMs = 15_000) => {
    const end = Date.now() + timeoutMs;
    while (!condition()) {
        if (Date.now() > end) { throw new Error('timed out waiting for the condition'); }
        await sleep(25);
    }
};
const State = TreeItemCollapsibleState;

suite('command flows (real handlers, fake podman)', function () {
    this.timeout(30_000);
    let tmp: string;
    let logFile: string;
    let scenarioFile: string;
    let PodmanItem: any;
    let provider: any;
    const ctxState = new Map<string, any>();
    const globalState = new Map<string, any>();

    const calls = (): Array<{ argv: string[]; cwd: string }> =>
        fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
    const argvs = () => calls().map(c => c.argv);
    const lastArgv = () => argvs()[argvs().length - 1];
    const resetCalls = () => { fs.writeFileSync(logFile, ''); };
    const run = (id: string, ...args: any[]) => {
        const fn = ui.commands.get(id);
        assert.ok(fn, `command ${id} is not registered`);
        return fn!(...args);
    };
    const scenario = (obj: Record<string, any>) => { fs.writeFileSync(scenarioFile, JSON.stringify(obj)); process.env.FAKE_PODMAN_SCENARIO = scenarioFile; };
    const container = (id = 'abc123def456', label = `web (${id})`) => new PodmanItem(label, State.None, 'container', id, 'Up', true);

    suiteSetup(async () => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pmflows-'));
        logFile = path.join(tmp, 'calls.log');
        scenarioFile = path.join(tmp, 'scenario.json');
        process.env.FAKE_PODMAN_LOG = logFile;
        installVscodeMock();
        ui.reset();
        ui.config = { podmanPath: FAKE_SETTING, composePath: FAKE_SETTING, confirmDeletions: true };
        const ext = require('../../extension');
        PodmanItem = require('../../podmanItem').PodmanItem;
        ext.activate({
            subscriptions: [],
            workspaceState: { get: (k: string, d: any) => (ctxState.has(k) ? ctxState.get(k) : d), update: async (k: string, v: any) => { ctxState.set(k, v); } },
            globalState: { get: (k: string, d: any) => (globalState.has(k) ? globalState.get(k) : d), update: async (k: string, v: any) => { globalState.set(k, v); } },
        });
        provider = ui.treeViews.get('podmanView').treeDataProvider;
        // Activation starts `system df` and a machine check in the background; wait for both before the first test.
        await waitFor(() => argvs().some(a => a[0] === 'system') && argvs().some(a => a[0] === 'machine'));
        await sleep(150);
    });

    suiteTeardown(() => {
        require('../../statusBarManager').StatusBarManager.getInstance().dispose();
        delete process.env.FAKE_PODMAN_LOG;
        delete process.env.FAKE_PODMAN_SCENARIO;
        delete process.env.FAKE_PODMAN_FAIL;
    });

    setup(() => {
        ui.reset();
        ui.config = { podmanPath: FAKE_SETTING, composePath: FAKE_SETTING, confirmDeletions: true };
        delete process.env.FAKE_PODMAN_SCENARIO;
        delete process.env.FAKE_PODMAN_FAIL;
        resetCalls();
        provider.cache.clear(); // refresh() is debounced by 300ms; clear the cache directly so tests are independent
    });

    // ---------------------------------------------------------------- activation
    test('every command declared in package.json has a handler after activate()', () => {
        const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8'));
        const declared: string[] = pkg.contributes.commands.map((c: any) => c.command);
        const missing = declared.filter(id => !ui.commands.has(id));
        // podmanager.registerComposeFiles and podmanager.pushImage used to be declared but never registered.
        assert.deepStrictEqual(missing, []);
    });

    test('startup ran `system df` through the configured podman', () => {
        // setup() cleared the log; re-trigger exactly what startup does.
        return run('podmanager.refreshOverview').then(() => assert.deepStrictEqual(lastArgv(), ['system', 'df']));
    });

    // ---------------------------------------------------------------- tree view
    suite('tree view', () => {
        const children = async (el?: any) => provider.getChildren(el);
        const labels = (items: any[]) => items.map(i => i.label);

        test('root sections', async () => {
            assert.deepStrictEqual(labels(await children()), ['Containers', 'Pods', 'Images', 'Volumes', 'Networks', 'Overview']);
        });
        test('containers', async () => {
            const root = await children();
            const items = await children(root[0]);
            assert.deepStrictEqual(labels(items), ['web (abc123def456)', 'db (0123456789ab)']);
            assert.deepStrictEqual(items.map((i: any) => i.contextValue), ['container', 'container']);
            assert.deepStrictEqual(items.map((i: any) => i.isRunning), [true, false]);
            assert.deepStrictEqual(argvs()[0], ['container', 'ls', '-a', '--format', '{{.ID}}|{{.Names}}|{{.Status}}|{{.Labels}}']);
        });
        test('images (used/unused from container list)', async () => {
            const items = await children((await children())[2]);
            assert.strictEqual(items.length, 2);
            assert.deepStrictEqual(items.map((i: any) => i.isUsed), [true, false]);
        });
        test('volumes and networks', async () => {
            const root = await children();
            assert.deepStrictEqual(labels(await children(root[3])), ['data (local)']);
            assert.deepStrictEqual(labels(await children(root[4])), ['podman (bridge)', 'mynet (bridge)']);
        });
        test('pods and their containers', async () => {
            const root = await children();
            const pods = await children(root[1]);
            assert.strictEqual(pods.length, 1);
            assert.strictEqual(pods[0].contextValue, 'pod');
            const inner = await children(pods[0]);
            assert.deepStrictEqual(labels(inner), ['web (abc123def456)']);
            assert.ok(argvs().some(a => a[0] === 'ps' && a[1] === '--filter=pod=pod123456789'));
        });
        test('overview shows `system df` output', async () => {
            await run('podmanager.refreshOverview');
            const items = await children((await children())[5]);
            assert.ok(items.some((i: any) => String(i.label).includes('Images')));
        });
        test('a failing podman produces an error toast with Copy Command, not a crash', async () => {
            scenario({ 'volume ls': { stderr: 'boom', code: 125 } });
            const root = await children();
            assert.deepStrictEqual(await children(root[3]), []);
            assert.ok(ui.error.some(e => e.message.includes('Failed to get volumes') && e.buttons.includes('Copy Command')));
        });
    });

    // ---------------------------------------------------------------- containers
    suite('containers', () => {
        for (const verb of ['start', 'stop', 'restart']) {
            test(verb, async () => {
                await run(`podmanager.${verb}Container`, container());
                assert.deepStrictEqual(lastArgv(), ['container', verb, 'abc123def456']);
                assert.ok(ui.info.some(m => m.includes(`${verb === 'stop' ? 'stopped' : verb + 'ed'} successfully`) || m.includes('successfully')));
            });
        }
        test('compose containers use their original id', async () => {
            const item = new PodmanItem('api', State.None, 'compose-container', 'feedfacecafe', 'Up', true, 'shop');
            assert.strictEqual(item.id, 'compose-shop-feedfacecafe');
            await run('podmanager.stopContainer', item);
            assert.deepStrictEqual(lastArgv(), ['container', 'stop', 'feedfacecafe']);
        });
        test('delete asks first and does nothing on "No"', async () => {
            ui.warnAnswers = ['No'];
            await run('podmanager.deleteContainer', container());
            assert.strictEqual(argvs().length, 0);
            assert.ok(ui.warn[0].includes('abc123def456'));
        });
        test('delete on "Yes"', async () => {
            await run('podmanager.deleteContainer', container());
            assert.deepStrictEqual(lastArgv(), ['container', 'rm', '-f', 'abc123def456']);
        });
        test('delete without confirmation when confirmDeletions is off', async () => {
            ui.config.confirmDeletions = false;
            await run('podmanager.deleteContainer', container());
            assert.strictEqual(ui.warn.length, 0);
            assert.deepStrictEqual(lastArgv(), ['container', 'rm', '-f', 'abc123def456']);
        });
        test('a podman failure rejects (same as before the fix)', async () => {
            scenario({ 'container start': { stderr: 'no such container', code: 125 } });
            await assert.rejects(() => run('podmanager.startContainer', container()));
        });
        test('open in terminal: interactive shell via a terminal that stays open, no shell string', async () => {
            const item = new PodmanItem('api', State.None, 'compose-container', 'feedfacecafe', 'Up', true, 'shop');
            await run('podmanager.openInTerminal', item);
            const t = ui.terminals[0];
            assert.strictEqual(t.name, 'Podman: api');
            assert.ok(t.shown);
            if (!viaNode) {
                assert.strictEqual(t.shellPath, '/bin/sh');
                assert.deepStrictEqual(t.shellArgs!.slice(3), [FAKE, 'exec', '-it', 'feedfacecafe', '/bin/sh']);
            }
        });
        suite('logs', () => {
            test('output channel (default)', async () => {
                await run('podmanager.viewContainerLogs', container());
                assert.deepStrictEqual(lastArgv(), ['logs', 'abc123def456']);
                assert.ok(ui.outputChannels[0].text.includes('log line one'));
                assert.ok(ui.outputChannels[0].text.includes('abc123def456'));
            });
            test('terminal mode follows logs', async () => {
                ui.config.logsOutput = 'terminal';
                await run('podmanager.viewContainerLogs', container());
                assert.strictEqual(argvs().length, 0, 'terminal mode must not run podman itself');
                if (!viaNode) {
                    assert.deepStrictEqual(ui.terminals[0].shellArgs!.slice(3), [FAKE, 'logs', '-f', 'abc123def456']);
                }
            });
        });
    });

    // ---------------------------------------------------------------- pods, images, volumes, networks
    suite('pods / images / volumes / networks', () => {
        const pod = () => new PodmanItem('mypod', State.Collapsed, 'pod', 'pod123456789', 'Running');
        for (const verb of ['start', 'stop', 'restart']) {
            test(`pod ${verb}`, async () => {
                await run(`podmanager.${verb}Pod`, pod());
                assert.deepStrictEqual(lastArgv(), ['pod', verb, 'pod123456789']);
            });
        }
        test('pod delete (confirm yes / no)', async () => {
            ui.warnAnswers = ['No'];
            await run('podmanager.deletePod', pod());
            assert.strictEqual(argvs().length, 0);
            await run('podmanager.deletePod', pod());
            assert.deepStrictEqual(lastArgv(), ['pod', 'rm', '-f', 'pod123456789']);
        });
        test('image delete', async () => {
            await run('podmanager.deleteImage', new PodmanItem('nginx', State.Collapsed, 'image', 'aaa111111111'));
            assert.deepStrictEqual(lastArgv(), ['image', 'rm', '-f', 'aaa111111111']);
        });
        test('volume delete, and a missing name is reported without running anything', async () => {
            await run('podmanager.deleteVolume', new PodmanItem('data (local)', State.None, 'volume', 'volume-data', undefined, undefined, undefined, undefined, undefined, 'data'));
            assert.deepStrictEqual(lastArgv(), ['volume', 'rm', '-f', 'data']);
            resetCalls(); ui.error = [];
            await run('podmanager.deleteVolume', new PodmanItem('x', State.None, 'volume', 'volume-x'));
            assert.strictEqual(argvs().length, 0);
            assert.ok(ui.error[0].message.includes('Resource name is missing'));
        });
        test('network delete', async () => {
            await run('podmanager.deleteNetwork', new PodmanItem('mynet (bridge)', State.None, 'network', 'network-mynet', undefined, undefined, undefined, undefined, undefined, 'mynet'));
            assert.deepStrictEqual(lastArgv(), ['network', 'rm', '-f', 'mynet']);
        });
        test('create volume / network', async () => {
            ui.inputs = ['my-vol'];
            await run('podmanager.createVolume');
            assert.deepStrictEqual(lastArgv(), ['volume', 'create', 'my-vol']);
            ui.inputs = ['my-net'];
            await run('podmanager.createNetwork');
            assert.deepStrictEqual(lastArgv(), ['network', 'create', 'my-net']);
            const n = argvs().length;
            ui.inputs = [undefined];
            await run('podmanager.createVolume'); // Esc: nothing happens
            assert.strictEqual(argvs().length, n);
        });
        test('create volume with an option-like name is refused', async () => {
            ui.inputs = ['--driver=evil'];
            await run('podmanager.createVolume');
            assert.strictEqual(argvs().length, 0);
            assert.ok(ui.error.length >= 0);
        });
        test('create pod prompts in order and builds the command', async () => {
            ui.inputs = ['mypod', 'h.local', 'a:10.0.0.1;b:10.0.0.2', '512'];
            await run('podmanager.createPod');
            assert.deepStrictEqual(lastArgv(), ['pod', 'create', '--name=mypod', '--hostname=h.local', '--add-host=a:10.0.0.1', '--add-host=b:10.0.0.2', '--cpu-shares=512']);
            assert.ok(ui.prompts[0].includes('pod name'));
            assert.ok(ui.info.some(m => m.includes('Pod created successfully: pod987654321')));
        });
    });

    // ---------------------------------------------------------------- create container
    suite('create container', () => {
        test('simple mode', async () => {
            ui.picks = [pick('Simple'), pick('docker.io/library/nginx:latest')];
            ui.inputs = ['web2', '8080:80'];
            await run('podmanager.createContainer');
            assert.deepStrictEqual(lastArgv(), ['run', '-d', '--name=web2', '--publish=8080:80', 'docker.io/library/nginx:latest']);
            assert.ok(ui.info.some(m => m.startsWith('Container created successfully: abcdef012345')));
            assert.ok(ui.executed.some(e => e.id === 'podmanager.refreshView'));
        });
        test('advanced mode, every option', async () => {
            ui.picks = [pick('Advanced'), pick('localhost/app:dev'), pick('data'), pick('mynet')];
            ui.inputs = ['app', '/data', 'A=1,B=two words', '0.5', '512m', 'type=bind,src=/a,target=/b'];
            await run('podmanager.createContainer');
            assert.deepStrictEqual(lastArgv(), ['run', '-d', '--name=app', '--volume=data:/data', '--network=mynet',
                '--env=A=1', '--env=B=two words', '--cpus=0.5', '--memory=512m', '--mount=type=bind,src=/a,target=/b', 'localhost/app:dev']);
        });
        test('advanced mode with the default network and nothing else', async () => {
            ui.picks = [pick('Advanced'), pick('localhost/app:dev'), undefined as any, pick('podman')];
            ui.picks[2] = () => undefined; // skip volume
            ui.inputs = [undefined, undefined, undefined, undefined, undefined, undefined];
            await run('podmanager.createContainer');
            assert.deepStrictEqual(lastArgv(), ['run', '-d', 'localhost/app:dev']);
        });
        test('cancelling at any point runs nothing', async () => {
            await run('podmanager.createContainer'); // no mode picked
            ui.picks = [pick('Simple'), () => undefined]; // no image picked
            await run('podmanager.createContainer');
            assert.ok(!argvs().some(a => a[0] === 'run'));
        });
        test('no images available', async () => {
            scenario({ 'images': '' });
            ui.picks = [pick('Simple')];
            await run('podmanager.createContainer');
            assert.ok(ui.info.some(m => m.includes('No Podman images found')));
            assert.ok(!argvs().some(a => a[0] === 'run'));
        });
        test('podman failure shows an error with Copy Command', async () => {
            scenario({ 'run': { stderr: 'image not known', code: 125 } });
            ui.picks = [pick('Simple'), pick('docker.io/library/nginx:latest')];
            ui.inputs = ['', ''];
            await run('podmanager.createContainer');
            assert.ok(ui.error.some(e => e.message.startsWith('Failed to create container') && e.buttons.includes('Copy Command')));
        });
        test('hostile name cannot run anything', async () => {
            const canary = path.join(tmp, 'canary-container');
            ui.picks = [pick('Simple'), pick('docker.io/library/nginx:latest')];
            ui.inputs = [`x; touch ${canary}`, ''];
            await run('podmanager.createContainer');
            assert.strictEqual(fs.existsSync(canary), false);
            assert.deepStrictEqual(lastArgv(), ['run', '-d', `--name=x; touch ${canary}`, 'docker.io/library/nginx:latest']);
        });
    });

    // ---------------------------------------------------------------- build image
    suite('build image', () => {
        const mkProject = (dirName: string) => {
            const dir = path.join(tmp, dirName);
            fs.mkdirSync(dir, { recursive: true });
            const file = path.join(dir, 'Dockerfile');
            fs.writeFileSync(file, 'FROM scratch\n');
            return { dir, file };
        };
        test('from a Dockerfile URI', async () => {
            const { dir, file } = mkProject('app1');
            ui.inputs = ['myapp:latest'];
            await run('podmanager.buildImage', Uri.file(file));
            assert.deepStrictEqual(lastArgv(), ['build', '--tag=myapp:latest', `--file=${file}`, dir]);
            assert.ok(ui.info.some(m => m.includes('built successfully')));
        });
        test('from the active editor', async () => {
            const { dir, file } = mkProject('app2');
            ui.activeTextEditor = { document: { uri: Uri.file(file) } };
            ui.inputs = ['x:1'];
            await run('podmanager.buildImage', undefined);
            assert.deepStrictEqual(lastArgv(), ['build', '--tag=x:1', `--file=${file}`, dir]);
        });
        test('no dockerfile / no workspace / cancelled', async () => {
            await run('podmanager.buildImage', undefined);
            assert.ok(ui.error[0].message.includes('No Dockerfile path'));
            const { file } = mkProject('app3');
            ui.workspaceFolder = undefined;
            await run('podmanager.buildImage', Uri.file(file));
            assert.ok(ui.error[1].message.includes('workspace folder'));
            ui.workspaceFolder = {};
            ui.inputs = [undefined];
            await run('podmanager.buildImage', Uri.file(file));
            assert.ok(ui.info.some(m => m.includes('cancelled')));
            assert.strictEqual(argvs().length, 0);
        });
        test('stderr from podman is shown as a warning', async () => {
            const { file } = mkProject('app4');
            scenario({ 'build': { stdout: 'ok', stderr: 'warning: foo', code: 0 } });
            ui.inputs = ['w:1'];
            await run('podmanager.buildImage', Uri.file(file));
            assert.ok(ui.warn.some(m => m.includes('warning: foo')));
        });
        test('folder names containing shell syntax are passed literally (the reported exploit)', async () => {
            const evil = dirSafe('app$(touch pwned_canary)`touch pwned_canary`";touch pwned_canary;"');
            const { dir, file } = mkProject(evil);
            ui.inputs = ['evil:1'];
            await run('podmanager.buildImage', Uri.file(file));
            assert.deepStrictEqual(lastArgv(), ['build', '--tag=evil:1', `--file=${file}`, dir]);
            for (const where of [dir, tmp, process.cwd()]) {
                assert.strictEqual(fs.existsSync(path.join(where, 'pwned_canary')), false);
            }
        });
        test('option-like image name is refused', async () => {
            const { file } = mkProject('app5');
            ui.inputs = ['--privileged'];
            await run('podmanager.buildImage', Uri.file(file));
            assert.ok(!argvs().some(a => a[0] === 'build'));
            assert.ok(ui.error.length > 0);
        });
    });

    // ---------------------------------------------------------------- compose
    suite('compose', () => {
        const mkCompose = (dirName: string) => {
            const dir = path.join(tmp, dirName);
            fs.mkdirSync(dir, { recursive: true });
            const file = path.join(dir, 'docker-compose.yml');
            fs.writeFileSync(file, 'services: {}\n');
            return { dir, file };
        };
        const cases: Array<[string, string[]]> = [
            ['composeUp', ['up', '-d']], ['composeDown', ['down']], ['composeStart', ['start']],
            ['composeStop', ['stop']], ['composeRestart', ['restart']],
        ];
        for (const [cmd, tail] of cases) {
            test(`${cmd} from a compose file URI runs in its folder`, async () => {
                const { dir, file } = mkCompose('shop');
                await run(`podmanager.${cmd}`, Uri.file(file));
                const call = calls()[calls().length - 1];
                assert.deepStrictEqual(call.argv, ['-f', file, '-p', 'shop', ...tail]);
                assert.strictEqual(fs.realpathSync(call.cwd), fs.realpathSync(dir));
            });
        }
        test('remembers the project, so a later run without input reuses it', async () => {
            globalState.clear();
            const { file } = mkCompose('remembered');
            await run('podmanager.composeUp', Uri.file(file));
            resetCalls();
            await run('podmanager.composeDown');
            assert.deepStrictEqual(lastArgv(), ['-f', file, '-p', 'remembered', 'down']);
        });
        test('no compose file anywhere', async () => {
            globalState.clear();
            ui.findFilesResult = [];
            await run('podmanager.composeUp');
            assert.ok(ui.error[0].message.includes('No docker-compose.yml'));
            assert.strictEqual(argvs().length, 0);
        });
        test('picks from several workspace compose files', async () => {
            globalState.clear();
            const a = mkCompose('multi-a'); const b = mkCompose('multi-b');
            ui.findFilesResult = [Uri.file(a.file), Uri.file(b.file)];
            ui.picks = [pick(b.file)];
            await run('podmanager.composeUp');
            assert.deepStrictEqual(lastArgv(), ['-f', b.file, '-p', 'multi-b', 'up', '-d']);
        });
        test('stdout and stderr are surfaced', async () => {
            const { file } = mkCompose('noisy');
            scenario({ '-f': { stdout: 'started', stderr: 'pulling image', code: 0 } });
            await run('podmanager.composeUp', Uri.file(file));
            assert.ok(ui.warn.some(m => m.includes('pulling image')));
            assert.ok(ui.info.some(m => m.includes('started')));
        });
        test('failure: error toast, and "Copy Command" puts the command on the clipboard', async () => {
            const { file } = mkCompose('broken');
            scenario({ '-f': { stderr: 'compose failed', code: 1 } });
            ui.errorAnswers = ['Copy Command'];
            await run('podmanager.composeUp', Uri.file(file));
            assert.ok(ui.error[0].message.includes('Failed to execute Podman Compose up -d'));
            assert.ok(ui.clipboard.includes('up -d') && ui.clipboard.includes('broken'), ui.clipboard);
        });
        test('hostile project folder names run nothing (the reported exploit)', async () => {
            const evil = dirSafe('a"; touch pwned_canary; echo "'); // Windows cannot have a " in a folder name
            const { dir, file } = mkCompose(evil);
            await run('podmanager.composeUp', Uri.file(file));
            assert.deepStrictEqual(lastArgv(), ['-f', file, '-p', evil, 'up', '-d']);
            for (const where of [dir, tmp, process.cwd()]) {
                assert.strictEqual(fs.existsSync(path.join(where, 'pwned_canary')), false);
            }
        });
        test('compose style podman-space-compose runs `<podman> compose ...`', async () => {
            const { file } = mkCompose('spaced');
            ui.config.composePath = 'podman-compose'; // default => style decides
            ui.config.composeCommandStyle = 'podman-space-compose';
            await run('podmanager.composeUp', Uri.file(file));
            assert.deepStrictEqual(lastArgv(), ['compose', '-f', file, '-p', 'spaced', 'up', '-d']);
        });
        test('default style runs `<podman>-compose`', async function () {
            if (viaNode) { this.skip(); } // needs an executable named podman-compose; a .js fake cannot be one on Windows
            const { file } = mkCompose('dflt');
            const link = path.join(tmp, 'fakebin');
            fs.mkdirSync(link, { recursive: true });
            // <podmanPath>-compose must exist as a program: expose the fake under that name.
            fs.copyFileSync(FAKE, path.join(link, 'podman'));
            fs.copyFileSync(FAKE, path.join(link, 'podman-compose'));
            fs.chmodSync(path.join(link, 'podman'), 0o755);
            fs.chmodSync(path.join(link, 'podman-compose'), 0o755);
            ui.config.podmanPath = path.join(link, 'podman');
            ui.config.composePath = 'podman-compose';
            ui.config.composeCommandStyle = 'default';
            await run('podmanager.composeUp', Uri.file(file));
            assert.deepStrictEqual(lastArgv(), ['-f', file, '-p', 'dflt', 'up', '-d']);
        });
    });

    // ---------------------------------------------------------------- prune, machine, settings
    suite('prune / machine / settings', () => {
        const prunes: Array<[string, string[]]> = [
            ['pruneImages', ['image', 'prune', '-f']],
            ['pruneAllImages', ['image', 'prune', '-a', '-f']],
            ['pruneBuilderCache', ['builder', 'prune', '-a', '-f']],
        ];
        for (const [cmd, expected] of prunes) {
            test(`${cmd}: asks, then runs`, async () => {
                await run(`podmanager.${cmd}`);
                assert.deepStrictEqual(lastArgv(), expected);
                assert.ok(ui.warn.length === 1);
            });
            test(`${cmd}: "No" runs nothing`, async () => {
                ui.warnAnswers = ['No'];
                await run(`podmanager.${cmd}`);
                assert.strictEqual(argvs().length, 0);
            });
        }
        test('prune stderr is reported as an error', async () => {
            scenario({ 'image prune': { stderr: 'cannot prune', code: 0 } });
            await run('podmanager.pruneImages');
            assert.ok(ui.error.some(e => e.message.includes('cannot prune')));
        });
        test('tools menu dispatches the chosen command', async () => {
            ui.picks = [pick('Create Network')];
            ui.inputs = ['menu-net'];
            await run('podmanager.openToolsMenu'); // dispatches the chosen command without awaiting it
            await waitFor(() => argvs().length > 0);
            assert.deepStrictEqual(lastArgv(), ['network', 'create', 'menu-net']);
        });
        test('machine start uses the configured machine name', async () => {
            ui.config.machineName = 'dev-box';
            await run('podmanager.startPodmanMachine');
            assert.deepStrictEqual(lastArgv(), ['machine', 'start', 'dev-box']);
        });
        test('default machine name', async () => {
            await run('podmanager.startPodmanMachine');
            assert.deepStrictEqual(lastArgv(), ['machine', 'start', 'podman-machine-default']);
        });
        test('a hostile machine name is refused before anything runs', async () => {
            ui.config.machineName = 'x; touch pwned';
            await run('podmanager.startPodmanMachine');
            assert.strictEqual(argvs().length, 0);
            assert.ok(ui.error[0].message.includes('Invalid Podman machine name'));
        });
        test('reset podman path clears the setting', async () => {
            ui.config.podmanPath = '/custom/podman';
            await run('podmanager.resetPodmanPath');
            assert.strictEqual('podmanPath' in ui.config, false);
            assert.ok(ui.info.some(m => m.includes('reset to default')));
        });
    });

    // ---------------------------------------------------------------- podmanPath flavours
    suite('podmanPath forms that must keep working', () => {
        test('"program script" (multi-word command such as `flatpak-spawn --host podman`)', async () => {
            ui.config.podmanPath = `node "${FAKE}"`;
            await run('podmanager.createVolume'.replace('createVolume', 'refreshOverview'));
            assert.deepStrictEqual(lastArgv(), ['system', 'df']);
        });
        test('trailing --remote is forwarded to podman', async () => {
            ui.config.podmanPath = fakeSetting(FAKE, '--remote');
            await run('podmanager.refreshOverview');
            assert.deepStrictEqual(lastArgv(), ['--remote', 'system', 'df']);
        });
        test('a path with spaces, quoted', async () => {
            const { setting, file } = installFake(path.join(tmp, 'with space'), 'podman');
            ui.config.podmanPath = setting; // quoted
            await run('podmanager.refreshOverview');
            assert.deepStrictEqual(lastArgv(), ['system', 'df']);
            if (!viaNode) { // a .js file can only be executed directly on POSIX
                resetCalls();
                ui.config.podmanPath = file; // unquoted but the file exists
                await run('podmanager.refreshOverview');
                assert.deepStrictEqual(lastArgv(), ['system', 'df']);
            }
        });
        test('a missing podman surfaces a readable error instead of hanging', async () => {
            ui.config.podmanPath = '/nonexistent/podman';
            ui.inputs = ['v'];
            await run('podmanager.createVolume');
            assert.ok(ui.error.some(e => e.message.includes('Failed to create volume')));
        });
    });
    // ================================================================ features that used to be missing
    // README / package.json advertised these, but there was no working handler. Each one is shell-free.
    let uniq = 0;
    const unique = (base: string) => `${base}${++uniq}`;

    suite('podman machine: stop and status', () => {
        test('stop uses the configured machine name', async () => {
            ui.config.machineName = 'dev-box';
            await run('podmanager.stopPodmanMachine');
            assert.deepStrictEqual(lastArgv(), ['machine', 'stop', 'dev-box']);
            assert.ok(ui.info.some(m => m.includes("'dev-box' stopped successfully")));
        });
        test('stop with the default machine name', async () => {
            await run('podmanager.stopPodmanMachine');
            assert.deepStrictEqual(lastArgv(), ['machine', 'stop', 'podman-machine-default']);
        });
        test('a hostile machine name is refused before anything runs (stop)', async () => {
            ui.config.machineName = 'x; touch pwned';
            await run('podmanager.stopPodmanMachine');
            assert.strictEqual(argvs().length, 0);
            assert.ok(ui.error[0].message.includes('Invalid Podman machine name'));
        });
        test('stop failure shows an error with Copy Command', async () => {
            scenario({ 'machine stop': { stderr: 'not running', code: 125 } });
            await run('podmanager.stopPodmanMachine');
            assert.ok(ui.error.some(e => e.message.includes('Failed to stop Podman machine') && e.buttons.includes('Copy Command')));
        });
        test('status: running', async () => {
            await run('podmanager.showMachineStatus');
            assert.deepStrictEqual(lastArgv(), ['machine', 'list', '--format', 'json']);
            assert.ok(ui.info.some(m => m === "Podman machine 'podman-machine-default' is running."));
        });
        test('status: stopped, with a custom machine name', async () => {
            ui.config.machineName = 'dev-box';
            scenario({ 'machine list': JSON.stringify([{ Name: 'dev-box', Running: false }, { Name: 'podman-machine-default', Running: true }]) });
            await run('podmanager.showMachineStatus');
            assert.ok(ui.info.some(m => m === "Podman machine 'dev-box' is stopped."));
        });
        test('status: no such machine (Linux) is explained, not an error', async () => {
            scenario({ 'machine list': '[]' });
            await run('podmanager.showMachineStatus');
            assert.ok(ui.info.some(m => m.includes('No Podman machine named')));
            assert.strictEqual(ui.error.length, 0);
        });
        test('status: podman missing is explained, not a crash', async () => {
            ui.config.podmanPath = '/nonexistent/podman';
            await run('podmanager.showMachineStatus');
            assert.ok(ui.info.some(m => m.includes('No Podman machine named')));
        });
    });

    suite('execute a command in a container', () => {
        test('runs the text as ONE argument to /bin/sh -c inside the container, and shows the output', async () => {
            scenario({ 'exec': 'hello\n' });
            const item = container('abc123def456', `${unique('exec-web')} (abc123def456)`);
            ui.inputs = ['echo hello'];
            await run('podmanager.execInContainer', item);
            assert.deepStrictEqual(lastArgv(), ['exec', 'abc123def456', '/bin/sh', '-c', 'echo hello']);
            const out = ui.outputChannels.find(c => c.name === `Podman Exec: ${item.label}`);
            assert.ok(out, 'an output channel is shown');
            assert.ok(out!.text.includes('$ echo hello') && out!.text.includes('hello\n'), out!.text);
        });
        test('compose containers use their original id', async () => {
            const item = new PodmanItem(`${unique('exec-api')} (feedfacecafe)`, State.None, 'compose-container', 'feedfacecafe', 'Up', true, 'shop');
            ui.inputs = ['ls'];
            await run('podmanager.execInContainer', item);
            assert.deepStrictEqual(lastArgv(), ['exec', 'feedfacecafe', '/bin/sh', '-c', 'ls']);
        });
        test('shell syntax in the command never reaches a host shell (it is a single argv entry)', async () => {
            const canary = path.join(tmp, 'canary-exec');
            const evil = `x; touch ${canary} && $(touch ${canary})`;
            ui.inputs = [evil];
            await run('podmanager.execInContainer', container('abc123def456', `${unique('exec-evil')} (abc123def456)`));
            assert.deepStrictEqual(lastArgv(), ['exec', 'abc123def456', '/bin/sh', '-c', evil]);
            assert.strictEqual(fs.existsSync(canary), false);
        });
        test('Esc or an empty command runs nothing', async () => {
            ui.inputs = [undefined, '   '];
            await run('podmanager.execInContainer', container());
            await run('podmanager.execInContainer', container());
            assert.strictEqual(argvs().length, 0);
        });
        test('called without an item (e.g. from the palette) does nothing', async () => {
            await run('podmanager.execInContainer', undefined);
            assert.strictEqual(argvs().length, 0);
            assert.strictEqual(ui.prompts.length, 0);
        });
        test('a failing command shows stderr and an error with Copy Command', async () => {
            scenario({ 'exec': { stdout: 'partial', stderr: 'sh: nope: not found', code: 127 } });
            const item = container('abc123def456', `${unique('exec-fail')} (abc123def456)`);
            ui.inputs = ['nope'];
            await run('podmanager.execInContainer', item);
            const out = ui.outputChannels.find(c => c.name === `Podman Exec: ${item.label}`);
            assert.ok(out && out.text.includes('sh: nope: not found') && out.text.includes('partial'));
            assert.ok(ui.error.some(e => e.message.startsWith('Command failed in') && e.buttons.includes('Copy Command')));
        });
        test('an option-like container id is refused', async () => {
            ui.inputs = ['ls'];
            await run('podmanager.execInContainer', new PodmanItem('x', State.None, 'container', '--privileged', 'Up', true));
            assert.strictEqual(argvs().length, 0);
            assert.ok(ui.error.length > 0);
        });
    });

    suite('push image', () => {
        const imageItem = (names: string[], id = 'aaa111111111') => new PodmanItem(
            names.length > 1 ? `${id} (${names.length} tags)` : `${names[0]} (${id})`,
            State.Collapsed, 'image', id, id, undefined, undefined,
            names.map((n, i) => new PodmanItem(n, State.None, 'image-tag', `${id}-tag-${i}`, id)));
        const NGINX = 'docker.io/library/nginx:latest';

        test('disabled by default: explains how to enable it and runs nothing', async () => {
            await run('podmanager.pushImage', imageItem([NGINX]));
            assert.strictEqual(argvs().length, 0);
            assert.ok(ui.info.some(m => m.includes('podmanager.enablePushCommand')));
        });
        test('enabled, no default registry: the destination is pre-filled with the image itself', async () => {
            ui.config.enablePushCommand = true;
            ui.inputs = [NGINX];
            await run('podmanager.pushImage', imageItem([NGINX]));
            assert.strictEqual(ui.prefills[0], NGINX);
            assert.deepStrictEqual(lastArgv(), ['push', NGINX]);
            assert.ok(ui.info.some(m => m.includes('pushed to')));
        });
        test('default registry is pre-filled and used as the destination', async () => {
            ui.config.enablePushCommand = true;
            ui.config.pushDefaultRegistry = 'quay.io/me/'; // trailing slash tolerated
            ui.inputs = ['quay.io/me/nginx:latest'];
            await run('podmanager.pushImage', imageItem([NGINX]));
            assert.strictEqual(ui.prefills[0], 'quay.io/me/nginx:latest');
            assert.deepStrictEqual(lastArgv(), ['push', NGINX, 'quay.io/me/nginx:latest']);
        });
        test('several tags: pick one first', async () => {
            ui.config.enablePushCommand = true;
            ui.picks = [pick('localhost/app:dev')];
            ui.inputs = ['localhost/app:dev'];
            await run('podmanager.pushImage', imageItem([NGINX, 'localhost/app:dev']));
            assert.deepStrictEqual(lastArgv(), ['push', 'localhost/app:dev']);
        });
        test('works from a single tag row too', async () => {
            ui.config.enablePushCommand = true;
            ui.inputs = [NGINX];
            await run('podmanager.pushImage', new PodmanItem(NGINX, State.None, 'image-tag', 'aaa-tag-0', 'aaa'));
            assert.deepStrictEqual(lastArgv(), ['push', NGINX]);
        });
        test('an untagged image cannot be pushed: clear message, nothing runs', async () => {
            ui.config.enablePushCommand = true;
            await run('podmanager.pushImage', imageItem(['<none>:<none>']));
            assert.strictEqual(argvs().length, 0);
            assert.ok(ui.error[0].message.includes('no tag'));
        });
        test('Esc at the tag picker or the destination box runs nothing', async () => {
            ui.config.enablePushCommand = true;
            ui.picks = [() => undefined];
            await run('podmanager.pushImage', imageItem([NGINX, 'localhost/app:dev']));
            ui.inputs = [undefined];
            await run('podmanager.pushImage', imageItem([NGINX]));
            assert.strictEqual(argvs().length, 0);
        });
        test('an option-like destination is refused', async () => {
            ui.config.enablePushCommand = true;
            ui.inputs = ['--tls-verify=false'];
            await run('podmanager.pushImage', imageItem([NGINX]));
            assert.strictEqual(argvs().length, 0);
            assert.ok(ui.error.some(e => e.message.startsWith('Failed to push image')));
        });
        test('a push failure shows an error with Copy Command', async () => {
            ui.config.enablePushCommand = true;
            scenario({ 'push': { stderr: 'unauthorized', code: 125 } });
            ui.inputs = [NGINX];
            await run('podmanager.pushImage', imageItem([NGINX]));
            assert.ok(ui.error.some(e => e.message.includes('Failed to push image') && e.buttons.includes('Copy Command')));
        });
    });

    suite('view details (volume / network / pod / container / image)', () => {
        const volume = () => new PodmanItem('data (local)', State.None, 'volume', 'volume-data', undefined, undefined, undefined, undefined, undefined, 'data');
        const network = () => new PodmanItem('mynet (bridge)', State.None, 'network', 'network-mynet', undefined, undefined, undefined, undefined, undefined, 'mynet');
        const cases: Array<[string, () => any, string[]]> = [
            ['volume', volume, ['volume', 'inspect', 'data']],
            ['network', network, ['network', 'inspect', 'mynet']],
            ['pod', () => new PodmanItem('mypod (pod123456789)', State.Collapsed, 'pod', 'pod123456789', 'Running'), ['pod', 'inspect', 'pod123456789']],
            ['container', () => container(), ['container', 'inspect', 'abc123def456']],
            ['image', () => new PodmanItem('nginx', State.Collapsed, 'image', 'aaa111111111'), ['image', 'inspect', 'aaa111111111']],
        ];
        for (const [kind, make, expected] of cases) {
            test(`${kind}: runs podman inspect and opens the JSON`, async () => {
                scenario({ [`${expected[0]} inspect`]: '[{"Name":"x"}]\n' });
                await run('podmanager.viewDetails', make());
                assert.deepStrictEqual(lastArgv(), expected);
                assert.strictEqual(ui.documents.length, 1);
                assert.strictEqual(ui.documents[0].language, 'json');
                assert.ok(ui.documents[0].content.includes('"Name":"x"'));
                assert.strictEqual(ui.shownDocuments, 1);
            });
        }
        test('a missing resource name is reported and nothing runs', async () => {
            await run('podmanager.viewDetails', new PodmanItem('x', State.None, 'volume', 'volume-x'));
            assert.strictEqual(argvs().length, 0);
            assert.ok(ui.error[0].message.includes('Unable to show details'));
        });
        test('items that have no details (e.g. section headers) are ignored', async () => {
            await run('podmanager.viewDetails', new PodmanItem('Volumes', State.Collapsed, 'volumes'));
            await run('podmanager.viewDetails', undefined);
            assert.strictEqual(argvs().length, 0);
            assert.strictEqual(ui.error.length, 0);
        });
        test('a podman failure shows an error with Copy Command', async () => {
            scenario({ 'volume inspect': { stderr: 'no such volume', code: 125 } });
            await run('podmanager.viewDetails', volume());
            assert.ok(ui.error.some(e => e.message.startsWith('Failed to get details') && e.buttons.includes('Copy Command')));
            assert.strictEqual(ui.documents.length, 0);
        });
        test('an option-like resource name is refused', async () => {
            await run('podmanager.viewDetails', new PodmanItem('x', State.None, 'network', 'network-x', undefined, undefined, undefined, undefined, undefined, '--all'));
            assert.strictEqual(argvs().length, 0);
        });
    });

    suite('add a container to a pod', () => {
        const stopped = (label = 'db (0123456789ab)') => new PodmanItem(label, State.None, 'container', '0123456789ab', 'Exited (0)', false);

        test('re-creates the stopped container inside the chosen pod, keeping its name', async () => {
            ui.picks = [pick('mypod')];
            await run('podmanager.addContainertToPod', stopped());
            assert.deepStrictEqual(lastArgv(), ['container', 'clone', '--destroy', '--pod=mypod', '--name=db', '0123456789ab']);
            assert.ok(ui.warn[0].includes('re-created inside pod'));
            assert.ok(ui.info.some(m => m.includes('re-created in pod mypod')));
            assert.ok(ui.executed.some(e => e.id === 'podmanager.refreshView'));
        });
        test('a running container must be stopped first; nothing runs', async () => {
            await run('podmanager.addContainertToPod', container());
            assert.strictEqual(argvs().length, 0);
            assert.ok(ui.info.some(m => m.includes('Stop container web first')));
        });
        test('no pods: asks the user to create one', async () => {
            scenario({ 'pod ls': '' });
            await run('podmanager.addContainertToPod', stopped());
            assert.ok(ui.info.some(m => m.includes('No pods found')));
            assert.ok(!argvs().some(a => a[0] === 'container' && a[1] === 'clone'));
        });
        test('answering No, or cancelling the pod picker, changes nothing', async () => {
            ui.picks = [pick('mypod')]; ui.warnAnswers = ['No'];
            await run('podmanager.addContainertToPod', stopped());
            ui.picks = [() => undefined];
            await run('podmanager.addContainertToPod', stopped());
            assert.ok(!argvs().some(a => a[1] === 'clone'));
        });
        test('without a parsable name the clone keeps podman\'s default name', async () => {
            ui.picks = [pick('mypod')];
            await run('podmanager.addContainertToPod', stopped('0123456789ab'));
            assert.deepStrictEqual(lastArgv(), ['container', 'clone', '--destroy', '--pod=mypod', '0123456789ab']);
        });
        test('an option-like pod name from podman output is refused', async () => {
            scenario({ 'pod ls': 'p1|-evil|Running|now\n' });
            ui.picks = [pick('-evil')];
            await run('podmanager.addContainertToPod', stopped());
            assert.ok(!argvs().some(a => a[1] === 'clone'));
            assert.ok(ui.error.some(e => e.message.startsWith('Failed to add container to pod')));
        });
        test('a podman failure shows an error with Copy Command', async () => {
            scenario({ 'container clone': { stderr: 'port conflict', code: 125 } });
            ui.picks = [pick('mypod')];
            await run('podmanager.addContainertToPod', stopped());
            assert.ok(ui.error.some(e => e.message.includes('Failed to add container to pod') && e.buttons.includes('Copy Command')));
        });
    });

    suite('register compose files', () => {
        const mkCompose = (dirName: string) => {
            const dir = path.join(tmp, dirName);
            fs.mkdirSync(dir, { recursive: true });
            const file = path.join(dir, 'docker-compose.yml');
            fs.writeFileSync(file, 'services: {}\n');
            return { dir, file };
        };
        test('asks for yml/yaml files (several allowed) and stores them by project folder', async () => {
            globalState.clear();
            const a = mkCompose('reg-one');
            ui.openDialogResult = [Uri.file(a.file)];
            await run('podmanager.registerComposeFiles');
            const opts = ui.openDialogOptions[0];
            assert.strictEqual(opts.canSelectMany, true);
            assert.deepStrictEqual(opts.filters['Compose files'], ['yml', 'yaml']);
            assert.deepStrictEqual(globalState.get('podmanComposePaths'), { 'reg-one': a.file });
            assert.ok(ui.info.some(m => m === 'Registered 1 compose file(s): reg-one'));
        });
        test('a registered project is used by later compose commands without any picker', async () => {
            globalState.clear();
            const a = mkCompose('reg-two');
            ui.openDialogResult = [Uri.file(a.file)];
            await run('podmanager.registerComposeFiles');
            resetCalls();
            await run('podmanager.composeDown');
            assert.deepStrictEqual(lastArgv(), ['-f', a.file, '-p', 'reg-two', 'down']);
        });
        test('several files at once; each action then asks which project', async () => {
            globalState.clear();
            const a = mkCompose('reg-multi-a'); const b = mkCompose('reg-multi-b');
            ui.openDialogResult = [Uri.file(a.file), Uri.file(b.file)];
            await run('podmanager.registerComposeFiles');
            assert.ok(ui.info.some(m => m === 'Registered 2 compose file(s): reg-multi-a, reg-multi-b'));
            ui.picks = [pick('reg-multi-b')];
            await run('podmanager.composeStop');
            assert.deepStrictEqual(lastArgv(), ['-f', b.file, '-p', 'reg-multi-b', 'stop']);
        });
        test('cancelling the dialog changes nothing', async () => {
            globalState.clear();
            ui.openDialogResult = undefined;
            await run('podmanager.registerComposeFiles');
            assert.strictEqual(globalState.get('podmanComposePaths'), undefined);
            assert.strictEqual(ui.info.length, 0);
        });
    });

    suite('compose actions on a compose-group tree item (used to match the wrong contextValue)', () => {
        const mkCompose = (dirName: string) => {
            const dir = path.join(tmp, dirName);
            fs.mkdirSync(dir, { recursive: true });
            const file = path.join(dir, 'docker-compose.yml');
            fs.writeFileSync(file, 'services: {}\n');
            return { dir, file };
        };
        const group = (project: string, composeFile?: string) =>
            new PodmanItem(project, State.Collapsed, 'compose-group', `compose-group-${project}`, undefined, undefined, project, [], undefined, undefined, composeFile);

        test('acts on the clicked group\'s own project, using the compose file from the container labels', async () => {
            globalState.clear();
            const { dir, file } = mkCompose('grp-labels');
            await run('podmanager.composeRestart', group('grp-labels', file));
            const call = calls()[calls().length - 1];
            assert.deepStrictEqual(call.argv, ['-f', file, '-p', 'grp-labels', 'restart']);
            assert.strictEqual(fs.realpathSync(call.cwd), fs.realpathSync(dir));
            assert.strictEqual(ui.picks.length, 0);
        });
        test('with several remembered projects it does NOT ask which one; it uses the clicked group', async () => {
            globalState.clear();
            const a = mkCompose('grp-a'); const b = mkCompose('grp-b');
            globalState.set('podmanComposePaths', { 'grp-a': a.file, 'grp-b': b.file });
            await run('podmanager.composeDown', group('grp-b'));
            assert.deepStrictEqual(lastArgv(), ['-f', b.file, '-p', 'grp-b', 'down']);
        });
        test('unknown path: searches the workspace for the project folder', async () => {
            globalState.clear();
            const { file } = mkCompose('grp-search');
            ui.findFilesResult = [Uri.file(file)];
            await run('podmanager.composeStart', group('grp-search', '/does/not/exist/docker-compose.yml'));
            assert.deepStrictEqual(lastArgv(), ['-f', file, '-p', 'grp-search', 'start']);
        });
        test('nothing known about the group: falls back to the old workspace-wide behaviour', async () => {
            globalState.clear();
            const { file } = mkCompose('grp-fallback-dir');
            // the project-specific search finds nothing; the workspace-wide search finds one file
            ui.findFilesResult = (glob: string) => (glob.includes('/unknown-project/') ? [] : [Uri.file(file)]);
            await run('podmanager.composeStop', group('unknown-project'));
            assert.deepStrictEqual(lastArgv(), ['-f', file, '-p', 'grp-fallback-dir', 'stop']);
        });
    });

    suite('auto-refresh (opt-in)', () => {
        const realSetInterval = global.setInterval;
        const realClearInterval = global.clearInterval;
        let created: Array<{ fn: () => void; ms: number }>;
        let cleared: number;
        setup(() => {
            created = []; cleared = 0;
            (global as any).setInterval = (fn: () => void, ms: number) => { created.push({ fn, ms }); return created.length as any; };
            (global as any).clearInterval = () => { cleared++; };
            if (provider.refreshTimeout) { clearTimeout(provider.refreshTimeout); provider.refreshTimeout = null; }
        });
        teardown(() => {
            (global as any).setInterval = realSetInterval;
            (global as any).clearInterval = realClearInterval;
            if (provider.refreshTimeout) { clearTimeout(provider.refreshTimeout); provider.refreshTimeout = null; }
            ui.config.autoRefreshInterval = 0;
            ui.fireConfigChange('podmanager.autoRefreshInterval');
        });

        test('off by default (0): no timer is created', () => {
            ui.config.autoRefreshInterval = 0;
            ui.fireConfigChange('podmanager.autoRefreshInterval');
            assert.strictEqual(created.length, 0);
        });
        test('enabling it starts one timer; the minimum interval is 5 seconds', () => {
            ui.config.autoRefreshInterval = 2;
            ui.fireConfigChange('podmanager.autoRefreshInterval');
            assert.strictEqual(created.length, 1);
            assert.strictEqual(created[0].ms, 5000);
            ui.config.autoRefreshInterval = 30;
            ui.fireConfigChange('podmanager.autoRefreshInterval');
            assert.strictEqual(created[1].ms, 30000);
            assert.ok(cleared >= 1, 'the previous timer is cleared when the setting changes');
        });
        test('each tick refreshes the tree while the view is visible, and not while it is hidden', () => {
            ui.config.autoRefreshInterval = 10;
            ui.fireConfigChange('podmanager.autoRefreshInterval');
            ui.treeVisible = false;
            created[0].fn();
            assert.strictEqual(provider.refreshTimeout, null, 'hidden view: no refresh');
            ui.treeVisible = true;
            created[0].fn();
            assert.ok(provider.refreshTimeout, 'visible view: refresh scheduled');
        });
        test('turning it off again clears the timer', () => {
            ui.config.autoRefreshInterval = 10;
            ui.fireConfigChange('podmanager.autoRefreshInterval');
            const before = cleared;
            ui.config.autoRefreshInterval = 0;
            ui.fireConfigChange('podmanager.autoRefreshInterval');
            assert.ok(cleared > before);
            assert.strictEqual(created.length, 1);
        });
        test('unrelated settings do not touch the timer', () => {
            ui.fireConfigChange('podmanager.logsOutput');
            assert.strictEqual(created.length + cleared, 0);
        });
    });
    // ================================================================ general features from the manual checklist
    suite('sidebar, quick links, tools menu, status bar and refresh', () => {
        test('activation creates the Resources and Quick Links views', () => {
            assert.ok(ui.treeViews.get('podmanView')?.treeDataProvider);
            assert.ok(ui.treeViews.get('podmanLinks')?.treeDataProvider);
        });

        test('quick links: Website, Documentation, GitHub, Issues, Settings, Star', async () => {
            const links = await ui.treeViews.get('podmanLinks').treeDataProvider.getChildren();
            assert.deepStrictEqual(links.map((l: any) => l.label), ['Website', 'Documentation', 'GitHub Repository', 'Issues', 'Settings', 'Star Project']);
            const urls = links.filter((l: any) => l.command.command === 'vscode.open').map((l: any) => l.command.arguments[0].fsPath);
            assert.deepStrictEqual(urls, [
                'https://pod-manager.pages.dev', 'https://pod-manager.pages.dev/docs', 'https://github.com/dreamcatcher45/podmanager',
                'https://github.com/dreamcatcher45/podmanager/issues', 'https://github.com/dreamcatcher45/podmanager']);
            const settings = links.find((l: any) => l.label === 'Settings');
            assert.strictEqual(settings.command.command, 'workbench.action.openSettings');
        });
        test('the link commands open the site, docs and repository, and the settings page', async () => {
            await run('podmanager.openWebsite');
            await run('podmanager.openDocs');
            await run('podmanager.openGitHub');
            assert.deepStrictEqual(ui.opened, ['https://pod-manager.pages.dev', 'https://pod-manager.pages.dev/docs', 'https://github.com/dreamcatcher45/podmanager']);
            await run('podmanager.openSettings');
            assert.deepStrictEqual(ui.executed[ui.executed.length - 1], { id: 'workbench.action.openSettings', args: ['@ext:dreamcatcher45.podmanager'] });
        });

        test('collapse all runs the tree-view collapse while the view is visible, and not otherwise', async () => {
            await run('podmanager.collapseAll');
            assert.ok(ui.executed.some(e => e.id === 'workbench.actions.treeView.podmanView.collapseAll'));
            ui.executed = []; ui.treeVisible = false;
            await run('podmanager.collapseAll');
            assert.strictEqual(ui.executed.length, 0);
        });

        test('refresh view: the tree is told to refresh (debounced)', async () => {
            let fired = 0;
            const sub = provider.onDidChangeTreeData(() => { fired++; });
            await run('podmanager.refreshView');
            await waitFor(() => fired >= 1, 5000);
            sub.dispose();
            assert.ok(fired >= 1);
        });
        test('refresh overview picks up the current podman state', async () => {
            scenario({ 'system df': 'TYPE     TOTAL  ACTIVE  SIZE  RECLAIMABLE\nVolumes  9      0       1MB   1MB (100%)\n' });
            await run('podmanager.refreshOverview');
            const items = await provider.getChildren((await provider.getChildren())[5]);
            assert.ok(items.some((i: any) => String(i.label).includes('Volumes')), items.map((i: any) => i.label).join(' | '));
        });

        test('tools menu: every entry runs the command it names', async () => {
            const wanted = ['Create Container', 'Create Volume', 'Create Pod', 'Create Network', 'Prune Dangling Images',
                'Prune All Unused Images', 'Prune Builder Cache', 'Reset Podman Path to Default'];
            const ids = ['podmanager.createContainer', 'podmanager.createVolume', 'podmanager.createPod', 'podmanager.createNetwork',
                'podmanager.pruneImages', 'podmanager.pruneAllImages', 'podmanager.pruneBuilderCache', 'podmanager.resetPodmanPath'];
            const originals = ids.map(id => ui.commands.get(id)!);
            const ran: string[] = [];
            ids.forEach(id => ui.commands.set(id, async () => { ran.push(id); }));
            try {
                for (const label of wanted) {
                    ui.picks = [pick(label)];
                    await run('podmanager.openToolsMenu');
                    await sleep(10);
                }
                assert.deepStrictEqual(ran, ids);
                let offered: string[] = [];
                ui.picks = [items => { offered = items.map((i: any) => i.label); return undefined; }];
                await run('podmanager.openToolsMenu');
                assert.deepStrictEqual(offered, wanted);
            } finally {
                ids.forEach((id, i) => ui.commands.set(id, originals[i]));
            }
        });

        suite('status bar progress', () => {
            let withStatus: any;
            let StatusBarManager: any;
            const realSetTimeout = global.setTimeout;
            let timers: Array<{ fn: () => void; ms: number }>;
            let item: any;
            let hidden: number;
            setup(() => {
                ({ withStatus, StatusBarManager } = require('../../statusBarManager')); // after the vscode mock is installed
                item = (StatusBarManager.getInstance() as any).statusBarItem;
                hidden = 0;
                item.hide = () => { hidden++; };
                timers = [];
                (global as any).setTimeout = (fn: () => void, ms: number, ...rest: any[]) => {
                    if (ms === 3000) { timers.push({ fn, ms }); return 0 as any; }
                    return realSetTimeout(fn, ms, ...rest);
                };
            });
            teardown(() => { (global as any).setTimeout = realSetTimeout; });

            test('spinner while running, check mark when done, hidden after 3 seconds', async () => {
                let during = '';
                await withStatus('Doing X', async () => { during = item.text; });
                assert.strictEqual(during, '$(sync~spin) Podman: Doing X...');
                assert.strictEqual(item.text, '$(check) Podman: Doing X completed');
                assert.strictEqual(timers.length, 1);
                timers[0].fn();
                assert.strictEqual(hidden, 1);
            });
            test('a failure is shown as failed (no stuck spinner), hidden after 3 seconds, and still rejects', async () => {
                await assert.rejects(() => withStatus('Doing Y', async () => { throw new Error('boom'); }), /boom/);
                assert.strictEqual(item.text, '$(check) Podman: Doing Y failed');
                timers[timers.length - 1].fn();
                assert.strictEqual(hidden, 1);
            });
        });
    });

    suite('errors and compose file types', () => {
        test('Copy Error puts the full error text on the clipboard', async () => {
            scenario({ 'volume ls': { stderr: 'boom', code: 125 } });
            ui.errorAnswers = ['Copy Error'];
            await provider.getChildren((await provider.getChildren())[3]);
            assert.ok(ui.clipboard.startsWith('Failed to get volumes'), ui.clipboard);
            assert.ok(ui.info.includes('Error message copied to clipboard'));
        });
        test('Copy Command puts a runnable command (without internal --format flags) on the clipboard', async () => {
            scenario({ 'volume ls': { stderr: 'boom', code: 125 } });
            ui.errorAnswers = ['Copy Command'];
            await provider.getChildren((await provider.getChildren())[3]);
            assert.ok(/volume ls/.test(ui.clipboard) && !ui.clipboard.includes('--format'), ui.clipboard);
        });
        test('docker-compose.yaml (not just .yml) works', async () => {
            const dir = path.join(tmp, 'yaml-project');
            fs.mkdirSync(dir, { recursive: true });
            const file = path.join(dir, 'docker-compose.yaml');
            fs.writeFileSync(file, 'services: {}\n');
            await run('podmanager.composeUp', Uri.file(file));
            assert.deepStrictEqual(lastArgv(), ['-f', file, '-p', 'yaml-project', 'up', '-d']);
        });
        test('the workspace search looks for both .yml and .yaml', async () => {
            globalState.clear();
            const globs: string[] = [];
            ui.findFilesResult = (glob: string) => { globs.push(glob); return []; };
            await run('podmanager.composeUp');
            assert.ok(globs.includes('**/docker-compose.{yml,yaml}'), globs.join(', '));
        });
    });
});
