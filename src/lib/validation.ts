const ALLOWED_DOMAINS = ["essencislabs.com", "essencistech.com.br"];

export function isAllowedEmail(email: string): boolean {
  const domain = email.trim().toLowerCase().split("@")[1];
  return !!domain && ALLOWED_DOMAINS.includes(domain);
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
