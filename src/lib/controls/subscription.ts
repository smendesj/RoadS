// ControlS domain types and the dashboard math — pure, no database, no environment, so every number the
// screen shows is unit-tested here. Money is kept as a number in the subscription's currency (BRL by
// default); a missing amount (price still being collected) is null and counts as zero in the totals.

export type BillingCycle = "monthly" | "annual" | "one_off";
export type SubStatus = "active" | "inactive" | "to_register";

export const BILLING_CYCLES: BillingCycle[] = ["monthly", "annual", "one_off"];
export const SUB_STATUSES: SubStatus[] = ["active", "inactive", "to_register"];

/** One subscription as the screen sees it. `hasSecret` stands in for the vault's ciphertext, which the
 *  listing never carries to the browser — the password is fetched on its own, by its own action. */
export type Subscription = {
  id: string;
  name: string;
  category: string | null;
  accessUrl: string | null;
  loginIdentifier: string | null;
  loginEmail: string | null;
  hasSecret: boolean;
  amount: number | null;
  currency: string;
  billingCycle: BillingCycle;
  billingDay: number | null;
  nextChargeDate: string | null;
  status: SubStatus;
  notes: string | null;
};

/** What a create/edit form sends. The secret is handled apart: undefined keeps it, null clears it, a string sets it. */
export type SubscriptionInput = {
  name: string;
  category: string | null;
  accessUrl: string | null;
  loginIdentifier: string | null;
  loginEmail: string | null;
  amount: number | null;
  currency: string;
  billingCycle: BillingCycle;
  billingDay: number | null;
  nextChargeDate: string | null;
  status: SubStatus;
  notes: string | null;
};

export function isBillingCycle(value: unknown): value is BillingCycle {
  return value === "monthly" || value === "annual" || value === "one_off";
}

export function isSubStatus(value: unknown): value is SubStatus {
  return value === "active" || value === "inactive" || value === "to_register";
}

/** What a subscription costs per month, normalized: annual is spread over 12, a one-off counts as zero
 *  recurring. A null amount is zero. Never negative. */
export function monthlyEquivalent(sub: Pick<Subscription, "amount" | "billingCycle">): number {
  if (sub.amount == null || !Number.isFinite(sub.amount)) return 0;
  const amount = Math.max(0, sub.amount);
  if (sub.billingCycle === "monthly") return amount;
  if (sub.billingCycle === "annual") return amount / 12;
  return 0;
}

export type Totals = {
  monthly: number;
  annual: number;
  oneOffTotal: number;
  activeCount: number;
  total: number;
};

/** The headline numbers, over the active subscriptions only. Monthly is the sum of the normalized monthly
 *  costs; annual is that times twelve; one-offs are summed on their own (a single charge, not recurring). */
export function totals(subs: Subscription[]): Totals {
  const active = subs.filter((s) => s.status === "active");
  let monthly = 0;
  let oneOffTotal = 0;
  for (const s of active) {
    monthly += monthlyEquivalent(s);
    if (s.billingCycle === "one_off" && s.amount != null && Number.isFinite(s.amount)) {
      oneOffTotal += Math.max(0, s.amount);
    }
  }
  return {
    monthly,
    annual: monthly * 12,
    oneOffTotal,
    activeCount: active.length,
    total: subs.length,
  };
}

export type CategorySlice = { category: string; monthly: number; count: number };

/** Monthly spend and count grouped by category (a missing category is "Uncategorized"), active subs only,
 *  biggest spend first then by name. Categories with zero spend still appear (they are real subscriptions). */
export function byCategory(subs: Subscription[]): CategorySlice[] {
  const map = new Map<string, CategorySlice>();
  for (const s of subs.filter((x) => x.status === "active")) {
    const category = s.category?.trim() || "Uncategorized";
    const slice = map.get(category) ?? { category, monthly: 0, count: 0 };
    slice.monthly += monthlyEquivalent(s);
    slice.count += 1;
    map.set(category, slice);
  }
  return [...map.values()].sort((a, b) => b.monthly - a.monthly || a.category.localeCompare(b.category));
}

export type ServiceBar = { id: string; name: string; monthly: number };

/** Per-service monthly spend, active subs with a real recurring cost, biggest first — the bar chart's rows. */
export function byService(subs: Subscription[]): ServiceBar[] {
  return subs
    .filter((s) => s.status === "active")
    .map((s) => ({ id: s.id, name: s.name, monthly: monthlyEquivalent(s) }))
    .filter((s) => s.monthly > 0)
    .sort((a, b) => b.monthly - a.monthly || a.name.localeCompare(b.name));
}

/** The single biggest recurring monthly spend among active subs, or null when none has a price yet. */
export function biggestSpend(subs: Subscription[]): ServiceBar | null {
  return byService(subs)[0] ?? null;
}

// ---- Renewals -------------------------------------------------------------------------------------------

/** A date as YYYY-MM-DD in UTC, so "today" and a stored date line up without a timezone drifting the day. */
function toUtcDate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

/** The next charge date for a subscription, on or after `today`. A stored next_charge_date wins; otherwise a
 *  monthly sub with a billing day rolls to the next occurrence of that day. Returns null when nothing is known
 *  (an annual sub with only a day-of-month is ambiguous, so it is left out rather than guessed). */
export function nextCharge(
  sub: Pick<Subscription, "billingCycle" | "billingDay" | "nextChargeDate" | "status">,
  today: Date
): Date | null {
  if (sub.status !== "active") return null;
  if (sub.nextChargeDate) {
    const explicit = toUtcDate(sub.nextChargeDate);
    if (explicit) return explicit;
  }
  if (sub.billingCycle === "monthly" && sub.billingDay != null) {
    const year = today.getUTCFullYear();
    const month = today.getUTCMonth();
    for (let add = 0; add < 3; add++) {
      const m = month + add;
      const candidate = new Date(Date.UTC(year, m, 1));
      const lastDay = new Date(Date.UTC(candidate.getUTCFullYear(), candidate.getUTCMonth() + 1, 0)).getUTCDate();
      const day = Math.min(sub.billingDay, lastDay);
      const date = new Date(Date.UTC(candidate.getUTCFullYear(), candidate.getUTCMonth(), day));
      if (daysBetween(today, date) >= 0) return date;
    }
  }
  return null;
}

export type Renewal = { id: string; name: string; date: string; daysUntil: number };

/** Active subscriptions renewing within `windowDays` of today (today included), soonest first. The date is
 *  returned as YYYY-MM-DD; daysUntil is 0 for today. Drives both the "upcoming renewals" card and the row badge. */
export function upcomingRenewals(subs: Subscription[], today: Date, windowDays = 10): Renewal[] {
  const out: Renewal[] = [];
  for (const s of subs) {
    const date = nextCharge(s, today);
    if (!date) continue;
    const daysUntil = daysBetween(today, date);
    if (daysUntil >= 0 && daysUntil <= windowDays) {
      out.push({ id: s.id, name: s.name, date: date.toISOString().slice(0, 10), daysUntil });
    }
  }
  return out.sort((a, b) => a.daysUntil - b.daysUntil || a.name.localeCompare(b.name));
}

/** Money for the screen: the subscription's currency, grouped thousands, two decimals. BRL shows as "R$". */
export function formatMoney(value: number, currency = "BRL"): string {
  const symbol = currency === "BRL" ? "R$" : currency === "USD" ? "$" : currency === "EUR" ? "€" : "";
  const fixed = value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return symbol ? `${symbol} ${fixed}` : `${fixed} ${currency}`;
}
