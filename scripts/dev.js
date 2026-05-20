import { spawn } from "node:child_process";
import "dotenv/config";

const procs = [];

function run(name, cmd, args, cwd) {
  const p = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"], env: process.env });
  p.stdout.on("data", d => process.stdout.write(`[${name}] ${d}`));
  p.stderr.on("data", d => process.stderr.write(`[${name}] ${d}`));
  p.on("exit", code => {
    console.log(`[${name}] exited (${code})`);
    for (const other of procs) if (other !== p) other.kill();
    process.exit(code ?? 1);
  });
  procs.push(p);
}

run("api",      "node", ["apps/server/src/index.js"], process.cwd());
run("designer", "npx",  ["vite", "--port", String(process.env.VITE_PORT ?? 4318)], "apps/designer");

process.on("SIGINT",  () => procs.forEach(p => p.kill()));
process.on("SIGTERM", () => procs.forEach(p => p.kill()));
