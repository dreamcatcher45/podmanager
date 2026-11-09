import * as fs from 'fs';
import * as path from 'path';

// The fake podman is a Node script (test/fake-podman/podman.js).
// POSIX can execute it directly through its shebang. Windows cannot execute a .js file
// (spawn EFTYPE), so there the tests use the command-line form of podmanPath/composePath
// ("node.exe" "podman.js"), which the extension supports on every platform.
export const FAKE_SCRIPT = path.resolve(__dirname, '../../../../test/fake-podman/podman.js');
export const isWindows = process.platform === 'win32';
/** Launch the fake as `node podman.js` (always on Windows). PM_TEST_FAKE_VIA_NODE=1 forces it elsewhere, to test that path. */
export const viaNode = isWindows || process.env.PM_TEST_FAKE_VIA_NODE === '1';

const quote = (p: string) => `"${p}"`;

/** A podmanPath / composePath setting value that runs the fake (extra tokens are appended, e.g. '--remote'). */
export function fakeSetting(script: string = FAKE_SCRIPT, ...extra: string[]): string {
    const base = viaNode ? `${quote(process.execPath)} ${quote(script)}` : (script.includes(' ') ? quote(script) : script);
    return [base, ...extra].join(' ');
}

/** Program + arguments to run the fake directly through runCommand(). */
export function fakeInvocation(args: string[]): { file: string; args: string[] } {
    return viaNode ? { file: process.execPath, args: [FAKE_SCRIPT, ...args] } : { file: FAKE_SCRIPT, args };
}

/**
 * Copy the fake into `dir` under `name` and return the podmanPath/composePath setting that runs that copy.
 * On Windows the copy keeps a .js extension and is launched through node.
 */
export function installFake(dir: string, name: string): { setting: string; file: string } {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, viaNode ? `${name}.js` : name);
    fs.copyFileSync(FAKE_SCRIPT, file);
    if (!viaNode) { fs.chmodSync(file, 0o755); }
    return { setting: fakeSetting(file), file };
}

/** Windows cannot create folders containing < > : " / \ | ? *, so keep the shell syntax that CAN exist there. */
export function dirSafe(name: string): string {
    return isWindows ? name.replace(/[<>:"/\\|?*]/g, '_') : name;
}
