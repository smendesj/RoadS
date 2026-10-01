type SignOutScope = "global" | "local";

export type EndSessionDeps = {
  signOut: (scope: SignOutScope) => Promise<{ error: unknown }>;
  clearActivity: () => void;
  navigate: (to: string) => void;
};

// Ending a session takes more than one signOut call: if it fails (offline, server error) the
// session cookies stay, and /login would bounce a still-signed-in user straight back into the app —
// which is also how an idle timeout would silently fail to disconnect anyone. So a failed sign-out
// falls back to dropping the session locally, and the user always lands on /login.
export async function endSession({ signOut, clearActivity, navigate }: EndSessionDeps): Promise<void> {
  clearActivity();
  const serverSignedOut = await signOut("global").then(
    ({ error }) => !error,
    () => false
  );
  if (!serverSignedOut) await signOut("local").catch(() => undefined);
  navigate("/login");
}
