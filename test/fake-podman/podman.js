#!/usr/bin/env node
// A fake `podman` (also usable as a fake compose tool). It never runs anything:
// it appends {argv, cwd} to $FAKE_PODMAN_LOG (one JSON object per line) and prints canned output.
//
//   FAKE_PODMAN_LOG       file to record invocations in
//   FAKE_PODMAN_DELAY_MS  if set: sleep this many ms before doing anything (simulate a slow machine)
//   FAKE_PODMAN_FAIL      if set: exit 1 with this text on stderr (for every call)
//   FAKE_PODMAN_SCENARIO  path to a JSON file {"<arg prefix>": {"stdout","stderr","code"}} merged over the
//                         defaults below. The LONGEST matching prefix of the (joined) arguments wins.
const fs = require('fs');
let args = process.argv.slice(2);
// FAKE_PODMAN_DELAY_MS: pretend to be slow (simulates a loaded machine or a nested container).
if (process.env.FAKE_PODMAN_DELAY_MS) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(process.env.FAKE_PODMAN_DELAY_MS));
}
if (process.env.FAKE_PODMAN_LOG) {
    fs.appendFileSync(process.env.FAKE_PODMAN_LOG, JSON.stringify({ argv: args, cwd: process.cwd() }) + '\n');
}
if (process.env.FAKE_PODMAN_FAIL) {
    process.stderr.write(process.env.FAKE_PODMAN_FAIL);
    process.exit(1);
}
if (args[0] === '--remote') { args = args.slice(1); }

const defaults = {
    'system df': 'TYPE    TOTAL  ACTIVE  SIZE   RECLAIMABLE\nImages  2      1       10MB   5MB (50%)\n',
    'container ls -a --format {{if .ImageID}}': 'aaa111111111\nnone\n',
    'container ls': 'abc123def456|web|Up 2 minutes|\n0123456789ab|db|Exited (0) 1 hour ago|\n',
    'image ls': 'aaa111111111|docker.io/library/nginx|latest\nbbb222222222|localhost/app|dev\n',
    'images': 'docker.io/library/nginx|latest|aaa111111111\nlocalhost/app|dev|bbb222222222\n',
    'volume ls --format {{.Name}}|{{.Mountpoint}}': 'data|/var/lib/containers/data\n',
    'volume ls': 'data|local\n',
    'network ls --format {{.Name}}|{{.Driver}}': 'podman|bridge\nmynet|bridge\n',
    'network ls --format {{.Name}}': 'podman\nmynet\nnone\n',
    'pod ls': 'pod123456789|mypod|Running|2 hours ago\n',
    'ps': 'abc123def456|web|Up 2 minutes|2 minutes ago\n',
    'machine list': JSON.stringify([{ Name: 'podman-machine-default', Running: true }]),
    'logs': 'log line one\nlog line two\n',
    'build': 'Successfully built abc\n',
    'run': 'abcdef0123456789abcdef\n',
    'pod create': 'pod9876543210abcdef\n',
};
let scenario = defaults;
if (process.env.FAKE_PODMAN_SCENARIO) {
    const custom = JSON.parse(fs.readFileSync(process.env.FAKE_PODMAN_SCENARIO, 'utf8'));
    scenario = { ...defaults, ...custom };
}
const joined = args.join(' ');
const key = Object.keys(scenario).filter(k => joined.startsWith(k)).sort((a, b) => b.length - a.length)[0];
const hit = key === undefined ? '' : scenario[key];
const r = typeof hit === 'string' ? { stdout: hit } : hit;
if (r.stdout) { process.stdout.write(r.stdout); }
if (r.stderr) { process.stderr.write(r.stderr); }
process.exit(r.code || 0);
