import { DurableObject } from "cloudflare:workers"

/**
 * Storage for the OAuth server that lets outside agents (Claude Code,
 * ChatGPT, Cursor) reach Coworkers over MCP: clients, grants and tokens
 * (`@cloudflare/workers-oauth-provider` stores tokens only as hashes).
 *
 * The library expects a KV namespace bound as `OAUTH_KV`. A SQLite Durable
 * Object stands in for it, so a deployment needs no extra resource: the
 * installer and `pnpm run setup` would otherwise have to create a namespace
 * and wire its id into every install. One instance ("oauth") holds it all.
 */
export class OAuthStore extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      expires_at INTEGER,
      metadata TEXT
    )`)
  }

  get(key: string): string | null {
    const row = this.ctx.storage.sql
      .exec<{ value: string }>(
        "SELECT value FROM kv WHERE key = ? AND (expires_at IS NULL OR expires_at > ?)",
        key,
        Date.now()
      )
      .toArray()[0]
    return row?.value ?? null
  }

  put(
    key: string,
    value: string,
    options: {
      expirationTtl?: number
      expiration?: number
      metadata?: unknown
    } = {}
  ) {
    const expiresAt =
      options.expiration !== undefined
        ? options.expiration * 1000
        : options.expirationTtl !== undefined
          ? Date.now() + options.expirationTtl * 1000
          : null
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO kv (key, value, expires_at, metadata) VALUES (?, ?, ?, ?)",
      key,
      value,
      expiresAt,
      options.metadata === undefined ? null : JSON.stringify(options.metadata)
    )
    // KV drops expired keys on its own; here they go a few at a time.
    this.ctx.storage.sql.exec(
      "DELETE FROM kv WHERE key IN (SELECT key FROM kv WHERE expires_at <= ? LIMIT 50)",
      Date.now()
    )
  }

  delete(key: string) {
    this.ctx.storage.sql.exec("DELETE FROM kv WHERE key = ?", key)
  }

  list(options: { prefix?: string; limit?: number; cursor?: string } = {}) {
    const prefix = options.prefix ?? ""
    const limit = Math.min(Math.max(options.limit ?? 1000, 1), 1000)
    // Keys sort as text, so everything with the prefix sits between it and
    // the prefix followed by the highest character.
    const rows = this.ctx.storage.sql
      .exec<{
        key: string
        expires_at: number | null
        metadata: string | null
      }>(
        `SELECT key, expires_at, metadata FROM kv
         WHERE key >= ? AND key < ? AND key > ?
           AND (expires_at IS NULL OR expires_at > ?)
         ORDER BY key LIMIT ?`,
        prefix,
        `${prefix}￿`,
        options.cursor ?? "",
        Date.now(),
        limit + 1
      )
      .toArray()
    const page = rows.slice(0, limit)
    const complete = rows.length <= limit
    return {
      keys: page.map((row) => ({
        name: row.key,
        ...(row.expires_at !== null
          ? { expiration: Math.floor(row.expires_at / 1000) }
          : {}),
        ...(row.metadata !== null
          ? { metadata: JSON.parse(row.metadata) }
          : {}),
      })),
      list_complete: complete,
      ...(complete ? {} : { cursor: page.at(-1)!.key }),
    }
  }
}

type GetType = "text" | "json"

/**
 * The part of `KVNamespace` the OAuth library uses, over the store above.
 * Pass it as `OAUTH_KV` in the env given to the library.
 */
export function oauthKv(env: Env) {
  const store = () =>
    (env.OAuthStore as DurableObjectNamespace<OAuthStore>).getByName("oauth")
  return {
    async get(key: string, options?: GetType | { type?: GetType }) {
      const type = typeof options === "string" ? options : options?.type
      const value = await store().get(key)
      if (value === null) return null
      return type === "json" ? JSON.parse(value) : value
    },
    async put(
      key: string,
      value: string,
      options?: {
        expirationTtl?: number
        expiration?: number
        metadata?: unknown
      }
    ) {
      await store().put(key, value, options)
    },
    async delete(key: string) {
      await store().delete(key)
    },
    async list(options?: { prefix?: string; limit?: number; cursor?: string }) {
      return store().list(options)
    },
  } as unknown as KVNamespace
}
