# 0023 — Simulator screenshots and a recording go on the PR as attachments

Status: Accepted

## Context

The `mobile-verifier` takes one screenshot per Done when line. It reads each
one and quotes the visible text in its report, and the PR gets only that text.
The images stayed in `.worktrees/sim-shots/` on the runner, and the next job's
checkout wiped them. Nobody reviewing a PR could see what the simulator showed.

Since `gh` v2.99.0, `--attach` uploads images and videos as GitHub
attachments (`github.com/user-attachments/assets/…`). Those are shown inline
in a comment, and nothing is stored in the repository. GitHub's upload endpoint
(`uploads.github.com/user-attachments/assets`) accepts only tokens tied to a
user. On 2026-10-05 a factory app installation token got 404 there, while the
maintainer's `gh` login got 201. `gh` itself refuses installation tokens
before it sends anything. The factory acts as the app (ADR 0020).

## Decision

1. **The upload uses the runner user's own `gh` login; the comment is the
   bot's.** `.agents/scripts/attach.sh <file>[#caption]...` takes the user
   token from `gh auth token` with `GH_TOKEN` unset. It passes the token to
   curl on stdin, posts each file, and prints Markdown: an image, or a
   video's URL, which GitHub shows as a player. It needs no `gh` upgrade. The
   agent then posts the comment with `gh pr comment`, as the app.
2. **The verifier records its checks and shows them.** `device-lane.sh record
   start <name>` / `record stop` wraps agent-device's recording into
   `sim-shots/<name>.mp4`, and `release` stops a recording left running.
   `verify-mobile` records step 4. After the release it posts one
   `## Simulator evidence` comment per run: each line, its result and its
   screenshot, then the recording. Its report gains an `Evidence comment:`
   line.
3. **Evidence never decides a result.** If there is no user login
   (`attach.sh` exits 69) or an upload fails, there is no comment, and the
   report says why. Lines pass or fail on agent-device's checks, as before.
4. **The `mobile-verifier`'s step cap goes from 40 to 44** (ADR 0015) for
   the four extra calls.

## Consequences

- A PR shows what the simulator showed at each checked commit, without
  committing media. A private repository's attachments are visible only to
  people who can see the repository.
- The uploads belong to the maintainer's account, and their deletion is
  tied to that account. Unattended runs again depend on that login, but only
  for uploads; without it, delivery works and the PR gets text evidence.
- Agents could already reach that login on the runner (it is the runner
  user's); `attach.sh` uses it for nothing but uploads.
- Every simulator run on a PR adds one comment.
