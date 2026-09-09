#!/bin/bash
# Find a usable Node, or fetch one.
#
# Sourced by start.command and start.sh. Sets NODE_BIN on success.
#
# This has to work before anything else does, so it is plain bash with no
# dependencies beyond curl and tar — both present on any stock macOS or Linux.
#
# A Node that is merely PRESENT is not enough: the project needs 22 or newer,
# and a Mac with an old Homebrew Node would otherwise fail deep inside the app
# with a syntax error rather than here with a sentence.

NODE_MIN=22
NODE_BIN=""

# Is this binary a Node new enough to use?
node_ok() {
  local candidate="$1" version major
  [ -n "$candidate" ] || return 1
  command -v "$candidate" >/dev/null 2>&1 || [ -x "$candidate" ] || return 1
  version="$("$candidate" -v 2>/dev/null)" || return 1
  version="${version#v}"
  major="${version%%.*}"
  case "$major" in ''|*[!0-9]*) return 1 ;; esac
  [ "$major" -ge "$NODE_MIN" ]
}

find_node() {
  local candidate

  # A Node this launcher installed earlier wins, so a machine whose system
  # Node is too old does not re-download on every launch.
  if node_ok "$PWD/.runtime/node/bin/node"; then
    NODE_BIN="$PWD/.runtime/node/bin/node"; return 0
  fi

  if node_ok node; then NODE_BIN="$(command -v node)"; return 0; fi

  # Double-clicking does not run your shell profile, so a Node installed by
  # nvm, Homebrew or Volta is invisible in PATH here even though it works
  # perfectly in a terminal. Look where they actually live.
  for candidate in \
    /opt/homebrew/bin/node \
    /usr/local/bin/node \
    "$HOME/.volta/bin/node" \
    "$HOME/.local/bin/node"; do
    if node_ok "$candidate"; then NODE_BIN="$candidate"; return 0; fi
  done

  # nvm keeps versions in a directory per release; take the highest that works.
  if [ -d "$HOME/.nvm/versions/node" ]; then
    for candidate in $(ls -1 "$HOME/.nvm/versions/node" 2>/dev/null | sort -Vr); do
      if node_ok "$HOME/.nvm/versions/node/$candidate/bin/node"; then
        NODE_BIN="$HOME/.nvm/versions/node/$candidate/bin/node"; return 0
      fi
    done
  fi

  return 1
}

# Download a private Node into .runtime/. Nothing is installed system-wide and
# nothing needs admin rights: it is a folder inside this project, and deleting
# the project deletes it.
install_node() {
  local os arch dist file url version sums tmp

  case "$(uname -s)" in
    Darwin) os=darwin ;;
    Linux)  os=linux ;;
    *) echo "  Unsupported platform: $(uname -s)"; return 1 ;;
  esac
  case "$(uname -m)" in
    arm64|aarch64) arch=arm64 ;;
    x86_64|amd64)  arch=x64 ;;
    *) echo "  Unsupported processor: $(uname -m)"; return 1 ;;
  esac

  command -v curl >/dev/null 2>&1 || { echo "  curl is not available."; return 1; }

  echo ""
  echo "  Node ${NODE_MIN}+ is needed and was not found. Fetching it (about 50 MB, once) …"

  dist="https://nodejs.org/dist/latest-v${NODE_MIN}.x"

  # The exact filename is read from the release's own checksum file rather than
  # guessed, so this keeps working as new versions land and cannot point at a
  # release that was never published.
  sums="$(curl -fsSL --retry 3 --connect-timeout 20 "${dist}/SHASUMS256.txt" 2>/dev/null)" || {
    echo "  Could not reach nodejs.org."
    return 1
  }
  file="$(printf '%s\n' "$sums" | grep -o "node-v[0-9.]*-${os}-${arch}\.tar\.gz" | head -1)"
  [ -n "$file" ] || { echo "  No Node build published for ${os}-${arch}."; return 1; }
  version="$(printf '%s' "$file" | sed -E 's/^node-(v[0-9.]+)-.*/\1/')"
  url="${dist}/${file}"

  tmp="$(mktemp -d)" || return 1
  curl -fL --retry 3 --connect-timeout 20 --progress-bar -o "${tmp}/${file}" "$url" || {
    echo "  Download failed."; rm -rf "$tmp"; return 1
  }

  # Verify what was downloaded before running it. This binary is about to be
  # executed, so an unchecked download would be the least defensible thing in
  # the whole project.
  local expected actual
  expected="$(printf '%s\n' "$sums" | grep " $file\$" | awk '{print $1}')"
  if command -v shasum >/dev/null 2>&1; then
    actual="$(shasum -a 256 "${tmp}/${file}" | awk '{print $1}')"
  elif command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "${tmp}/${file}" | awk '{print $1}')"
  else
    echo "  No checksum tool available; refusing to run an unverified download."
    rm -rf "$tmp"; return 1
  fi
  if [ "$expected" != "$actual" ]; then
    echo "  Checksum mismatch — the download was corrupted or tampered with. Stopping."
    rm -rf "$tmp"; return 1
  fi

  mkdir -p "$PWD/.runtime"
  rm -rf "$PWD/.runtime/node"
  tar -xzf "${tmp}/${file}" -C "$tmp" || { echo "  Could not unpack Node."; rm -rf "$tmp"; return 1; }
  mv "${tmp}/node-${version}-${os}-${arch}" "$PWD/.runtime/node" || { rm -rf "$tmp"; return 1; }
  rm -rf "$tmp"

  if node_ok "$PWD/.runtime/node/bin/node"; then
    NODE_BIN="$PWD/.runtime/node/bin/node"
    echo "  Installed Node ${version} inside this folder."
    return 0
  fi
  echo "  The downloaded Node did not run."
  return 1
}

ensure_node() {
  find_node && return 0
  install_node && return 0
  return 1
}
