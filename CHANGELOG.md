# Changelog

## [3.1.3] – 2026-11-08
### Security
- Fixed command injection. Podman and compose commands were built as one text string and run through the system shell, so attacker-controlled text could run as commands. Everything now runs via `execFile` with an argument array (no shell), including Open in Terminal and live logs, which start podman directly instead of typing a command into a shell.
- `podmanager.podmanPath`, `podmanager.composePath` and `podmanager.machineName` are now `machine`-scoped, so a repository can no longer override them through `.vscode/settings.json` (previously this ran attacker-chosen commands as soon as the folder was opened).
- Declared limited Workspace Trust support, with those three settings restricted in untrusted workspaces.
- Folder, file, project, image, container, pod, volume and network names are passed as plain arguments; values that start with `-` or contain control characters are rejected, and machine names are validated.

### Added
Features the README and `package.json` already advertised, but that had no working handler:
- **Stop Podman Machine** (`podmanager.stopPodmanMachine`, in the view title bar) and **Show Podman Machine Status**. The machine state is also shown briefly in the status bar at startup.
- **Execute Command in Container**: runs the text with `/bin/sh -c` inside the container and shows the output.
- **Push Image** (only offered when `podmanager.enablePushCommand` is on); the destination is pre-filled from `podmanager.pushDefaultRegistry`.
- **View Details** for volumes, networks, pods (and containers/images): opens the `podman inspect` JSON.
- **Add Container to Pod**: Podman cannot move a container into a pod, so this runs `podman container clone --destroy --pod` (the container must be stopped; it is re-created with a new ID).
- **Register Compose Files**: remember compose files by project folder.
- **Reset Podman Path** is now listed in the Command Palette; a **Documentation** quick link was added.
- Right-click menu entries for every inline action (inline-only items never appear in a right-click menu).
- Opt-in `podmanager.autoRefreshInterval` (seconds, default `0` = off): refresh the view while it is visible.
- A **What's New** page (`WHATS_NEW.md`) opens once as a rendered preview after installing or updating to this release, with the security fix, the upgrade steps and the new features. Reopen it with **Show What's New**; turn the automatic opening off with `podmanager.showWhatsNew`.

### Fixed
- Compose actions on a compose-group tree item checked the wrong context value and so never used the group's own project; they now do, and fall back to the previous behaviour when nothing is known about the group.
- The Push icon was shown even when push was disabled; duplicate menu entries were removed.
- Create Pod now builds its options correctly (they were previously concatenated without spaces).

### Compatibility
- `podmanPath` and `composePath` still accept a command line (`flatpak-spawn --host podman`, `sudo podman`, `docker compose`, `podman --remote`). It is split into a program and arguments by the extension (quotes supported) and run without a shell. Quote paths that contain spaces.
- A leading `~` and `$VAR` / `${VAR}` (`%VAR%` on Windows) in those settings are still substituted. `$(...)` and backticks are not supported.
- Open in Terminal and live logs still leave a shell open when the command ends (POSIX); on Windows the terminal runs podman directly and closes when it exits.
- Machine start/stop/list now use your configured podman command instead of a hard-coded `podman`.

### Upgrade notes (what some users must change)
1. If `podmanPath`, `composePath` or `machineName` were set in a **workspace** or folder `settings.json`, move them to your **user** settings; workspace values are now ignored on purpose.
2. On **Windows**, `.bat`/`.cmd` wrappers can no longer be used for `podmanPath`/`composePath` (no shell). Point them at the `.exe`.
3. `podmanPath`/`composePath` values that relied on shell features (pipes, `&&`, redirects, `$(...)`, backticks, aliases, shell functions) no longer work. Use a program plus arguments, or a small wrapper script on your PATH.
4. Names that start with `-` (for example a container called `-x`) are refused instead of being treated as options.

## [3.1.1] – 2025-12-24
### Added
- Added `podmanager.logsOutput` setting to choose where container logs are shown: `outputChannel` (default) or `terminal`.
- `View Logs` action now respects this setting: selecting `terminal` opens a new terminal running `podman logs -f <container-id>` for live output, while `outputChannel` shows a one-time dump in the Output panel.

## [3.0.7] – 2025-06-14
### Added
- Add support for pod menu options

## [3.0.0] – 2025-06-14

### Added

- **Pod Management Support:**  
  Integrated full support for managing pods directly within the extension.
- **Workspace Flexibility:**  
  Removed the requirement for all Podman Compose operations to be performed within a single workspace, enabling more flexible project management.
- **Enhanced Error Notifications:**  
  Introduced options to copy error messages and command outputs directly from error notifications for easier debugging.
- **Action Status Updates:**  
  Implemented real-time action status indicators in the status bar, providing users with immediate feedback on ongoing operations.
- **Quick Links Section:**  
  Added a dedicated quick links section for faster access to frequently used features and documentation.

## [2.0.6] - 2024-12-21
### Added
- Podman push option for images (Disabled by default)

## [2.0.4] - 2024-12-04
### Added
- Added log view option

## [2.0.3] - 2024-11-23
### Added
- Open in terminal bug fix for containers

## [0.1.9] - 2024-10-20
### Added
- Added create volume tool
- Added create network tool
- new collapse option
- build image option for dockerfiles

## [0.1.8] - 2024-10-19
### Added
- Added create container tool
- Simple and advanced mode for container creation


## [0.1.7] - 2024-09-22
### Added
- Added custom path configuration in the settings

## [0.1.4] - 2024-09-6
### Added
- Migrated `Compose Group` as `Pods`
- Pod operations
- Distinct Pod sections for each compose up procedure

## [0.1.3] - 2024-09-1
### Added
- Podman tools
  - Prune Dangling Images
  - Prune All Unused Images
  - Prune Builder Cache


## [0.0.9] - 2024-08-30
### Added
- Overview section
  - displays the disk usage and details
- Color indicators for images
  - green color for images in use
  - red color for unused images

## [0.0.8] - 2024-08-30
### Added
- Bug Fix
  - multiple images with same id is now compatible

## [0.0.7] - 2024-08-27
### Added
- Debounce Refresh
  - for controlling accidently refresh and flooded command execution

## [0.0.6] - 2024-08-25
### Added
- Compose Section improved
  - `compose up`: Added to context menu for .yaml and .yml files
- New compose group section
   - `compose start`: Start existing containers
   - `compose stop`: Stop running containers
   - `compose down`: Stop and remove containers, networks, and volumes

## [0.0.5] - 2024-08-24
### Added
- Support for Podman Compose
  - New commands:
    - `compose up`: Create and start containers
    - `compose start`: Start existing containers
    - `compose stop`: Stop running containers
    - `compose down`: Stop and remove containers, networks, and volumes

## [0.0.1] - 2024-08-24
### Added
- Initial release

## [Unreleased]
- No unreleased changes at this time
