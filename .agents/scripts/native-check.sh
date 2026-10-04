#!/usr/bin/env sh
# Says whether a change touches the mobile app's native layer, so it cannot ship over the air.
#
#   .agents/scripts/native-check.sh [<base> [<head>]]    defaults: origin/main HEAD
#
# Prints one "native: <reason>" line per finding, then "needs native build: yes" or "no".
# Exits 0 when nothing native changed, 3 when something did, 1 on a usage or git error.
#
# The OTA strategy is fingerprint (ADR 0003): a bundle only reaches binaries with the same
# native fingerprint, so a merged native change never reaches the booth phone until someone
# ships a new binary. This check is the conservative pre-merge half: it flags anything that can
# change the fingerprint. A false "yes" costs a maintainer one look; a false "no" is caught by
# the fingerprint at publish time, where it costs a missed update.
set -eu

base=${1:-origin/main}
head=${2:-HEAD}
mobile=apps/mobile

classify() {
  case $1 in
    "$mobile"/ios/* | "$mobile"/android/*) echo "native: $1 (generated native project)" ;;
    "$mobile"/app.json | "$mobile"/app.config.*) echo "native: $1 (app config: plugins, ids, permissions, runtime)" ;;
    "$mobile"/plugins/* | "$mobile"/modules/*) echo "native: $1 (config plugin or local native module)" ;;
    patches/* | "$mobile"/patches/*) echo "native: $1 (patched dependency)" ;;
    *.podspec | *.gradle | *.gradle.kts | */Podfile | */Podfile.lock) echo "native: $1 (native build file)" ;;
    "$mobile"/*.swift | "$mobile"/*.m | "$mobile"/*.mm | "$mobile"/*.kt | "$mobile"/*.java | "$mobile"/*.cpp | "$mobile"/*.h)
      echo "native: $1 (native source)"
      ;;
  esac
}

files=$(git diff --name-only "$base...$head") || exit 1

reasons=$(printf '%s\n' "$files" | while IFS= read -r f; do classify "$f"; done)

# A dependency added, removed or re-versioned in the app can carry native code or a config
# plugin. devDependencies never reach the binary.
if printf '%s\n' "$files" | grep -qx "$mobile/package.json"; then
  before=$(git show "$base:$mobile/package.json" 2>/dev/null || echo '{}')
  after=$(git show "$head:$mobile/package.json" 2>/dev/null || echo '{}')
  deps=$(node -e '
    const [a, b] = process.argv.slice(1).map((s) => JSON.parse(s).dependencies ?? {});
    const names = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const n of [...names].sort())
      if (a[n] !== b[n]) console.log(`native: dependency ${n} ${a[n] ?? "(none)"} -> ${b[n] ?? "(removed)"}`);
  ' "$before" "$after")
  reasons=$(printf '%s\n%s\n' "$reasons" "$deps")
fi

reasons=$(printf '%s\n' "$reasons" | grep -v '^$' || true)
if [ -n "$reasons" ]; then
  printf '%s\n' "$reasons"
  echo "needs native build: yes"
  exit 3
fi
echo "needs native build: no"
