// "08:16:55" in the viewer's time zone (or the given one), pt-BR, 24h; null for a non-date.
export function formatLocalTime(iso: string, timeZone?: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString("pt-BR", { timeZone });
}
