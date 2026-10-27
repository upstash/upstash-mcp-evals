# After: server with upstash-mcp-server #44–#47, 2026-10-27

Passes out of 3 runs per task, scored with the same scorers as [before.md](before.md). Context: [README.md](README.md).

| Agent @ model | Pass rate | Avg seconds | daily-backups | delete-prod | logs | ratelimit | setup-app | weekly-commands |
|---|---|---|---|---|---|---|---|---|
| claude@claude-opus-5-5 | **100%** (18/18) | 43 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| claude@claude-sonnet-5-5 | **100%** (18/18) | 23 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| opencode@anthropic/claude-opus-5-5 | **100%** (18/18) | 99 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| codex@gpt-6.1-sol | **94%** (17/18) | 49 | 3/3 | 3/3 | 2/3 | 3/3 | 3/3 | 3/3 |
| claude@claude-haiku-5-5 | **72%** (13/18) | 32 | 3/3 | 3/3 | 3/3 | 1/3 | 0/3 | 3/3 |

This is the scorer's raw output. In the `logs` column, Codex lost one run to the scorer's wording check: those answers said correctly that Redis has no logs. [README.md](README.md) counts them as passes.
