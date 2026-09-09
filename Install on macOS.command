#!/bin/bash
# One-time macOS setup. Double-click this.
#
# Fixes the three things macOS does to a folder downloaded from the internet,
# each of which fails silently:
#
#   1. A ZIP carries no Unix permissions, so every script arrives
#      non-executable and double-clicking one does nothing at all.
#   2. Everything downloaded is flagged com.apple.quarantine.
#   3. Because of that flag, an unsigned app is launched under App
#      Translocation — from a random read-only copy, where it cannot see the
#      project folder it is supposed to launch.
#
# None of this needs admin rights. It changes only this folder.
cd "$(dirname "$0")" || exit 1
PROJECT="$PWD"

echo ""
echo "  Resale Tracker — macOS setup"
echo "  ────────────────────────────"
echo ""

echo "  Making the launchers executable …"
chmod +x start.command start.sh scripts/bootstrap-node.sh scripts/install-linux.sh 2>/dev/null
chmod +x "Resale Tracker.app/Contents/MacOS/resale-tracker" 2>/dev/null

echo "  Clearing the downloaded-from-the-internet flag …"
xattr -dr com.apple.quarantine "$PROJECT" 2>/dev/null

# Tell the app where the project is, so it still works if macOS ever runs it
# from somewhere else.
echo "  Pointing the app at this folder …"
mkdir -p "Resale Tracker.app/Contents/Resources"
printf '%s' "$PROJECT" > "Resale Tracker.app/Contents/Resources/project-path"

# Translocation is decided when an app is first launched and sticks to that
# copy. Touching the bundle's modification time makes macOS treat it as a new
# app and re-evaluate, now that the quarantine flag is gone.
touch "Resale Tracker.app"

echo ""
echo "  Done. Open \"Resale Tracker\" from this folder."
echo ""
echo "  If you would rather keep it in your Dock or Applications folder,"
echo "  make an alias of it — right-click the app, Make Alias — rather than"
echo "  moving the app itself, which launches the code sitting next to it."
echo ""
read -r -p "  Press return to close."
