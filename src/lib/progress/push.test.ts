import { test } from "node:test";
import assert from "node:assert/strict";
import { runPush } from "../../../scripts/progress/push.ts";
import type { PushDeps } from "../../../scripts/progress/push.ts";
import type { ProgressContent } from "../progress-report.ts";

// Everything below is made-up data: round numbers, invented titles, a fake secret.

const SECRET = "SEGREDO-DE-TESTE-4f9a";
const WINDOW = { start: "2026-03-02T00:00:00-03:00", end: "2026-03-04T00:00:00-03:00" };

const draft = (): ProgressContent => ({
  window: WINDOW,
  headline: "Frase de abertura de exemplo, que não pode aparecer no resumo da simulação.",
  entries: [
    { id: "gc-101", issue: 101, status: "concluido", title: "Título de exemplo A", summary: "Resumo de exemplo A.", deliveredAt: null, subIssues: null, hidden: false, edited: false, sources: [] },
    { id: "gc-102", issue: 102, status: "em_andamento", title: "Título de exemplo B", summary: "Resumo de exemplo B.", deliveredAt: null, subIssues: null, hidden: true, edited: false, sources: [] },
  ],
  internal: { count: 0, text: "" },
  difficulties: [],
  nextSteps: [{ id: "n1", text: "Passo de exemplo." }],
  usage: {
    scope: "GeoCloud",
    window: WINDOW,
    generatedAt: "2026-03-04T12:00:00-03:00",
    totals: { sessions: 0, messages: 0, activeDays: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
    byModel: [],
    favoriteModel: null,
    peakHour: null,
    days: [],
  },
});

const jpeg = (bytes: number) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(bytes - 4, 7)]);
const png = (bytes: number) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(bytes - 8, 7)]);

type Reply = { status: number; body?: unknown } | "network-error";

/** A command line's worth of fake world: files, environment, network, and what was printed. */
function world(opts: { files?: Record<string, string | Buffer>; env?: Record<string, string | undefined>; config?: unknown; reply?: Reply } = {}) {
  const files: Record<string, string | Buffer> = { "rascunho.json": JSON.stringify(draft()), ...opts.files };
  const printed: string[] = [];
  const requests: { url: string; init: RequestInit }[] = [];
  let reply: Reply = opts.reply ?? { status: 200, body: { id: "rel-1", created: true, url: "https://roads-psi.vercel.app/resumo" } };
  const deps: PushDeps = {
    env: "env" in opts ? opts.env! : { FRONTLIGHTS_API_SECRET: SECRET },
    readFile: (path) => {
      if (!(path in files)) throw new Error(`ENOENT ${path}`);
      return Buffer.from(files[path]);
    },
    readConfig: () => ("config" in opts ? opts.config : { roadmapSync: { endpoint: "https://roads.example/api/frontlights" } }),
    fetch: (async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init: init ?? {} });
      if (reply === "network-error") throw new TypeError(`fetch failed for ${SECRET}`);
      return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status, headers: { "content-type": "application/json" } });
    }) as typeof fetch,
    print: (line) => printed.push(line),
  };
  return {
    deps,
    printed,
    requests,
    output: () => printed.join("\n"),
    run: (...args: string[]) => runPush(args, deps),
    setReply: (r: Reply) => (reply = r),
  };
}

test("--dry-run checks the draft, says what it would send, and never touches the network", async () => {
  const w = world({ env: {} });
  const code = await w.run("--draft", "rascunho.json", "--dry-run");
  assert.equal(code, 0);
  assert.equal(w.requests.length, 0);
  assert.match(w.output(), /nada foi enviado/i);
  assert.match(w.output(), /GeoCloud/);
  assert.match(w.output(), /Entradas: 2 \(1 oculta\)/);
  assert.match(w.output(), /2026-03-02T00:00:00-03:00/);
});

test("the dry run does not repeat the text of the draft", async () => {
  const w = world();
  await w.run("--draft", "rascunho.json", "--dry-run");
  assert.doesNotMatch(w.output(), /Frase de abertura|Título de exemplo|Resumo de exemplo|Passo de exemplo/);
});

test("it posts the draft to <endpoint>/progress-report with the secret as a bearer token", async () => {
  const w = world();
  const code = await w.run("--draft", "rascunho.json");
  assert.equal(code, 0);
  assert.equal(w.requests.length, 1);
  const [req] = w.requests;
  assert.equal(req.url, "https://roads.example/api/frontlights/progress-report");
  assert.equal(req.init.method, "POST");
  const headers = new Headers(req.init.headers);
  assert.equal(headers.get("authorization"), `Bearer ${SECRET}`);
  assert.equal(headers.get("content-type"), "application/json");
  assert.deepEqual(JSON.parse(String(req.init.body)), { produto: "GeoCloud", content: draft() });
  assert.match(w.output(), /HTTP 200/);
  assert.match(w.output(), /rel-1/);
});

test("--endpoint wins over the configured one, and a trailing slash does not double up", async () => {
  const w = world();
  await w.run("--draft", "rascunho.json", "--endpoint", "https://outro.example/api/frontlights/");
  assert.equal(w.requests[0].url, "https://outro.example/api/frontlights/progress-report");
});

test("the secret never shows up in anything it prints", async () => {
  const replies: Reply[] = [
    { status: 200, body: { id: "rel-1", created: false, url: "https://roads-psi.vercel.app/resumo" } },
    { status: 400, body: { error: "content.window.end: o fim vem antes do início" } },
    { status: 401, body: { error: "unauthorized" } },
    { status: 409, body: { error: "period_already_sent" } },
    { status: 500, body: { error: "internal_error" } },
    { status: 502 },
    "network-error",
  ];
  for (const reply of replies) {
    const w = world({ reply });
    await w.run("--draft", "rascunho.json");
    assert.ok(!w.output().includes(SECRET), `secret printed for ${JSON.stringify(reply)}`);
  }
  const dry = world();
  await dry.run("--draft", "rascunho.json", "--dry-run");
  assert.ok(!dry.output().includes(SECRET));
  // The secret is also kept out when something goes wrong before any request.
  const noDraft = world();
  await noDraft.run("--draft", "nao-existe.json");
  assert.ok(!noDraft.output().includes(SECRET));
});

test("a period that was already sent becomes a plain message in Portuguese", async () => {
  const w = world({ reply: { status: 409, body: { error: "period_already_sent" } } });
  const code = await w.run("--draft", "rascunho.json");
  assert.equal(code, 1);
  assert.match(w.output(), /já foi enviado/i);
  assert.doesNotMatch(w.output(), /period_already_sent/);
});

test("the other answers of the server are explained too", async () => {
  const wrongSecret = world({ reply: { status: 401, body: { error: "unauthorized" } } });
  assert.equal(await wrongSecret.run("--draft", "rascunho.json"), 1);
  assert.match(wrongSecret.output(), /segredo/i);

  const refused = world({ reply: { status: 400, body: { error: "content.window.end: o fim vem antes do início" } } });
  assert.equal(await refused.run("--draft", "rascunho.json"), 1);
  assert.match(refused.output(), /content\.window\.end: o fim vem antes do início/);

  const broken = world({ reply: { status: 500, body: { error: "internal_error" } } });
  assert.equal(await broken.run("--draft", "rascunho.json"), 1);
  assert.match(broken.output(), /HTTP 500/);

  const down = world({ reply: "network-error" });
  assert.equal(await down.run("--draft", "rascunho.json"), 1);
  assert.match(down.output(), /não consegui falar com o servidor/i);
  assert.doesNotMatch(down.output(), /fetch failed/);
});

test("without the secret in the environment it stops before sending anything", async () => {
  const w = world({ env: {} });
  const code = await w.run("--draft", "rascunho.json");
  assert.equal(code, 1);
  assert.equal(w.requests.length, 0);
  assert.match(w.output(), /FRONTLIGHTS_API_SECRET/);
});

test("without an endpoint anywhere it says how to give one", async () => {
  const w = world({ config: null });
  assert.equal(await w.run("--draft", "rascunho.json"), 1);
  assert.equal(w.requests.length, 0);
  assert.match(w.output(), /--endpoint/);
});

test("prints are attached with their captions, and travel as base64 inside the content", async () => {
  const shot1 = jpeg(3000);
  const shot2 = png(2000);
  const w = world({ files: { "a.jpg": shot1, "b.png": shot2 } });
  const code = await w.run("--draft", "rascunho.json", "--shot", "a.jpg", "--caption", "Tela A", "--shot", "b.png", "--caption", "Tela B");
  assert.equal(code, 0);
  const sent = JSON.parse(String(w.requests[0].init.body)) as { content: ProgressContent };
  assert.deepEqual(sent.content.shots, [
    { id: "shot-1", caption: "Tela A", mime: "image/jpeg", data: shot1.toString("base64") },
    { id: "shot-2", caption: "Tela B", mime: "image/png", data: shot2.toString("base64") },
  ]);
});

test("a print above 256 KB is refused with the limit in the message, even in a dry run", async () => {
  const w = world({ files: { "grande.jpg": jpeg(256 * 1024 + 1) } });
  for (const extra of [[], ["--dry-run"]]) {
    assert.equal(await w.run("--draft", "rascunho.json", "--shot", "grande.jpg", "--caption", "Tela", ...extra), 1);
  }
  assert.equal(w.requests.length, 0);
  assert.match(w.output(), /256 KB/);
  assert.match(w.output(), /grande\.jpg/);
  // A print exactly at the limit is fine.
  const ok = world({ files: { "limite.jpg": jpeg(256 * 1024) } });
  assert.equal(await ok.run("--draft", "rascunho.json", "--shot", "limite.jpg", "--caption", "Tela", "--dry-run"), 0);
});

test("at most ten prints, each with a caption, and only jpeg or png", async () => {
  const files = { "a.jpg": jpeg(100), "b.jpg": jpeg(100), "c.jpg": jpeg(100), "nota.txt": "texto" };
  const pairs = (n: number) => Array.from({ length: n }, (_, i) => ["--shot", "a.jpg", "--caption", `Tela ${i + 1}`]).flat();
  const eleven = world({ files });
  assert.equal(await eleven.run("--draft", "rascunho.json", ...pairs(11), "--dry-run"), 1);
  assert.match(eleven.output(), /no máximo 10/);
  const ten = world({ files });
  assert.equal(await ten.run("--draft", "rascunho.json", ...pairs(10), "--dry-run"), 0);

  const noCaption = world({ files });
  assert.equal(await noCaption.run("--draft", "rascunho.json", "--shot", "a.jpg"), 1);
  assert.match(noCaption.output(), /--caption/);

  const stray = world({ files });
  assert.equal(await stray.run("--draft", "rascunho.json", "--caption", "Sozinha"), 1);

  const notAnImage = world({ files });
  assert.equal(await notAnImage.run("--draft", "rascunho.json", "--shot", "nota.txt", "--caption", "X"), 1);
  assert.match(notAnImage.output(), /JPEG ou PNG/);

  for (const w of [eleven, noCaption, stray, notAnImage]) assert.equal(w.requests.length, 0);
});

test("a draft the server would refuse is refused here, with the field named and without its value", async () => {
  const bad = draft();
  bad.entries[0].status = "ZZ-VALOR-SECRETO" as never;
  const w = world({ files: { "ruim.json": JSON.stringify(bad) } });
  assert.equal(await w.run("--draft", "ruim.json"), 1);
  assert.equal(w.requests.length, 0);
  assert.match(w.output(), /content\.entries\[0\]\.status/);
  assert.doesNotMatch(w.output(), /ZZ-VALOR-SECRETO/);

  // Only GeoCloud is accepted for now, and the product option is checked by the same rules.
  const other = world();
  assert.equal(await other.run("--draft", "rascunho.json", "--produto", "ELIMS"), 1);
  assert.match(other.output(), /produto/);
  assert.equal(other.requests.length, 0);
});

test("a missing or unreadable draft file is explained without echoing its content", async () => {
  const missing = world();
  assert.equal(await missing.run("--draft", "nao-existe.json"), 1);
  assert.match(missing.output(), /não consegui ler/i);

  const notJson = world({ files: { "lixo.json": "ZZ-CONTEUDO isto não é json" } });
  assert.equal(await notJson.run("--draft", "lixo.json"), 1);
  assert.match(notJson.output(), /não é um JSON válido/i);
  assert.doesNotMatch(notJson.output(), /ZZ-CONT/);
});

test("a wrong command line prints the usage and exits with 2", async () => {
  for (const args of [[], ["--dry-run"], ["--draft"], ["--draft", "a.json", "--nada"], ["--draft", "a.json", "--shot"]]) {
    const w = world();
    assert.equal(await w.run(...args), 2, args.join(" "));
    assert.match(w.output(), /Uso:/);
    assert.equal(w.requests.length, 0);
  }
});

/* ---------- --assemble: the texts file plus the collected files become the draft ---------- */

const factsFile = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    window: WINDOW,
    entries: [
      { id: "gc-101", issue: 101, title: "Técnico A", status: "concluido", deliveredAt: "2026-03-02T15:00:00-03:00", subIssues: null, hidden: false, sources: ["https://github.com/OWNER/REPOSITORY/issues/101"] },
      { id: "gc-102", issue: 102, title: "Técnico B", status: "em_andamento", deliveredAt: null, subIssues: null, hidden: false, sources: [] },
    ],
    internal: { count: 0, items: [] },
    ...over,
  });
const textsFile = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    headline: "Abertura de exemplo.",
    entries: [
      { issue: 101, title: "Título de exemplo A", summary: "Resumo de exemplo A." },
      { issue: 102, title: "Título de exemplo B", summary: "Resumo de exemplo B." },
    ],
    nextSteps: ["Passo de exemplo."],
    ...over,
  });
const ASSEMBLE = ["--draft", "textos.json", "--assemble", "--facts", "fatos.json", "--usage", "uso.json", "--local", "local.json"];
const assembling = (extra: Record<string, string | Buffer> = {}) =>
  world({
    files: {
      "textos.json": textsFile(),
      "fatos.json": factsFile(),
      "uso.json": JSON.stringify(draft().usage),
      "local.json": JSON.stringify({ access: { account: "reader@example.test", password: "Tmp-pass-1234" } }),
      ...extra,
    },
  });
const sentContent = (w: ReturnType<typeof world>) => JSON.parse(String(w.requests[0].init.body)).content;

test("--assemble builds the draft from the texts and the collected files, and sends it", async () => {
  const w = assembling();
  assert.equal(await w.run(...ASSEMBLE), 0, w.output());
  const content = sentContent(w);
  assert.deepEqual(content.entries.map((e: { status: string }) => e.status), ["concluido", "em_andamento"]);
  assert.equal(content.entries[0].title, "Título de exemplo A");
  assert.deepEqual(content.access, { account: "reader@example.test", password: "Tmp-pass-1234" });
  assert.equal(content.usage.scope, "GeoCloud");
});

test("--assemble without the local file simply sends no sign-in details", async () => {
  const w = assembling();
  assert.equal(await w.run("--draft", "textos.json", "--assemble", "--facts", "fatos.json", "--usage", "uso.json", "--local", "nao-existe.json"), 0, w.output());
  assert.equal(sentContent(w).access, undefined);
});

test("--assemble names a delivery that has no text, and sends nothing", async () => {
  const w = assembling({ "textos.json": textsFile({ entries: [{ issue: 101, title: "Só A", summary: "Frase." }] }) });
  assert.equal(await w.run(...ASSEMBLE), 1);
  assert.match(w.output(), /#102/);
  assert.equal(w.requests.length, 0);
});

test("--assemble says which file it could not read, without quoting it", async () => {
  const w = assembling();
  assert.equal(await w.run("--draft", "textos.json", "--assemble", "--facts", "sumiu.json", "--usage", "uso.json"), 1);
  assert.match(w.output(), /sumiu\.json/);
  const broken = assembling({ "fatos.json": "{ isto não é json SEGREDO" });
  assert.equal(await broken.run(...ASSEMBLE), 1);
  assert.ok(!broken.output().includes("SEGREDO"));
});

test("--shots-dir takes the prints listed in captions.json, in that order, and ignores the rest", async () => {
  const dir = ".frontlights/progress/shots";
  const w = assembling({
    [`${dir}/captions.json`]: JSON.stringify([{ file: "b.png", caption: "Segunda tela." }, { file: "a.jpg", caption: "Primeira tela." }]),
    [`${dir}/a.jpg`]: jpeg(200),
    [`${dir}/b.png`]: png(200),
    [`${dir}/velho.png`]: png(200),
  });
  assert.equal(await w.run(...ASSEMBLE, "--shots-dir", dir), 0, w.output());
  const shots = sentContent(w).shots;
  assert.deepEqual(shots.map((s: { caption: string; mime: string }) => [s.caption, s.mime]), [["Segunda tela.", "image/png"], ["Primeira tela.", "image/jpeg"]]);
});

test("--shots-dir without a captions.json sends no prints; a listed file that is missing is named", async () => {
  const dir = ".frontlights/progress/shots";
  const none = assembling({ [`${dir}/a.jpg`]: jpeg(200) });
  assert.equal(await none.run(...ASSEMBLE, "--shots-dir", dir), 0, none.output());
  assert.equal(sentContent(none).shots, undefined);
  const gone = assembling({ [`${dir}/captions.json`]: JSON.stringify([{ file: "sumiu.png", caption: "X." }]) });
  assert.equal(await gone.run(...ASSEMBLE, "--shots-dir", dir), 1);
  assert.match(gone.output(), /sumiu\.png/);
  assert.equal(gone.requests.length, 0);
});

test("--shots-dir refuses a name that leaves the folder, a missing caption and a bad list", async () => {
  const dir = ".frontlights/progress/shots";
  for (const list of [[{ file: "../segredo.png", caption: "X." }], [{ file: "a.jpg", caption: "" }], [{ file: "a.jpg" }], { file: "a.jpg" }]) {
    const w = assembling({ [`${dir}/captions.json`]: JSON.stringify(list), [`${dir}/a.jpg`]: jpeg(200), "segredo.png": png(200) });
    assert.equal(await w.run(...ASSEMBLE, "--shots-dir", dir), 1, JSON.stringify(list));
    assert.equal(w.requests.length, 0);
  }
});
