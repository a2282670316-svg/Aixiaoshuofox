import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const vinext = resolve(projectRoot, "node_modules/vinext/dist/cli.js");
const env = {
  ...process.env,
  WRANGLER_WRITE_LOGS: process.env.WRANGLER_WRITE_LOGS || "false",
  WRANGLER_LOG_PATH: process.env.WRANGLER_LOG_PATH || resolve(projectRoot, ".wrangler/logs"),
  MINIFLARE_REGISTRY_PATH: process.env.MINIFLARE_REGISTRY_PATH || resolve(projectRoot, ".wrangler/registry"),
};

const result = spawnSync(process.execPath, [vinext, "build"], {
  cwd: projectRoot,
  env,
  stdio: "inherit",
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);

await import("./validate-artifact.mjs");
