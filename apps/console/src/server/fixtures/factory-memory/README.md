Files as `.agents/scripts/memory.sh` and `run-record.sh` wrote them on a scratch
`factory-memory` branch, from the factory runs of #18 on the booth Mac. The tests
parse them so that a change to either script's format fails `pnpm check`. The
attempt 2 digest is cut after its stage table; the host name is replaced.
