#!/usr/bin/env sh
# Uploads screenshots and videos as GitHub attachments and prints Markdown that shows them, for
# a comment the caller then posts as the factory's app (ADR 0023). Nothing is committed.
#
#   .agents/scripts/attach.sh <file>[#<caption>]...
#
# GitHub refuses an app installation token at its upload endpoint (404), so the upload uses
# the runner user's own `gh` login (`gh auth token` with GH_TOKEN unset): the files belong to
# that account, the comment to the bot. A private repository's attachments are visible only to
# people who can see the repository.
#
# Prints one Markdown line per file, in order: `![<caption>](<url>)` for an image (.png, .jpg,
# .jpeg, .gif; up to 10 MB) and the bare URL for a video (.mp4, .mov, .webm; up to 100 MB),
# which GitHub shows as a player. The caption defaults to the file name.
#
# Exit: 0 every file uploaded; 1 a file was refused or an upload failed (nothing printed);
# 64 usage; 69 no user login on this machine: post the text evidence without media.
set -eu

[ $# -gt 0 ] || {
  sed -n '2,19p' "$0" >&2
  exit 64
}

token=$(env -u GH_TOKEN -u GITHUB_TOKEN gh auth token 2>/dev/null || true)
case $token in
  '') echo "unavailable: no gh login for $(id -un) on this machine; attachments need a user's token" >&2; exit 69 ;;
  ghs_*) echo "unavailable: the gh login is an app installation token, which cannot upload attachments" >&2; exit 69 ;;
esac
repo_id=$(env -u GITHUB_TOKEN GH_TOKEN="$token" gh api 'repos/{owner}/{repo}' -q .id) ||
  { echo "attach: cannot read the repository id" >&2; exit 1; }

out=
for arg in "$@"; do
  file=${arg%%#*}
  caption=${arg#"$file"}
  caption=${caption#\#}
  [ -f "$file" ] || { echo "attach: no such file: $file" >&2; exit 1; }
  name=$(basename "$file")
  case $(printf '%s' "$name" | tr '[:upper:]' '[:lower:]') in
    *.png) type=image/png limit=10 ;;
    *.jpg | *.jpeg) type=image/jpeg limit=10 ;;
    *.gif) type=image/gif limit=10 ;;
    *.mp4) type=video/mp4 limit=100 ;;
    *.mov) type=video/quicktime limit=100 ;;
    *.webm) type=video/webm limit=100 ;;
    *) echo "attach: $name: not an image or video GitHub shows" >&2; exit 1 ;;
  esac
  size=$(wc -c <"$file" | tr -d ' ')
  [ "$size" -le $((limit * 1024 * 1024)) ] || { echo "attach: $name is over $limit MB" >&2; exit 1; }
  # The token goes to curl on stdin, never on its command line.
  response=$(printf 'header = "Authorization: token %s"\n' "$token" | curl -sS --config - -X POST \
    "https://uploads.github.com/user-attachments/assets?name=$name&content_type=$type&repository_id=$repo_id" \
    -H 'Content-Type: application/octet-stream' -H 'X-GitHub-Api-Version: 2022-11-28' \
    --data-binary "@$file" -w '\n%{http_code}') || { echo "attach: upload of $name failed" >&2; exit 1; }
  code=$(printf '%s\n' "$response" | tail -n 1)
  url=$(printf '%s\n' "$response" | sed -n 's/.*"url":"\([^"]*\)".*/\1/p' | head -n 1)
  [ "$code" = 201 ] && [ -n "$url" ] || { echo "attach: GitHub answered $code for $name" >&2; exit 1; }
  case $type in
    image/*) line="![${caption:-$name}]($url)" ;;
    *) line=$url ;;
  esac
  out="$out$line
"
done
printf '%s' "$out"
