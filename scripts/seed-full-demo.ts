import { spawnSync } from "child_process";

// Backward-compatible entrypoint for older docs/commands.
// Runs the SQLite full demo seeder.
const extraArgs = process.argv.slice(2);
const hasMode = extraArgs.includes("--mode");
const args = [
  "scripts/seed-sqlite-demo.mjs",
  ...(hasMode ? [] : ["--mode", "full"]),
  ...extraArgs,
];

const res = spawnSync(process.execPath, args, { stdio: "inherit" });
if (typeof res.status === "number") {
  process.exit(res.status);
}
process.exit(1);
