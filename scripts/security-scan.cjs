// Are any server secrets in the client bundle or in git history? Prints locations/counts, never the values.
const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");
const REPO = path.resolve(__dirname, "..");
process.loadEnvFile(path.join(REPO, ".env.local"));

const SECRETS = {
  SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
  GITHUB_TOKEN: process.env.GITHUB_TOKEN,
  CRON_SECRET: process.env.CRON_SECRET,
  FRONTLIGHTS_API_SECRET: process.env.FRONTLIGHTS_API_SECRET,
};
for (const [k, v] of Object.entries(SECRETS)) if (!v || v.length < 12) console.log(`(note) ${k} is empty or short here; skipping its exact-match scan`);

function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) walk(p, out);
    else if (/\.(js|css|html|json|map|txt)$/.test(f.name)) out.push(p);
  }
  return out;
}

// ---- 1. the client bundle (what any visitor downloads)
const files = [...walk(`${REPO}/.next/static`), ...walk(`${REPO}/public`)];
const generic = [/ghp_[A-Za-z0-9]{20,}/, /github_pat_[A-Za-z0-9_]{20,}/, /sb_secret_[A-Za-z0-9_-]{10,}/, /service_role/i];
let hits = 0;
for (const f of files) {
  const text = fs.readFileSync(f, "utf8");
  for (const [name, value] of Object.entries(SECRETS)) {
    if (value && value.length >= 12 && text.includes(value)) { hits++; console.log(`LEAK  ${name} found in ${path.relative(REPO, f)}`); }
  }
  for (const re of generic) if (re.test(text)) { hits++; console.log(`LEAK? pattern ${re} in ${path.relative(REPO, f)}`); }
}
console.log(`client bundle: scanned ${files.length} files, ${hits} hit(s)`);

// ---- 2. the server build output must hold them only as env lookups, never inlined
const serverFiles = walk(`${REPO}/.next/server`).filter((f) => !f.endsWith(".map"));
let serverHits = 0;
for (const f of serverFiles) {
  const text = fs.readFileSync(f, "utf8");
  for (const [name, value] of Object.entries(SECRETS)) if (value && value.length >= 12 && text.includes(value)) { serverHits++; console.log(`INLINED ${name} in ${path.relative(REPO, f)}`); }
}
console.log(`server build: scanned ${serverFiles.length} files, ${serverHits} inlined secret(s)`);

// ---- 3. git history (every commit): the values themselves, and common secret shapes
function git(cmd) { return execSync(`git -C ${REPO} ${cmd}`, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }); }
let histHits = 0;
for (const [name, value] of Object.entries(SECRETS)) {
  if (!value || value.length < 12) continue;
  const out = git(`log --all --oneline -S${JSON.stringify(value)}`).trim();
  if (out) { histHits++; console.log(`HISTORY ${name} appears in commits:\n${out}`); }
}
for (const pattern of ["ghp_", "github_pat_", "sb_secret_", "service_role"]) {
  const out = git(`log --all --oneline -S${pattern}`).trim();
  if (out) { histHits++; console.log(`HISTORY pattern "${pattern}" touched in:\n${out.split("\n").slice(0, 6).join("\n")}`); }
}
const tracked = git("ls-files").split("\n").filter((f) => /(^|\/)\.env/.test(f));
console.log(`git history: ${histHits} hit(s); tracked .env files: ${tracked.length ? tracked.join(", ") : "none"}`);
