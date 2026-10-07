import { test } from "node:test";
import assert from "node:assert/strict";
import type { ProgressContent } from "../progress-report.ts";
import { KEPT_FIELDS, MAX_PAYLOAD_BYTES, MAX_SHOT_BYTES, parseDraft } from "./draft.ts";

// Everything below is made-up data: round numbers, invented titles, an example repository.

// A secret-looking value that must never come back in an error message.
const SENTINEL = "ZZ-SENTINELA-7c41";

type Body = { produto?: string; content: ProgressContent };
/** Lets a test put a value of the wrong type into a typed field. */
const unsafe = (value: unknown) => value as never;

const WINDOW = { start: "2026-03-02T00:00:00-03:00", end: "2026-03-04T00:00:00-03:00" };
const TOKENS = { input: 1200, output: 3400, cacheRead: 56000, cacheWrite: 7800 };
const LINK = "https://github.com/example-org/example-repo/issues/101";

/** A bytes-long file that starts like a real JPEG/PNG, as base64. */
const jpeg = (bytes: number) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(bytes - 4, 7)]).toString("base64");
const png = (bytes: number) =>
  Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(bytes - 8, 7)]).toString("base64");

/** The smallest realistic draft: what the push script sends. Each test bends one thing in a fresh copy. */
function validBody(): Body {
  return {
    produto: "GeoCloud",
    content: {
      window: { ...WINDOW },
      headline: "Duas entregas de exemplo foram concluídas e uma está em validação.",
      entries: [
        {
          id: "gc-101",
          issue: 101,
          status: "concluido",
          title: "Entrega de exemplo A",
          summary: "Uma frase simples que descreve a primeira entrega de exemplo.",
          deliveredAt: "2026-03-03T15:00:00-03:00",
          subIssues: { total: 3, done: 3 },
          hidden: false,
          edited: false,
          sources: [LINK],
        },
        {
          id: "gc-102",
          issue: 102,
          status: "em_validacao",
          title: "Entrega de exemplo B",
          summary: "Uma frase simples que descreve a segunda entrega de exemplo.",
          deliveredAt: null,
          subIssues: null,
          hidden: false,
          edited: false,
          sources: [],
        },
      ],
      internal: { count: 2, text: "Também houve ajustes internos de exemplo." },
      difficulties: [{ id: "d1", text: "Uma dependência externa de exemplo ainda não respondeu.", needs: "Uma resposta do fornecedor de exemplo." }],
      nextSteps: [{ id: "n1", text: "Fechar o período de exemplo com tudo conferido." }],
      usage: {
        scope: "GeoCloud",
        products: ["Projeto A", "Projeto B"],
        window: { ...WINDOW },
        generatedAt: "2026-03-04T12:00:00-03:00",
        label: "Uso de IA (exemplo)",
        method: "real",
        totals: { sessions: 1, messages: 40, humanPrompts: 12, activeDays: 1, tokens: { ...TOKENS } },
        byModel: [{ model: "claude-opus-5-5", messages: 40, ...TOKENS }],
        favoriteModel: "claude-opus-5-5",
        peakHour: 10,
        days: [
          {
            date: "2026-03-02",
            sessions: [{ start: "2026-03-02T09:00:00-03:00", end: "2026-03-02T12:30:00-03:00", messages: 40, tokens: 100000 }],
            firstPromptAt: "2026-03-02T09:00:00-03:00",
            lastPromptAt: "2026-03-02T12:30:00-03:00",
            messages: 40,
            humanPrompts: 12,
            tokens: { ...TOKENS },
            otherMethodTokens: 250000,
            hourly: Array.from({ length: 24 }, (_, h) => (h >= 9 && h <= 12 ? 10 : 0)),
          },
        ],
        notes: [{ date: "2026-03-02", text: "Parte do trabalho de exemplo foi feita fora do computador." }],
      },
      // One print per delivery that is not "próximo": one already in the storage bucket, one inline (older form).
      shots: [
        { id: "shot-1", caption: "Tela de exemplo", mime: "image/png", issue: 101, path: `${"a".repeat(64)}.png` },
        { id: "shot-2", caption: "Outra tela de exemplo", mime: "image/jpeg", issue: 102, data: jpeg(2048) },
      ],
      sprint: {
        epics: [
          {
            issue: 900,
            title: "Capa de exemplo A",
            summary: "Uma frase de exemplo sobre a capa.",
            issues: { total: 3, done: 1 },
            parts: { total: 8, done: 5, remaining: 3 },
            open: [{ issue: 910, title: "Entrega aberta de exemplo" }],
          },
        ],
        totals: { covers: 1, remainingParts: 3 },
      },
      gaps: [{ at: "2026-03-02T20:00:00-03:00", ref: "PR 12", nearestMessageMinutes: 120 }],
      access: { account: "reader@example.test", password: "Tmp-pass-1234" },
    },
  };
}

/** Bends a fresh valid body with `bend`, then parses it. */
function parseBent(bend: (body: Body) => void) {
  const body = validBody();
  bend(body);
  return parseDraft(body);
}

/** The draft is refused AND the reason names the offending field (so a blanket "no" would not pass). */
function refused(bend: (body: Body) => void, where: RegExp) {
  const r = parseBent(bend);
  assert.equal(r.ok, false, "should have been refused");
  if (!r.ok) assert.match(r.error, where);
}

test("a valid draft is accepted and the content comes back as sent", () => {
  const r = parseDraft(validBody());
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.produto, "GeoCloud");
    assert.deepEqual(r.content, validBody().content);
  }
});

test("every field of the contract survives, and the list of kept fields is complete", () => {
  const { content } = validBody();
  const keys = (o: object) => Object.keys(o).sort();
  // The sample uses every field there is (optional ones too)...
  assert.deepEqual(keys(content), [...KEPT_FIELDS.content].sort());
  assert.deepEqual(keys(content.entries[0]), [...KEPT_FIELDS.entry].sort());
  assert.deepEqual(keys(content.usage), [...KEPT_FIELDS.usage].sort());
  assert.deepEqual(keys(content.usage.totals), [...KEPT_FIELDS.totals].sort());
  assert.deepEqual(keys(content.usage.byModel[0]), [...KEPT_FIELDS.byModel].sort());
  assert.deepEqual(keys(content.usage.days[0]), [...KEPT_FIELDS.day].sort());
  assert.deepEqual(keys(content.usage.days[0].sessions[0]), [...KEPT_FIELDS.session].sort());
  // A print carries either `path` or `data`: the two sample prints together use every field.
  assert.deepEqual([...new Set(content.shots!.flatMap(keys))].sort(), [...KEPT_FIELDS.shot].sort());
  assert.deepEqual(keys(content.gaps![0]), [...KEPT_FIELDS.gap].sort());
  assert.deepEqual(keys(content.sprint!), [...KEPT_FIELDS.sprint].sort());
  assert.deepEqual(keys(content.sprint!.epics[0]), [...KEPT_FIELDS.cover].sort());
  // ...and the parser hands every one of them back.
  const r = parseDraft(validBody());
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.content, content);
});

test("the counting method is 'real' or 'stats', and the new counts are whole numbers", () => {
  refused((b) => (b.content.usage.method = unsafe("outro")), /content\.usage\.method/);
  refused((b) => (b.content.usage.totals.humanPrompts = -1), /content\.usage\.totals\.humanPrompts/);
  refused((b) => (b.content.usage.days[0].humanPrompts = 1.5), /content\.usage\.days\[0\]\.humanPrompts/);
  refused((b) => (b.content.usage.days[0].otherMethodTokens = unsafe("1")), /content\.usage\.days\[0\]\.otherMethodTokens/);
  assert.equal(parseBent((b) => (b.content.usage.method = "stats")).ok, true);
  // They are optional: a collector that does not know them leaves them out.
  const r = parseBent((b) => {
    delete b.content.usage.method;
    delete b.content.usage.totals.humanPrompts;
    delete b.content.usage.days[0].humanPrompts;
    delete b.content.usage.days[0].otherMethodTokens;
  });
  assert.equal(r.ok && ["method" in r.content.usage, "humanPrompts" in r.content.usage.totals, "humanPrompts" in r.content.usage.days[0], "otherMethodTokens" in r.content.usage.days[0]].some(Boolean), false);
});

test("the product defaults to GeoCloud, and GeoCloud is the only one accepted for now", () => {
  const r = parseDraft({ content: validBody().content });
  assert.equal(r.ok && r.produto, "GeoCloud");
  refused((b) => (b.produto = "ELIMS"), /produto/);
  refused((b) => (b.produto = unsafe(42)), /produto/);
});

test("a status written as its Portuguese label becomes the status code", () => {
  const labels: [string, string][] = [
    ["Concluído", "concluido"],
    ["Em validação", "em_validacao"],
    ["em andamento", "em_andamento"],
    ["BLOQUEADO", "bloqueado"],
    ["Próximo", "proximo"],
    ["concluido", "concluido"],
    ["em_validacao", "em_validacao"],
  ];
  for (const [sent, expected] of labels) {
    const r = parseBent((b) => (b.content.entries[0].status = unsafe(sent)));
    assert.equal(r.ok && r.content.entries[0].status, expected, sent);
  }
});

test("a status that is neither a code nor a label is refused", () => {
  refused((b) => (b.content.entries[1].status = unsafe("quase pronto")), /content\.entries\[1\]\.status/);
  refused((b) => (b.content.entries[0].status = unsafe(3)), /content\.entries\[0\]\.status/);
});

test("dates need a UTC offset and have to exist on the calendar", () => {
  refused((b) => (b.content.window.start = "2026-03-02T00:00:00"), /content\.window\.start/);
  refused((b) => (b.content.window.end = "2026-03-04"), /content\.window\.end/);
  refused((b) => (b.content.window.end = "2026-02-31T00:00:00-03:00"), /content\.window\.end/);
  refused((b) => (b.content.window.end = "2026-03-04T25:00:00-03:00"), /content\.window\.end/);
  refused((b) => (b.content.entries[0].deliveredAt = "2026-03-03T15:00:00"), /deliveredAt/);
  refused((b) => (b.content.usage.generatedAt = "ontem"), /generatedAt/);
  refused((b) => (b.content.usage.days[0].sessions[0].start = "2026-03-02T09:00:00"), /sessions\[0\]\.start/);
  refused((b) => (b.content.usage.days[0].firstPromptAt = "2026-03-02T09:00"), /firstPromptAt/);
  refused((b) => (b.content.usage.days[0].date = "2026-03-32"), /content\.usage\.days\[0\]\.date/);
  refused((b) => (b.content.gaps![0].at = "2026-03-02 20:00:00-03:00"), /content\.gaps\[0\]\.at/);
  // The same instant written in UTC is fine.
  assert.equal(parseBent((b) => (b.content.window.start = "2026-03-02T03:00:00Z")).ok, true);
});

test("a window that ends before it starts is refused, an empty one is not", () => {
  refused((b) => (b.content.window.end = "2026-03-01T00:00:00-03:00"), /content\.window/);
  const empty = parseBent((b) => (b.content.window.end = b.content.window.start));
  assert.equal(empty.ok, true);
});

test("the hourly strip has exactly 24 buckets of whole, non-negative message counts", () => {
  const hourly = (n: number) => Array.from({ length: n }, () => 1);
  refused((b) => (b.content.usage.days[0].hourly = hourly(23)), /hourly/);
  refused((b) => (b.content.usage.days[0].hourly = hourly(25)), /hourly/);
  refused((b) => (b.content.usage.days[0].hourly[3] = -1), /hourly/);
  refused((b) => (b.content.usage.days[0].hourly[3] = 1.5), /hourly/);
  refused((b) => (b.content.usage.days[0].hourly[3] = unsafe("10")), /hourly/);
  assert.equal(parseBent((b) => (b.content.usage.days[0].hourly = hourly(24))).ok, true);
});

test("at most forty prints, each a real jpeg or png in valid base64 or a path in the storage bucket", () => {
  const shot = (n: number) => ({ id: `shot-${n}`, caption: "Tela", mime: "image/png" as const, issue: 101 + (n % 2), path: `${String(n % 10).repeat(64)}.png` });
  const many = (n: number) => Array.from({ length: n }, (_, i) => shot(i + 1));
  refused((b) => (b.content.shots = many(41)), /content\.shots/);
  assert.equal(parseBent((b) => (b.content.shots = many(40))).ok, true);
  refused((b) => (b.content.shots![1].mime = unsafe("image/gif")), /content\.shots\[1\]\.mime/);
  // A path is a content hash with the extension of its type; nothing else (no folders, no other names).
  refused((b) => (b.content.shots![0].path = "../segredo.png"), /content\.shots\[0\]\.path/);
  refused((b) => (b.content.shots![0].path = `${"a".repeat(64)}.jpg`), /content\.shots\[0\]\.path/);
  refused((b) => (b.content.shots![0].path = `pasta/${"a".repeat(64)}.png`), /content\.shots\[0\]\.path/);
  // Exactly one of the two: a path, or the inline image.
  refused((b) => (b.content.shots![0].data = png(1024)), /content\.shots\[0\]/);
  refused((b) => delete b.content.shots![1].data, /content\.shots\[1\]/);
  refused((b) => (b.content.shots![1].data = "isto não é base64!"), /content\.shots\[1\]\.data/);
  refused((b) => (b.content.shots![1].data = "data:image/png;base64," + png(64)), /content\.shots\[1\]\.data/);
  // Bytes that do not start like the declared image type (a png sent as a jpeg, or plain text).
  refused((b) => (b.content.shots![1].data = png(1024)), /content\.shots\[1\]\.data/);
  refused((b) => (b.content.shots![1].data = Buffer.from("<svg onload=alert(1)></svg>").toString("base64")), /content\.shots\[1\]\.data/);
  refused((b) => (b.content.shots![1].data = ""), /content\.shots\[1\]\.data/);
});

test("every delivery on show that is not 'próximo' needs a print of its own, and a print names a delivery of the report", () => {
  // Delivery 102 loses its print: refused, naming the issue.
  refused((b) => b.content.shots!.splice(1, 1), /#102/);
  refused((b) => delete b.content.shots, /#101, #102/);
  // A hidden delivery, or one that is only "próximo", needs none.
  assert.equal(parseBent((b) => { b.content.shots!.splice(1, 1); b.content.entries[1].hidden = true; }).ok, true);
  assert.equal(parseBent((b) => { b.content.shots!.splice(1, 1); b.content.entries[1].status = "proximo"; }).ok, true);
  // A general print (no delivery) is fine, on top of the required ones.
  assert.equal(parseBent((b) => b.content.shots!.push({ id: "shot-3", caption: "Visão geral", mime: "image/png", path: `${"b".repeat(64)}.png` })).ok, true);
  // A print that names a delivery the report does not have, or not a whole issue number, is refused.
  refused((b) => (b.content.shots![0].issue = 999), /content\.shots\[0\]\.issue.*#999/);
  refused((b) => (b.content.shots![0].issue = unsafe("101")), /content\.shots\[0\]\.issue/);
});

test("an inline print is refused above 1 MB decoded and accepted right at the limit", () => {
  assert.equal(MAX_SHOT_BYTES, 1024 * 1024);
  assert.equal(parseBent((b) => (b.content.shots![1].data = jpeg(MAX_SHOT_BYTES))).ok, true);
  refused((b) => (b.content.shots![1].data = jpeg(MAX_SHOT_BYTES + 1)), /content\.shots\[1\].*1024 KB/);
  // Far above every limit: never accepted.
  assert.equal(parseBent((b) => (b.content.shots![1].data = jpeg(5 * 1024 * 1024))).ok, false);
});

test("a payload above 4096 KB is refused before anything else is looked at", () => {
  assert.equal(MAX_PAYLOAD_BYTES, 4096 * 1024);
  const r = parseBent((b) => {
    b.content.entries = Array.from({ length: 30000 }, (_, i) => ({ ...b.content.entries[0], id: `gc-${i}`, issue: i + 1 }));
    b.content.window.end = "isto também está errado";
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /4096 KB/);
});

test("an error never repeats what it was sent", () => {
  const variants: ((b: Body) => void)[] = [
    (b) => (b.produto = SENTINEL),
    (b) => (b.content.entries[0].status = unsafe(SENTINEL)),
    (b) => (b.content.window.start = SENTINEL),
    (b) => (b.content.entries[0].deliveredAt = SENTINEL),
    (b) => (b.content.usage.days[0].hourly = unsafe([SENTINEL])),
    (b) => (b.content.usage.days[0].date = SENTINEL),
    (b) => (b.content.shots![0].mime = unsafe(SENTINEL)),
    (b) => (b.content.shots![0].data = SENTINEL),
    (b) => (b.content.entries = unsafe(SENTINEL)),
    (b) => (b.content.entries[0].id = SENTINEL + ":"),
    (b) => (b.content.entries[0].sources = [SENTINEL]),
    (b) => (b.content.usage.scope = unsafe(SENTINEL)),
    (b) => (b.content.headline = SENTINEL.repeat(100)),
    (b) => (b.content.entries[0].title = unsafe({ [SENTINEL]: SENTINEL })),
  ];
  for (const [i, bend] of variants.entries()) {
    const r = parseBent(bend);
    assert.equal(r.ok, false, `variant ${i} should be refused`);
    if (!r.ok) assert.ok(!r.error.includes(SENTINEL), `variant ${i} echoed the value: ${r.error}`);
  }
  // Even a key the contract does not know, next to a part that is refused, is not echoed.
  const odd = parseDraft({ produto: "GeoCloud", [SENTINEL]: 1, content: null });
  assert.equal(odd.ok, false);
  if (!odd.ok) assert.ok(!odd.error.includes(SENTINEL));
});

test("fields the contract does not know are dropped: prompts, paths and the like never get stored", () => {
  const r = parseBent((b) => {
    const at = <T>(v: unknown) => v as T;
    at<Record<string, unknown>>(b.content).prompt = SENTINEL;
    at<Record<string, unknown>>(b.content.usage).cwd = `/home/example/${SENTINEL}`;
    at<Record<string, unknown>>(b.content.entries[0]).transcript = SENTINEL;
    at<Record<string, unknown>>(b.content.usage.days[0]).project = SENTINEL;
    at<Record<string, unknown>>(b.content.usage.days[0].sessions[0]).firstMessage = SENTINEL;
    at<Record<string, unknown>>(b.content.shots![0]).file = SENTINEL;
    at<Record<string, unknown>>(b)[SENTINEL] = SENTINEL;
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.ok(!JSON.stringify(r.content).includes(SENTINEL));
    assert.deepEqual(r.content, validBody().content);
  }
});

test("texts have a limit, and control characters and line breaks are cleaned up", () => {
  refused((b) => (b.content.headline = "a".repeat(2000)), /content\.headline/);
  refused((b) => (b.content.entries[0].title = "a".repeat(500)), /content\.entries\[0\]\.title/);
  refused((b) => (b.content.entries[0].title = "   "), /content\.entries\[0\]\.title/);
  refused((b) => (b.content.nextSteps[0].text = ""), /content\.nextSteps\[0\]\.text/);
  refused((b) => (b.content.usage.label = "a".repeat(200)), /content\.usage\.label/);
  const r = parseBent((b) => {
    b.content.headline = "Primeira linha\n\u0000  segunda\tlinha  ";
    b.content.entries[0].summary = "ok \uD800 sem par";
  });
  assert.equal(r.ok && r.content.headline, "Primeira linha segunda linha");
  assert.equal(r.ok && r.content.entries[0].summary, "ok � sem par");
});

test("an entry id is a short plain token and is unique, because the user's edits are keyed by it", () => {
  refused((b) => (b.content.entries[1].id = "gc-101"), /content\.entries\[1\]\.id/);
  refused((b) => (b.content.entries[0].id = "entry:title"), /content\.entries\[0\]\.id/);
  refused((b) => (b.content.entries[0].id = ""), /content\.entries\[0\]\.id/);
  refused((b) => (b.content.difficulties[0].id = "a b"), /content\.difficulties\[0\]\.id/);
  // Ids that do not follow the "gc-<number>" pattern are fine.
  assert.equal(parseBent((b) => (b.content.entries[0].id = "issue-101")).ok, true);
});

test("difficulties and next steps without an id get one from their position, so they can be edited", () => {
  const r = parseBent((b) => {
    b.content.difficulties = [
      { text: "Primeira dificuldade.", needs: "" },
      { id: "custom", text: "Segunda dificuldade.", needs: "Algo." },
      { text: "Terceira dificuldade.", needs: "" },
    ];
    b.content.nextSteps = [{ text: "Primeiro passo." }, { text: "Segundo passo." }];
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.deepEqual(r.content.difficulties.map((d) => d.id), ["d1", "custom", "d3"]);
    assert.deepEqual(r.content.nextSteps.map((n) => n.id), ["n1", "n2"]);
    assert.equal(r.content.difficulties[1].text, "Segunda dificuldade.");
  }
});

test("ids that were given are kept; a repeated one is told apart on the later items", () => {
  const ids = (build: (b: Body) => void) => {
    const r = parseBent(build);
    assert.equal(r.ok, true);
    return r.ok ? [r.content.difficulties.map((d) => d.id), r.content.nextSteps.map((n) => n.id)] : [];
  };
  const item = (id?: string) => ({ ...(id ? { id } : {}), text: "Item.", needs: "" });
  assert.deepEqual(ids((b) => (b.content.difficulties = [item("a"), item("a"), item("a")]))[0], ["a", "a-2", "a-3"]);
  assert.deepEqual(ids((b) => (b.content.nextSteps = [{ id: "x", text: "1" }, { id: "x", text: "2" }]))[1], ["x", "x-2"]);
  // A given id wins over the positional one: the item without id steps aside.
  assert.deepEqual(ids((b) => (b.content.difficulties = [item(), item("d1")]))[0], ["d1-2", "d1"]);
  // The suffix never makes an id longer than the limit.
  const long = "a".repeat(40);
  const suffixed = ids((b) => (b.content.difficulties = [item(long), item(long)]))[0];
  assert.equal(suffixed[0], long);
  assert.equal(suffixed[1]?.length, 40);
  assert.notEqual(suffixed[1], long);
});

test("pushing the same list again gives the same ids", () => {
  const build = (b: Body) => {
    b.content.difficulties = [{ text: "Uma.", needs: "" }, { text: "Outra.", needs: "" }];
    b.content.nextSteps = [{ text: "Um." }, { text: "Outro." }];
  };
  const first = parseBent(build);
  const second = parseBent(build);
  assert.equal(first.ok && second.ok, true);
  if (first.ok && second.ok) {
    assert.deepEqual(first.content.difficulties, second.content.difficulties);
    assert.deepEqual(first.content.nextSteps, second.content.nextSteps);
  }
});

test("source links must be https links to GitHub and nothing else", () => {
  refused((b) => (b.content.entries[0].sources = ["javascript:alert(1)"]), /content\.entries\[0\]\.sources\[0\]/);
  refused((b) => (b.content.entries[0].sources = ["http://github.com/example-org/example-repo/issues/1"]), /sources\[0\]/);
  refused((b) => (b.content.entries[0].sources = ["https://github.com.evil.example.com/x"]), /sources\[0\]/);
  refused((b) => (b.content.entries[0].sources = [`${LINK} onclick=x`]), /sources\[0\]/);
  assert.equal(parseBent((b) => (b.content.entries[0].sources = [`${LINK}#issuecomment-1234567890`])).ok, true);
});

test("anything that is not an object with a content object is refused", () => {
  for (const body of [null, undefined, 42, "texto", [], {}, { content: [] }, { content: "x" }, { produto: "GeoCloud" }]) {
    assert.equal(parseDraft(body).ok, false);
  }
});

test("the sign-in details are kept, and refused when they do not look like an account and a password", () => {
  const r = parseDraft(validBody());
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.content.access, { account: "reader@example.test", password: "Tmp-pass-1234" });
  const without = parseBent((b) => delete b.content.access);
  if (without.ok) assert.equal(without.content.access, undefined);
  refused((b) => (b.content.access = { account: "not an e-mail", password: "Tmp-pass-1234" }), /content\.access\.account/);
  refused((b) => (b.content.access = { account: "reader@example.test", password: "" }), /content\.access\.password/);
  refused((b) => (b.content.access = { account: "reader@example.test", password: "has space" }), /content\.access\.password/);
  refused((b) => (b.content.access = unsafe("x")), /content\.access/);
});

test("the usage section keeps the names of the projects it adds up, and refuses a malformed list", () => {
  const r = parseBent((b) => (b.content.usage.products = ["Projeto A", "Projeto B", "Projeto C"]));
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.content.usage?.products, ["Projeto A", "Projeto B", "Projeto C"]);
  const single = parseBent((b) => delete b.content.usage.products);
  if (single.ok) assert.equal(single.content.usage?.products, undefined);
  refused((b) => (b.content.usage.products = unsafe("Projeto A")), /content\.usage\.products/);
  refused((b) => (b.content.usage.products = ["Projeto A", "   "]), /content\.usage\.products\[1\]/);
  refused((b) => (b.content.usage.products = Array.from({ length: 9 }, (_, i) => `P${i}`)), /content\.usage\.products/);
});

test("the usage section is for GeoCloud and keeps its numbers whole", () => {
  refused((b) => (b.content.usage.scope = unsafe("ELIMS")), /content\.usage\.scope/);
  refused((b) => (b.content.usage.totals.messages = -1), /content\.usage\.totals\.messages/);
  refused((b) => (b.content.usage.byModel[0].output = 1.5), /content\.usage\.byModel\[0\]\.output/);
  refused((b) => (b.content.usage.peakHour = 24), /content\.usage\.peakHour/);
  refused((b) => (b.content.usage.days[0].tokens.input = unsafe("1200")), /content\.usage\.days\[0\]\.tokens\.input/);
  assert.equal(parseBent((b) => (b.content.usage.peakHour = null)).ok, true);
});

test("what a collector may leave out gets its default", () => {
  const r = parseBent((b) => {
    const entry = b.content.entries[0] as unknown as Record<string, unknown>;
    for (const key of ["deliveredAt", "subIssues", "hidden", "edited", "sources"]) delete entry[key];
    // Without prints, only deliveries that are still "próximo" may be on show.
    delete b.content.shots;
    b.content.entries.forEach((e) => (e.status = "proximo"));
    delete b.content.gaps;
    delete b.content.usage.notes;
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.deepEqual(r.content.entries[0], {
      id: "gc-101",
      issue: 101,
      status: "proximo",
      title: "Entrega de exemplo A",
      summary: "Uma frase simples que descreve a primeira entrega de exemplo.",
      deliveredAt: null,
      subIssues: null,
      hidden: false,
      edited: false,
      sources: [],
    });
    assert.ok(!("shots" in r.content) && !("gaps" in r.content) && !("notes" in r.content.usage));
  }
});

test("hostile input is refused instead of throwing", () => {
  const trap = {
    get content(): never {
      throw new Error("boom");
    },
  };
  assert.equal(parseDraft(trap).ok, false);
});

test("the sprint block is optional, rebuilt from what it knows, and its sums are made again from the covers", () => {
  assert.equal(parseBent((b) => delete b.content.sprint).ok, true);
  const r = parseBent((b) => {
    const cover = b.content.sprint!.epics[0];
    b.content.sprint!.epics.push({ ...cover, issue: 901, parts: { total: 4, done: 4, remaining: 0 }, open: [] }); // all done: not counted as going
    b.content.sprint!.totals = { covers: 99, remainingParts: 99 };
    delete (cover as { summary?: string }).summary;
    (cover as Record<string, unknown>).sentinel = SENTINEL;
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.deepEqual(r.content.sprint!.totals, { covers: 1, remainingParts: 3 });
    assert.equal(r.content.sprint!.epics[0].summary, "");
    assert.ok(!JSON.stringify(r.content).includes(SENTINEL));
  }
});

test("a bad sprint block is refused naming its field, never the value", () => {
  refused((b) => (b.content.sprint!.epics[0].parts.done = 99), /content\.sprint\.epics\[0\]\.parts/);
  refused((b) => (b.content.sprint!.epics[0].issues.done = 99), /content\.sprint\.epics\[0\]\.issues/);
  refused((b) => (b.content.sprint!.epics[0].title = unsafe(SENTINEL.length)), /content\.sprint\.epics\[0\]\.title/);
  refused((b) => b.content.sprint!.epics.push({ ...b.content.sprint!.epics[0] }), /content\.sprint\.epics\[1\]\.issue/);
  refused((b) => (b.content.sprint!.epics[0].open = Array.from({ length: 31 }, (_, i) => ({ issue: i + 1, title: "x" }))), /content\.sprint\.epics\[0\]\.open/);
  refused((b) => (b.content.sprint = unsafe("nope")), /content\.sprint/);
  const long = parseBent((b) => (b.content.sprint!.epics[0].title = SENTINEL.repeat(40)));
  assert.equal(long.ok, false);
  if (!long.ok) assert.ok(!long.error.includes(SENTINEL));
});
