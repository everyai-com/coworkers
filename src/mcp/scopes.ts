import type { AccessLevel } from "@/lib/types"

/** One scope per access level; a grant's level is its highest. */
export const LEVEL_SCOPES: Record<AccessLevel, string> = {
  read: "coworkers.read",
  act: "coworkers.act",
  manage: "coworkers.manage",
}

/** What `completeAuthorization()` stores and every `/mcp` request gets back. */
export interface McpProps {
  userId: string
  level: AccessLevel
  /** The client's name as the user approved it, for "Message from …". */
  label: string
}

/** The access level a token's scopes add up to. */
export function levelOfScopes(scope: readonly string[]): AccessLevel | null {
  if (scope.includes(LEVEL_SCOPES.manage)) return "manage"
  if (scope.includes(LEVEL_SCOPES.act)) return "act"
  if (scope.includes(LEVEL_SCOPES.read)) return "read"
  return null
}
