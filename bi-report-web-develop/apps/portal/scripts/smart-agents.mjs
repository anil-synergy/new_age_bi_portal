/**
 * Start the unified SMART stack (:8100 — orchestrator + SemantIQ + N.O.V.A. MCP mounts).
 * Skipped when SMART_AUTO_START_AGENTS=false or orchestrator already responds on 8100.
 *
 * Ensures a Python venv exists and runs `pip install -e .` (pythonnet, msal, etc.) before each start.
 */
import { spawn } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const portalRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const agentsRoot = join(portalRoot, "src", "modules", "smart-chatbot", "agents");

/** Preferred venv when SMART_PYTHON is unset (matches start_local.ps1). */
export function defaultVenvPython() {
  if (process.platform === "win32") {
    return join(process.env.USERPROFILE || "", ".venvs", "smart-agents", "Scripts", "python.exe");
  }
  return join(process.env.HOME || "", ".venvs", "smart-agents", "bin", "python");
}

function resolvePythonCandidates() {
  const fromEnv = process.env.SMART_PYTHON?.trim();
  const list = [];
  if (fromEnv) list.push(fromEnv);
  list.push(defaultVenvPython());
  list.push(join(agentsRoot, ".venv", "Scripts", "python.exe"));
  list.push(join(agentsRoot, ".venv", "bin", "python"));
  return list;
}

function resolvePython() {
  for (const candidate of resolvePythonCandidates()) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return process.platform === "win32" ? "python" : "python3";
}

function spawnCapture(py, args, cwd) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(py, args, { cwd, stdio: ["ignore", "pipe", "pipe"], shell: false });
    let out = "";
    let err = "";
    child.stdout?.on("data", (c) => {
      out += c;
    });
    child.stderr?.on("data", (c) => {
      err += c;
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolvePromise({ out, err });
      else reject(new Error(`${args.join(" ")} exited ${code}: ${err || out}`.trim()));
    });
  });
}

function run(py, args, cwd) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(py, args, { cwd, stdio: "inherit", shell: false });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolvePromise() : reject(new Error(`${args.join(" ")} exited ${code}`))));
  });
}

/** Create ~/.venvs/smart-agents (or agents/.venv) when no venv python exists yet. */
async function ensurePythonVenv() {
  for (const candidate of resolvePythonCandidates()) {
    if (candidate && existsSync(candidate)) return candidate;
  }

  const target = defaultVenvPython();
  const venvDir = dirname(dirname(target));
  process.stderr.write(`[SMART] Creating Python venv at ${venvDir}\n`);
  mkdirSync(dirname(venvDir), { recursive: true });

  const launcher = process.platform === "win32" ? "py" : "python3";
  const launcherArgs =
    process.platform === "win32" ? ["-3.11", "-m", "venv", venvDir] : ["-m", "venv", venvDir];

  try {
    await run(launcher, launcherArgs, agentsRoot);
  } catch {
    await run(process.platform === "win32" ? "python" : "python3", ["-m", "venv", venvDir], agentsRoot);
  }

  if (!existsSync(target)) {
    throw new Error(`Venv was created but python not found at ${target}`);
  }
  return target;
}

/** Install editable package + dependencies (pythonnet, msal, …) from pyproject.toml. */
async function syncAgentDependencies(py) {
  process.stderr.write("[SMART] Syncing agent dependencies (pip install -e .)…\n");
  try {
    await run(py, ["-m", "pip", "install", "-q", "-U", "pip"], agentsRoot);
  } catch {
    /* pip upgrade is best-effort */
  }
  await run(py, ["-m", "pip", "install", "-q", "-e", "."], agentsRoot);
  try {
    await spawnCapture(py, ["-c", "import clr; import pythonnet"], agentsRoot);
    process.stderr.write("[SMART] pythonnet OK (XMLA / ADOMD).\n");
  } catch (error) {
    process.stderr.write(`[SMART] Warning: pythonnet check failed after install: ${error.message}\n`);
  }
}

async function orchestratorUp() {
  try {
    const response = await fetch("http://127.0.0.1:8100/health", { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
}

function startUnifiedStack(py) {
  const child = spawn(py, ["-m", "smart_orchestrator.app"], {
    cwd: agentsRoot,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
  });
  child.stdout?.on("data", (chunk) => process.stderr.write(`[SMART:orchestrator] ${chunk}`));
  child.stderr?.on("data", (chunk) => process.stderr.write(`[SMART:orchestrator] ${chunk}`));
  child.on("exit", (code, signal) => {
    if (code !== 0 && code !== null) {
      process.stderr.write(`[SMART:orchestrator] process exited (${code}${signal ? ` ${signal}` : ""})\n`);
    }
  });
  return child;
}

async function waitReady(maxMs = 45000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch("http://127.0.0.1:8100/health/ready", { signal: AbortSignal.timeout(4000) });
      if (response.ok) {
        const body = await response.json();
        if (body.status === "ready") return true;
      }
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

/** @returns {import("child_process").ChildProcess[]} */
export async function ensureSmartAgentsRunning() {
  if (process.env.SMART_AUTO_START_AGENTS === "false") {
    return [];
  }

  let py;
  try {
    py = await ensurePythonVenv();
    await syncAgentDependencies(py);
  } catch (error) {
    process.stderr.write(`[SMART] Python environment setup failed: ${error.message}\n`);
    process.stderr.write(
      "[SMART] Set SMART_PYTHON to a venv python, or install Python 3.11+ and retry npm run dev.\n"
    );
    return [];
  }

  if (await orchestratorUp()) {
    process.stderr.write("[SMART] Orchestrator already running on :8100 (dependencies were synced).\n");
    process.stderr.write("[SMART] Restart the :8100 process if you changed Python code or added packages.\n");
    return [];
  }

  process.stderr.write(`[SMART] Starting unified stack on :8100 with ${py}\n`);

  const bootstrap = join(agentsRoot, "scripts", "bootstrap_local_env.py");
  if (existsSync(bootstrap)) {
    try {
      await run(py, [bootstrap], agentsRoot);
    } catch (error) {
      process.stderr.write(`[SMART] bootstrap_local_env.py failed: ${error.message}\n`);
      process.stderr.write("[SMART] Fix apps/portal/.env.local (SMART_ORCHESTRATOR_*, SMART_PBI_*) then retry.\n");
    }
  }

  const child = startUnifiedStack(py);
  const children = [child];

  const ready = await waitReady();
  if (ready) {
    process.stderr.write("[SMART] Unified stack ready on :8100 (SemantIQ + N.O.V.A. mounted).\n");
  } else {
    process.stderr.write(
      "[SMART] Stack started but /health/ready is not ready yet. Check LLM key, SMART_PBI_* credentials, and MCP secrets.\n"
    );
  }
  return children;
}

export function stopSmartAgents(children) {
  for (const child of children) {
    try {
      if (process.platform === "win32") {
        spawn("taskkill", ["/pid", String(child.pid), "/f", "/t"], { stdio: "ignore" });
      } else {
        child.kill("SIGTERM");
      }
    } catch {
      /* ignore */
    }
  }
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const children = await ensureSmartAgentsRunning();
  process.stderr.write("[SMART] Unified stack running on :8100. Press Ctrl+C to stop.\n");
  process.on("SIGINT", () => {
    stopSmartAgents(children);
    process.exit(0);
  });
  await new Promise(() => {});
}
