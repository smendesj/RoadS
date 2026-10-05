import { frontlightsJson } from "./frontlights/contract.ts";

// A 500 that tells the caller nothing about what broke (table names, SQL errors); the details go to
// the server log instead. Like every answer of a Frontlights door it says the version of the contract.
// Plain Response.json underneath, so it also runs outside Next.
export function serverError(context: string, error: unknown): Response {
  console.error(`${context} failed`, error);
  return frontlightsJson({ error: "internal_error" }, 500);
}
