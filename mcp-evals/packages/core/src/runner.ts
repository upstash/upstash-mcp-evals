import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Agent, SetupStep } from "./agents/index.ts";
import { childEnv } from "./agents/util.ts";
import type { Case, Check, RunContext, Score, SetupResult } from "./cases.ts";
import { loadEval, loadSetup, renderPrompt } from "./cases.ts";
import type { Creds } from "./env.ts";
import { BASELINE_DIR, RESULTS_DIR, UPSTASH_BIN } from "./paths.ts";
import { run } from "./proc.ts";
import { makeRedactor } from "./redact.ts";
import { bypassKind, type Transcript } from "./transcript.ts";
import { deleteResource, isOurs, listResources, loadOtherBaseline, missingFromBaseline } from "./products.ts";
import { isMcpevalName, type RedisDb, UpstashCli } from "./upstash.ts";

export type Access = "mcp" | "upstash-cli" | "raw-api" | "mixed" | "none";

export type RunResult = {
  readonly phase: string;
  readonly caseId: string;
  readonly agent: string;
  readonly model: string;
  readonly run: number;
  readonly dbName: string;
  readonly startedAt: string;
  readonly durationMs: number;
  readonly exitCode: number;
  readonly timedOut: boolean;
  readonly agentError: string | null;
  readonly score: Score;
  readonly access: Access;
  readonly mcpTools: readonly string[];
  readonly mcpErrors: number;
  readonly finalText: string;
  readonly setupSteps: readonly SetupStep[];
  /** Databases this run created that are not `mcpeval-*`. Left in place and reported. */
  readonly strays: readonly string[];
  readonly harnessError: string | null;
};

export class GuardError extends Error {}

/**
 * ERROR when the run itself broke (harness failure, agent crash, timeout), so a broken run can
 * never count as a pass. Otherwise the scorer decides.
 */
export function verdict(r: Pick<RunResult, "harnessError" | "agentError" | "timedOut" | "exitCode" | "score">): "PASS" | "FAIL" | "n/a" | "ERROR" {
  if (r.harnessError || r.agentError || r.timedOut || r.exitCode !== 0) return "ERROR";
  if (r.score.kind === "na") return "n/a";
  return r.score.pass ? "PASS" : "FAIL";
}

/** Settings that should never change on a database the harness didn't create. */
const FINGERPRINT_KEYS = ["state", "database_type", "eviction", "read_regions", "budget"] as const;
type BaselineEntry = Pick<RedisDb, "database_id" | "database_name"> & Partial<Pick<RedisDb, (typeof FINGERPRINT_KEYS)[number]>>;
export type Baseline = BaselineEntry[];

export function loadBaseline(): Baseline {
  const file = join(BASELINE_DIR, "redis.json");
  if (!existsSync(file)) throw new GuardError(`No baseline at ${file}. Run \`bun run manual --baseline\` first.`);
  return JSON.parse(readFileSync(file, "utf8"));
}

export function baselineEntry(db: RedisDb): BaselineEntry {
  const { database_id, database_name, state, database_type, eviction, read_regions, budget } = db;
  return { database_id, database_name, state, database_type, eviction, read_regions: read_regions ?? null, budget: budget ?? null };
}

const norm = (v: unknown) => JSON.stringify(Array.isArray(v) ? [...v].sort() : (v ?? null));

/**
 * Stops everything if a database that existed before the harness started is gone or has
 * different settings. Only fields recorded in the baseline are compared.
 */
export async function assertBaselineIntact(upstash: UpstashCli, baseline: Baseline): Promise<RedisDb[]> {
  const now = await upstash.listRedis();
  const problems: string[] = [];
  for (const b of baseline) {
    const cur = now.find((d) => d.database_id === b.database_id);
    if (!cur) {
      problems.push(`${b.database_name} MISSING`);
      continue;
    }
    for (const k of FINGERPRINT_KEYS) {
      if (k in b && norm(b[k]) !== norm(cur[k])) problems.push(`${b.database_name}.${k} ${norm(b[k])} -> ${norm(cur[k])}`);
    }
  }
  if (problems.length) throw new GuardError(`BASELINE DATABASE CHANGED: ${problems.join("; ")}. Stopping all runs.`);
  return now;
}

function accessOf(t: Transcript): Access {
  const kinds = new Set<Access>();
  if (t.calls.some((c) => c.via === "mcp")) kinds.add("mcp");
  for (const c of t.calls) {
    const k = bypassKind(c);
    if (k) kinds.add(k);
  }
  if (kinds.size === 0) return "none";
  if (kinds.size > 1) return "mixed";
  const [only] = kinds;
  return only ?? "none";
}

/** Everything an asciinema v3 cast printed to the screen, joined. */
function castOutput(cast: string): string {
  return cast
    .split("\n")
    .slice(1)
    .flatMap((line) => {
      try {
        const ev: unknown = JSON.parse(line);
        return Array.isArray(ev) && ev[1] === "o" && typeof ev[2] === "string" ? [ev[2]] : [];
      } catch {
        return [];
      }
    })
    .join("");
}

/** Single-quotes a string for sh. */
const shq = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;

function shortId(): string {
  return Math.random().toString(36).slice(2, 8);
}

export function runDir(r: Pick<RunResult, "phase" | "agent" | "model" | "caseId" | "run">): string {
  return join(RESULTS_DIR, r.phase, `${r.agent}@${r.model.replaceAll("/", "_")}`, r.caseId, `run-${r.run}`);
}

/** Runs one case on one agent end to end: workspace, setup, agent, score, cleanup, guard. */
export async function runOne(opts: {
  phase: string;
  agent: Agent;
  model: string;
  testCase: Case;
  run: number;
  creds: Creds;
  baseline: Baseline;
  log: (msg: string) => void;
  /** Record the agent live in a terminal (asciinema .cast) instead of capturing its JSON stream. */
  recordCast?: string;
}): Promise<RunResult> {
  const { agent, model, testCase, creds } = opts;
  const otherBaseline = loadOtherBaseline();
  const upstash = new UpstashCli(creds);
  const redact = makeRedactor(creds, () => [...upstash.seenSecrets]);
  const tag = shortId();
  const dbName = `mcpeval-${testCase.id}-${tag}`;
  if (!isMcpevalName(dbName)) throw new Error("unreachable: db name prefix");
  const tmp = mkdtempSync(join(tmpdir(), "mcpeval-run-"));
  const paths = { workspace: join(tmp, "ws"), home: join(tmp, "home"), outDir: join(tmp, "out") };
  for (const p of Object.values(paths)) mkdirSync(p, { recursive: true });
  const out = runDir({ phase: opts.phase, agent: agent.id, model, caseId: testCase.id, run: opts.run });
  mkdirSync(out, { recursive: true });
  const write = (name: string, text: string) => writeFileSync(join(out, name), redact(text));

  const ctx: RunContext = { upstash, workspace: paths.workspace, dbName };
  const started = Date.now();
  let state: SetupResult = { db: null };
  let setupSteps: SetupStep[] = [];
  let proc = { exitCode: -1, stdout: "", stderr: "", timedOut: false, durationMs: 0 };
  let transcript: Transcript = { calls: [], finalText: "", agentError: null };
  let score: Score = { kind: "na", reason: "no scorer" };
  let harnessError: string | null = null;
  let strays: string[] = [];
  let cleanupError: string | null = null;
  let guardError: GuardError | null = null;

  try {
    if (testCase.fixtureDir) cpSync(testCase.fixtureDir, paths.workspace, { recursive: true });
    await run({ cmd: ["git", "init", "-q"], cwd: paths.workspace, timeoutMs: 10_000 });

    if (agent.upstashSetupFlag) {
      const setup = await run({
        cmd: [UPSTASH_BIN, "setup", agent.upstashSetupFlag, "--project", "--mode", "mcp", "-y", "--json"],
        cwd: paths.workspace,
        env: childEnv(paths.home, {}),
        timeoutMs: 120_000,
      });
      write("upstash-setup.json", setup.stdout || setup.stderr);
      if (setup.exitCode !== 0) throw new Error(`upstash setup ${agent.upstashSetupFlag} failed: ${setup.stderr.slice(0, 200)}`);
      setupSteps.push({ by: "upstash-setup", what: `upstash setup ${agent.upstashSetupFlag} --project --mode mcp -y` });
    }
    setupSteps = [...setupSteps, ...(await agent.configure({ paths, creds }))];

    const setupFn = await loadSetup(testCase);
    if (setupFn) state = await setupFn(ctx);

    const prompt = renderPrompt(testCase, dbName);
    write("prompt.md", prompt);
    opts.log(`▶ ${agent.id}@${model} ${testCase.id} #${opts.run} (${dbName})`);
    if (opts.recordCast) {
      if (!agent.liveCommand) throw new Error(`${agent.id} has no human-readable mode to record`);
      const live = agent.liveCommand({ paths, prompt, model });
      const shown = `${agent.bin.split("/").pop()} ${JSON.stringify(prompt)}`;
      const script = `printf '\\033[2m$ %s\\033[0m\\n\\n' ${shq(shown)}; ${live.cmd.map(shq).join(" ")} < /dev/null`;
      proc = await run({
        cmd: ["asciinema", "rec", "--overwrite", "--quiet", "--headless", "--window-size", "110x34", "-c", script, opts.recordCast],
        cwd: paths.workspace,
        env: live.env,
        timeoutMs: testCase.timeoutSec * 1000,
      });
      transcript = { calls: [], finalText: readFileSync(opts.recordCast, "utf8"), agentError: null };
    } else {
      const cmd = agent.command({ paths, prompt, model });
      proc = await run({ cmd: cmd.cmd, cwd: paths.workspace, env: cmd.env, timeoutMs: testCase.timeoutSec * 1000 });
      transcript = agent.parse({ stdout: proc.stdout, outDir: paths.outDir });
    }

    const evalFn = await loadEval(testCase);
    if (opts.recordCast) {
      score = { kind: "na", reason: "live recording: no structured transcript, so transcript-based checks can't run" };
    } else if (evalFn) {
      const checks: Check[] = await evalFn({ ...ctx, state, transcript });
      score = { kind: "scored", pass: checks.every((c) => c.ok), checks };
    }
  } catch (e) {
    harnessError = e instanceof Error ? e.message : String(e);
  } finally {
    // Cleanup never depends on the guard: delete this run's DBs first, then check the baseline.
    try {
      const mine = (await upstash.listRedis()).filter((d) => d.database_name.includes(`-${tag}`) && isMcpevalName(d.database_name));
      for (const db of mine) {
        await upstash.getRedis(db.database_id).catch(() => undefined); // registers its secrets with the redactor
        await upstash.deleteRedis(db);
      }
      for (const r of (await listResources(upstash)).filter((x) => x.name.includes(`-${tag}`) && isOurs(x))) {
        await deleteResource(upstash, r);
      }
    } catch (e) {
      cleanupError = `cleanup failed, run \`bun run cleanup\`: ${e instanceof Error ? e.message : String(e)}`;
    }
    try {
      const now = await assertBaselineIntact(upstash, opts.baseline);
      const known = new Set(opts.baseline.map((b) => b.database_id));
      strays = now.filter((d) => !known.has(d.database_id) && !isMcpevalName(d.database_name)).map((d) => `${d.database_name} (${d.database_id})`);
      const others = await listResources(upstash);
      const gone = missingFromBaseline(otherBaseline, others);
      if (gone.length) throw new GuardError(`BASELINE RESOURCE MISSING: ${gone.map((g) => `${g.kind} ${g.name}`).join(", ")}. Stopping all runs.`);
      const knownOther = new Set(otherBaseline.map((b) => b.id));
      strays.push(...others.filter((r) => !knownOther.has(r.id) && !isOurs(r)).map((r) => `${r.kind} ${r.name} (${r.id})`));
    } catch (e) {
      if (e instanceof GuardError) guardError = e;
      else cleanupError ??= `baseline check failed: ${e instanceof Error ? e.message : String(e)}`;
    }
    // Persist whatever we have, even when the guard tripped.
    if (opts.recordCast && existsSync(opts.recordCast)) {
      // A secret split across terminal events would slip past line-by-line redaction, so check the
      // reconstructed screen output as one string and throw the recording away if anything shows.
      const raw = readFileSync(opts.recordCast, "utf8");
      if (redact(castOutput(raw)) !== castOutput(raw)) {
        rmSync(opts.recordCast, { force: true });
        harnessError ??= "recording showed a credential and was discarded";
      } else {
        writeFileSync(opts.recordCast, redact(raw));
      }
    }
    write("stdout.jsonl", proc.stdout);
    write("stderr.txt", proc.stderr.slice(-20_000));
    write("transcript.json", JSON.stringify(transcript, null, 2));
    for (const f of existsSync(paths.outDir) ? readdirSync(paths.outDir) : []) write(f, readFileSync(join(paths.outDir, f), "utf8"));
    if (existsSync(join(paths.workspace, ".env"))) write("workspace.env", readFileSync(join(paths.workspace, ".env"), "utf8"));
  }
  harnessError ??= guardError?.message ?? cleanupError;
  rmSync(tmp, { recursive: true, force: true }); // the workspace holds the MCP config with the account's Basic auth header

  const result: RunResult = {
    phase: opts.phase,
    caseId: testCase.id,
    agent: agent.id,
    model,
    run: opts.run,
    dbName,
    startedAt: new Date(started).toISOString(),
    durationMs: Date.now() - started,
    exitCode: proc.exitCode,
    timedOut: proc.timedOut,
    agentError: transcript.agentError,
    score,
    access: accessOf(transcript),
    mcpTools: transcript.calls.filter((c) => c.via === "mcp").map((c) => c.name),
    mcpErrors: transcript.calls.filter((c) => c.via === "mcp" && c.isError).length,
    finalText: transcript.finalText,
    setupSteps,
    strays,
    harnessError,
  };
  write("result.json", JSON.stringify(result, null, 2));
  if (guardError) throw guardError; // after result.json, so the run that tripped the guard is on record
  opts.log(`■ ${agent.id}@${model} ${testCase.id} #${opts.run}: ${verdict(result)} via ${result.access} in ${Math.round(result.durationMs / 1000)}s${harnessError ? ` [harness: ${harnessError}]` : ""}${strays.length ? ` [STRAY: ${strays.join(", ")}]` : ""}`);
  return result;
}
