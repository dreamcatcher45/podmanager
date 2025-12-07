# Podmanager - VSCode Extension

**Podmanager** is an Visual Studio Code extension designed to help you manage Podman containers, images, volumes, and networks directly from the VSCode interface.

## Quick Links

- [Website](https://pod-manager.pages.dev)
- [GitHub Repository](https://github.com/dreamcatcher45/podmanager)

If you find this project useful, please consider giving it a star ⭐ on GitHub! Your support helps me continue developing and improving this project.


## Features

- **Manage Podman Resources**: Comprehensive management of containers, images, volumes, networks, and pods.
- **Podman Machine Control**: 
  - Start and stop your Podman machine directly from VSCode
  - Machine status monitoring
  - Configurable machine name support
- **Container Management**: 
  - Start, stop, and restart containers
  - Delete containers with force option
  - Interactive terminal access to containers
  - View container logs in real-time
  - Execute commands in containers
- **Image Management**:
  - Build images from Dockerfile
  - Remove images with force option
  - Prune dangling images
  - Prune all unused images
  - Prune builder cache
- **Volume Management**:
  - Create new volumes
  - Delete volumes with force option
  - View volume details
- **Network Management**:
  - Create new networks
  - Delete networks with force option
  - View network details
- **Pod Management**:
  - Start, stop, and restart pods
  - Delete pods with force option
  - View pod details and status
- **Docker/Podman Compose Support**: 
  - Up, down, start, stop, and restart compose services
  - Support for both docker-compose.yml and docker-compose.yaml
  - Project name detection
  - Multiple compose file support
  - Configurable compose command style
  - Remote compose support
- **Tools and Utilities**:
  - Quick access tools menu
  - Customizable Podman path
  - Status bar integration
  - Error handling with copy-to-clipboard support
  - Collapsible tree view
  - Auto-refresh capability

## Installation

1. **Install Podmanager**: Open the Extensions view in VSCode (`Ctrl+Shift+X`), search for "Podmanager", and install the extension.
2. **Ensure Podman is installed**: Make sure you have Podman installed on your system and accessible via your command line.

## Getting Started

Once the extension is installed:

1. **Activate the Extension**: The extension will automatically activate when VSCode starts.
2. **Open the Podmanager Sidebar**: Click on the Podmanager icon in the activity bar on the left side to open the Podmanager sidebar.
3. **Manage Your Resources**: Use the Podmanager view to interact with your containers, images, volumes, and networks.

### Available Commands

#### General Commands
- `Refresh View`: Refresh the entire Podman resources view
- `Refresh Overview`: Update the overview section
- `Open Tools Menu`: Access quick tools and actions
- `Reset Podman Path`: Reset Podman path to default
- `Collapse All`: Collapse all expandable elements in the tree view

#### Machine Management
- `Start Podman Machine`: Start the configured Podman machine
- `Stop Podman Machine`: Stop the running Podman machine

#### Container Commands
- `Create Container`: Create a new container
- `Start Container`: Start a stopped container
- `Stop Container`: Stop a running container
- `Restart Container`: Restart a container
- `Delete Container`: Remove a container
- `Open in Terminal`: Open an interactive terminal in a container
- `View Container Logs`: View real-time container logs
- `Add Container to Pod`: Adds the the container to a pod

#### Image Commands
- `Build Image`: Build an image from a Dockerfile
- `Delete Image`: Remove an image
- `Prune Images`: Remove all dangling images
- `Prune All Images`: Remove all unused images
- `Prune Builder Cache`: Clear the Podman builder cache

#### Volume Commands
- `Create Volume`: Create a new volume
- `Delete Volume`: Remove a volume

#### Network Commands
- `Create Network`: Create a new network
- `Delete Network`: Remove a network

#### Pod Commands
- `Start Pod`: Start a pod
- `Stop Pod`: Stop a running pod
- `Restart Pod`: Restart a pod
- `Delete Pod`: Remove a pod

#### Compose Commands
- `Compose Up`: Create and start compose services
- `Compose Down`: Stop and remove compose services
- `Compose Start`: Start existing compose services
- `Compose Stop`: Stop running compose services
- `Compose Restart`: Restart compose services

## Contributing

Contributions, issues, and feature requests are welcome! Feel free to check the [Issues page](https://github.com/dreamcatcher45/podmanager/issues) to report bugs or request features.
