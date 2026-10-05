# Architecture decision records

One file per decision, numbered in order. A record is _Proposed_, _Accepted_,
_Accepted — not yet implemented_, or _Superseded by NNNN_. An accepted record is
binding: change it with a new record that supersedes it, never by editing.

| ADR | Title | Status |
| --- | --- | --- |
| [0001](0001-pnpm-monorepo-with-shared-contract.md) | A pnpm monorepo with one shared contract package | Accepted |
| [0002](0002-hono-on-node-for-http-services.md) | Hono on Node for every HTTP service | Accepted |
| [0003](0003-ota-through-self-hosted-hot-updater.md) | OTA updates through a self-hosted hot-updater server | Accepted |
| [0004](0004-opencode-with-one-model.md) | The factory runs on OpenCode with one model | Accepted (amended by 0008) |
| [0005](0005-github-issues-are-spec-and-queue.md) | GitHub Issues are the spec and the queue | Accepted |
| [0006](0006-wave-a-amendments.md) | Source-shipping packages are installed, not deployed; the OTA server is exempt from the OpenAPI rule | Accepted |
| [0007](0007-device-lane-simlock-agent-device.md) | Devices are leased with simlock and driven with agent-device; appduct ships in the booth binary | Accepted |
| [0008](0008-reasoning-variants-of-the-one-model.md) | Each agent picks a reasoning variant of the one model | Accepted |
| [0009](0009-a-faster-delivery-loop.md) | A faster delivery loop: lean review proving, a severity gate, parallel checks, a quicker OTA path | Accepted |
| [0010](0010-native-build-cache.md) | A native build cache keyed by the OTA fingerprint, shared by Expo and the device lanes | Accepted |
| [0011](0011-fewer-stopped-runs.md) | Fewer stopped runs: a spec check before ready, house defaults, assumptions instead of parking | Accepted |
| [0012](0012-allow-by-default-watchdog-dispatcher.md) | Allow by default with a short deny list, a watchdog per run, and a GitHub Actions dispatcher | Accepted (amended by 0016) |
| [0013](0013-booth-binary-bundles-native-capabilities.md) | The booth binary carries the native libraries booth features are likely to need | Accepted |
| [0014](0014-keep-the-models-reasoning-between-steps.md) | Keep the model's reasoning between steps | Accepted |
| [0015](0015-step-caps-and-no-implementer-device.md) | Hard step caps per agent; the implementer never leases a device; the dispatcher runs the newest main | Accepted |
| [0016](0016-factory-memory-run-records-and-retro.md) | Factory memory on a branch, a record of every run, and a retro agent | Accepted |
| [0017](0017-a-local-factory-console.md) | A local, read-mostly factory console | Accepted (amended by 0018) |
| [0018](0018-console-chats-with-intake-and-spec-agents.md) | The console chats with the intake and spec agents | Proposed |
| [0019](0019-no-global-skills-in-factory-runs.md) | Factory runs see only the repository's skills (`OPENCODE_TEST_HOME`) | Accepted |
