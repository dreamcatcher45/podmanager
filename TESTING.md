# Testing

| Command | What it runs | Needs |
|---|---|---|
| `task test` / `npm run test:unit` | compile, lint, unit tests (real-podman smoke tests auto-skip) | Node |
| `npm run test:integration` | tests inside a real VS Code opened on a *hostile* fixture workspace | Node, display (or `xvfb-run`) |
| `task test:container` | **everything**, inside a throwaway podman-in-podman container | podman |

## The container run

`scripts/run-tests.js` (plain Node, no bash, so it also runs on Windows) builds `test/container/Containerfile` (based on `quay.io/podman/stable`),
starts one container with the repo mounted read-only, runs the stages
`preflight → build → lint → unit → integration`, and writes to `./test-results/`:

- `status.json` – overall pass/fail plus per-stage exit code and duration
- `<stage>.log` – full output of each stage
- `unit-junit.xml` – JUnit report

The container is **removed on success** and **kept on failure** (or with `--keep`) so you can
`podman logs <name>` / `podman start -ai <name>`.

Options: `--stages "build lint unit"`, `--keep`, `--privileged` (fallback if nested podman won't
start with `/dev/fuse`), `--no-build`. The container has its own podman storage, so test
containers never appear in your host's `podman ps`.

## Test layout

- `src/test/unit/` – plain mocha, no VS Code. Includes the shell-injection tests, a fake podman
  (`test/fake-podman/`), manifest guards, and real-podman smoke tests.
- `src/test/unit/commandFlows.test.ts` – runs the extension's **real** `activate()` and command handlers
  with a mocked `vscode` module (`helpers/vscodeMock.ts`) against the fake podman, and asserts the exact
  podman invocations, messages and tree contents for: tree view, container/pod/image/volume/network
  actions, create container/pod/volume/network, build image, all five compose commands, prune, machine
  start, logs/terminals, and the accepted `podmanPath` forms. Includes the original exploit scenarios.
- `src/test/unit/createArgsParity.test.ts` – the same oracle approach for Create Container / Create Pod.
- `src/test/unit/composeParity.test.ts` – compares the new compose command builder with the *original*
  string-building code across 126 combinations of settings (flatpak, sudo, `--remote`, custom compose, all styles).
- `src/test/integration/` – needs VS Code; opens `test/fixtures/hostile-workspace`, whose
  `.vscode/settings.json` tries to hijack `podmanPath`/`composePath`/`machineName`.

## Proving the tests have teeth

Temporarily make `runCommand` build a shell string again (the original bug). 10 tests fail, including
both "reported exploit" tests. If you change the runner, do this once to be sure the suite still bites.
Note that the mutant really executes the injected commands, so run it in a scratch checkout.

## Checklist

`CHECKLIST.md` maps every item of the manual test suite (`podmanager-test-suite.html`, 65 items) to the automated
tests that cover it, notes what is still worth checking by hand against real podman, and lists the security and
compatibility behaviour the manual does not cover. `src/test/unit/checklist.test.ts` fails if a test named there
disappears, so the file cannot drift.

## Windows

- `npm run test:unit` works on Windows. The fake podman is a Node script and Windows cannot execute a `.js` file, so
  the tests launch it as `"node.exe" "podman.js"` through the command-line form of `podmanPath`
  (see `src/test/unit/helpers/fakeProgram.ts`). `PM_TEST_FAKE_VIA_NODE=1` forces that mode on Linux/macOS too.
- The `<podman>-compose` default-style test is skipped there (it needs an executable named `podman-compose`).
- `.gitattributes` keeps `test/container/**` and `test/fake-podman/**` on LF (they run on Linux inside the container); the container
  also strips carriage returns from them itself. The host-side wrapper is Node, so line endings cannot break it.
- Inside the container the VS Code integration stage can fail on some machines (Electron crashes) even though the
  unit stage passes. To run everything except it: `task test:container -- --stages "preflight build lint unit"`.
  Add `--privileged` if nested podman or Electron need more rights. `test-results/integration.log` has the details.
- `task test:container` needs only Node and `podman` on PATH (for example Podman Desktop with its machine running).

## Known limitations

- Real podman behaviour (inspect output, `container clone --pod`, `push`, machines) is only exercised by the fake
  podman here; the `real podman smoke` tests run when a working podman is present.
- Windows `.bat`/`.cmd` wrappers cannot be used for `podmanPath`/`composePath` (no shell).
