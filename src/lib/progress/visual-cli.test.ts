import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sampleContent } from "./visual-fixture.ts";

// The contingency tool that draws the picture from a content file, for when the screen is not ready.
const SCRIPT = fileURLToPath(new URL("../../../scripts/progress/visual.ts", import.meta.url));

function run(args: string[], cwd: string) {
  const out = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", SCRIPT, ...args], { cwd, encoding: "utf8", timeout: 60_000 });
  return { code: out.status, stdout: out.stdout, stderr: out.stderr };
}

function workdir() {
  const dir = mkdtempSync(join(tmpdir(), "roads-visual-cli-"));
  return { dir, done: () => rmSync(dir, { recursive: true, force: true }) };
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

test("draws the PNG of a content file into the file asked for", () => {
  const w = workdir();
  try {
    const content = join(w.dir, "resumo.json");
    const out = join(w.dir, "imagem.png");
    writeFileSync(content, JSON.stringify(sampleContent(2)));
    const result = run(["--content", content, "--out", out], w.dir);
    assert.equal(result.code, 0, result.stderr);
    assert.ok(existsSync(out));
    const png = readFileSync(out);
    assert.deepEqual([...png.subarray(0, 8)], PNG_SIGNATURE);
    assert.equal(png.readUInt32BE(16), 1200);
    assert.match(result.stdout, /1200x\d+/);
    assert.ok(result.stdout.includes(out));
    // It reports where the picture went, never what the report said.
    assert.ok(!result.stdout.includes("Duas entregas de teste"));
  } finally {
    w.done();
  }
});

test("without --out the picture goes to .frontlights/progress/ of the folder it runs in", () => {
  const w = workdir();
  try {
    const content = join(w.dir, "resumo.json");
    writeFileSync(content, JSON.stringify(sampleContent(1)));
    const result = run(["--content", content], w.dir);
    assert.equal(result.code, 0, result.stderr);
    assert.ok(existsSync(join(w.dir, ".frontlights", "progress", "visual.png")));
  } finally {
    w.done();
  }
});

test("a call without --content explains the usage and exits with 2", () => {
  const w = workdir();
  try {
    const result = run([], w.dir);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /Uso:/);
    assert.match(result.stderr, /--content/);
  } finally {
    w.done();
  }
});

test("a file that is missing, is not JSON or is not a report fails with a short message and no picture", () => {
  const w = workdir();
  try {
    const out = join(w.dir, "imagem.png");
    const notJson = join(w.dir, "ruim.json");
    const notReport = join(w.dir, "outro.json");
    writeFileSync(notJson, "{ isto nao e json");
    writeFileSync(notReport, JSON.stringify({ segredo: "VALOR-SECRETO-DE-TESTE" }));
    for (const [file, message] of [
      [join(w.dir, "nao-existe.json"), /Não foi possível ler/],
      [notJson, /não é um JSON válido/],
      [notReport, /não parece um resumo/],
    ] as const) {
      const result = run(["--content", file, "--out", out], w.dir);
      assert.equal(result.code, 1, file);
      assert.match(result.stderr, message);
      assert.ok(!result.stderr.includes("VALOR-SECRETO-DE-TESTE")); // never echoes the file
      assert.doesNotMatch(result.stderr, /\bat .*\.ts:\d+/); // no stack trace for a user mistake
    }
    assert.ok(!existsSync(out));
  } finally {
    w.done();
  }
});
