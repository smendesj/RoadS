// ControlS screen texts, in English like the rest of the app (issue #23). Shared words live in common.ts.

export const CONTROLS_NAME = "ControlS";

export const CONTROLS = {
  pageTitle: "RoadS — ControlS",
  heading: "ControlS",
  subtitle: "Subscriptions vault — Essencis Labs",
  loading: "Loading subscriptions...",
  loadFailed: "Couldn't load the subscriptions.",
  signInToSee: "Sign in to see this page.",
  membersOnly: "ControlS is limited to its two members.",

  // KPI cards
  monthlyTotal: "Monthly total",
  monthlyTotalHint: "Recurring, normalized (annual ÷ 12)",
  annualTotal: "Annual total",
  annualTotalHint: "Monthly × 12",
  activeCount: "Active subscriptions",
  oneOffTotal: "One-off charges",
  biggestSpend: "Biggest monthly spend",
  noPricedSub: "No priced subscription yet",

  // charts
  byCategory: "Monthly spend by category",
  byService: "Monthly spend by service",
  noChartData: "Add a price to see the breakdown.",

  // renewals
  upcomingRenewals: "Renewing in the next 10 days",
  noRenewals: "Nothing renews in the next 10 days.",
  dueToday: "Today",
  dueInDays: (n: number) => `in ${n} day${n === 1 ? "" : "s"}`,
  renewsOn: (date: string) => `renews ${date}`,

  // list + form
  subscriptions: "Subscriptions",
  add: "Add subscription",
  newSubscription: "New subscription",
  editSubscription: "Edit subscription",
  open: "Open",
  noAccessUrl: "No link",
  none: "—",
  empty: "No subscriptions yet. Add the first one.",
  confirmDeleteBefore: "Delete ",
  confirmDeleteAfter: "? This can't be undone.",

  // fields
  name: "Name",
  category: "Category",
  accessUrl: "Access URL",
  loginIdentifier: "Login",
  loginEmail: "Login email",
  amount: "Amount",
  currency: "Currency",
  billingCycle: "Billing cycle",
  billingDay: "Billing day",
  nextChargeDate: "Next charge date",
  status: "Status",
  notes: "Notes",
  password: "Password",

  // cycle + status labels
  cycleMonthly: "Monthly",
  cycleAnnual: "Annual",
  cycleOneOff: "One-off",
  statusActive: "Active",
  statusInactive: "Inactive",
  statusToRegister: "To register",

  // vault
  vaultHidden: "••••••••",
  reveal: "Reveal",
  hide: "Hide",
  copy: "Copy",
  copied: "Copied",
  noPassword: "Not set",
  setPassword: "Set a password",
  keepPassword: "Keep current password",
  clearPassword: "Clear password",
  vaultLocked: "The vault key isn't configured on the server (CONTROLS_VAULT_KEY). Passwords can't be stored or revealed.",
  revealFailed: "Couldn't reveal this password.",
  saveFailed: "Couldn't save. Try again.",
  nameRequired: "A name is required.",
} as const;

export const CYCLE_LABEL = {
  monthly: CONTROLS.cycleMonthly,
  annual: CONTROLS.cycleAnnual,
  one_off: CONTROLS.cycleOneOff,
} as const;

export const STATUS_LABEL = {
  active: CONTROLS.statusActive,
  inactive: CONTROLS.statusInactive,
  to_register: CONTROLS.statusToRegister,
} as const;
