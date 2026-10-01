export const ALLOWED_DOMAINS = ["essencislabs.com", "essencistech.com.br"];

// Exactly one "@": taking whatever follows the first one would let "ana@essencislabs.com@evil.com" in.
export function isAllowedEmail(email: string): boolean {
  const parts = email.trim().toLowerCase().split("@");
  return parts.length === 2 && !!parts[0] && ALLOWED_DOMAINS.includes(parts[1]);
}

export function emailDomainHint(): string {
  return ALLOWED_DOMAINS.map((d) => `@${d}`).join(" ou ");
}

// 8+ chars, at least one letter and one digit. Uppercase, lowercase and special characters are
// all allowed but none of them is required.
export function isValidPassword(password: string): boolean {
  return password.length >= 8 && /[A-Za-z]/.test(password) && /\d/.test(password);
}

export const PASSWORD_HINT = "Mínimo 8 caracteres, com letras e números.";
