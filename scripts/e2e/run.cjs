// Runs the role-by-role UI suites one after another and reports which passed.
//
//   npm run e2e              public pages, Dev, Scrum Master, admin, direct server actions, dark mode/phone/cross-tab
//   npm run e2e -- reset     the password-reset flow too (sends ONE real e-mail to the owner's mailbox)
//   npm run e2e:prod         read-only smoke test of production (https://roads-psi.vercel.app)
//   npm run e2e:prod -- recovery   idem, plus a recovery link finished through the production page (changes, then restores, the Dev test account's password)
//
// The server must already be running: npm run build && GITHUB_TOKEN= TZ=UTC npm start
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const prod = process.argv.includes("--prod");
const withReset = process.argv.includes("reset");
const withRecovery = process.argv.includes("recovery");
const suites = prod
  ? ["prod-roles", ...(withRecovery ? ["prod-recovery"] : [])]
  : ["public", "dev", "scrum-master", "admin", "actions", "final", ...(withReset ? ["password-reset"] : [])];

const outcome = suites.map((name) => {
  console.log(`\n=================== ${name} ===================`);
  const result = spawnSync(process.execPath, [path.join(__dirname, `${name}.cjs`)], { stdio: "inherit" });
  return { name, ok: result.status === 0 };
});

console.log("\n=================== summary ===================");
for (const { name, ok } of outcome) console.log(`${ok ? "  ok  " : " FAIL "} ${name}`);
process.exit(outcome.every((o) => o.ok) ? 0 : 1);
