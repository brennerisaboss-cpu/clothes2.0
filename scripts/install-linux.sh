#!/bin/bash
# Put Resale Tracker in the applications menu.
#
#   ./scripts/install-linux.sh
#
# Most Linux file managers refuse to execute a script on double-click, by
# design — which is why start.sh appears to do nothing when you double-click
# it. A .desktop entry is the supported way to get a launchable application,
# and it is what puts the icon in your menu.
#
# Nothing is installed system-wide: this writes one file into your own
# ~/.local/share/applications and can be undone by deleting it.
set -e
cd "$(dirname "$0")/.."
PROJECT="$PWD"

DEST="$HOME/.local/share/applications"
mkdir -p "$DEST"

chmod +x start.sh scripts/bootstrap-node.sh

cat > "$DEST/resale-tracker.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Resale Tracker
Comment=Personal resale price tracking and arbitrage scoring
Exec=$PROJECT/start.sh
Icon=$PROJECT/assets/icon.png
Path=$PROJECT
Terminal=true
Categories=Office;Finance;
DESKTOP

chmod +x "$DEST/resale-tracker.desktop"
update-desktop-database "$DEST" 2>/dev/null || true

echo ""
echo "  Installed. Look for \"Resale Tracker\" in your applications menu."
echo ""
echo "  To remove it:  rm $DEST/resale-tracker.desktop"
echo ""
