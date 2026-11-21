# Mainline
Built with Rust, Tauri v2, and React, Mainline scans local workspace directories in sub-second time to surface every nested GitHub repository, its active branch, and working-tree status. Select individual or multiple repositories to safely reset branches back to main and fast-forward updates without leaving a clean, native-feeling desktop UI.

## Local macOS Installation & Updating

- **Initial install** (defaults to `~/Applications`, or pass `INSTALL_DIR=/Applications`):
  ```bash
  make install-app
  ```
- **Update an existing local installation** (rebuilds a fresh release bundle, auto-detects an existing `Mainline.app` in `~/Applications` or `/Applications` unless `INSTALL_DIR` is specified, gracefully quits any running `Mainline` instance, replaces the bundle via `ditto`, and prints the previous and updated versions from `Info.plist`):
  ```bash
  make update-app
  ```
- **Update and relaunch** automatically after replacing the bundle:
  ```bash
  make update-app RELAUNCH=1
  ```
