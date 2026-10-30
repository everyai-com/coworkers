import { createFileRoute } from "@tanstack/react-router"
import { env } from "cloudflare:workers"
import { getAgentByName } from "agents"
import { z } from "zod"
import { DEMO_PROFILE_COOKIE, accessConfigured } from "@/lib/auth"
import type { UserHub } from "@/agents/user-hub"

const querySchema = z.object({
  as: z.enum(["jane", "you"]),
  seed: z.enum(["1"]).optional(),
})

/**
 * Local demos only (no Access): `/api/demo-profile?as=jane&seed=1` fills
 * Jane's profile with fresh demo data and switches this browser to it;
 * `?as=you` switches back to your own.
 */
export const Route = createFileRoute("/api/demo-profile")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (accessConfigured())
          return new Response("Not found", { status: 404 })
        const parsed = querySchema.safeParse(
          Object.fromEntries(new URL(request.url).searchParams)
        )
        if (!parsed.success) {
          return Response.json(
            { error: "Use ?as=jane or ?as=you", issues: parsed.error.issues },
            { status: 400 }
          )
        }
        const { as, seed } = parsed.data
        if (as === "jane" && seed) {
          const hub = await getAgentByName(
            env.UserHub as unknown as DurableObjectNamespace<UserHub>,
            "jane"
          )
          await hub.seedDemo()
        }
        const cookie =
          as === "jane"
            ? `${DEMO_PROFILE_COOKIE}=jane; Path=/; SameSite=Lax; Max-Age=2592000`
            : `${DEMO_PROFILE_COOKIE}=; Path=/; SameSite=Lax; Max-Age=0`
        return new Response(null, {
          status: 302,
          headers: { Location: "/", "Set-Cookie": cookie },
        })
      },
    },
  },
})
