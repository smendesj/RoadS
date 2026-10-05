// The one way into every /api/frontlights route: the shared secret first (a 401 otherwise), then the handler,
// and a handler that throws becomes a plain 500 that says nothing about what broke (the details go to the
// server log). Every answer made here says the version of the contract, and every call that got through the
// secret is written down (calls.ts) once its answer is ready. The secret check, the log and the clock are
// passed in so the door runs under test without the environment; src/lib/frontlights/doors.ts plugs in the
// real ones.
import { serverError } from "../api-response.ts";
import { describeCall } from "./calls.ts";
import type { CallRecord } from "./calls.ts";
import { frontlightsJson } from "./contract.ts";

export type DoorOptions = {
  /** The route's pattern under /api/frontlights, e.g. "/ack" or "/progress-report/[id]/shots": what the log keeps. */
  route: string;
  authorized: (request: Request) => boolean;
  /** Called with every call that got through the secret, after its answer is ready. It may throw: nothing is lost. */
  record?: (call: CallRecord) => void;
  now?: () => number;
};

export function frontlightsDoor<Context = unknown>(
  options: DoorOptions,
  handle: (request: Request, context: Context) => Promise<Response>
): (request: Request, context: Context) => Promise<Response> {
  const now = options.now ?? Date.now;
  return async (request, context) => {
    if (!options.authorized(request)) {
      // Only in the server's log, never in the table of calls (so nobody outside can fill it), and nothing of
      // the request but its method and route.
      console.warn(`frontlights ${request.method} ${options.route} refused: no valid secret`);
      return frontlightsJson({ error: "unauthorized" }, 401);
    }

    const startedAt = now();
    let response: Response;
    try {
      response = await handle(request, context);
    } catch (error) {
      response = serverError(`${request.method} ${options.route}`, error);
    }

    try {
      options.record?.(
        describeCall({ method: request.method, route: options.route, status: response.status, userAgent: request.headers.get("user-agent"), startedAt, endedAt: now() })
      );
    } catch (error) {
      console.error("frontlights call log failed", error);
    }
    return response;
  };
}
