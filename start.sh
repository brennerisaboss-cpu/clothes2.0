#!/bin/bash
# Start the resale tracker.
cd "$(dirname "$0")" || exit 1

# shellcheck source=scripts/bootstrap-node.sh
. "./scripts/bootstrap-node.sh"

if ! ensure_node; then
  echo ""
  echo "  Could not find or install Node. Get the LTS build from https://nodejs.org."
  echo ""
  exit 1
fi

exec "$NODE_BIN" scripts/launch.mjs
