"use client";

import { useEffect } from "react";
import { clearActivity, readActivity, touchActivity } from "@/lib/idle-storage";
import { startIdleWatch, watchSessionEnd } from "@/lib/session-guard";
import { createClient } from "@/lib/supabase/client";
import { useGoToLogin, useLogout } from "@/lib/use-logout";

// Renders nothing; keeps a signed-in page honest about its session. 10 idle minutes sign the
// user out, and a session that ends in another tab of this browser takes this tab to /login too.
export function SessionGuard() {
  const logout = useLogout();
  const goToLogin = useGoToLogin();

  useEffect(
    () => startIdleWatch({ win: window, doc: document, now: Date.now, readActivity, touchActivity, onExpire: logout }),
    [logout]
  );

  useEffect(
    () =>
      watchSessionEnd(createClient().auth, () => {
        clearActivity();
        goToLogin();
      }),
    [goToLogin]
  );

  return null;
}
