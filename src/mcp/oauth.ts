import {
  AuthorizationError,
  CimdFetchError,
  OAuthAuthorizationServer,
  OAuthResourceServer,
} from "@cloudflare/workers-oauth-provider"
import type { ConsentDescription } from "@cloudflare/workers-oauth-provider"
import { Unauthorized, identify } from "@/lib/auth"
import type { AccessLevel } from "@/lib/types"
import { LEVEL_SCOPES } from "./scopes"
import type { McpProps } from "./scopes"
import { oauthKv } from "./oauth-store"
import { serveMcp } from "./server"

/**
 * Outside agents (Claude Code, Codex, ChatGPT, any MCP client) sign in
 * with OAuth and reach the shared operations on `/mcp`. Both OAuth roles
 * live in this Worker: the authorization server (discovery, registration,
 * token) and the resource server in front of `/mcp`.
 *
 * Access sits in front of everything except the paths an MCP client calls
 * on its own (`/mcp`, `/oauth/token`, `/oauth/register` and discovery):
 * those carry their own tokens. `/oauth/authorize` stays behind Access, so
 * only someone signed in to this deployment can approve a client.
 */

const AUTHORIZE_PATH = "/oauth/authorize"

type OAuthEnv = Env & { OAUTH_KV: KVNamespace }

function withStore(env: Env): OAuthEnv {
  return { ...env, OAUTH_KV: oauthKv(env) }
}

/**
 * The issuer and resource are this deployment's own URL, which the Worker
 * only learns from requests (workers.dev, a custom domain, localhost in
 * dev). Built once per origin.
 */
const servers = new Map<
  string,
  {
    authorization: OAuthAuthorizationServer<OAuthEnv>
    resource: OAuthResourceServer<OAuthEnv, McpProps>
  }
>()

function serversFor(origin: string) {
  let pair = servers.get(origin)
  if (pair) return pair
  const resourceUrl = `${origin}/mcp`
  const authorization = new OAuthAuthorizationServer<OAuthEnv>({
    issuer: origin,
    resources: [resourceUrl],
    authorizeEndpoint: AUTHORIZE_PATH,
    tokenEndpoint: "/oauth/token",
    // Dynamic Client Registration: what Claude Code, Codex and ChatGPT use
    // when given only a URL. Client ID Metadata Documents would also need
    // the global_fetch_strictly_public flag, which breaks http://localhost
    // connections in dev.
    clientRegistrationEndpoint: "/oauth/register",
    scopesSupported: [...Object.values(LEVEL_SCOPES), "offline_access"],
    // Signed-in agents keep working while they are used, and lapse after
    // a month idle.
    refreshTokenIdleTTL: 30 * 24 * 3600,
  })
  const resource = new OAuthResourceServer<OAuthEnv, McpProps>({
    resourceMetadata: {
      resource: resourceUrl,
      authorization_servers: [origin],
      resource_name: "Coworkers",
    },
    requiredScopes: [LEVEL_SCOPES.read],
    validateToken: (env) => (resourceId, token) =>
      authorization.validateToken<McpProps>(resourceId, token, env),
    handler: {
      fetch: (request, env, ctx) => serveMcp(request, env, ctx),
    },
  })
  pair = { authorization, resource }
  servers.set(origin, pair)
  return pair
}

/** Grants and clients, for the Connected agents settings. */
export function oauthApi(env: Env, origin: string) {
  return serversFor(origin).authorization.getOAuthApi(withStore(env))
}

/**
 * Answer the OAuth and MCP paths, or null for everything else. Runs before
 * the Access check in `src/server.ts`, except for the consent page, which
 * checks Access itself.
 */
export async function handleOAuthRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response | null> {
  const url = new URL(request.url)
  const path = url.pathname
  const { authorization, resource } = serversFor(url.origin)
  const oauthEnv = withStore(env)
  if (
    path === "/mcp" ||
    path.startsWith("/.well-known/oauth-protected-resource")
  ) {
    return resource.fetch(request, oauthEnv, ctx)
  }
  if (path === AUTHORIZE_PATH) {
    return authorize(request, oauthEnv, authorization)
  }
  if (
    path.startsWith("/oauth/") ||
    path.startsWith("/.well-known/oauth-authorization-server")
  ) {
    return authorization.fetch(request, oauthEnv, ctx)
  }
  return null
}

// ── Consent page ──────────────────────────────────────────────────────

async function authorize(
  request: Request,
  env: OAuthEnv,
  authorization: OAuthAuthorizationServer<OAuthEnv>
) {
  let userId: string
  try {
    userId = (await identify(request)).id
  } catch (err) {
    if (err instanceof Unauthorized) {
      return page(
        "Sign in first",
        "<p>Open Coworkers, sign in, then try connecting again.</p>",
        401
      )
    }
    throw err
  }
  const oauth = authorization.getOAuthApi(env)
  try {
    if (request.method === "POST") {
      const form = await request.formData()
      const handle = String(form.get("handle") ?? "")
      if (form.get("decision") !== "approve") {
        const denied = await oauth.denyConsent(request, handle)
        return new Response(null, { status: 302, headers: denied.headers })
      }
      const level = levelFrom(form.get("level"))
      const approved = await oauth.approveConsent(request, handle, {
        scope: scopesFor(level),
      })
      const details = await oauth.describeConsent(approved.request)
      const props: McpProps = {
        userId,
        level,
        label: details.clientName,
      }
      const { redirectTo } = await oauth.completeAuthorization({
        request: approved.request,
        userId,
        metadata: { label: props.label, level, approvedAt: Date.now() },
        scope: scopesFor(level),
        props,
      })
      approved.headers.set("Location", redirectTo)
      return new Response(null, { status: 302, headers: approved.headers })
    }
    const authRequest = await oauth.parseAuthRequest(request)
    const details = await oauth.describeConsent(authRequest)
    const consent = await oauth.beginConsent(authRequest)
    consent.headers.set("Content-Type", "text/html; charset=utf-8")
    return new Response(consentPage(details, consent.handle), {
      headers: consent.headers,
    })
  } catch (error) {
    if (error instanceof AuthorizationError && error.redirectTo) {
      return Response.redirect(error.redirectTo, 302)
    }
    if (error instanceof AuthorizationError) {
      return page(
        "This sign-in can't continue",
        `<p>${escape(error.description ?? "The request expired or was already used.")} Start connecting again from your agent.</p>`,
        400
      )
    }
    if (error instanceof CimdFetchError) {
      return page(
        "This app could not be verified",
        "<p>Its details could not be loaded. Try again later.</p>",
        400
      )
    }
    throw error
  }
}

function levelFrom(value: FormDataEntryValue | null): AccessLevel {
  return value === "act" || value === "manage" ? value : "read"
}

/** Each level includes the ones below it. */
function scopesFor(level: AccessLevel) {
  const order: AccessLevel[] = ["read", "act", "manage"]
  return [
    ...order.slice(0, order.indexOf(level) + 1).map((l) => LEVEL_SCOPES[l]),
    "offline_access",
  ]
}

const escape = (value: string) =>
  value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)

const LEVELS: { level: AccessLevel; title: string; detail: string }[] = [
  {
    level: "read",
    title: "Read only",
    detail: "See your bots, what they are doing, and their chats.",
  },
  {
    level: "act",
    title: "Work with your bots",
    detail: "Also message bots and hand them tasks.",
  },
  {
    level: "manage",
    title: "Manage your bots",
    detail:
      "Also create, change and pause bots. Deleting a bot still needs you, in Coworkers.",
  },
]

/** The consent page's HTML. Sent with `beginConsent()`'s headers, which forbid framing. */
function consentPage(details: ConsentDescription, handle: string) {
  const name = escape(details.clientName)
  const origin = details.clientDomain
    ? `Published by <strong>${escape(details.clientDomain)}</strong>.`
    : "It named itself; Coworkers can't verify that name."
  const loopback = details.redirectIsLoopback
    ? `<p class="warn">Access goes to an app on this computer. Continue only if you just started connecting from it.</p>`
    : ""
  const options = LEVELS.map(
    ({ level, title, detail }) => `<label class="option">
      <input type="radio" name="level" value="${level}"${level === "read" ? " checked" : ""}>
      <span><strong>${title}</strong><span>${detail}</span></span>
    </label>`
  ).join("")
  return html(
    `Connect ${name} to Coworkers?`,
    `<p>${origin} Access will be sent to <strong>${escape(details.redirectHost)}</strong>.</p>
    ${loopback}
    <form method="post">
      <input type="hidden" name="handle" value="${escape(handle)}">
      <fieldset><legend>What may it do?</legend>${options}</fieldset>
      <p class="fine">You can disconnect it any time in Settings → Connected agents.</p>
      <div class="actions">
        <button name="decision" value="deny" class="secondary">Cancel</button>
        <button name="decision" value="approve" class="primary">Connect</button>
      </div>
    </form>`
  )
}

function page(title: string, body: string, status = 200) {
  return new Response(html(title, body), {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  })
}

function html(title: string, body: string) {
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  :root { color-scheme: light dark; --line: light-dark(#e6e6e6, #333); --sub: light-dark(#666, #aaa); --tint: light-dark(#f5f5f5, #1d1d1d); }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; font: 15px/1.55 system-ui, -apple-system, sans-serif; background: light-dark(#fafafa, #111); color: light-dark(#111, #eee); }
  main { width: min(440px, calc(100vw - 32px)); padding: 28px; border-radius: 24px; background: light-dark(#fff, #181818); box-shadow: 0 0 0 1px var(--line), 0 8px 24px rgb(0 0 0 / 0.06); }
  h1 { margin: 0 0 8px; font-size: 20px; font-weight: 600; letter-spacing: -0.01em; text-wrap: balance; }
  p { margin: 0 0 12px; color: var(--sub); text-wrap: pretty; }
  strong { color: light-dark(#111, #eee); font-weight: 600; }
  .warn { padding: 10px 12px; border-radius: 12px; background: light-dark(#fff6e5, #2b2111); color: light-dark(#7a4b00, #f0c36d); }
  fieldset { margin: 16px 0 8px; padding: 0; border: 0; }
  legend { margin-bottom: 8px; font-weight: 600; }
  .option { display: flex; gap: 10px; padding: 12px; border-radius: 14px; cursor: pointer; }
  .option:has(input:checked) { background: var(--tint); }
  .option input { margin-top: 4px; }
  .option span { display: flex; flex-direction: column; }
  .option span span { color: var(--sub); font-size: 14px; }
  .fine { font-size: 13px; }
  .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
  button { font: inherit; font-weight: 500; padding: 8px 18px; border-radius: 999px; border: 0; cursor: pointer; }
  .primary { background: light-dark(#111, #eee); color: light-dark(#fff, #111); }
  .secondary { background: var(--tint); color: inherit; }
</style>
<main>
  <h1>${title}</h1>
  ${body}
</main>
</html>`
}
