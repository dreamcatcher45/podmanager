# Changelog

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