"use server";

import { isControlsEmail } from "@/lib/controls/access";
import { decryptSecret, encryptSecret, vaultKey } from "@/lib/controls/vault";
import {
  isBillingCycle,
  isSubStatus,
  type Subscription,
  type SubscriptionInput,
} from "@/lib/controls/subscription";
import { createClient } from "@/lib/supabase/server";

// ControlS is limited to its two members (src/lib/controls/access.ts), the same boundary the database
// enforces (migration 0046). Every action here re-checks it on its own: a "use server" export is an HTTP
// endpoint any signed-in user can call, so the gate can't live only in the page.
async function requireMember(): Promise<{ userId: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("unauthenticated");
  if (!isControlsEmail(user.email)) throw new Error("forbidden");
  return { userId: user.id };
}

type Row = {
  id: string;
  name: string;
  category: string | null;
  access_url: string | null;
  login_identifier: string | null;
  login_email: string | null;
  secret_password: string | null;
  amount: number | string | null;
  currency: string;
  billing_cycle: string;
  billing_day: number | null;
  next_charge_date: string | null;
  status: string;
  notes: string | null;
};

const COLUMNS =
  "id, name, category, access_url, login_identifier, login_email, secret_password, amount, currency, billing_cycle, billing_day, next_charge_date, status, notes";

// Maps a row to the shape the screen sees. The ciphertext never leaves this function: it becomes the
// `hasSecret` flag and is dropped, so the listing can't ship a password (even sealed) to the browser.
function toSubscription(row: Row): Subscription {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    accessUrl: row.access_url,
    loginIdentifier: row.login_identifier,
    loginEmail: row.login_email,
    hasSecret: Boolean(row.secret_password),
    amount: row.amount == null ? null : Number(row.amount),
    currency: row.currency,
    billingCycle: isBillingCycle(row.billing_cycle) ? row.billing_cycle : "monthly",
    billingDay: row.billing_day,
    nextChargeDate: row.next_charge_date,
    status: isSubStatus(row.status) ? row.status : "active",
    notes: row.notes,
  };
}

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

// A create/edit form's fields, validated into the database columns. Throws on a bad shape; the secret is
// handled apart (it is encrypted, never logged, never echoed back).
function sanitize(input: SubscriptionInput): Record<string, unknown> {
  const name = clean(input.name);
  if (!name) throw new Error("name_required");
  if (!isBillingCycle(input.billingCycle)) throw new Error("invalid_billing_cycle");
  if (!isSubStatus(input.status)) throw new Error("invalid_status");

  const amount =
    input.amount == null || !Number.isFinite(input.amount) ? null : Math.max(0, Math.round(input.amount * 100) / 100);
  const billingDay =
    input.billingDay == null || !Number.isInteger(input.billingDay)
      ? null
      : Math.min(31, Math.max(1, input.billingDay));
  const nextChargeDate = /^\d{4}-\d{2}-\d{2}$/.test(input.nextChargeDate ?? "") ? input.nextChargeDate : null;

  return {
    name,
    category: clean(input.category),
    access_url: clean(input.accessUrl),
    login_identifier: clean(input.loginIdentifier),
    login_email: clean(input.loginEmail),
    amount,
    currency: clean(input.currency) ?? "BRL",
    billing_cycle: input.billingCycle,
    billing_day: billingDay,
    next_charge_date: nextChargeDate,
    status: input.status,
    notes: clean(input.notes),
  };
}

// `secret` says what to do with the vault password: undefined keeps it, null clears it, a string sets it
// (sealed before it is stored). Returns the column patch, or throws "vault_locked" when a set is asked for
// but the server has no key.
function secretPatch(secret: string | null | undefined): Record<string, unknown> {
  if (secret === undefined) return {};
  if (secret === null || secret.trim() === "") return { secret_password: null };
  const key = vaultKey();
  if (!key) throw new Error("vault_locked");
  return { secret_password: encryptSecret(secret, key) };
}

export async function listSubscriptions(): Promise<{ subscriptions: Subscription[]; vaultReady: boolean }> {
  await requireMember();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("subscriptions")
    .select(COLUMNS)
    .order("status", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw error;
  return { subscriptions: (data as Row[]).map(toSubscription), vaultReady: vaultKey() !== null };
}

export async function createSubscription(
  input: SubscriptionInput,
  secret: string | null
): Promise<{ ok: true; subscription: Subscription } | { ok: false; error: string }> {
  try {
    const { userId } = await requireMember();
    const supabase = await createClient();
    const patch = { ...sanitize(input), ...secretPatch(secret), created_by: userId };
    const { data, error } = await supabase.from("subscriptions").insert(patch).select(COLUMNS).single();
    if (error) throw error;
    return { ok: true, subscription: toSubscription(data as Row) };
  } catch (e) {
    console.error("createSubscription failed", e);
    return { ok: false, error: errorCode(e) };
  }
}

export async function updateSubscription(
  id: string,
  input: SubscriptionInput,
  secret: string | null | undefined
): Promise<{ ok: true; subscription: Subscription } | { ok: false; error: string }> {
  try {
    await requireMember();
    const supabase = await createClient();
    const patch = { ...sanitize(input), ...secretPatch(secret), updated_at: new Date().toISOString() };
    const { data, error } = await supabase.from("subscriptions").update(patch).eq("id", id).select(COLUMNS).single();
    if (error) throw error;
    return { ok: true, subscription: toSubscription(data as Row) };
  } catch (e) {
    console.error("updateSubscription failed", e);
    return { ok: false, error: errorCode(e) };
  }
}

export async function deleteSubscription(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireMember();
    const supabase = await createClient();
    const { error } = await supabase.from("subscriptions").delete().eq("id", id);
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    console.error("deleteSubscription failed", e);
    return { ok: false, error: errorCode(e) };
  }
}

// The one place a stored password is opened. Gated like the rest, and the ciphertext is decrypted only here,
// only for the row asked for, only when the server holds the key.
export async function revealSubscriptionSecret(
  id: string
): Promise<{ ok: true; secret: string | null } | { ok: false; error: string }> {
  try {
    await requireMember();
    const supabase = await createClient();
    const { data, error } = await supabase.from("subscriptions").select("secret_password").eq("id", id).single();
    if (error) throw error;
    const sealed = (data as { secret_password: string | null }).secret_password;
    if (!sealed) return { ok: true, secret: null };
    const key = vaultKey();
    if (!key) return { ok: false, error: "vault_locked" };
    return { ok: true, secret: decryptSecret(sealed, key) };
  } catch (e) {
    console.error("revealSubscriptionSecret failed", e);
    return { ok: false, error: "reveal_failed" };
  }
}

function errorCode(e: unknown): string {
  const message = e instanceof Error ? e.message : "";
  if (message === "name_required" || message === "vault_locked" || message === "forbidden" || message === "unauthenticated") {
    return message;
  }
  return "save_failed";
}
