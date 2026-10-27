import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

/** `mcp-evals/` */
export const ROOT = resolve(here, "../../..");
/** Repo root that holds the gitignored `.env`. */
export const REPO_ROOT = resolve(ROOT, "..");
/** Overridable so a git worktree can point at the main checkout's gitignored .env and baseline. */
export const ENV_FILE = process.env.MCPEVAL_ENV_FILE ?? join(REPO_ROOT, ".env");
export const EVALS_DIR = join(ROOT, "evals");
export const RESULTS_DIR = join(ROOT, "results");
export const REPORT_DIR = join(ROOT, "report");
export const BASELINE_DIR = process.env.MCPEVAL_BASELINE_DIR ?? join(RESULTS_DIR, "baseline");
export const UPSTASH_BIN = join(ROOT, "packages/core/node_modules/.bin/upstash");
export const PRODUCTION_MCP_URL = "https://mcp.upstash.com/mcp";
/** Overridable to run the evals against another server, e.g. a local build of unmerged changes. */
export const MCP_URL = process.env.MCPEVAL_MCP_URL ?? PRODUCTION_MCP_URL;
/** Every resource the harness creates or may delete starts with this. */
export const RESOURCE_PREFIX = "mcpeval-";
