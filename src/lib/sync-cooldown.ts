// A second sync inside this window gets the last result back instead of spending GitHub API calls: the
// token's quota is shared with the daily cron and with whoever owns it, and any role can press the button.
// FrontlightS's sync-before-fetch counts as the same press.
export const SYNC_COOLDOWN_MS = 30_000;
