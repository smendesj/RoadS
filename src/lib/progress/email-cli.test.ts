import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sampleContent } from "./visual-fixture.ts";

// The contingency tool that builds the e-mail HTML from a content file, for when the screen is not
// ready. It shows the conferência table first and writes nothing until the person says --confirm.
const SCRIPT = fileURLToPath(new URL("../../../scripts/progress/email.ts", import.meta.url));

function run(args: string[], cwd: string) {
  const out = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", SCRIPT, ...args], { cwd, encoding: "utf8", timeout: 60_000 });
  return { code: out.status, stdout: out.stdout, stderr: out.stderr };
}

function workdir() {
  const dir = mkdtempSync(join(tmpdir(), "roads-email-cli-"));
  return { dir, done: () => rmSync(dir, { recursive: true, force: true }) };
}

const withExtras = () =>
  sampleContent(2, {
    shots: [{ id: "s1", caption: "Legenda do print 1", mime: "image/jpeg", data: "AAECAwQF" }],
    gaps: [{ at: "2026-09-29T20:00:00-03:00", ref: "pull/123", nearestMessageMinutes: 90 }],
  });

test("without --confirm it shows the conferência table and writes nothing", () => {
  const w = workdir();
  try {
    const content = join(w.dir, "resumo.json");
    const out = join(w.dir, "email.html");
    writeFileSync(content, JSON.stringify(withExtras()));
    const result = run(["--content", content, "--out", out], w.dir);
    assert.equal(result.code, 0, result.stderr);
    assert.ok(!existsSync(out));
    // One line per day of the window, with the first and the last prompt in São Paulo time.
    assert.match(result.stdout, /28\/09/);
    assert.match(result.stdout, /29\/09/);
    assert.match(result.stdout, /06:10/);
    assert.match(result.stdout, /15:50/);
    // The coverage gap is shown as a warning line.
    assert.match(result.stdout, /Aviso: trabalho no GitHub/);
    assert.match(result.stdout, /--confirm/);
    assert.match(result.stdout, /Nada foi gravado/);
  } finally {
    w.done();
  }
});

test("with --confirm it writes the e-mail, the pictures embedded so the file works offline", () => {
  const w = workdir();
  try {
    const content = join(w.dir, "resumo.json");
    const out = join(w.dir, "email.html");
    writeFileSync(content, JSON.stringify(withExtras()));
    const result = run(["--content", content, "--out", out, "--confirm"], w.dir);
    assert.equal(result.code, 0, result.stderr);
    const html = readFileSync(out, "utf8");
    assert.match(html, /^<!DOCTYPE html>/);
    assert.match(html, /<img src="data:image\/png;base64,iVBOR[A-Za-z0-9+/=]+" width="600"/); // the Claude picture
    assert.match(html, /<img src="data:image\/jpeg;base64,AAECAwQF"/); // the print
    assert.ok(html.includes("Duas entregas de teste ficaram prontas"));
    assert.ok(html.includes('href="https://roads-psi.vercel.app/resumo"'));
    assert.ok(!html.includes("example.invalid")); // sources never reach the e-mail
    // It prints the subject to paste, and where the file went; it does not print the report.
    assert.ok(result.stdout.includes("GeoCloud: andamento de 28/09 a 29/09"));
    assert.ok(result.stdout.includes(out));
    assert.ok(!result.stdout.includes("Duas entregas de teste"));
  } finally {
    w.done();
  }
});

test("without --out the e-mail goes to .frontlights/progress/ of the folder it runs in", () => {
  const w = workdir();
  try {
    const content = join(w.dir, "resumo.json");
    writeFileSync(content, JSON.stringify(sampleContent(1)));
    const result = run(["--content", content, "--confirm"], w.dir);
    assert.equal(result.code, 0, result.stderr);
    assert.ok(existsSync(join(w.dir, ".frontlights", "progress", "email.html")));
  } finally {
    w.done();
  }
});

test("a call without --content explains the usage and exits with 2; a bad file fails with a short message", () => {
  const w = workdir();
  try {
    const noArgs = run([], w.dir);
    assert.equal(noArgs.code, 2);
    assert.match(noArgs.stderr, /Uso:/);
    const bad = join(w.dir, "ruim.json");
    writeFileSync(bad, "nao e json");
    const result = run(["--content", bad, "--confirm", "--out", join(w.dir, "x.html")], w.dir);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /não é um JSON válido/);
    assert.ok(!existsSync(join(w.dir, "x.html")));
  } finally {
    w.done();
  }
});
