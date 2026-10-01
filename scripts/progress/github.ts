// Collects the GitHub facts of a report window into .frontlights/progress/facts.json (read-only on
// GitHub). Usage: node --experimental-strip-types scripts/progress/github.ts --from 2026-09-28 --to 2026-09-30
// The token is GITHUB_TOKEN from .env.local and is never printed; the logic lives in src/lib/progress/gh-cli.ts.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runGithubCli } from "../../src/lib/progress/gh-cli.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const envFile = join(root, ".env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);

process.exitCode = await runGithubCli(process.argv.slice(2), {
  env: process.env,
  now: () => new Date(),
  readText: (path) => {
    const file = resolve(root, path);
    return existsSync(file) ? readFileSync(file, "utf8") : null;
  },
  writeText: (path, text) => {
    const file = resolve(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text, "utf8");
  },
  log: (line) => console.log(line),
  error: (line) => console.error(line),
});
