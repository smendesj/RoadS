// The contract RoadS keeps with Frontlights (docs/frontlights-contract.md): every JSON body of a door under
// /api/frontlights says which version of the contract it follows, and a request that names another version
// is refused. A body that names none is version 1, so what already runs keeps working. Pure on purpose: the
// doors, their handlers and the tests all use it without a server.

export const SCHEMA_VERSION = 1;

/** What a handler decides: the status and the body, before the door puts them on the wire. */
export type Answer = { status: number; body: Record<string, unknown> };

/** A JSON response of a door: the body, with the version of the contract in front. Errors too. */
export function frontlightsJson(body: Record<string, unknown>, status = 200): Response {
  return Response.json({ schemaVersion: SCHEMA_VERSION, ...body }, { status });
}

export function answerJson(answer: Answer): Response {
  return frontlightsJson(answer.body, answer.status);
}

/**
 * A request body that names a version other than the supported one is refused (400); one that names none, or
 * the supported one, passes (null). A body that is not an object has no version to refuse: the handler says
 * what is wrong with it.
 */
export type UnsupportedSchema = { status: 400; body: { error: "unsupported_schema_version"; supported: number } };

export function unsupportedSchema(body: unknown): UnsupportedSchema | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  if (!("schemaVersion" in body) || (body as { schemaVersion: unknown }).schemaVersion === SCHEMA_VERSION) return null;
  return { status: 400, body: { error: "unsupported_schema_version", supported: SCHEMA_VERSION } };
}
