import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Next.js 16: cookies() is async — every caller of this must itself be an async
// Server Component, Server Action, or Route Handler.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Called from a Server Component render (not a Server Action/Route Handler) — the
            // session refresh cookie can't be written here. Harmless if session refresh is
            // otherwise handled (e.g. in proxy.ts once that exists); ignored on purpose.
          }
        },
      },
    }
  );
}
