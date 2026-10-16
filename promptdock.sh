#!/usr/bin/env bash
# Run PromptDock straight from the source code on Linux: ./promptdock.sh
# The first run installs dependencies (~600 MB, needs internet); later runs start instantly.
cd "$(dirname "$0")" || exit 1
command -v node >/dev/null 2>&1 || { echo "Node.js 22 or newer is required: https://nodejs.org"; exit 1; }
[ -d node_modules/electron/dist ] || { echo "Installing dependencies, this happens only once..."; npm install || exit 1; }
# --no-sandbox: Electron from npm lacks the setuid sandbox helper, which Ubuntu 24+ requires.
# PromptDock only loads its own local files, so this is safe here.
nohup npx electron . --no-sandbox >/dev/null 2>&1 &
echo "PromptDock is running. Press Super+Alt+P to open it."
