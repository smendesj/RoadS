import { isValidPassword, PASSWORD_HINT } from "./validation.ts";

export type FinishResetPorts = {
  getUserId: () => Promise<string | null>;
  /** Runs under the user's own session. */
  setPassword: (password: string) => Promise<void>;
  /** Runs as the service role: the user's own session is not allowed to clear the flag. */
  clearMustReset: (userId: string) => Promise<void>;
};

// Finishing a forced password reset: the new password is checked here (the page's check can be skipped),
// set under the user's session, and only then is the account's flag cleared. If setting it fails the flag
// stays, so the reset can't be skipped by failing on purpose.
export async function finishPasswordReset(password: string, { getUserId, setPassword, clearMustReset }: FinishResetPorts): Promise<void> {
  if (!isValidPassword(password)) throw new Error("weak_password");
  const userId = await getUserId();
  if (!userId) throw new Error("not_authenticated");
  await setPassword(password);
  await clearMustReset(userId);
}

// What the page may show for a failed reset. Production masks thrown messages, so the action returns
// these instead of throwing; only known cases get a specific line.
export function resetErrorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : "";
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : "";
  if (text === "weak_password") return PASSWORD_HINT;
  if (text === "not_authenticated" || code === "session_not_found" || /session missing/i.test(text)) return "Sua sessão expirou. Peça um novo link ao admin ou entre de novo.";
  if (code === "same_password") return "A nova senha precisa ser diferente da atual.";
  return "Não foi possível salvar a senha agora. Tente de novo.";
}
