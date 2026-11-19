/**
 * Deletes the Next output and caches before dev or build.
 * OneDrive turns files in `.next` into cloud placeholders. Next then calls
 * readlink on them and fails with `EINVAL: invalid argument, readlink`.
 */
import { spawnSync } from "child_process";
import { chmodSync, existsSync, lstatSync, rmdirSync, rmSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

export function cleanPortalCache(portalRoot) {
  const targets = [join(portalRoot, ".next"), join(portalRoot, "node_modules", ".cache")];
  for (const target of targets) removeDir(target);
}

function removeDir(target) {
  let stat;
  try {
    stat = lstatSync(target);
  } catch {
    return;
  }

  if (stat.isSymbolicLink()) {
    chmodSync(target, 0o777);
    rmdirSync(target);
    return;
  }

  try {
    rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  } catch {
    // Fallback below handles placeholders Node cannot unlink.
  }
  if (existsSync(target) && process.platform === "win32") {
    // cmd re-parses /c, so the path must be one quoted string or spaces split it.
    spawnSync("cmd.exe", ["/d", "/s", "/c", `rmdir /s /q "${target}"`], { stdio: "ignore" });
  }
  if (existsSync(target)) {
    console.error(`Could not delete ${target}. Stop other Next servers and delete it manually.`);
    process.exit(1);
  }
  console.log(`Cleared ${target}`);
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  cleanPortalCache(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
}
