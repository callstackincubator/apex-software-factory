# Apex Software Factory

A showcase of an AI-native delivery line, built for the Callstack booth at
reactCon Berlin (October 7–9, 2026). Visitors describe an idea for an almost
empty Expo app. It becomes a GitHub issue, a developer writes the technical
spec, and agents implement, test, review and merge it. The merge ships an
over-the-air update to the phones at the booth.

- [How the factory works](docs/FACTORY.md)
- [Set up a factory machine](docs/BOOTSTRAP.md)

| Path                | What                                             |
| ------------------- | ------------------------------------------------ |
| `apps/mobile`       | The booth app ([README](apps/mobile/README.md))  |
| `apps/api`          | The product API ([README](apps/api/README.md))   |
| `apps/ota-server`   | The self-hosted OTA update server                |
| `packages/contract` | Every wire shape as zod schemas, plus the client |

```bash
pnpm install
pnpm check
```

Agents and contributors start at [AGENTS.md](AGENTS.md).
