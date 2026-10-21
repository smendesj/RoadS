// A second sync inside this window gets the last result back instead of spending GitHub API calls: the
// token's quota is shared with the daily cron and with whoever owns it, and any role can press the button.
// FrontlightS's sync-before-fetch counts as the same press.
export const SYNC_COOLDOWN_MS = 30_000;

// How long a sync may run, in seconds: the maxDuration of every route and page that syncs (the cron and FrontlightS
// routes, the Dashboard and the Roadmap, whose server actions sync). Next reads that setting only as a literal, so each
// of those files writes 300 and sync-cooldown.test.ts checks they all agree with this. 300 s is what Vercel allows a
// function with Fluid compute on every plan; a round took 121 s on 21/10/2026, the first after issue #22.
export const SYNC_MAX_DURATION_S = 300;
