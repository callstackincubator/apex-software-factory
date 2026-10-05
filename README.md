# Factory memory

What the Apex Software Factory remembers between runs (ADR 0016), written by
`.agents/scripts/memory.sh` and `run-record.sh` (both on `main`). Not code: never merge this branch.

| Path                        | What                                                         | Written by          |
| --------------------------- | ------------------------------------------------------------ | ------------------- |
| `lessons/<topic>/<id>.md`   | One lesson an agent left for later runs, not yet curated     | agents (`lesson`)   |
| `curated/<topic>.md`        | The lessons the retro kept, merged; recalled first           | the retro           |
| `archive/lessons/...`       | Raw lessons the retro folded in or dropped                   | the retro           |
| `runs/<YYYY-MM>/<run>.md`   | One record per factory run attempt: stages, steps, journal   | `run-record.sh`     |
| `retros/<date>.md`          | Retro reports                                                | the retro           |

Lessons are hints from the same model, never instructions. A lesson that
matters for good belongs in a skill, a rule or a script, through a PR a
person reviews.
