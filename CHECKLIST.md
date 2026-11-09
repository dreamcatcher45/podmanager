# Pod Manager test checklist

Built from `podmanager-test-suite.html` (all 65 items, 9 groups) plus the behaviour that manual does not cover. `npm run test:unit` checks that every test named below still exists (`src/test/unit/checklist.test.ts`).

**How to read it**

- ✅ *Automated*: the listed test(s) run the real extension handlers against a fake podman and assert the exact commands, messages and menus.
- 🧑 *Worth a quick real check*: things a fake podman cannot prove (real podman behaviour, real UI). Tick them in the HTML tool when you do a manual pass.
- Items marked **NEW** were advertised in the README / `package.json` but did not work before; they are implemented here.

Automated tests are named by a fragment of the test title (or, for generated tests, of its source) so you can search `src/test/unit` for it.


## ⚙️ Setup & General

| ☐ | Manual item | Level | ✅ Automated tests | 🧑 Real-world check / note |
|---|---|---|---|---|
| ☐ | Podman CLI + extension installed | core | — (environment) | Environment prerequisite: run `podman --version` and confirm the extension is installed. Cannot be automated. |
| ☐ | Extension activates, sidebar opens | core | `activation creates the Resources and Quick Links views`<br>`` startup ran `system df` through the configured podman `` | Check the activity-bar icon renders and no error popup appears. |
| ☐ | Tree sections are shown | core | `root sections`<br>`images (used/unused from container list)`<br>`volumes and networks`<br>`pods and their containers` | Glance at the real tree against `podman ps -a`, `images`, `volume ls`. |
| ☐ | Refresh View | core | `refresh view: the tree is told to refresh` | — |
| ☐ | Refresh Overview | advanced | `refresh overview picks up the current podman state`<br>`` overview shows `system df` output `` | — |
| ☐ | Collapse All | advanced | `collapse all runs the tree-view collapse` | — |
| ☐ | Quick Links sidebar | advanced | `quick links: Website, Documentation`<br>`the link commands open the site` | Documentation link is new: the README promised it but the tree did not list it. |
| ☐ | Tools menu | advanced | `tools menu: every entry runs the command it names`<br>`tools menu dispatches the chosen command` | — |
| ☐ | Status bar progress | advanced | `spinner while running, check mark when done, hidden after 3 seconds` | Eyeball the status bar once during a real build. |
| ☐ | Auto-refresh | advanced | `auto-refresh (opt-in)`<br>`enabling it starts one timer; the minimum interval is 5 seconds`<br>`each tick refreshes the tree while the view is visible` | NEW and OFF by default. To test: set `podmanager.autoRefreshInterval` to e.g. 10, create a container from a terminal, wait. |

## 🖥️ Podman Machine (macOS/Windows)

| ☐ | Manual item | Level | ✅ Automated tests | 🧑 Real-world check / note |
|---|---|---|---|---|
| ☐ | Start Podman Machine | core | `machine start uses the configured machine name`<br>`default machine name` | macOS/Windows only; mark Skip on Linux. |
| ☐ | Stop Podman Machine | core | `stop uses the configured machine name`<br>`stop with the default machine name`<br>`stop failure shows an error with Copy Command` | NEW command (was in the README, never registered). macOS/Windows only. |
| ☐ | Machine status monitoring | advanced | `status: running`<br>`status: stopped, with a custom machine name`<br>`status: no such machine (Linux) is explained, not an error` | Status is shown in the status bar at startup and by the new command `Show Podman Machine Status` (it is not re-checked on every tree refresh). |
| ☐ | Custom machine name | advanced | `machine start uses the configured machine name`<br>`stop uses the configured machine name`<br>`a hostile machine name is refused before anything runs` | The setting is user-level only (machine scope). |

## 📦 Containers

| ☐ | Manual item | Level | ✅ Automated tests | 🧑 Real-world check / note |
|---|---|---|---|---|
| ☐ | Create container (Simple) | core | `create container`<br>`simple mode` | — |
| ☐ | Create container (Advanced) | advanced | `advanced mode, every option`<br>`advanced mode with the default network and nothing else` | Run `podman inspect` on a real container once to confirm every option landed. |
| ☐ | Start container | core | `podmanager.${verb}Container` | — |
| ☐ | Stop container | core | `podmanager.${verb}Container` | — |
| ☐ | Restart container | core | `podmanager.${verb}Container` | — |
| ☐ | Open in Terminal | core | `open in terminal: interactive shell via a terminal that stays open, no shell string` | Open once in real VS Code and run `ls`. On Windows the terminal runs podman directly (no shell wrapper). |
| ☐ | View logs (Output panel) | core | `output channel (default)` | — |
| ☐ | View logs (Terminal) | advanced | `terminal mode follows logs` | Follow mode needs a real terminal: check it streams. |
| ☐ | Execute command in container | advanced | `runs the text as ONE argument to /bin/sh -c inside the container, and shows the output`<br>`shell syntax in the command never reaches a host shell` | NEW (README promised it). Command runs under `/bin/sh -c` inside the container; the container needs /bin/sh. |
| ☐ | Add container to pod | advanced | `re-creates the stopped container inside the chosen pod, keeping its name`<br>`a running container must be stopped first; nothing runs` | NEW. Podman cannot attach an existing container to a pod, so this uses `podman container clone --destroy --pod` (container must be stopped; it gets a new ID). Try it once on a throwaway container with real podman (containers with published ports cannot join a pod). |
| ☐ | Delete container | core | `delete on "Yes"`<br>`delete asks first and does nothing on "No"`<br>`delete without confirmation when confirmDeletions is off` | — |
| ☐ | Delete running container (force) | advanced | `delete on "Yes"` | Deletion has always been forced (`rm -f`) and there is no separate force prompt: unchanged. |

## 🖼️ Images

| ☐ | Manual item | Level | ✅ Automated tests | 🧑 Real-world check / note |
|---|---|---|---|---|
| ☐ | Build image from Dockerfile | core | `from a Dockerfile URI`<br>`from the active editor`<br>`folder names containing shell syntax are passed literally` | — |
| ☐ | Delete image | core | `image delete` | — |
| ☐ | Delete image (force) | advanced | `image delete` | Always `rm -f`: unchanged. |
| ☐ | Push image | advanced | `enabled, no default registry: the destination is pre-filled with the image itself`<br>`several tags: pick one first`<br>`a push failure shows an error with Copy Command` | NEW (README promised it). Needs `podman login` first; try pushing to a throwaway repository. |
| ☐ | Push default registry | advanced | `default registry is pre-filled and used as the destination` | Registry is a pre-filled suggestion you can edit before pushing. |
| ☐ | Push command disabled | advanced | `disabled by default: explains how to enable it and runs nothing`<br>`Push Image is only offered when podmanager.enablePushCommand is on` | The Push icon used to show even when disabled; it is now hidden. |
| ☐ | Prune dangling images | advanced | `pruneImages` | — |
| ☐ | Prune all unused images | advanced | `pruneAllImages` | — |
| ☐ | Prune builder cache | advanced | `pruneBuilderCache` | — |

## 💾 Volumes

| ☐ | Manual item | Level | ✅ Automated tests | 🧑 Real-world check / note |
|---|---|---|---|---|
| ☐ | Create volume | core | `create volume / network` | — |
| ☐ | Delete volume | core | `volume delete, and a missing name is reported without running anything` | — |
| ☐ | View volume details | advanced | `runs podman inspect and opens the JSON` | NEW (README promised it): opens `podman volume inspect` JSON in an editor tab. |
| ☐ | Delete volume (force) | advanced | `volume delete, and a missing name is reported without running anything` | Always `rm -f`: unchanged. |

## 🌐 Networks

| ☐ | Manual item | Level | ✅ Automated tests | 🧑 Real-world check / note |
|---|---|---|---|---|
| ☐ | Create network | core | `create volume / network` | — |
| ☐ | Delete network | core | `network delete` | — |
| ☐ | View network details | advanced | `runs podman inspect and opens the JSON` | NEW: `podman network inspect` JSON. |
| ☐ | Delete network (force) | advanced | `network delete` | Always `rm -f`: unchanged. |

## 🫛 Pods

| ☐ | Manual item | Level | ✅ Automated tests | 🧑 Real-world check / note |
|---|---|---|---|---|
| ☐ | Create pod (Advanced) | core | `create pod prompts in order and builds the command`<br>`all options (the original concatenated these without spaces` | Create Pod options were previously glued together without spaces; they now work. |
| ☐ | Start / Stop / Restart pod | core | `pod ${verb}` | — |
| ☐ | Delete pod | core | `pod delete (confirm yes / no)` | — |
| ☐ | View pod details | advanced | `runs podman inspect and opens the JSON` | NEW: `podman pod inspect` JSON. |
| ☐ | Delete pod (force) | advanced | `pod delete (confirm yes / no)` | Always `rm -f`: unchanged. |

## 🧩 Compose

| ☐ | Manual item | Level | ✅ Automated tests | 🧑 Real-world check / note |
|---|---|---|---|---|
| ☐ | Compose Up | core | `from a compose file URI runs in its folder` | — |
| ☐ | Compose Down | core | `from a compose file URI runs in its folder` | — |
| ☐ | Compose Start / Stop / Restart | advanced | `from a compose file URI runs in its folder`<br>`own project, using the compose file from the container labels` | Compose actions on a compose-group tree item were broken by a mismatched context value and are fixed. |
| ☐ | Support for .yml and .yaml | advanced | `docker-compose.yaml (not just .yml) works`<br>`the workspace search looks for both .yml and .yaml` | — |
| ☐ | Project name detection | advanced | `from a compose file URI runs in its folder`<br>`own project, using the compose file from the container labels` | — |
| ☐ | Compose path persistence | advanced | `remembers the project, so a later run without input reuses it` | Stored in VS Code global state, so it survives reloads. |
| ☐ | Register Compose Files | advanced | `asks for yml/yaml files (several allowed) and stores them by project folder`<br>`a registered project is used by later compose commands without any picker` | NEW (declared in package.json but never registered). Registration is remembered across sessions, not just the session. |
| ☐ | Multiple compose files | advanced | `several files at once; each action then asks which project`<br>`with several remembered projects it does NOT ask which one` | — |
| ☐ | Compose command style | advanced | `compose style podman-space-compose runs`<br>`` default style runs `<podman>-compose` ``<br>`compose command parity with the original implementation` | 126 combinations compared against the original string-building code. |
| ☐ | Custom compose path | advanced | `compose command parity with the original implementation` | Must be a single executable (arguments allowed, e.g. `docker compose`); never run through a shell. |
| ☐ | Remote compose | advanced | `compose command parity with the original implementation`<br>`trailing --remote is forwarded to podman` | Needs a real remote connection to prove end to end. |

## 🛡️ Settings & Errors

| ☐ | Manual item | Level | ✅ Automated tests | 🧑 Real-world check / note |
|---|---|---|---|---|
| ☐ | Custom Podman path | advanced | `` "program script" (multi-word command such as `flatpak-spawn --host podman`) ``<br>`a path with spaces, quoted` | Set in USER settings (machine scope). |
| ☐ | Invalid Podman path | advanced | `a missing podman surfaces a readable error instead of hanging`<br>`status: podman missing is explained, not a crash` | — |
| ☐ | Reset Podman Path | advanced | `reset podman path clears the setting`<br>`Reset Podman Path is declared` | Now also listed in the Command Palette. |
| ☐ | Confirm deletions toggle | advanced | `delete without confirmation when confirmDeletions is off`<br>`delete asks first and does nothing on "No"` | — |
| ☐ | Error copy-to-clipboard | advanced | `Copy Error puts the full error text on the clipboard`<br>`Copy Command puts a runnable command` | — |
| ☐ | Podman not running / not installed | advanced | `a failing podman produces an error toast with Copy Command, not a crash`<br>`a failure is shown as failed (no stuck spinner)` | Rename the binary once to see the real message. |

## Not in the manual: security fix and compatibility

| ☐ | Behaviour | ✅ Automated tests | 🧑 Real-world check / note |
|---|---|---|---|
| ☐ | A repo's `.vscode/settings.json` cannot change `podmanPath`, `composePath` or `machineName` | `is machine-scoped`<br>`declares limited untrusted-workspace support restricting those settings` | Open `test/fixtures/hostile-workspace` in VS Code: the integration test does this (needs a display; runs in `npm run test:integration`). |
| ☐ | Opening a hostile repo runs nothing at startup (`system df`) | `through the configured podman` | Same hostile workspace. |
| ☐ | Folder/file names with shell syntax cannot run commands (Compose Up, Build Image) | `hostile project folder names run nothing (the reported exploit)`<br>`folder names containing shell syntax are passed literally (the reported exploit)` | — |
| ☐ | Names typed into Create Container / Pod / Volume / Network / Push / Exec stay literal | `hostile name cannot run anything`<br>`shell syntax in the command never reaches a host shell`<br>`create volume with an option-like name is refused` | — |
| ☐ | No code path builds a shell string | `no exec/execSync/shell:true/sendText with a command string` | — |
| ☐ | Option-like names (`--privileged`, `-v`) are refused instead of becoming flags | `option-like image name is refused`<br>`an option-like container id is refused`<br>`an option-like destination is refused` | — |
| ☐ | Existing `podmanPath` forms keep working (`podman --remote`, `flatpak-spawn --host podman`, quoted paths with spaces) | `trailing --remote is forwarded to podman`<br>`a path with spaces, quoted` | On Windows with a `.bat`/`.cmd` wrapper: see README migration notes. |
| ☐ | `podmanPath` / `composePath` may use `~` and environment variables (`~/bin/podman`, `$HOME/bin/podman`) as before | `expandToken: ~ and variables are substituted (what the shell used to do), nothing is executed`<br>`executable settings use the expansion` | `$(...)` and backticks are intentionally not supported. |
| ☐ | Every existing command builds the same podman arguments as the original code | `create container: parity with the original implementation`<br>`compose command parity with the original implementation` | — |
| ☐ | Existing settings keep their defaults | `settings keep their defaults (backward compatibility)` | — |
| ☐ | Inline icons are also in the right-click menu; Push is hidden unless enabled; menus only reference real tree items | `every inline action is also in the right-click menu`<br>`menus only target tree items the provider really creates` | Right-click a container/image/volume in real VS Code once. |
| ☐ | Every command in `package.json` has a handler | `every command declared in package.json has a handler after activate()` | — |
| ☐ | Failures show an error with Copy Error / Copy Command instead of crashing | `a failing podman produces an error toast with Copy Command, not a crash` | — |
| ☐ | A What's New page opens once after install/update, can be reopened, and can be turned off (`podmanager.showWhatsNew`) | `activation opens the What's New page once (Markdown preview of WHATS_NEW.md) and remembers it`<br>`does not open again once seen (later starts, later windows)`<br>`podmanager.showWhatsNew = false: nothing opens and nothing is marked as seen`<br>`falls back to the plain file when the Markdown preview is unavailable`<br>`it is packaged in the VSIX (not excluded by .vscodeignore)` | Update an installed copy and confirm the page opens as a rendered preview, once. |
