// A 500 that tells the caller nothing about what broke (table names, SQL errors); the details go to
// the server log instead. Plain Response.json so it also runs outside Next.
export function serverError(context: string, error: unknown): Response {
  console.error(`${context} failed`, error);
  return Response.json({ error: "internal_error" }, { status: 500 });
}
