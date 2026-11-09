#!/usr/bin/env node
// Host-side wrapper: build the test image, run the whole suite in a throwaway podman container,
// save logs/status to ./test-results and delete the container when everything passed.
// Cross-platform (Windows, macOS, Linux): needs only Node and podman. No bash.
//
//   node scripts/run-tests.js [--keep] [--privileged] [--no-build] [--stages "build lint unit"] [--clean]
//
// Env: IMAGE, STAGES, PODMAN (podman binary, default "podman")
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const PODMAN = process.env.PODMAN || 'podman';
const IMAGE = process.env.IMAGE || 'localhost/podmanager-test:latest';
const CACHE_VOLUME = 'podmanager-test-cache';
let stages = process.env.STAGES || 'preflight build lint unit integration';
let keep = false;
let privileged = false;
let build = true;
let clean = false;

const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
        case '--keep': keep = true; break;
        case '--privileged': privileged = true; break;
        case '--no-build': build = false; break;
        case '--clean': clean = true; break;
        case '--stages': stages = argv[++i] || ''; break;
        case '-h': case '--help':
            console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 9).map(l => l.replace(/^\/\/ ?/, '')).join('\n'));
            process.exit(0);
            break;
        default:
            console.error(`unknown option: ${argv[i]}`);
            process.exit(2);
    }
}

const podman = (args, opts = {}) => spawnSync(PODMAN, args, { stdio: 'inherit', cwd: root, ...opts });
const resultsDir = path.join(root, 'test-results');
const removeResults = () => {
    try { fs.rmSync(resultsDir, { recursive: true, force: true }); } catch { /* handled below */ }
    if (fs.existsSync(resultsDir) && process.platform !== 'win32') {
        // files written by the container user map to a sub-uid on the host: clear them through the user namespace
        podman(['unshare', 'rm', '-rf', resultsDir], { stdio: 'ignore' });
    }
};

if (clean) {
    removeResults();
    podman(['rmi', '-f', IMAGE], { stdio: 'ignore' });
    podman(['volume', 'rm', '-f', CACHE_VOLUME], { stdio: 'ignore' });
    console.log('removed test-results, the test image and the cache volume');
    process.exit(0);
}

const probe = spawnSync(PODMAN, ['--version'], { encoding: 'utf8' });
if (probe.error || probe.status !== 0) {
    console.error(`podman not found (tried "${PODMAN}"). Install Podman and make sure it is on your PATH.`);
    process.exit(2);
}

if (build) {
    console.log(`>> building ${IMAGE}`);
    const b = podman(['build', '-f', path.join('test', 'container', 'Containerfile'), '-t', IMAGE, '.']);
    if (b.status !== 0) { process.exit(2); }
}

removeResults();
fs.mkdirSync(resultsDir, { recursive: true });
try { fs.chmodSync(resultsDir, 0o777); } catch { /* not supported on Windows */ }

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const name = `podmanager-test-${stamp.slice(0, 8)}-${stamp.slice(8)}`;
// --shm-size: Electron (the integration stage) crashes with the 64 MB default /dev/shm.
const runArgs = ['run', '--name', name,
    '-v', `${root}:/src:ro`,
    '-v', `${resultsDir}:/results`,
    '-v', `${CACHE_VOLUME}:/cache`,
    '-e', `STAGES=${stages}`,
    '--shm-size=1g',
    ...(privileged ? ['--privileged'] : ['--device', '/dev/fuse', '--security-opt', 'label=disable']),
    IMAGE];

console.log(`>> running container ${name} (stages: ${stages})`);
const run = podman(runArgs);
const code = run.status === null ? 1 : run.status;

console.log();
try {
    const status = JSON.parse(fs.readFileSync(path.join(resultsDir, 'status.json'), 'utf8'));
    for (const s of status.stages || []) {
        console.log(`  ${s.passed ? 'PASS' : 'FAIL'}  ${s.stage} (${s.seconds}s)`);
    }
} catch { /* no status.json (the container did not get that far) */ }

if (code === 0 && !keep) {
    podman(['rm', name], { stdio: 'ignore' });
    console.log(`>> PASSED. container ${name} removed. results: test-results/`);
} else {
    console.log(`>> ${code === 0 ? 'PASSED (kept by --keep)' : `FAILED (exit ${code})`}. container kept: ${name}`);
    console.log('   logs:    test-results/*.log   status: test-results/status.json');
    console.log(`   inspect: ${PODMAN} logs ${name}   |   ${PODMAN} start -ai ${name}   |   ${PODMAN} rm ${name}`);
}
process.exit(code);
