#!/bin/bash
# Double-click this in Finder to start the resale tracker.
#
# macOS runs a .command file from the user's home directory rather than from
# where the file lives, so the first job is to get back here. The path may
# contain spaces — it usually does, under Downloads — hence the quoting.
cd "$(dirname "$0")" || exit 1

# Finder does not run your shell profile, so PATH here is the bare system one:
# a Node installed by Homebrew, nvm or Volta is invisible unless we look for
# it. bootstrap-node.sh does that, and fetches one if there is genuinely none.
# shellcheck source=scripts/bootstrap-node.sh
. "./scripts/bootstrap-node.sh"

if ! ensure_node; then
  echo ""
  echo "  Could not find or install Node."
  echo ""
  echo "  Install it from https://nodejs.org (take the LTS build),"
  echo "  then double-click this again."
  echo ""
  read -r -p "  Press return to close."
  exit 1
fi

"$NODE_BIN" scripts/launch.mjs
status=$?

# A failure must not vanish with the window.
if [ $status -ne 0 ]; then
  echo ""
  read -r -p "  Press return to close."
fi
