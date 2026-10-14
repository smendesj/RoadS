import { answerAvatarRequest } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";

// POST /api/profile/avatar { "avatar": "<id>" } -> { ok: true } | { error }. Sets the signed-in user's own
// picture; the rules, and why this is not a server action, are in src/lib/profile.ts.
export async function POST(request: Request) {
  const supabase = await createClient();
  const answer = await answerAvatarRequest(
    {
      origin: request.headers.get("origin"),
      // Behind Vercel's proxy the host the browser asked for is in x-forwarded-host (what Next checks for actions).
      host: request.headers.get("x-forwarded-host") ?? request.headers.get("host"),
      body: await request.json().catch(() => null),
    },
    {
      getUserId: async () => (await supabase.auth.getUser()).data.user?.id ?? null,
      setAvatar: async (userId, value) => {
        // A 200 means the row really changed: an update that matched nothing is a failure, not a quiet success.
        const { data, error } = await supabase.from("profiles").update({ avatar: value }).eq("id", userId).select("id");
        if (error) throw error;
        if (!data?.length) throw new Error("no_profile_row");
      },
    }
  );
  return Response.json(answer.body, { status: answer.status });
}
