import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatDay,
  formatStamp,
  isConferenceCurrent,
  isUuid,
  partsLabel,
  previewDocument,
  reasonMessage,
  reportPeriodLabel,
  statusCounts,
} from "./report-view.ts";
import type { ProgressContent, ProgressEntry } from "../progress-report.ts";

const entry = (over: Partial<ProgressEntry>): ProgressEntry => ({
  id: "gc-1",
  issue: 1,
  status: "concluido",
  title: "Título",
  summary: "Frase.",
  deliveredAt: null,
  subIssues: null,
  hidden: false,
  edited: false,
  sources: [],
  ...over,
});

const content = (over: Partial<ProgressContent> = {}): ProgressContent => ({
  window: { start: "2026-09-28T00:00:00-03:00", end: "2026-09-30T00:00:00-03:00" },
  headline: "Abertura sugerida.",
  entries: [],
  internal: { count: 2, text: "Dois ajustes internos." },
  difficulties: [{ id: "d1", text: "Atraso no teste.", needs: "Uma pessoa a mais." }],
  nextSteps: [{ id: "n1", text: "Validar com o cliente." }],
  usage: {
    scope: "GeoCloud",
    window: { start: "2026-09-28T00:00:00-03:00", end: "2026-09-30T00:00:00-03:00" },
    generatedAt: "2026-09-30T12:00:00-03:00",
    totals: { sessions: 0, messages: 0, activeDays: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
    byModel: [],
    favoriteModel: null,
    peakHour: null,
    days: [],
  },
  ...over,
});

/* ---------- period ---------- */

test("the period shows the first and the last day included, the end being exclusive", () => {
  assert.equal(reportPeriodLabel({ start: "2026-09-28T00:00:00-03:00", end: "2026-09-30T00:00:00-03:00" }), "28/09 a 29/09");
});

test("the period reads the same when the database hands the instants back in UTC", () => {
  assert.equal(reportPeriodLabel({ start: "2026-09-28T03:00:00+00:00", end: "2026-09-30T03:00:00+00:00" }), "28/09 a 29/09");
});

test("a one-day (or empty) window names a single day instead of a backwards range", () => {
  assert.equal(reportPeriodLabel({ start: "2026-09-28T00:00:00-03:00", end: "2026-09-29T00:00:00-03:00" }), "28/09");
  assert.equal(reportPeriodLabel({ start: "2026-09-28T00:00:00-03:00", end: "2026-09-28T00:00:00-03:00" }), "28/09");
});

test("a window that runs up to 'now' counts today as included", () => {
  assert.equal(reportPeriodLabel({ start: "2026-09-30T00:00:00-03:00", end: "2026-10-01T15:00:00.000Z" }), "30/09 a 01/10");
});

/* ---------- dates in São Paulo, spelled out so the server and every browser print the same text ---------- */

test("stamps are São Paulo time with a fixed shape, whatever the machine's own zone", () => {
  assert.equal(formatStamp("2026-10-01T15:05:00Z"), "01/10/2026 12:05");
  // 02:30 UTC is still the evening before in São Paulo.
  assert.equal(formatStamp("2026-10-01T02:30:00Z"), "30/09/2026 23:30");
  // Midnight is 00:00, not 24:00.
  assert.equal(formatStamp("2026-10-01T03:00:00Z"), "01/10/2026 00:00");
});

test("a value that is not a date shows a dash instead of 'Invalid Date'", () => {
  assert.equal(formatStamp("nada"), "—");
  assert.equal(formatStamp(null), "—");
  assert.equal(formatDay(undefined), "—");
});

test("a day label is dd/mm in São Paulo", () => {
  assert.equal(formatDay("2026-10-01T02:30:00Z"), "30/09");
});

/* ---------- counters on the card ---------- */

test("the counters count what the e-mail will show: hidden entries are left out", () => {
  const counts = statusCounts(
    content({
      entries: [
        entry({ id: "gc-1", status: "concluido" }),
        entry({ id: "gc-2", status: "concluido" }),
        entry({ id: "gc-3", status: "concluido", hidden: true }),
        entry({ id: "gc-4", status: "em_validacao" }),
        entry({ id: "gc-5", status: "bloqueado" }),
      ],
    })
  );
  assert.deepEqual(counts, { concluido: 2, em_validacao: 1, em_andamento: 0, bloqueado: 1, proximo: 0 });
});

/* ---------- the conference stays valid only for the draft it was ticked over ---------- */

test("numbers count as conferred only if ticked after the last push of the draft", () => {
  const pushed_at = "2026-10-01T12:00:00Z";
  assert.equal(isConferenceCurrent({ checked_at: null, pushed_at }), false);
  assert.equal(isConferenceCurrent({ checked_at: "2026-10-01T11:59:59Z", pushed_at }), false);
  assert.equal(isConferenceCurrent({ checked_at: "2026-10-01T12:00:00Z", pushed_at }), true);
  assert.equal(isConferenceCurrent({ checked_at: "2026-10-01T12:30:00Z", pushed_at }), true);
});

/* ---------- ids in the address bar ---------- */

test("only a well-formed id reaches the database", () => {
  assert.equal(isUuid("0b9f1c2e-3d4a-4b5c-8d6e-7f8091a2b3c4"), true);
  assert.equal(isUuid("../../etc/passwd"), false);
  assert.equal(isUuid("0b9f1c2e-3d4a-4b5c-8d6e-7f8091a2b3c4'; drop table x"), false);
  assert.equal(isUuid(""), false);
});

/* ---------- the preview frame ---------- */

test("the preview keeps links inert so a click cannot load the app inside its own frame", () => {
  const doc = previewDocument("<html><head><title>x</title></head><body><a href=\"https://roads-psi.vercel.app\">RoadS</a></body></html>");
  assert.match(doc, /<head>\s*<style>[^<]*pointer-events:\s*none/i);
  assert.match(doc, /<a href="https:\/\/roads-psi\.vercel\.app">RoadS<\/a>/);
});

test("the inert-link style never goes before a doctype (that would flip the e-mail into quirks mode)", () => {
  const doc = previewDocument("<!DOCTYPE html><html><body><p>oi</p></body></html>");
  assert.ok(doc.startsWith("<!DOCTYPE html>"), doc.slice(0, 40));
  assert.match(doc, /pointer-events:\s*none/i);
});

test("a bare fragment is previewed as it is, with the style in front", () => {
  const doc = previewDocument("<table><tr><td>oi</td></tr></table>");
  assert.match(doc, /^<style>[^<]*pointer-events:\s*none[^<]*<\/style><table>/i);
});

/* ---------- messages for the reasons an action can be refused ---------- */

test("every reason an action can give for refusing reads as a sentence in Portuguese", () => {
  assert.match(reasonMessage("stale"), /Recarregue/);
  assert.match(reasonMessage("sent"), /já foi enviado/);
  assert.match(reasonMessage("not_checked"), /Conferi os números/);
  assert.match(reasonMessage("not_found"), /não foi encontrado/);
  assert.match(reasonMessage("empty"), /vazio/);
  assert.match(reasonMessage("too_long"), /longo demais/);
  for (const bad of ["invalid", "invalid_key", "invalid_value", "invalid_status"]) assert.match(reasonMessage(bad), /não foi aceito/, bad);
  assert.match(reasonMessage("unavailable"), /Tente de novo/);
  assert.match(reasonMessage("forbidden"), /permissão/);
  assert.match(reasonMessage("unauthenticated"), /sessão/);
  assert.match(reasonMessage("must_reset_password"), /nova senha/);
});

test("a reason nobody foresaw still gives a usable sentence, never undefined or the raw code", () => {
  for (const odd of ["algo-novo", "", undefined, null, "constructor", "__proto__"]) {
    const message = reasonMessage(odd);
    assert.match(message, /Não foi possível/);
    assert.ok(!message.includes("algo-novo"));
  }
});

test("the parts of a delivery read as plain words, in the singular too, and nothing for a delivery with no parts", () => {
  assert.equal(partsLabel({ total: 8, done: 3 }), "3 de 8 partes prontas");
  assert.equal(partsLabel({ total: 5, done: 5 }), "5 de 5 partes prontas");
  assert.equal(partsLabel({ total: 1, done: 0 }), "0 de 1 parte pronta");
  assert.equal(partsLabel(null), null);
  assert.equal(partsLabel({ total: 0, done: 0 }), null);
  assert.equal(partsLabel(undefined), null);
});
