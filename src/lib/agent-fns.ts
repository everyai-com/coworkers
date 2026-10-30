import { createServerFn } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"
import { env } from "cloudflare:workers"
import { identify } from "@/lib/auth"
import type { AccessLevel } from "@/lib/types"
import { oauthApi } from "@/mcp/oauth"
import { levelOfScopes } from "@/mcp/scopes"

/** An outside agent the user connected over MCP, for Settings. */
export interface ConnectedAgent {
  grantId: string
  label: string
  level: AccessLevel
  connectedAt: number
}

async function signedIn() {
  const request = getRequest()
  const { id } = await identify(request)
  const origin = new URL(request.url).origin
  return { userId: id, origin, api: oauthApi(env, origin) }
}

export const getConnectedAgents = createServerFn().handler(
  async (): Promise<{ mcpUrl: string; agents: ConnectedAgent[] }> => {
    const { userId, origin, api } = await signedIn()
    const grants = await api.listUserGrants(userId, { limit: 100 })
    const agents = await Promise.all(
      grants.items.map(async (grant): Promise<ConnectedAgent> => {
        const label =
          typeof grant.metadata?.label === "string"
            ? grant.metadata.label
            : ((await api.lookupClient(grant.clientId))?.clientName ??
              "An agent")
        return {
          grantId: grant.id,
          label,
          level: levelOfScopes(grant.scope) ?? "read",
          connectedAt: grant.createdAt * 1000,
        }
      })
    )
    return {
      mcpUrl: `${origin}/mcp`,
      agents: agents.sort((a, b) => b.connectedAt - a.connectedAt),
    }
  }
)

/** Revoke an agent's grant: its tokens stop working at once. */
export const disconnectAgent = createServerFn({ method: "POST" })
  .validator((grantId: string) => grantId)
  .handler(async ({ data: grantId }) => {
    const { userId, api } = await signedIn()
    await api.revokeGrant(grantId, userId)
  })
