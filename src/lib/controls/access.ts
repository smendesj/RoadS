// Who may open ControlS: an e-mail allowlist, not a role. The same list is the RLS boundary in the
// database (migration 0046, public.is_controls_member) — keep the two in step. The test admin's
// plus-address is the founder's own mailbox, kept here so the automated admin account reaches the
// section too (mirrors migration 0015).

export const CONTROLS_MEMBERS = [
  "sergio.mendes@essencislabs.com",
  "sergio.mendes+roads-test@essencislabs.com",
  "joao.fiori@essencistech.com.br",
] as const;

/** A member is recognized by e-mail, case-insensitively, trimmed; anything unknown is not a member. */
export function isControlsEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  return (CONTROLS_MEMBERS as readonly string[]).includes(normalized);
}
