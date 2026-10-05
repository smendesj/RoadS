import { test } from "node:test";
import assert from "node:assert/strict";
import { runAttach } from "../../../scripts/progress/attach.ts";
import type { PushDeps } from "../../../scripts/progress/push.ts";
import type { ProgressContent } from "../progress-report.ts";
import { attachShots, type AttachStore } from "./attach.ts";
import { receiveShot } from "./shot-upload.ts";
import { entry, sampleContent } from "./visual-fixture.ts";

// Made-up data only: a fake secret, invented deliveries, a folder that only exists in memory.

const SECRET = "SEGREDO-DE-TESTE-77c1";
const ID = "0b9f1c2e-3d4a-4b5c-8d6e-7f8091a2b3c4";
const WEEK = "C:/Exemplo/SCRUM/2026/05_10/summary";
const png = (bytes: number, fill = 7) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(bytes - 8, fill)]);
const jpeg = (bytes: number) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(bytes - 4, 7)]);

const sentContent = (): ProgressContent => sampleContent(2, { entries: [entry(1, "concluido"), entry(2, "em_andamento")] });

/** A command line's worth of fake world: the RoadS doors answer with their real rules over in-memory state. */
function world(
  opts: { files?: Record<string, string | Buffer>; env?: Record<string, string | undefined>; status?: "sent" | "draft"; raceOnWrite?: boolean; uploadDown?: boolean } = {}
) {
  const files: Record<string, string | Buffer> = {
    [`${WEEK}/captions.json`]: JSON.stringify([
      { file: "1-tela.png", caption: "Tela da entrega 1.", issue: 1 },
      { file: "2-codigo.jpg", caption: "Código da entrega 2.", issue: 2 },
    ]),
    [`${WEEK}/1-tela.png`]: png(300),
    [`${WEEK}/2-codigo.jpg`]: jpeg(300),
    ...opts.files,
  };
  const bucket = new Map<string, Uint8Array>();
  let report = { status: opts.status ?? ("sent" as const), rev: 3, content: sentContent(), overrides: {} };
  const store: AttachStore = {
    findReport: async (id) => (id === ID ? structuredClone(report) : null),
    shotExists: async (path) => bucket.has(path),
    writeShots: async (_id, rev, content) => (!opts.raceOnWrite && rev === report.rev ? ((report = { ...report, rev: rev + 1, content }), true) : false),
  };
  const printed: string[] = [];
  const requests: { url: string; init: RequestInit }[] = [];
  const deps: PushDeps = {
    env: "env" in opts ? opts.env! : { FRONTLIGHTS_API_SECRET: SECRET },
    readFile: (path) => {
      if (!(path in files)) throw new Error(`ENOENT ${path}`);
      return Buffer.from(files[path]);
    },
    readConfig: () => ({ roadmapSync: { endpoint: "https://roads.example/api/frontlights" } }),
    fetch: (async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init: init ?? {} });
      const json = (out: { status: number; body: unknown }) => new Response(JSON.stringify(out.body), { status: out.status, headers: { "content-type": "application/json" } });
      if (new Headers(init?.headers).get("authorization") !== `Bearer ${SECRET}`) return json({ status: 401, body: { error: "unauthorized" } });
      const body = JSON.parse(String(init?.body));
      if (String(url).endsWith("/progress-report/shots") && opts.uploadDown) return json({ status: 500, body: { error: "internal_error" } });
      if (String(url).endsWith("/progress-report/shots")) return json(await receiveShot({ upload: async (p, b) => (bucket.set(p, b), { error: null }) }, body));
      const attach = /\/progress-report\/([^/]+)\/shots$/.exec(String(url));
      if (attach) return json(await attachShots(store, attach[1], body));
      return json({ status: 404, body: {} });
    }) as typeof fetch,
    print: (line) => printed.push(line),
  };
  return { deps, printed, requests, bucket, report: () => report, output: () => printed.join("\n"), run: (...args: string[]) => runAttach(args, deps) };
}

test("it uploads each print of the folder, then adds them to the sent report, and says what it did", async () => {
  const w = world();
  assert.equal(await w.run("--report", ID, "--shots-dir", WEEK), 0, w.output());
  assert.deepEqual(
    w.requests.map((r) => r.url.replace("https://roads.example/api/frontlights", "")),
    ["/progress-report/shots", "/progress-report/shots", `/progress-report/${ID}/shots`]
  );
  const shots = w.report().content.shots ?? [];
  assert.deepEqual(shots.map((s) => [s.issue, s.caption]), [[1, "Tela da entrega 1."], [2, "Código da entrega 2."]]);
  assert.match(w.output(), /acrescentados: 2/i);
  assert.ok(!w.output().includes(SECRET));
});

test("every call it makes says which script it is, for the log of calls", async () => {
  const w = world();
  await w.run("--report", ID, "--shots-dir", WEEK);
  assert.equal(w.requests.length, 3);
  for (const r of w.requests) assert.equal(new Headers(r.init.headers).get("user-agent"), "roads-script/attach");
});

test("running it again adds nothing and says the prints were already there", async () => {
  const w = world();
  await w.run("--report", ID, "--shots-dir", WEEK);
  assert.equal(await w.run("--report", ID, "--shots-dir", WEEK), 0, w.output());
  assert.equal((w.report().content.shots ?? []).length, 2);
  assert.match(w.output(), /já existiam: 2/i);
});

test("the dry run checks the folder and touches no network", async () => {
  const w = world({ env: {} });
  assert.equal(await w.run("--report", ID, "--shots-dir", WEEK, "--dry-run"), 0, w.output());
  assert.equal(w.requests.length, 0);
  assert.match(w.output(), /Prints: 2/);
});

test("a print without a delivery goes up as a general print of the week, and the dry run says so", async () => {
  const files = {
    [`${WEEK}/captions.json`]: JSON.stringify([
      { file: "1-tela.png", caption: "Tela da entrega 1.", issue: 1 },
      { file: "2-codigo.jpg", caption: "Plano geral da semana." },
    ]),
  };
  const dry = world({ env: {}, files });
  assert.equal(await dry.run("--report", ID, "--shots-dir", WEEK, "--dry-run"), 0, dry.output());
  assert.equal(dry.requests.length, 0);
  assert.match(dry.output(), /Prints: 2 \(#1, geral\)/);

  const w = world({ files });
  assert.equal(await w.run("--report", ID, "--shots-dir", WEEK), 0, w.output());
  const shots = w.report().content.shots ?? [];
  assert.deepEqual(shots.map((s) => [s.issue, s.caption]), [[1, "Tela da entrega 1."], [undefined, "Plano geral da semana."]]);
  assert.match(w.output(), /acrescentados: 2/i);
});

test("a bad folder, id or issue stops before any request", async () => {
  const cases: [string[], Record<string, string | Buffer>, RegExp][] = [
    [["--report", ID, "--shots-dir", WEEK], { [`${WEEK}/captions.json`]: JSON.stringify([{ file: "1-tela.png", caption: "Entrega torta.", issue: "um" }]) }, /issue/],
    [["--report", ID, "--shots-dir", WEEK], { [`${WEEK}/captions.json`]: JSON.stringify([{ file: "sumiu.png", caption: "X.", issue: 1 }]) }, /sumiu\.png/],
    [["--report", ID, "--shots-dir", WEEK], { [`${WEEK}/captions.json`]: "[]" }, /nenhum print/i],
    [["--report", ID, "--shots-dir", WEEK], { [`${WEEK}/captions.json`]: JSON.stringify([{ file: "1-tela.png", caption: "x".repeat(201), issue: 1 }]) }, /200 caracteres/],
    [["--report", "isto-nao-e-um-id", "--shots-dir", WEEK], {}, /--report/],
  ];
  for (const [args, files, said] of cases) {
    const w = world({ files });
    assert.equal(await w.run(...args), 1, args.join(" "));
    assert.match(w.output(), said);
    assert.equal(w.requests.length, 0);
  }
  for (const args of [[], ["--report", ID], ["--shots-dir", WEEK], ["--report", ID, "--shots-dir", WEEK, "--nada"]]) {
    const w = world();
    assert.equal(await w.run(...args), 2, args.join(" "));
    assert.match(w.output(), /Uso:/);
  }
});

test("the answers of the server become plain messages: a draft, an unknown report, a delivery it does not have", async () => {
  const draft = world({ status: "draft" });
  assert.equal(await draft.run("--report", ID, "--shots-dir", WEEK), 1);
  assert.match(draft.output(), /não foi enviado|rascunho/i);

  const unknown = world();
  assert.equal(await unknown.run("--report", "11111111-2222-4333-8444-555555555555", "--shots-dir", WEEK), 1);
  assert.match(unknown.output(), /não existe|não encontr/i);

  const other = world({ files: { [`${WEEK}/captions.json`]: JSON.stringify([{ file: "1-tela.png", caption: "X.", issue: 99 }]) } });
  assert.equal(await other.run("--report", ID, "--shots-dir", WEEK), 1);
  assert.match(other.output(), /#99/);
  assert.equal((other.report().content.shots ?? []).length, 0);

  const raced = world({ raceOnWrite: true });
  assert.equal(await raced.run("--report", ID, "--shots-dir", WEEK), 1);
  assert.match(raced.output(), /rode de novo/i);

  const down = world({ uploadDown: true });
  assert.equal(await down.run("--report", ID, "--shots-dir", WEEK), 1);
  assert.match(down.output(), /HTTP 500.*Nada foi acrescentado/);
  assert.equal(down.requests.filter((r) => /\/progress-report\/[^/]+\/shots$/.test(r.url) && !r.url.endsWith("/progress-report/shots")).length, 0);

  const noSecret = world({ env: {} });
  assert.equal(await noSecret.run("--report", ID, "--shots-dir", WEEK), 1);
  assert.match(noSecret.output(), /FRONTLIGHTS_API_SECRET/);
  assert.equal(noSecret.requests.length, 0);
});
