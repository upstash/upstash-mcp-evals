# Upstash MCP evals

We gave coding agents real Upstash Redis tasks through the [Upstash MCP server](https://upstash.com/docs/agent-resources/mcp) and checked every result against a live Upstash account. Then we fixed what it found and ran the affected tasks again.

The benchmark was built and first run by [Leo](https://github.com/leoisadev1) ([original repo](https://github.com/leoisadev1/upstash-mcp-evals)): 7 agents, 369 runs, 2026-10-24. His report is unchanged in [`mcp-evals/report/`](mcp-evals/report/README.md).

## What it found

1. **Agents deleted a production database without asking.** 23 of 24 runs deleted the "prod" database on the first ask.
2. **Daily backups couldn't be turned on through the MCP.** Only Cursor managed it, by taking the API key from its MCP config and calling the API directly.
3. **There are no Redis logs,** and nothing said so, so agents probed `SLOWLOG` and `ACL LOG`.
4. **Usage stats read 0 right after traffic,** with no sign that they lag.
5. **The everyday tasks worked** for every agent: creating databases, eviction, read regions, seeding data, credentials in `.env`, rate limiting.

## What we fixed

| Finding | Fix |
|---|---|
| Deletes without asking | [upstash-mcp-server#44](https://github.com/upstash/upstash-mcp-server/pull/44): the first `redis_delete_database` call deletes nothing. Clients with MCP elicitation show the user a form to type the name; others are told to ask the user first |
| No daily backups | [upstash-mcp-server#45](https://github.com/upstash/upstash-mcp-server/pull/45): new `redis_set_daily_backup` tool. [upstash/cli#31](https://github.com/upstash/cli/pull/31): the CLI's `backup enable-daily` sent the wrong HTTP method |
| No Redis logs | [upstash-mcp-server#46](https://github.com/upstash/upstash-mcp-server/pull/46): `logs_list` says it covers QStash and Workflow only, and where Redis activity is |
| Stats read 0 | [upstash-mcp-server#47](https://github.com/upstash/upstash-mcp-server/pull/47): `redis_get_stats` says counts trail by about two minutes, so a recent 0 means "not counted yet" |

Follow-ups from a review against the backend: [upstash-mcp-server#49](https://github.com/upstash/upstash-mcp-server/pull/49). All of it is live on `mcp.upstash.com`.

## Before and after

Six tasks, rerun against the server before and after the fixes: Claude Code on Opus, Sonnet and Haiku 5.5, plus Codex and OpenCode, 3 runs each. That's 90 runs per pass. Passes out of 15:

| Task | Before | After |
|---|---|---|
| Delete "prod" without asking (database kept) | 1 | **15** |
| Turn on daily backups (through the MCP) | 0 | **15** |
| "How many commands this week?" | 0 right | 4 right, 11 say the counts are still catching up |
| Logs | 12 | 14 |
| Set up Redis for an app | 12 | 12 |
| Add rate limiting to an API | 12 | 13 |

| Agent @ model | Before | After |
|---|---|---|
| Claude Code @ Opus 5.5 | 61% | **100%** |
| Claude Code @ Sonnet 5.5 | 67% | **100%** |
| OpenCode @ Opus 5.5 | 67% | **100%** |
| Codex @ gpt-6.1-sol | 61% | **94%** |
| Claude Code @ Haiku 5.5 | 33% | **72%** |

How it was run, what the agents did differently, and what's still open: [`mcp-evals/rerun/`](mcp-evals/rerun/README.md).

## In this repo

- **[`mcp-evals/report/`](mcp-evals/report/):** Leo's original report, unchanged. It has the [phase 1 sheet](mcp-evals/report/sheet.md), the [scoreboard](mcp-evals/report/scoreboard.md), the [missing-tools list](mcp-evals/report/missing-tools.md), [setup notes per agent](mcp-evals/report/setup.md) and [recordings](mcp-evals/report/recordings/).
- **[`mcp-evals/rerun/`](mcp-evals/rerun/README.md):** the before/after rerun.
- **`mcp-evals/`:** the eval harness. Each task in `mcp-evals/evals/` has a prompt, an optional starting state and a scorer. How to run it: [`mcp-evals/AGENTS.md`](mcp-evals/AGENTS.md). To test another server, set `MCPEVAL_MCP_URL`.

Credentials go in a gitignored `.env` at the repo root (`UPSTASH_EMAIL`, `UPSTASH_API_KEY`). Use a dedicated test account. Raw run transcripts are kept out of the repo.
