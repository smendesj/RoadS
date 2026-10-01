import { randomBytes } from "node:crypto";
import { isValidPassword } from "./validation.ts";

export type ResetPorts = {
  getEmail: (userId: string) => Promise<string | null>;
  /** Throws when the e-mail can't be sent (Supabase refuses a second one within a minute, for one). */
  sendRecoveryEmail: (email: string) => Promise<void>;
  setTemporaryPassword: (userId: string) => Promise<void>;
  flagMustReset: (userId: string) => Promise<void>;
};

// An admin's "Resetar senha". The order is the point: the e-mail goes out first, so if it can't be sent
// nothing else has happened, instead of the old password being thrown away with no way back in. The
// address is read from the account, never taken from the caller. Returns the address for the screen.
export async function resetPassword(userId: string, { getEmail, sendRecoveryEmail, setTemporaryPassword, flagMustReset }: ResetPorts): Promise<string> {
  const email = await getEmail(userId);
  if (!email) throw new Error("user_not_found");
  await sendRecoveryEmail(email);
  await setTemporaryPassword(userId);
  await flagMustReset(userId);
  return email;
}

// Nobody ever sees this password: it only exists to make the old one stop working.
export function temporaryPassword(): string {
  for (;;) {
    const candidate = randomBytes(24).toString("base64url");
    if (isValidPassword(candidate)) return candidate;
  }
}

// What the Config screen says when a reset fails. Thrown messages never reach the screen as they are.
export function resetFailureMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : typeof error === "object" && error !== null && "message" in error ? String((error as { message: unknown }).message) : "";
  const status = typeof error === "object" && error !== null && "status" in error ? Number((error as { status: unknown }).status) : 0;
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : "";
  if (status === 429 || code === "over_email_send_rate_limit" || /rate limit|only request this after/i.test(text)) {
    return "O e-mail de redefinição só pode ser enviado uma vez por minuto para a mesma pessoa. Tente de novo em instantes.";
  }
  if (text === "user_not_found") return "Usuário não encontrado.";
  return "Não foi possível concluir o reset agora. Tente de novo.";
}
