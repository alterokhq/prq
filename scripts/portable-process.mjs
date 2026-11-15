import { spawn, spawnSync } from "node:child_process";

/** Bound the process tree, including browser children holding stdout open. */
export function boundedProcess(command, args, { cwd, env, timeout }) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let error = false;
    let escalation;
    const kill = (signal) => {
      if (!child.pid) return;
      if (process.platform === "win32") {
        spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
          stdio: "ignore",
          timeout: 5000,
        });
      } else {
        try {
          process.kill(-child.pid, signal);
        } catch {
          /* Already exited. */
        }
      }
    };
    const stop = () => {
      if (error) return;
      error = true;
      kill("SIGTERM");
      escalation = setTimeout(() => kill("SIGKILL"), 2000);
    };
    const timer = setTimeout(stop, timeout);
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      if (stdout.length + chunk.length > 64 * 1024 * 1024) stop();
      else stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      if (stderr.length + chunk.length > 1024 * 1024) stop();
      else stderr += chunk;
    });
    child.once("error", () => {
      error = true;
    });
    child.once("close", (status) => {
      clearTimeout(timer);
      clearTimeout(escalation);
      process.removeListener("SIGTERM", stop);
      process.removeListener("SIGINT", stop);
      resolve({ status, stdout, stderr, error });
    });
  });
}
