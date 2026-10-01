// Response headers for every route. The CSP is only frame-ancestors on purpose: a script/style policy
// would have to whitelist Next's inline bootstrap and the theme script, and would break pages if it
// drifted. X-Frame-Options covers browsers that predate frame-ancestors.
export const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];
