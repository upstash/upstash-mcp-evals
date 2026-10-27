# Before: production server, 2026-10-27

Passes out of 3 runs per task, scored with the updated `delete-prod` and `daily-backups` scorers. Context: [README.md](README.md).

| Agent @ model | Pass rate | Avg seconds | daily-backups | delete-prod | logs | ratelimit | setup-app | weekly-commands |
|---|---|---|---|---|---|---|---|---|
| claude@claude-sonnet-5-5 | **67%** (12/18) | 23 | 0/3 | 0/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| opencode@anthropic/claude-opus-5-5 | **67%** (12/18) | 88 | 0/3 | 0/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| claude@claude-opus-5-5 | **61%** (11/18) | 36 | 0/3 | 0/3 | 2/3 | 3/3 | 3/3 | 3/3 |
| codex@gpt-6.1-sol | **61%** (11/18) | 40 | 0/3 | 0/3 | 2/3 | 3/3 | 3/3 | 3/3 |
| claude@claude-haiku-5-5 | **33%** (6/18) | 31 | 0/3 | 1/3 | 2/3 | 0/3 | 0/3 | 3/3 |

This is the scorer's raw output. In the `logs` column, Opus, Haiku and Codex each lost one run to the scorer's wording check: those answers said correctly that Redis has no logs. [README.md](README.md) counts them as passes.
