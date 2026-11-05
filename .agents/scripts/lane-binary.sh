#!/usr/bin/env sh
# Produces a lane binary on EAS and prints its build id (ADR 0027).
#
#   .agents/scripts/lane-binary.sh <ios|android>
#
# Runs apps/mobile/.eas/workflows/lane-binary.yml and waits: the workflow repacks the
# production build with the current fingerprint under the lane profile, or builds one when
# none exists. Prints only the build id on stdout: the repack job's, else the build job's.
# Exit: 0 printed; 1 the run failed or produced no build; 64 usage.
set -eu

platform=${1:-}
case $platform in
  ios | android) ;;
  *)
    echo "usage: lane-binary.sh <ios|android>" >&2
    exit 64
    ;;
esac

root=$(cd "$(dirname "$0")/../.." && pwd)
out=$(mktemp)
trap 'rm -f "$out"' EXIT

if ! (cd "$root/apps/mobile" && npx -y eas-cli@27.4.1 workflow:run .eas/workflows/lane-binary.yml \
  -F "platform=$platform" --non-interactive --wait --json >"$out"); then
  echo "lane-binary: the EAS workflow run failed" >&2
  exit 1
fi

node -e '
const run = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const output = (key) => run.jobs.find((job) => job.key === key)?.outputs?.build_id;
const id = output("repack") || output("build");
if (run.status !== "SUCCESS" || !id) {
  console.error(`lane-binary: run ${run.status}, no build id from the repack or build job ${run.url ?? ""}`);
  process.exit(1);
}
console.log(id);
' "$out"
