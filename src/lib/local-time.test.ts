import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { formatLocalTime } from "./local-time.ts";
import { useLocalTime } from "./use-local-time.ts";

const SYNCED_AT = "2026-10-01T11:16:55.000Z";

test("the time is shown in the viewer's own time zone, 24h, pt-BR", () => {
  assert.equal(formatLocalTime(SYNCED_AT, "America/Sao_Paulo"), "08:16:55");
  assert.equal(formatLocalTime(SYNCED_AT, "UTC"), "11:16:55");
});

test("a timestamp that isn't a date shows nothing", () => {
  assert.equal(formatLocalTime("not a date"), null);
});

// The server can't know the viewer's time zone. If it printed a time, the Vercel server (UTC)
// and the browser (São Paulo) would disagree on the text and React would throw the server HTML away.
function Probe({ iso }: { iso: string | null }) {
  return createElement("span", null, `Última sincronização: ${useLocalTime(iso) ?? "—"}`);
}

test("the server render never depends on the time, so it can't disagree with any browser", () => {
  const withTime = renderToString(createElement(Probe, { iso: SYNCED_AT }));
  const withoutTime = renderToString(createElement(Probe, { iso: null }));
  assert.equal(withTime, withoutTime);
  assert.match(withTime, /Última sincronização: —/);
});
