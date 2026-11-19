import { spawn } from "child_process";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

export function assertLocalWindows(request: Request) {
  if (process.platform !== "win32") {
    throw new Error("Outlook opens automatically only when this portal is running on Windows.");
  }
  const host = (request.headers.get("host") ?? "").toLowerCase();
  const hostname = host.replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  if (hostname !== "localhost" && hostname !== "127.0.0.1" && hostname !== "::1") {
    throw new Error("Outlook opens automatically only from the portal on this computer.");
  }
}

/** Runs in STA so Outlook.Application can show a new message window. */
export function runPowerShellFile(script: string, args: string[] = []) {
  return new Promise<void>((resolve, reject) => {
    void (async () => {
      const directory = await mkdtemp(path.join(tmpdir(), "bi-portal-ps-"));
      const file = path.join(directory, "mail.ps1");
      await writeFile(file, script, "utf8");
      const child = spawn(
        "powershell.exe",
        ["-Sta", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", file, ...args],
        { windowsHide: true }
      );
      let stderr = "";
      let stdout = "";
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill();
        reject(new Error("Outlook did not open a new message within 75 seconds."));
      }, 75000);
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
        if (!settled && stdout.includes("displayed")) {
          settled = true;
          clearTimeout(timer);
          child.unref();
          resolve();
        }
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", (error) => {
        void rm(directory, { recursive: true, force: true });
        if (!settled) reject(error);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        void rm(directory, { recursive: true, force: true });
        if (settled) return;
        settled = true;
        if (code === 0) resolve();
        else reject(new Error(stderr.trim() || stdout.trim() || `PowerShell exited ${code}`));
      });
    })().catch(reject);
  });
}

export function runPowerShell(script: string, env: Record<string, string>) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-Sta", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", "-"],
      { windowsHide: true, env: { ...process.env, ...env } }
    );
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `PowerShell exited ${code}`));
    });
    child.stdin.write(script);
    child.stdin.end();
  });
}
