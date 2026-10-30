import type { UIMessage } from "ai"
import { withoutTrailingLinks } from "./desk"
import type {
  BotAvatarKind,
  DeskCardInput,
  MessageMeta,
  MessageOrigin,
} from "@/lib/types"

/**
 * Demo data for the local "jane" profile (see /api/demo-profile): the Desk of
 * a VP of Developer GTM, with bots on her Google Chat, Gmail, Salesforce,
 * Jira, calendar and the developer community. People and companies are
 * made up.
 */

export interface DemoBotSeed {
  id: string
  avatar: BotAvatarKind
  name: string
  role: string
  memory: string
  unread: boolean
  messages: UIMessage[]
  openItems: { title: string; note: string; at: number; checkAfter?: number }[]
}

export interface DemoSeed {
  bots: DemoBotSeed[]
  cards: { botId: string; card: DeskCardInput }[]
  sharedMemory: string
}

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

export const DEMO_SHARED_MEMORY = `- Jane Austen is VP of Developer GTM at Cloudflare: developer relations, developer marketing, developer-led sales and events.
- Her leads: Priya Raman (Developer Relations), Marcus Chen (Developer Sales), Sofia Alvarez (Product Marketing, Workers AI), Hannah Lee (Events), Tom Okafor (Engineering Manager, Workers AI).
- Works 8am–6pm Pacific. Prefers short bullet summaries that end with a recommendation.
- Never send, post or commit her to anything outside Cloudflare without asking first.
- Team chat is Google Chat; key spaces are #devgtm-leads, #devweek-2027 and #workers-ai-launch.`

export function demoSeed(now: number): DemoSeed {
  // Fresh ids each time: a deleted bot's Durable Object cannot be reused.
  const suffix = now.toString(36).slice(-4)
  const id = (base: string) => `${base}-${suffix}`
  const at = (ago: number) => now - ago
  let n = 0
  const msg = (
    botId: string,
    role: "user" | "assistant",
    text: string,
    ago: number,
    origin?: MessageOrigin
  ): UIMessage => ({
    id: `${botId}-m${n++}`,
    role,
    parts: [{ type: "text", text }],
    metadata: {
      at: at(ago),
      ...(origin ? { origin, background: true } : {}),
    } satisfies MessageMeta,
  })
  const trigger = (botId: string, origin: MessageOrigin, ago: number) =>
    msg(botId, "user", `[${origin.name}]`, ago + 20_000, origin)
  const checkIn: MessageOrigin = { kind: "check-in", name: "Check-in" }

  const brief = id("brief")
  const chat = id("chat")
  const inbox = id("inbox")
  const deals = id("deals")
  const eng = id("eng")
  const community = id("community")

  // ── Chief of Staff ────────────────────────────────────────────────
  const briefReady = msg(
    brief,
    "assistant",
    `Your 4pm with the Workers AI leads is prepped. One page in your Drive: last week's decisions, the image models GA slip, the open pricing questions, and two asks for you (approve the slip comms, pick a webinar date). [Brief: Workers AI leads, Oct 29](https://docs.google.com/document/d/brief-workers-ai)`,
    40 * MIN
  )
  const briefBot: DemoBotSeed = {
    id: brief,
    avatar: "amber-rectangle",
    name: "Chief of Staff",
    role: "Preps Jane's meetings, writes her weekly exec update, and keeps her calendar sane.",
    unread: true,
    memory: `- Prep a one-pager for any meeting with 3+ people: context, decisions needed, what Jane owes people.
- Weekly exec update goes to the SVP every Friday by 5pm Pacific.
- Protect Tuesday and Thursday mornings for deep work.`,
    messages: [
      msg(
        brief,
        "user",
        "Prep me for every meeting with more than three people: a one-pager with context, decisions needed, and what I owe people. Put it in my Drive an hour before.",
        7 * DAY
      ),
      msg(
        brief,
        "assistant",
        "Will do. I'll read the invite, the related Chat threads and emails, and last meeting's notes, then drop a one-pager in **Drive › Meeting briefs** an hour before. I'll also block 15 minutes before anything with an exec so you can read it.",
        7 * DAY - 2 * MIN
      ),
      trigger(brief, { kind: "routine", name: "Meeting prep" }, 40 * MIN),
      briefReady,
      msg(brief, "user", "What's left on my plate today?", 6 * MIN),
      msg(
        brief,
        "assistant",
        `Four things need you, all on your Desk:

1. **Ridgeline discount** – Marcus needs your sign-off on 18% to close Friday.
2. **Brightloop exec briefing** – the yes to Dana is drafted, waiting for your OK.
3. **Developer Week 2027 dates** – Hannah needs a pick by Friday.
4. **Launch roll-up** – ready to post in #workers-ai-launch.

Then your 4pm with the Workers AI leads (brief is ready) and the weekly exec update, due tomorrow. I'll draft that tonight from this week's Desk.`,
        5 * MIN
      ),
    ],
    openItems: [
      {
        title: "Weekly exec update, due Fri 5pm",
        note: "Draft Thursday night from the week's Desk and launch status.",
        at: at(2 * DAY),
        checkAfter: at(-6 * HOUR),
      },
    ],
  }

  // ── Chat Triage ────────────────────────────────────────────────────
  const mentions = msg(
    chat,
    "assistant",
    `You were @mentioned 3 times in #devgtm-leads during your QBR.

- **Priya** needs your OK on the DevRel headcount swap: one APAC advocate for one content engineer. The doc is ready.
- **Marcus** asked if you can join the Ridgeline call Friday at 10. I put a hold on your calendar.
- **Sofia** shared the Workers AI pricing FAQ for review, due Monday.

Only Marcus's Friday call is time-sensitive. [Open #devgtm-leads](https://chat.google.com/room/devgtm-leads)`,
    35 * MIN
  )
  const devweek = msg(
    chat,
    "assistant",
    "Hannah needs your call in #devweek-2027 by Friday to hold the venue: **April 5–9** (clashes with a big cloud conference) or **April 12–16** (the venue is $40k cheaper). Which one?",
    2 * HOUR
  )
  const chatBot: DemoBotSeed = {
    id: chat,
    avatar: "teal-circle",
    name: "Chat Triage",
    role: "Watches Jane's Google Chat spaces and DMs, pulls out what needs her, and drafts replies.",
    unread: true,
    memory: `- Watch DMs and @mentions in #devgtm-leads, #devweek-2027 and #workers-ai-launch.
- Skip bot posts and muted threads. Batch anything that can wait into a 5pm summary.
- Jane likes replies drafted, never sent.`,
    messages: [
      msg(
        chat,
        "user",
        "Watch my Google Chat. DMs and @mentions in #devgtm-leads, #devweek-2027 and #workers-ai-launch. Tell me only what needs me and batch the rest.",
        3 * DAY
      ),
      msg(
        chat,
        "assistant",
        "Got it. I'll check every two hours during your working day. Decisions go on your Desk right away; everything else waits for a 5pm summary. I'll skip bot posts and threads you've muted, and I'll draft replies but never send them.",
        3 * DAY - 2 * MIN
      ),
      trigger(chat, checkIn, 2 * HOUR),
      devweek,
      trigger(chat, checkIn, 35 * MIN),
      mentions,
    ],
    openItems: [
      {
        title: "Developer Week 2027 dates",
        note: "Hannah needs Jane's pick by Friday to hold the venue.",
        at: at(2 * HOUR),
        checkAfter: at(-DAY),
      },
      {
        title: "Workers AI pricing FAQ review",
        note: "Sofia asked for comments by Monday.",
        at: at(35 * MIN),
      },
    ],
  }

  // ── Inbox Triage ───────────────────────────────────────────────────
  const sweep = msg(
    inbox,
    "assistant",
    "Cleared 52 emails and flagged 4 for you. I archived 38 newsletters and notifications, filed 10 receipts to Expensify, and answered 4 scheduling requests with your template. The 4 that need you are on your Desk.",
    6 * HOUR
  )
  const analyst = msg(
    inbox,
    "assistant",
    `Northbeam Research wants a Developer Platform briefing before Nov 14. Their analyst covering serverless and edge platforms is finishing a market report and wants 45 minutes with you and a product lead. Last year's briefing moved us from Contender to Strong Performer.

You're free **Nov 10 at 9am** and **Nov 12 at 2pm**, and Priya can cover demos. Want me to propose those times? [Email thread](https://mail.google.com/mail/u/0/#inbox/northbeam-briefing)`,
    3 * HOUR
  )
  const brightloop = msg(
    inbox,
    "assistant",
    "Dana at Brightloop followed up on the Dec 3 exec briefing. Sofia confirmed she can present, so I drafted the yes. It's waiting for your OK on your Desk.",
    70 * MIN
  )
  const inboxBot: DemoBotSeed = {
    id: inbox,
    avatar: "coral-circle",
    name: "Inbox Triage",
    role: "Clears Jane's Gmail every morning, files receipts, handles scheduling, and flags what needs her.",
    unread: true,
    memory: `- Morning sweep at 7am Pacific: archive newsletters, file receipts to Expensify, answer scheduling from the template.
- Anything that commits Jane to something external: draft it and ask.
- Brightloop: say yes to the exec briefing if Sofia can present.`,
    messages: [
      msg(
        inbox,
        "user",
        "Every morning: clear the noise, file receipts, answer scheduling with my template. Anything that commits me to something, ask first.",
        5 * DAY
      ),
      msg(
        inbox,
        "assistant",
        "Done. I'll run a sweep at 7am Pacific. Newsletters and notifications get archived, receipts go to Expensify, and scheduling requests get your template with your real availability. Anything that commits you to something, I'll draft and put on your Desk for an OK.",
        5 * DAY - 2 * MIN
      ),
      msg(
        inbox,
        "user",
        "If Brightloop asks about the exec briefing again, say yes as long as Sofia can present.",
        2 * DAY
      ),
      msg(
        inbox,
        "assistant",
        "Noted. If Dana follows up, I'll check with Sofia first, then draft the yes for your OK.",
        2 * DAY - MIN
      ),
      trigger(
        inbox,
        { kind: "routine", name: "Morning inbox sweep" },
        6 * HOUR
      ),
      sweep,
      trigger(
        inbox,
        { kind: "email", name: "ar@northbeam-research.example" },
        3 * HOUR
      ),
      analyst,
      trigger(
        inbox,
        { kind: "email", name: "dana@brightloop.example" },
        70 * MIN
      ),
      brightloop,
    ],
    openItems: [
      {
        title: "Northbeam briefing times",
        note: "Proposed Nov 10 9am or Nov 12 2pm, waiting on Jane.",
        at: at(3 * HOUR),
      },
      {
        title: "Brightloop exec briefing, Dec 3",
        note: "Reply drafted, waiting for Jane's OK.",
        at: at(70 * MIN),
      },
    ],
  }

  // ── Deal Desk ──────────────────────────────────────────────────────
  const pipeline = msg(
    deals,
    "assistant",
    "Updated the Q4 developer-led pipeline: **$3.2M commit, $1.1M upside**. Commit is up $400k on last week, mostly Ridgeline. Two deals slipped to Q1 (Fabrikam and Lumen). [Pipeline sheet](https://docs.google.com/spreadsheets/d/q4-dev-led-pipeline)",
    7 * HOUR
  )
  const signals = msg(
    deals,
    "assistant",
    `Three accounts crossed $50k/month on Workers with no account exec.

| Account | October spend | vs. September | Main products |
|---|---|---|---|
| Tandem AI | $82k | +210% | Workers AI, Durable Objects |
| Quillstack | $61k | +95% | R2, Workers |
| Harbor Labs | $54k | +140% | D1, Containers |

All three are self-serve on pay-as-you-go. I can draft intros to the right AEs on Marcus's team, with the usage story for each. [Salesforce report](https://cloudflare.my.salesforce.com/dev-led-expansion)`,
    110 * MIN
  )
  const discount = msg(
    deals,
    "assistant",
    "Marcus submitted Ridgeline's upgrade to Workers Enterprise at **18% off** ($420k ARR, 24 months). Finance needs your sign-off above 15%. Their usage is up 3.4x since July and they have a competing offer, so I'd approve. It's on your Desk.",
    25 * MIN
  )
  const dealsBot: DemoBotSeed = {
    id: deals,
    avatar: "green-hexagon",
    name: "Deal Desk",
    role: "Watches Salesforce and Workers usage for developer-led revenue: expansions, discounts and renewals.",
    unread: true,
    memory: `- Discounts above 15% need Jane's sign-off; under that, Marcus approves.
- Expansion signal: any self-serve account over $50k/month or growing 2x month on month.
- Weekly pipeline roll-up on Thursday mornings.`,
    messages: [
      msg(
        deals,
        "user",
        "Watch Salesforce and Workers billing for developer-led accounts. Tell me about expansion signals and anything that needs my sign-off.",
        7 * DAY
      ),
      msg(
        deals,
        "assistant",
        "On it. I'll flag self-serve accounts that cross $50k/month or double month on month, discount requests over 15%, and renewals within 60 days. Every Thursday morning I'll roll up the developer-led pipeline into your sheet.",
        7 * DAY - 2 * MIN
      ),
      trigger(
        deals,
        { kind: "routine", name: "Weekly pipeline roll-up" },
        7 * HOUR
      ),
      pipeline,
      trigger(deals, checkIn, 110 * MIN),
      signals,
      trigger(deals, checkIn, 25 * MIN),
      discount,
    ],
    openItems: [
      {
        title: "Ridgeline 18% discount",
        note: "Waiting for Jane's sign-off; Marcus wants to close Friday.",
        at: at(25 * MIN),
      },
      {
        title: "Fabrikam slipped to Q1",
        note: "Procurement freeze until January. Check back mid-November.",
        at: at(7 * HOUR),
        checkAfter: at(-17 * DAY),
      },
    ],
  }

  // ── Launch Engineer ────────────────────────────────────────────────
  const docsGaps = msg(
    eng,
    "assistant",
    "Filed 4 docs gaps from the Containers GA bug bash, labelled `containers` and assigned to the docs on-call. The biggest one: there's no guide for moving from Docker Compose.",
    26 * HOUR
  )
  const slip = msg(
    eng,
    "assistant",
    `Workers AI image models GA is slipping a week, to Nov 19. Tom's team found a cold-start regression in the image pipeline during load tests yesterday. The fix is in review, but they want a week of soak time.

**What moves with it:**
- The launch blog post (booked Nov 12)
- Sofia's launch webinar (Nov 13)
- The lead story in the Nov 14 developer newsletter

I can move the blog slot to Nov 19, tell Sofia, and swap the newsletter lead to the Agents SDK beta. [WAI-2291](https://jira.example.com/browse/WAI-2291) · [#workers-ai-eng thread](https://chat.google.com/room/workers-ai-eng)`,
    9 * MIN
  )
  const rollup = msg(
    eng,
    "assistant",
    "This week's launch readiness roll-up is ready to post in #workers-ai-launch. It's waiting for your OK.",
    15 * MIN
  )
  const engBot: DemoBotSeed = {
    id: eng,
    avatar: "blue-rectangle",
    name: "Launch Engineer",
    role: "Tracks engineering readiness for Developer Platform launches in Jira and the launch channels, and flags slips before they reach marketing.",
    unread: true,
    memory: `- Watch Jira projects WAI, CONT and AGENTS, and the launch spaces in Google Chat.
- A date change on any launch ticket goes to Jane the same hour, with what moves with it.
- Weekly readiness roll-up to #workers-ai-launch on Thursdays.`,
    messages: [
      msg(
        eng,
        "user",
        "You're my eyes on engineering for launches. Watch Jira (WAI, CONT and AGENTS) and the launch channels. Flag anything that moves a date before marketing finds out.",
        6 * DAY
      ),
      msg(
        eng,
        "assistant",
        "Got it. I'll watch due dates, blockers and P0/P1 bugs on launch tickets, plus the eng threads in the launch spaces. When a date moves, you'll hear within the hour, with everything that moves with it: posts, webinars, newsletters and partner commitments.",
        6 * DAY - 2 * MIN
      ),
      msg(
        eng,
        "user",
        "Go through the Containers bug bash notes and file anything that's a docs problem.",
        26 * HOUR + 5 * MIN
      ),
      docsGaps,
      trigger(
        eng,
        { kind: "script", name: "Weekly launch readiness roll-up" },
        15 * MIN
      ),
      rollup,
      trigger(eng, checkIn, 9 * MIN),
      slip,
    ],
    openItems: [
      {
        title: "WAI-2291 cold-start fix",
        note: "In review. GA moves to Nov 19 if soak passes.",
        at: at(9 * MIN),
        checkAfter: at(-DAY),
      },
      {
        title: "Agents SDK 1.0 docs freeze, Nov 20",
        note: "On track. Check the open docs PRs on Monday.",
        at: at(3 * DAY),
      },
    ],
  }

  // ── Community Pulse ────────────────────────────────────────────────
  const themes = msg(
    community,
    "assistant",
    "Drafted three Developer Week 2027 themes, each backed by this year's top developer requests: **Agents everywhere**, **Your data, at the edge** and **Ship without servers**. It's in `/workspace/devweek-2027-themes.md`, with the forum threads and survey numbers behind each.",
    20 * HOUR
  )
  const hn = msg(
    community,
    "assistant",
    `The Agents SDK 1.0 beta post is #2 on Hacker News: 412 points and 180 comments in 5 hours. Sentiment is mostly positive. The top questions are about pricing for long-running agents and how Durable Objects compare to workflow engines.

Two comments say the docs skip deploying with an existing Hono app. I opened a docs issue and asked Priya's team whether someone can reply on the thread. [HN thread](https://news.ycombinator.com/item?id=43120001) · [Docs issue](https://github.com/cloudflare/cloudflare-docs/issues/27311)`,
    4 * HOUR
  )
  const communityBot: DemoBotSeed = {
    id: community,
    avatar: "violet-square",
    name: "Community Pulse",
    role: "Keeps an eye on what developers say about Cloudflare on Hacker News, X, Reddit and Discord.",
    unread: false,
    memory: `- Sources: Hacker News, X, r/CloudFlare, the Cloudflare Developers Discord.
- Weekly summary on Fridays. Ping right away if a thread passes 200 points or turns negative.
- Route unanswered technical questions to Priya's DevRel team.`,
    messages: [
      msg(
        community,
        "user",
        "Keep an eye on what developers say about us: HN, X, r/CloudFlare and our Discord. Weekly summary on Fridays, but ping me if something blows up.",
        4 * DAY
      ),
      msg(
        community,
        "assistant",
        "Will do. I'll check every few hours. Anything past 200 points on HN, trending on X, or turning negative comes to you right away; the rest goes in Friday's summary. Unanswered technical questions go to Priya's team.",
        4 * DAY - 2 * MIN
      ),
      msg(
        community,
        "user",
        "Pull together theme ideas for Developer Week 2027 based on what developers asked for this year.",
        20 * HOUR + 6 * MIN
      ),
      themes,
      trigger(community, checkIn, 4 * HOUR),
      hn,
    ],
    openItems: [
      {
        title: "HN: unanswered Hono deploy question",
        note: "Asked DevRel to reply on the thread.",
        at: at(4 * HOUR),
        checkAfter: at(-2 * HOUR),
      },
    ],
  }

  const open = [{ id: "open", label: "Open chat", kind: "open_chat" as const }]
  const cards: DemoSeed["cards"] = [
    // Needs you
    {
      botId: deals,
      card: {
        key: "demo:ridgeline",
        lane: "needs_you",
        origin: "chat",
        title: "Approve 18% off Ridgeline's Enterprise upgrade",
        why: "Marcus wants to close Friday. Finance needs your sign-off above 15%.",
        found: "",
        detail: JSON.stringify(
          {
            opportunity: "Ridgeline – Workers Enterprise",
            arr: "$420,000",
            discount: "18%",
            term: "24 months",
            reason:
              "Usage up 3.4x since July; competing offer from another cloud",
          },
          null,
          2
        ),
        sources: [],
        actions: [
          { id: "approve", label: "Approve", kind: "approve" },
          { id: "reject", label: "Not now", kind: "reject" },
        ],
        refs: { messageId: discount.id, approvalId: "demo-ridgeline" },
        createdAt: at(25 * MIN),
      },
    },
    {
      botId: inbox,
      card: {
        key: "demo:brightloop",
        lane: "needs_you",
        origin: "email",
        title: "Send Dana a yes for the Dec 3 Brightloop exec briefing",
        why: "She asked twice. You said yes as long as Sofia presents, and Sofia confirmed.",
        found: "",
        detail: JSON.stringify(
          {
            to: "dana@brightloop.example",
            subject: "Re: Exec briefing on Dec 3",
            body: "Hi Dana, yes, we'd love to. Sofia Alvarez will join me to walk through the Workers AI roadmap. Does 10am Pacific work? Best, Jane",
          },
          null,
          2
        ),
        sources: [],
        actions: [
          { id: "approve", label: "Send it", kind: "approve" },
          { id: "reject", label: "Not now", kind: "reject" },
        ],
        refs: { messageId: brightloop.id, approvalId: "demo-brightloop" },
        createdAt: at(70 * MIN),
      },
    },
    {
      botId: eng,
      card: {
        key: "demo:rollup",
        lane: "needs_you",
        origin: "script",
        title: "Post the launch readiness roll-up in #workers-ai-launch",
        why: "Script · Weekly launch readiness roll-up",
        found: "",
        detail: JSON.stringify(
          {
            space: "#workers-ai-launch",
            text: "Image models GA: at risk, moving to Nov 19 (WAI-2291). Containers GA follow-ups: on track. Agents SDK 1.0: on track for Dec 2.",
          },
          null,
          2
        ),
        sources: [],
        actions: [
          { id: "approve", label: "Post it", kind: "approve" },
          {
            id: "approve_all",
            label: "Approve for this run",
            kind: "approve_all",
          },
          { id: "reject", label: "Not now", kind: "reject" },
        ],
        refs: { messageId: rollup.id, approvalId: "demo-rollup" },
        createdAt: at(15 * MIN),
      },
    },
    {
      botId: chat,
      card: {
        key: "demo:devweek",
        lane: "needs_you",
        origin: "chat",
        title: "Developer Week 2027: April 5–9 or April 12–16?",
        why: "Hannah needs your call in #devweek-2027 by Friday to hold the venue.",
        found:
          "- April 5–9: clashes with a big cloud conference\n- April 12–16: the venue is $40k cheaper",
        sources: [],
        actions: [{ id: "open", label: "Answer", kind: "open_chat" }],
        refs: { messageId: devweek.id, approvalId: "demo-devweek" },
        createdAt: at(2 * HOUR),
      },
    },
    // Updates
    {
      botId: eng,
      card: {
        key: "demo:slip",
        lane: "fyi",
        origin: "check-in",
        title: "Workers AI image models GA is slipping a week, to Nov 19",
        why: "Found on a regular check-in · Jira WAI-2291",
        found: withoutTrailingLinks(textOf(slip).replace(/^.+?\. /, "")),
        sources: [
          {
            label: "WAI-2291",
            url: "https://jira.example.com/browse/WAI-2291",
          },
          {
            label: "#workers-ai-eng thread",
            url: "https://chat.google.com/room/workers-ai-eng",
          },
        ],
        actions: open,
        refs: { messageId: slip.id },
        createdAt: at(9 * MIN),
      },
    },
    {
      botId: chat,
      card: {
        key: "demo:mentions",
        lane: "fyi",
        origin: "check-in",
        title: "You were @mentioned 3 times in #devgtm-leads during your QBR",
        why: "Google Chat · #devgtm-leads",
        found: withoutTrailingLinks(textOf(mentions).replace(/^.+?\n\n/, "")),
        sources: [
          {
            label: "Open #devgtm-leads",
            url: "https://chat.google.com/room/devgtm-leads",
          },
        ],
        actions: open,
        refs: { messageId: mentions.id },
        createdAt: at(35 * MIN),
      },
    },
    {
      botId: deals,
      card: {
        key: "demo:signals",
        lane: "fyi",
        origin: "check-in",
        title:
          "Three accounts crossed $50k/month on Workers with no account exec",
        why: "Salesforce · Workers billing",
        found: withoutTrailingLinks(textOf(signals).replace(/^.+?\n\n/, "")),
        sources: [
          {
            label: "Salesforce report",
            url: "https://cloudflare.my.salesforce.com/dev-led-expansion",
          },
        ],
        actions: open,
        refs: { messageId: signals.id },
        createdAt: at(110 * MIN),
      },
    },
    {
      botId: inbox,
      card: {
        key: "demo:northbeam",
        lane: "fyi",
        origin: "email",
        title:
          "Northbeam Research wants a Developer Platform briefing before Nov 14",
        why: "Email from ar@northbeam-research.example",
        found: withoutTrailingLinks(textOf(analyst).replace(/^.+?\. /, "")),
        sources: [
          {
            label: "Email thread",
            url: "https://mail.google.com/mail/u/0/#inbox/northbeam-briefing",
          },
        ],
        actions: open,
        refs: { messageId: analyst.id },
        createdAt: at(3 * HOUR),
      },
    },
    {
      botId: community,
      card: {
        key: "demo:hn",
        lane: "fyi",
        origin: "check-in",
        title: "The Agents SDK 1.0 beta post is #2 on Hacker News",
        why: "Found on a regular check-in · Hacker News",
        found: withoutTrailingLinks(textOf(hn).replace(/^.+?: /, "")),
        sources: [
          {
            label: "HN thread",
            url: "https://news.ycombinator.com/item?id=43120001",
          },
          {
            label: "Docs issue",
            url: "https://github.com/cloudflare/cloudflare-docs/issues/27311",
          },
        ],
        actions: open,
        refs: { messageId: hn.id },
        createdAt: at(4 * HOUR),
      },
    },
    // Done while you were away
    {
      botId: brief,
      card: {
        key: "demo:brief",
        lane: "done",
        origin: "routine",
        title: "Prepped your 4pm with the Workers AI leads",
        why: "Routine · Meeting prep",
        found: withoutTrailingLinks(textOf(briefReady).replace(/^.+?\. /, "")),
        sources: [
          {
            label: "Brief: Workers AI leads, Oct 29",
            url: "https://docs.google.com/document/d/brief-workers-ai",
          },
        ],
        actions: open,
        refs: { messageId: briefReady.id },
        createdAt: at(40 * MIN),
      },
    },
    {
      botId: inbox,
      card: {
        key: "demo:sweep",
        lane: "done",
        origin: "routine",
        title: "Cleared 52 emails and flagged 4 for you",
        why: "Routine · Morning inbox sweep",
        found: withoutTrailingLinks(textOf(sweep).replace(/^.+?\. /, "")),
        sources: [],
        actions: open,
        refs: { messageId: sweep.id },
        createdAt: at(6 * HOUR),
      },
    },
    {
      botId: deals,
      card: {
        key: "demo:pipeline",
        lane: "done",
        origin: "routine",
        title: "Q4 developer-led pipeline: $3.2M commit, $1.1M upside",
        why: "Routine · Weekly pipeline roll-up",
        found: withoutTrailingLinks(textOf(pipeline).replace(/^.+?\. /, "")),
        sources: [
          {
            label: "Pipeline sheet",
            url: "https://docs.google.com/spreadsheets/d/q4-dev-led-pipeline",
          },
        ],
        actions: open,
        refs: { messageId: pipeline.id },
        createdAt: at(7 * HOUR),
      },
    },
    {
      botId: community,
      card: {
        key: "demo:themes",
        lane: "done",
        origin: "chat",
        title: "Drafted three Developer Week 2027 themes",
        why: "You asked: “Pull together theme ideas for Developer Week 2027”",
        found: withoutTrailingLinks(textOf(themes).replace(/^.+?: /, "")),
        sources: [],
        actions: open,
        refs: { messageId: themes.id },
        createdAt: at(20 * HOUR),
      },
    },
    {
      botId: eng,
      card: {
        key: "demo:docs",
        lane: "done",
        origin: "chat",
        title: "Filed 4 docs gaps from the Containers GA bug bash",
        why: "You asked: “File anything from the bug bash that's a docs problem”",
        found: withoutTrailingLinks(textOf(docsGaps).replace(/^.+?\. /, "")),
        sources: [],
        actions: open,
        refs: { messageId: docsGaps.id },
        createdAt: at(26 * HOUR),
      },
    },
  ]

  return {
    // Sidebar order, top to bottom.
    bots: [briefBot, chatBot, inboxBot, dealsBot, engBot, communityBot],
    cards,
    sharedMemory: DEMO_SHARED_MEMORY,
  }
}

function textOf(message: UIMessage) {
  return message.parts.map((p) => (p.type === "text" ? p.text : "")).join("")
}
