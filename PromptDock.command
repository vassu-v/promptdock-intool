#!/bin/bash
# Run PromptDock straight from the source code on macOS (double-click in Finder).
# The first run installs dependencies (~600 MB, needs internet); later runs start instantly.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22 or newer is required: https://nodejs.org"; read -r -p "Press Enter to close"; exit 1
fi
if [ ! -d node_modules/electron/dist ]; then
  echo "Installing dependencies, this happens only once..."
  npm install || { read -r -p "Install failed. Press Enter to close"; exit 1; }
fi
nohup npx electron . >/dev/null 2>&1 &
echo "PromptDock is running. Press Cmd+Option+P to open it. You can close this window."
