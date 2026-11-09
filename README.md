# Podmanager - VSCode Extension

**Podmanager** is a Visual Studio Code extension that helps you manage Podman containers, images, volumes, networks and pods directly from the VSCode interface.

## Quick Links

* [Website](https://pod-manager.pages.dev)
* [Documentation](https://pod-manager.pages.dev/docs)
* [GitHub Repository](https://github.com/dreamcatcher45/podmanager)

If you find this project useful, please consider giving it a star ⭐ on GitHub! Your support helps me continue developing and improving it.

## Features

* **Manage Podman Resources**: Comprehensive management of containers, images, volumes, networks and pods.
  Every action is available both as an inline icon and in the right-click menu.

* **Podman Machine Control**
  * Start and stop your Podman machine directly from VSCode
  * Machine status monitoring (shown in the status bar at startup and on demand)
  * Configurable machine name support

* **Container Management**
  * **Simple & Advanced Creation**: Choose between quick setup or advanced configuration (ports, volumes, networks, env vars, CPU/Memory limits and custom mounts).
  * Start, stop and restart containers
  * Delete containers (force-removed; the confirmation prompt can be turned off)
  * Interactive terminal access to containers
  * **Flexible Logging**: View logs in the Output panel or a dedicated Terminal.
  * Execute commands in containers
  * View container details (`podman inspect`)
  * Add a stopped container to a pod

* **Image Management**
  * Build images from a Dockerfile
  * **Push Images**: Push images to a registry, with support for a default registry (opt-in setting)
  * Remove images (force-removed)
  * Prune dangling images
  * Prune all unused images
  * Prune builder cache
  * View image details

* **Volume Management**
  * Create new volumes
  * Delete volumes (force-removed)
  * View volume details

* **Network Management**
  * Create new networks
  * Delete networks (force-removed)
  * View network details

* **Pod Management**
  * **Advanced Pod Creation**: Configure name, hostname, additional hosts and CPU shares.
  * Start, stop and restart pods
  * Delete pods (force-removed)
  * View pod details and status

* **Docker/Podman Compose Support**
  * Up, down, start, stop and restart compose services
  * Support for both `docker-compose.yml` and `docker-compose.yaml`
  * Project name detection
  * **Smart Path Persistence**: Remembers the location of your compose files for quick access.
  * Register compose files manually
  * Multiple compose file support
  * Configurable compose command style
  * Remote compose support

* **Tools and Utilities**
  * **Quick Links Sidebar**: Easy access to the website, documentation, GitHub repository, issues and settings.
  * Quick access tools menu
  * Customizable Podman path
  * Status bar integration with operation progress
  * Error handling with copy-to-clipboard support
  * Collapsible tree view with "Collapse All" support
  * Optional auto-refresh (off by default, see `podmanager.autoRefreshInterval`)

## Installation

1. **Install Podmanager**: Open the Extensions view in VSCode (`Ctrl+Shift+X`), search for "Podmanager", and install the extension.
2. **Ensure Podman is installed**: Make sure you have Podman installed on your system and accessible from your command line.

## Getting Started

Once the extension is installed:

1. **Activate the Extension**: The extension activates automatically when VSCode starts.
2. **Open the Podmanager Sidebar**: Click the Podmanager icon in the activity bar on the left to open the sidebar.
3. **Manage Your Resources**: Use the Podmanager view to interact with your containers, images, volumes, networks and pods.

### Available Commands

#### General Commands

* `Refresh View`: Refresh the entire Podman resources view
* `Refresh Overview`: Update the overview section
* `Open Tools Menu`: Access quick tools and actions
* `Reset Podman Path`: Reset the Podman path to its default
* `Show Podman Machine Status`: Report whether the configured machine is running
* `Collapse All`: Collapse all expandable elements in the tree view

#### Machine Management

* `Start Podman Machine`: Start the configured Podman machine
* `Stop Podman Machine`: Stop the running Podman machine

#### Container Commands

* `Create Container`: Create a new container (Simple or Advanced mode)
* `Start Container`: Start a stopped container
* `Stop Container`: Stop a running container
* `Restart Container`: Restart a container
* `Delete Container`: Remove a container
* `Open in Terminal`: Open an interactive terminal in a container
* `View Container Logs`: View container logs
* `Execute Command in Container`: Run a command inside a container and show the output
* `View Details`: Open the `podman inspect` output of a container, image, volume, network or pod
* `Add Container to Pod`: Re-creates a stopped container inside a pod (Podman cannot move a container, so the original is replaced)

#### Image Commands

* `Build Image`: Build an image from a Dockerfile
* `Push Image`: Push an image to a registry (turn on `podmanager.enablePushCommand`)
* `Delete Image`: Remove an image
* `Prune Images`: Remove all dangling images
* `Prune All Images`: Remove all unused images
* `Prune Builder Cache`: Clear the Podman builder cache

#### Volume Commands

* `Create Volume`: Create a new volume
* `Delete Volume`: Remove a volume

#### Network Commands

* `Create Network`: Create a new network
* `Delete Network`: Remove a network

#### Pod Commands

* `Create Pod`: Create a new pod
* `Start Pod`: Start a pod
* `Stop Pod`: Stop a running pod
* `Restart Pod`: Restart a pod
* `Delete Pod`: Remove a pod

#### Compose Commands

* `Compose Up`: Create and start compose services
* `Compose Down`: Stop and remove compose services
* `Compose Start`: Start existing compose services
* `Compose Stop`: Stop running compose services
* `Compose Restart`: Restart compose services
* `Register Compose Files`: Register compose files by project folder (remembered across sessions)

## Configuration

You can customize Podmanager via VSCode Settings (`Ctrl+,`):

| Setting | Description |
|---|---|
| `podmanager.podmanPath` | Podman command (e.g. `podman`, `flatpak-spawn --host podman`, `podman --remote`). Quote paths with spaces. |
| `podmanager.composePath` | Compose command (e.g. `podman-compose`, `docker compose`). Quote paths with spaces. |
| `podmanager.composeCommandStyle` | Choose between `default`, `podman-compose` or `podman-space-compose` (`podman compose`). |
| `podmanager.machineName` | The Podman machine name. |
| `podmanager.confirmDeletions` | Turn confirmation prompts for resource deletion on or off. |
| `podmanager.logsOutput` | Where logs are shown (`outputChannel` or `terminal`). |
| `podmanager.enablePushCommand` | Turn the Push Image action on or off (off by default). |
| `podmanager.pushDefaultRegistry` | Default registry (and namespace) used to pre-fill the push destination, e.g. `quay.io/username`. |
| `podmanager.autoRefreshInterval` | Refresh the view every N seconds while it is visible. `0` (the default) turns it off; the minimum when enabled is 5. |

> **Security:** `podmanPath`, `composePath` and `machineName` choose which program Podmanager runs, so they are *machine-scoped*: they can only be set in your user (or remote machine) settings and are ignored in a project's `.vscode/settings.json`. Podmanager runs podman with an argument list and never through a shell, and it declares limited support for untrusted workspaces.

### Upgrading from earlier versions

Most setups need no changes. Check these if something stops working:

1. **Workspace settings for `podmanPath`, `composePath` and `machineName` are ignored.** Move them to your *user* settings (Settings, "User" tab).
2. **Windows:** `.bat` / `.cmd` wrappers no longer work for `podmanPath` / `composePath`; use the `.exe`.
3. **Shell features no longer work in those two settings** (pipes, `&&`, redirects, `$(...)`, backticks, aliases). A program with arguments still works (`flatpak-spawn --host podman`, `sudo podman`, `docker compose`, `podman --remote`), and `~` and `$HOME`-style variables are still substituted. Quote paths that contain spaces.
4. Names that start with `-` are refused rather than treated as command-line options.

## Contributing

Contributions, issues and feature requests are welcome! Feel free to check the [Issues page](https://github.com/dreamcatcher45/podmanager/issues) to report bugs or request features.

### Development

* `npm run test:unit`: compile-free fast tests (fake podman, mocked VS Code); also works on Windows
* `task test:container`: the full suite in a throwaway Podman container (needs Node and Podman)
* See `TESTING.md` for details and `CHECKLIST.md` for the manual test checklist