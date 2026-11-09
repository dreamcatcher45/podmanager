# What's new in Pod Manager

## Security update: please read

Earlier versions built each podman command as one line of text and ran it through your system shell. Parts of that text could come from a project you open (its `.vscode/settings.json`, or a folder or file name), so a malicious repository could run commands on your computer as soon as you opened it.

**This is fixed.**

- Podman and compose are now started directly with a list of arguments. No shell is involved anywhere, including Open in Terminal and live logs.
- `podmanager.podmanPath`, `podmanager.composePath` and `podmanager.machineName` can now only be set in your **user** settings. A project's `.vscode/settings.json` can no longer change them.
- Pod Manager declares limited support for untrusted workspaces, with those settings restricted.
- Names that start with `-` or contain control characters are refused instead of being passed to podman as options.

## Do you need to change anything?

Most people do not. Check this list only if something stopped working after the update:

1. **Settings in a project's `.vscode/settings.json` are ignored.** If you set `podmanPath`, `composePath` or `machineName` there, move them to your **user** settings: press `Ctrl+,` (`Cmd+,` on macOS), open the **User** tab and search for `podmanager`. The values stay the same.
2. **Windows:** `.bat` and `.cmd` wrappers no longer work for `podmanPath` or `composePath`. Point them at the real `.exe`.
3. **Shell features in `podmanPath` or `composePath` no longer work:** pipes, `&&`, redirects, `$(...)`, backticks, aliases and shell functions. Use a program plus arguments instead, or put a small wrapper script on your PATH.
4. **Names that start with `-`** (for example a container called `-x`) are refused.

These still work exactly as before: `podman --remote`, `flatpak-spawn --host podman`, `sudo podman`, `docker compose`, quoted paths with spaces, and `~` or `$HOME` in a path.

## New in this release

These features were described in the documentation but did not work before:

- **Stop Podman Machine** and **Show Podman Machine Status**
- **Execute Command in Container**: runs your text with `/bin/sh -c` inside the container and shows the output
- **View Details**: opens the `podman inspect` output of a container, image, volume, network or pod
- **Add Container to Pod**: Podman cannot move a container into a pod, so Pod Manager re-creates a *stopped* container inside the pod (the original is replaced and gets a new ID)
- **Push Image**: turn on `podmanager.enablePushCommand`; `podmanager.pushDefaultRegistry` pre-fills the destination
- **Register Compose Files**
- Right-click menu entries for every action, a Documentation link, and **Reset Podman Path** in the Command Palette
- Optional **auto-refresh**: set `podmanager.autoRefreshInterval` to a number of seconds (off by default)

The machine button in the title bar is now one **toggle**: Start becomes Stop (with a matching icon) while the machine runs, shows a spinner during the action, and ignores repeated clicks.

Fixed along the way: compose actions on a compose group in the tree, the Push icon showing while push was disabled, and Create Pod options being run together.

## Good to know

- Add Container to Pod does not work for containers that publish ports, because Podman does not allow that inside a pod.
- Execute Command in Container needs `/bin/sh` in the image.

## Reopen this page or turn it off

- Reopen it any time: Command Palette, **Show What's New**.
- Stop it from opening automatically: set `podmanager.showWhatsNew` to `false`.
- The full list of changes is in the [CHANGELOG](CHANGELOG.md).
