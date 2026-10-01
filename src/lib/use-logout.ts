"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { clearActivity } from "@/lib/idle-storage";
import { endSession } from "@/lib/logout";
import { createClient } from "@/lib/supabase/client";

// Takes the tab to /login, refreshing so nothing signed-in stays rendered.
export function useGoToLogin() {
  const router = useRouter();
  return useCallback(() => {
    router.replace("/login");
    router.refresh();
  }, [router]);
}

// Signs the current user out from any client component: the menu's Sair button, the idle timeout
// and the forced password reset page.
export function useLogout() {
  const goToLogin = useGoToLogin();
  return useCallback(
    () =>
      endSession({
        signOut: (scope) => createClient().auth.signOut({ scope }),
        clearActivity,
        navigate: goToLogin,
      }),
    [goToLogin]
  );
}
