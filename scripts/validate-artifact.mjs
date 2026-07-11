import { access, readFile } from "node:fs/promises";
import { register } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const projectRoot = resolve(import.meta.dirname, "..");
const workerPath = resolve(projectRoot, "dist/server/index.js");
const hostingPath = resolve(projectRoot, "dist/.openai/hosting.json");

await access(workerPath);
await access(hostingPath);
JSON.parse(await readFile(hostingPath, "utf8"));

const workerUrl = pathToFileURL(workerPath);
workerUrl.searchParams.set("sites-validation", `${process.pid}-${Date.now()}`);
register("./cloudflare-loader.mjs", import.meta.url);
const worker = await import(workerUrl.href);
if (!worker.default || typeof worker.default.fetch !== "function") {
  throw new Error("dist/server/index.js 必须提供 default.fetch(request, env, ctx)");
}

console.log("Validated Sites artifact: Worker and hosting manifest are ready.");
