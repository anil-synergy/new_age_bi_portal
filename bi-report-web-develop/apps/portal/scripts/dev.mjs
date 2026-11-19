/**
 * Starts `next dev` after removing `.next`.
 * OneDrive turns files in `.next` into cloud placeholders. Next's own cleanup
 * then calls readlink on them and fails with `EINVAL: invalid argument, readlink`.
 * The dev webpack cache is in memory (next.config.mjs), so nothing is lost.
 */
import { spawn } from "child_process";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { cleanPortalCache } from "./clean-cache.mjs";
import { ensureSmartAgentsRunning, stopSmartAgents } from "./smart-agents.mjs";

const portalRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
cleanPortalCache(portalRoot);

const agentChildren = await ensureSmartAgentsRunning();
const shutdownAgents = () => stopSmartAgents(agentChildren);
process.on("exit", shutdownAgents);
process.on("SIGINT", () => {
  shutdownAgents();
  process.exit(130);
});
process.on("SIGTERM", () => {
  shutdownAgents();
  process.exit(143);
});

const nextBin = join(portalRoot, "node_modules", "next", "dist", "bin", "next");
// Turbopack writes its manifests into .next while OneDrive syncs that folder, and fails with
// "UNKNOWN: unknown error, open '...\.next\server\server-reference-manifest.js'". Always use webpack here.
const requested = process.argv.slice(2);
const forbidden = requested.filter((arg) => arg === "--turbo" || arg === "--turbopack");
if (forbidden.length) {
  console.warn("[dev] Ignoring " + forbidden.join(", ") + ": Turbopack is disabled for this project (OneDrive). Using webpack.");
}
const nextArgs = requested.filter((arg) => !forbidden.includes(arg));
const child = spawn(process.execPath, [nextBin, "dev", ...nextArgs], {
  cwd: portalRoot,
  stdio: "inherit",
});
child.on("exit", (code) => {
  shutdownAgents();
  process.exit(code ?? 0);
});
