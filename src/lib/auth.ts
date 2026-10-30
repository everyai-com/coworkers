import { env } from "cloudflare:workers"

/**
 * Who is making this request.
 *
 * Put the Worker behind Cloudflare Access and set ACCESS_TEAM_DOMAIN and
 * ACCESS_AUD (the installer does both): every request must then carry a
 * valid Access JWT, and each Access identity gets its own UserHub. Without
 * them (local dev, or an unprotected deploy) everyone is the same `demo`
 * user.
 */
export const DEMO_USER_ID = "demo"

/**
 * Without Access, `/api/demo-profile?as=jane` switches this browser to a
 * second local profile with seeded data, for demos; `?as=you` switches back.
 */
export const DEMO_PROFILE_COOKIE = "coworkers_profile"
export const DEMO_PROFILES = { jane: { label: "Jane Austen" } } as const
export type DemoProfile = keyof typeof DEMO_PROFILES

export function demoProfileOf(request: Request): DemoProfile | null {
  const value = cookie(request, DEMO_PROFILE_COOKIE)
  return value && value in DEMO_PROFILES ? (value as DemoProfile) : null
}

export interface Identity {
  id: string
  email: string | null
}

/** Thrown when Access is configured and the request did not pass it. */
export class Unauthorized extends Error {}

export function accessConfigured() {
  // `coworkers.deploy.json` sets the Access values for dev too, but
  // localhost is never behind Access, so no request could carry a token.
  if (import.meta.env.DEV) return false
  return !!(env.ACCESS_TEAM_DOMAIN?.trim() && env.ACCESS_AUD?.trim())
}

/** `https://<team>.cloudflareaccess.com`, however it was entered. */
function issuer() {
  const domain = env.ACCESS_TEAM_DOMAIN.trim().replace(/\/+$/, "")
  return domain.startsWith("https://") ? domain : `https://${domain}`
}

export async function identify(request: Request): Promise<Identity> {
  if (!accessConfigured()) {
    return { id: demoProfileOf(request) ?? DEMO_USER_ID, email: null }
  }
  const token =
    request.headers.get("Cf-Access-Jwt-Assertion") ??
    cookie(request, "CF_Authorization")
  if (!token) throw new Unauthorized("No Access token")
  const claims = await verifyAccessJwt(token)
  const email = typeof claims.email === "string" ? claims.email : null
  if (!email) throw new Unauthorized("Access token has no email")
  return { id: userIdForEmail(email), email }
}

export function userIdForEmail(email: string) {
  return email.toLowerCase().replace(/[^a-z0-9]+/g, "-")
}

function cookie(request: Request, name: string) {
  const header = request.headers.get("Cookie") ?? ""
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=")
    if (key === name) return rest.join("=")
  }
  return null
}

// ── Access JWT verification ────────────────────────────────────────────

interface Jwk extends JsonWebKey {
  kid: string
}

let keys: { at: number; byKid: Map<string, CryptoKey> } | null = null
const KEYS_TTL_MS = 60 * 60 * 1000

async function signingKey(kid: string) {
  if (!keys || Date.now() - keys.at > KEYS_TTL_MS || !keys.byKid.has(kid)) {
    const response = await fetch(`${issuer()}/cdn-cgi/access/certs`)
    if (!response.ok) throw new Error(`Access certs: ${response.status}`)
    const { keys: jwks } = await response.json<{ keys: Jwk[] }>()
    const byKid = new Map<string, CryptoKey>()
    for (const jwk of jwks) {
      byKid.set(
        jwk.kid,
        await crypto.subtle.importKey(
          "jwk",
          jwk,
          { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
          false,
          ["verify"]
        )
      )
    }
    keys = { at: Date.now(), byKid }
  }
  return keys.byKid.get(kid)
}

function base64UrlBytes(part: string) {
  const base64 = part.replace(/-/g, "+").replace(/_/g, "/")
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
}

function base64UrlJson(part: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(base64UrlBytes(part)))
}

async function verifyAccessJwt(token: string) {
  const [head, body, signature] = token.split(".")
  if (!head || !body || !signature) throw new Unauthorized("Malformed token")
  const header = base64UrlJson(head)
  if (header.alg !== "RS256" || typeof header.kid !== "string") {
    throw new Unauthorized("Unexpected token algorithm")
  }
  const key = await signingKey(header.kid)
  if (!key) throw new Unauthorized("Unknown signing key")
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    base64UrlBytes(signature),
    new TextEncoder().encode(`${head}.${body}`)
  )
  if (!valid) throw new Unauthorized("Bad signature")

  const claims = base64UrlJson(body)
  const now = Date.now() / 1000
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  if (claims.iss !== issuer()) throw new Unauthorized("Wrong issuer")
  if (!aud.includes(env.ACCESS_AUD.trim())) throw new Unauthorized("Wrong aud")
  if (typeof claims.exp !== "number" || claims.exp < now) {
    throw new Unauthorized("Expired")
  }
  if (typeof claims.nbf === "number" && claims.nbf > now + 60) {
    throw new Unauthorized("Not yet valid")
  }
  return claims
}
