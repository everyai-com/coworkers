/**
 * Links that name a bot: `[@Name](coworkers://bot/<id>)`. Messages store
 * them as Markdown, so bots read them as they are and the thread renders
 * them as chips with the bot's current name. Shared by the agents and the
 * client: no server-only imports.
 */
export const BOT_LINK_PREFIX = "coworkers://bot/"

/** Bot ids are short lowercase hex (`crypto.randomUUID().slice(0, 8)`). */
const BOT_ID = /^[a-z0-9-]{1,64}$/

export function botLink(botId: string) {
  return `${BOT_LINK_PREFIX}${botId}`
}

export function botMention(name: string, botId: string) {
  return `[@${markdownLabel(name)}](${botLink(botId)})`
}

/** The bot id in a `coworkers://bot/<id>` link, or null for anything else. */
export function botIdFromLink(value: string | null | undefined) {
  const trimmed = value?.trim() ?? ""
  if (!trimmed.toLowerCase().startsWith(BOT_LINK_PREFIX)) return null
  const id = trimmed.slice(BOT_LINK_PREFIX.length).replace(/\/+$/, "")
  return BOT_ID.test(id) ? id : null
}

function markdownLabel(name: string) {
  return name.replace(/[[\]\\]/g, "").replace(/\s+/g, " ")
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Turn `@Name` into a bot link for every bot named in the text. An `@` only
 * counts at the start or after a space or punctuation, so email addresses
 * stay as they are, and links already in the text are left alone. When two
 * bots share a name, the first in the list wins: put the ones the user
 * picked first.
 */
export function linkMentions(
  text: string,
  bots: readonly { id: string; name: string }[]
) {
  const seen = new Set<string>()
  const named = bots
    .filter((b) => {
      const key = b.name.trim().toLowerCase()
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
    // Longest first, so "Sales Lead" wins over "Sales".
    .sort((a, b) => b.name.trim().length - a.name.trim().length)
  let out = text
  for (const bot of named) {
    const pattern = new RegExp(
      `(^|[^\\w[@])@${escapeRegExp(bot.name.trim())}(?![\\w])`,
      "gi"
    )
    out = out.replace(pattern, (_, before: string) => {
      return `${before}${botMention(bot.name.trim(), bot.id)}`
    })
  }
  return out
}

export type MentionSegment =
  { kind: "text"; text: string } | { kind: "bot"; botId: string; label: string }

const MENTION_LINK = /\[@?([^\]\n]{1,80})\]\((coworkers:\/\/bot\/[^)\s]+)\)/gi

/** Bot links as "@Name", for one-line previews that cannot show chips. */
export function plainMentions(text: string) {
  return text.replace(MENTION_LINK, (_, label: string) => `@${label}`)
}

/** Split text into plain runs and bot links, for plain-text bubbles. */
export function splitMentions(text: string): MentionSegment[] {
  const segments: MentionSegment[] = []
  let last = 0
  for (const match of text.matchAll(MENTION_LINK)) {
    const botId = botIdFromLink(match[2])
    if (!botId) continue
    if (match.index > last) {
      segments.push({ kind: "text", text: text.slice(last, match.index) })
    }
    segments.push({ kind: "bot", botId, label: match[1] })
    last = match.index + match[0].length
  }
  if (last < text.length)
    segments.push({ kind: "text", text: text.slice(last) })
  return segments
}

/**
 * The `@` being typed at the caret, for the mention picker: where it starts
 * and what follows it. Names can have spaces, so the query may too.
 */
export function mentionQuery(
  text: string,
  caret: number
): { start: number; query: string } | null {
  const before = text.slice(0, caret)
  const at = before.lastIndexOf("@")
  if (at < 0) return null
  if (at > 0 && /[\w@[]/.test(before[at - 1])) return null
  const query = before.slice(at + 1)
  if (query.length > 40 || /[\n@\]]/.test(query)) return null
  if (query.startsWith(" ")) return null
  return { start: at, query }
}
