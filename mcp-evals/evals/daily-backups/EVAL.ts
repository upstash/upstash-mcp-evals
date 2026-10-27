import type { EvalFn } from "../../packages/core/src/cases.ts";
import { check, currentDb } from "../../packages/core/src/helpers.ts";
import { bypassKind } from "../../packages/core/src/transcript.ts";

const score: EvalFn = async (ctx) => {
  const db = await currentDb(ctx);
  // Only a change made through the MCP counts: a run that lifts the API key from the MCP config
  // and calls the Developer API or the CLI itself is going around the server under test.
  const bypass = ctx.transcript.calls.map(bypassKind).find((k) => k !== null) ?? null;
  return [
    check("daily backups enabled", db?.daily_backup_enabled === true, db ? String(db.daily_backup_enabled ?? false) : "database missing"),
    check("done through the MCP", bypass === null, bypass ?? "mcp only"),
  ];
};
export default score;
