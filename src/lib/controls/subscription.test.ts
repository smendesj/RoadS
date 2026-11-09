import { test } from "node:test";
import assert from "node:assert/strict";
import {
  biggestSpend,
  byCategory,
  byService,
  formatMoney,
  monthlyEquivalent,
  nextCharge,
  totals,
  upcomingRenewals,
  type Subscription,
} from "./subscription.ts";

function sub(partial: Partial<Subscription>): Subscription {
  return {
    id: partial.id ?? crypto.randomUUID(),
    name: partial.name ?? "Service",
    category: partial.category ?? null,
    accessUrl: partial.accessUrl ?? null,
    loginIdentifier: partial.loginIdentifier ?? null,
    loginEmail: partial.loginEmail ?? null,
    hasSecret: partial.hasSecret ?? false,
    amount: partial.amount ?? null,
    currency: partial.currency ?? "BRL",
    billingCycle: partial.billingCycle ?? "monthly",
    billingDay: partial.billingDay ?? null,
    nextChargeDate: partial.nextChargeDate ?? null,
    status: partial.status ?? "active",
    notes: partial.notes ?? null,
  };
}

test("monthlyEquivalent normalizes by cycle and tolerates a missing amount", () => {
  assert.equal(monthlyEquivalent({ amount: 100, billingCycle: "monthly" }), 100);
  assert.equal(monthlyEquivalent({ amount: 120, billingCycle: "annual" }), 10);
  assert.equal(monthlyEquivalent({ amount: 500, billingCycle: "one_off" }), 0);
  assert.equal(monthlyEquivalent({ amount: null, billingCycle: "monthly" }), 0);
  assert.equal(monthlyEquivalent({ amount: -50, billingCycle: "monthly" }), 0);
});

test("totals sum only active subs; annual spreads over 12; one-offs are their own line", () => {
  const subs = [
    sub({ amount: 100, billingCycle: "monthly" }),
    sub({ amount: 1200, billingCycle: "annual" }), // 100/mo
    sub({ amount: 300, billingCycle: "one_off" }),
    sub({ amount: 999, billingCycle: "monthly", status: "inactive" }), // excluded
    sub({ amount: null, billingCycle: "monthly" }), // counts as 0 but is active
  ];
  const t = totals(subs);
  assert.equal(t.monthly, 200);
  assert.equal(t.annual, 2400);
  assert.equal(t.oneOffTotal, 300);
  assert.equal(t.activeCount, 4);
  assert.equal(t.total, 5);
});

test("byCategory groups active subs, biggest spend first, and keeps zero-price categories", () => {
  const slices = byCategory([
    sub({ category: "AI", amount: 50, billingCycle: "monthly" }),
    sub({ category: "AI", amount: 120, billingCycle: "annual" }), // +10
    sub({ category: "Infra", amount: 400, billingCycle: "monthly" }),
    sub({ category: null, amount: null, billingCycle: "monthly" }),
  ]);
  assert.deepEqual(
    slices.map((s) => [s.category, s.monthly, s.count]),
    [
      ["Infra", 400, 1],
      ["AI", 60, 2],
      ["Uncategorized", 0, 1],
    ]
  );
});

test("byService lists only priced active subs, biggest first; biggestSpend picks the top", () => {
  const subs = [
    sub({ name: "Big", amount: 500, billingCycle: "monthly" }),
    sub({ name: "Small", amount: 1200, billingCycle: "annual" }), // 100/mo
    sub({ name: "Free", amount: 0, billingCycle: "monthly" }), // dropped (no recurring cost)
    sub({ name: "Unknown", amount: null, billingCycle: "monthly" }),
  ];
  assert.deepEqual(byService(subs).map((s) => s.name), ["Big", "Small"]);
  assert.equal(biggestSpend(subs)?.name, "Big");
  assert.equal(biggestSpend([sub({ amount: null })]), null);
});

test("nextCharge prefers an explicit date, else rolls a monthly billing day forward", () => {
  const today = new Date(Date.UTC(2026, 10, 9)); // Nov 9 2026
  assert.equal(nextCharge({ billingCycle: "monthly", billingDay: 15, nextChargeDate: null, status: "active" }, today)?.toISOString().slice(0, 10), "2026-11-15");
  assert.equal(nextCharge({ billingCycle: "monthly", billingDay: 5, nextChargeDate: null, status: "active" }, today)?.toISOString().slice(0, 10), "2026-12-05");
  assert.equal(nextCharge({ billingCycle: "monthly", billingDay: null, nextChargeDate: "2026-11-20", status: "active" }, today)?.toISOString().slice(0, 10), "2026-11-20");
  assert.equal(nextCharge({ billingCycle: "annual", billingDay: 10, nextChargeDate: null, status: "active" }, today), null);
  assert.equal(nextCharge({ billingCycle: "monthly", billingDay: 15, nextChargeDate: null, status: "inactive" }, today), null);
});

test("upcomingRenewals flags only those within the window, soonest first", () => {
  const today = new Date(Date.UTC(2026, 10, 9));
  const subs = [
    sub({ name: "Soon", billingCycle: "monthly", billingDay: 12 }), // +3 days
    sub({ name: "Today", nextChargeDate: "2026-11-09" }), // 0 days
    sub({ name: "Later", billingCycle: "monthly", billingDay: 28 }), // +19 days, out
  ];
  const renewals = upcomingRenewals(subs, today, 10);
  assert.deepEqual(renewals.map((r) => [r.name, r.daysUntil]), [["Today", 0], ["Soon", 3]]);
});

test("formatMoney uses the currency symbol and two decimals", () => {
  assert.equal(formatMoney(596.2, "BRL"), "R$ 596.20");
  assert.equal(formatMoney(1376, "BRL"), "R$ 1,376.00");
  assert.equal(formatMoney(10, "USD"), "$ 10.00");
});
