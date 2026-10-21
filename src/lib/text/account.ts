// The screen texts of the shell, the account pages (login, sign-up, new password) and Config, in English (issue #23).
// The words every screen shares are in common.ts.

import type { Role } from "../types.ts";

export const SITE = {
  description:
    "Essencis Labs' collaborative dashboard and roadmap: a real-time board and asynchronous prioritization in place of synchronous SCRUM.",
} as const;

/** How each role is named on screen; nobody signed in is VISITOR (common.ts). */
export const ROLE_LABEL: Record<Role, string> = { admin: "Admin", scrum_master: "Scrum Master", dev: "Dev" };

export const AUTH = {
  email: "Email",
  password: "Password",
  newPassword: "New password",
  signIn: "Sign in",
  signingIn: "Signing in...",
  signUp: "Sign up",
  creatingAccount: "Creating account...",
  signOut: "Sign out",
  noAccount: "Don't have an account?",
  haveAccount: "Already have an account?",
  wrongCredentials: "Wrong email or password.",
  alreadyRegistered: "This email is already registered.",
  checkEmail: "Account created. Check your email to confirm the account before signing in.",
  passwordHint: "At least 8 characters, with letters and numbers.",
  /** "@a.com or @b.com" */
  domainJoin: " or ",
  allowedEmailOnly: (domains: string) => `Use a ${domains} email.`,
  onlyAllowedEmails: (domains: string) => `Only ${domains} emails.`,
  emailPlaceholder: (domains: string) => `you${domains}`,
} as const;

export const RESET = {
  intro: "This is your first sign-in, or an admin reset your password. Create a new password to continue.",
  saveAndContinue: "Save and continue",
  linkExpired: "This link has expired or was already used. Ask the admin for a new one.",
  sessionExpired: "Your session has expired. Ask the admin for a new link or sign in again.",
  samePassword: "The new password must be different from the current one.",
  saveFailed: "Couldn't save the password right now. Try again.",
} as const;

export const NAV = {
  toggleTheme: "Toggle theme",
  userMenu: "User menu",
  profilePicture: "Profile picture",
  picture: (n: string) => `Picture ${n}`,
} as const;

export const SYNC_SIGN_IN = "Sign in to sync the board.";

export const CONFIG = {
  loadFailed: "Couldn't load the users.",
  signInToSee: "Sign in to see this page.",
  adminOnly: "Only an admin can open Config.",
  loading: "Loading...",
  users: "Users",
  resetExplained: "Resetting makes the person create a new password at their next sign-in.",
  nameEmail: "Name / email",
  role: "Role",
  github: "GitHub",
  password: "Password",
  needsNewPassword: "Needs a new password",
  passwordOk: "OK",
  resetPassword: "Reset password",
  confirmReset: "Confirm reset",
  /** Shown around the person's name in bold. */
  resetQuestionBefore: "Reset the password of ",
  resetQuestionAfter: "? The current password stops working and the person gets an email to create a new one.",
  resetSentBefore: "Password reset email sent to ",
  dismiss: "Ok",
  githubLoginOf: (name: string) => `GitHub login of ${name}`,
  loginPlaceholder: "login",
  invalidLogin: "Not a GitHub login: letters, digits and single hyphens.",
  loginTaken: "Another profile already has this login.",
  notSaved: "Not saved. Try again.",
  resetTooSoon: "The reset email can only be sent to the same person once a minute. Try again in a moment.",
  resetEmailCap: "The project's authentication email limit was reached (Supabase caps how many it sends per hour). Try again later.",
  userNotFound: "User not found.",
  resetFailed: "Couldn't complete the reset right now. Try again.",
} as const;
