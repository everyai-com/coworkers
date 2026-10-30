import type { SpendSummary, SpendTotals } from "@/lib/types"

/**
 * Per-bot model spend, read back from AI Gateway logs. Every model call a bot
 * makes is tagged with `botId` and `turn` (see `languageModel()`), and the
 * gateway prices each call, so nothing is estimated here.
 */

/** The fields of an AI Gateway log entry this reads. */
export interface GatewayLog {
  id: string
  created_at: string
  cost?: number | null
  tokens_in?: number | null
  tokens_out?: number | null
  /** A JSON string from the API (an object from some clients). */
  metadata?: string | Record<string, unknown> | null
}

/** One bot's calls of one kind on one UTC day. */
export interface SpendRow extends SpendTotals {
  /** "YYYY-MM-DD", UTC. */
  day: string
  botId: string
  turn: "chat" | "background"
}

/** Where the last sync stopped: the newest log time and the ids seen at it. */
export interface SpendCursor {
  at: string
  ids: string[]
}

export const LOGS_PER_PAGE = 50

function metadataOf(log: GatewayLog): Record<string, unknown> {
  const raw = log.metadata
  if (!raw) return {}
  if (typeof raw === "object") return raw
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

/**
 * Add up logs by day, bot and kind of turn. Logs without a bot this hub
 * owns (another user's bots, or calls made outside a bot) are left out.
 */
export function tally(logs: GatewayLog[], bots: ReadonlySet<string>) {
  const rows = new Map<string, SpendRow>()
  for (const log of logs) {
    const meta = metadataOf(log)
    const botId = typeof meta.botId === "string" ? meta.botId : ""
    if (!bots.has(botId)) continue
    const turn = meta.turn === "background" ? "background" : "chat"
    const day = log.created_at.slice(0, 10)
    const key = `${day}|${botId}|${turn}`
    const row = rows.get(key) ?? {
      day,
      botId,
      turn,
      cost: 0,
      tokensIn: 0,
      tokensOut: 0,
      requests: 0,
    }
    row.cost += log.cost ?? 0
    row.tokensIn += log.tokens_in ?? 0
    row.tokensOut += log.tokens_out ?? 0
    row.requests += 1
    rows.set(key, row)
  }
  return [...rows.values()]
}

/**
 * Logs newer than the cursor, oldest first. The gateway only filters with
 * `gt`, so this asks from just before the cursor and drops the ids it saw.
 */
export function newLogs(logs: GatewayLog[], cursor: SpendCursor | null) {
  if (!cursor) return logs
  const seen = new Set(cursor.ids)
  return logs.filter((l) => l.created_at >= cursor.at && !seen.has(l.id))
}

/** The cursor after these logs (oldest first), or the old one if none. */
export function advance(
  logs: GatewayLog[],
  cursor: SpendCursor | null
): SpendCursor | null {
  const last = logs.at(-1)
  if (!last) return cursor
  const ids = logs
    .filter((l) => l.created_at === last.created_at)
    .map((l) => l.id)
  return {
    at: last.created_at,
    ids:
      cursor?.at === last.created_at
        ? [...new Set([...cursor.ids, ...ids])]
        : ids,
  }
}

/** The `filters` query value for logs after `at` (an ISO time). */
export function afterFilter(at: string) {
  const from = new Date(Date.parse(at) - 1).toISOString()
  return JSON.stringify([{ key: "created_at", operator: "gt", value: [from] }])
}

const zero = (): SpendTotals => ({
  cost: 0,
  tokensIn: 0,
  tokensOut: 0,
  requests: 0,
})

function add(into: SpendTotals, row: SpendTotals) {
  into.cost += row.cost
  into.tokensIn += row.tokensIn
  into.tokensOut += row.tokensOut
  into.requests += row.requests
}

/** What the settings pages show, from the stored daily rows. */
export function summarize(
  rows: SpendRow[],
  now: number
): Omit<SpendSummary, "syncedAt" | "error"> {
  const today = new Date(now).toISOString().slice(0, 10)
  const month = today.slice(0, 7)
  const bots = new Map<string, SpendSummary["bots"][number]>()
  const days = new Map<string, number>()
  const total = { today: 0, month: 0 }
  for (const row of rows) {
    days.set(row.day, (days.get(row.day) ?? 0) + row.cost)
    if (!row.day.startsWith(month)) continue
    const bot = bots.get(row.botId) ?? {
      botId: row.botId,
      today: zero(),
      month: zero(),
      background: 0,
    }
    add(bot.month, row)
    total.month += row.cost
    if (row.turn === "background") bot.background += row.cost
    if (row.day === today) {
      add(bot.today, row)
      total.today += row.cost
    }
    bots.set(row.botId, bot)
  }
  return {
    month,
    total,
    bots: [...bots.values()].sort((a, b) => b.month.cost - a.month.cost),
    days: [...days.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-30)
      .map(([day, cost]) => ({ day, cost })),
  }
}
