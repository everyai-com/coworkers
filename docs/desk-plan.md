# The Desk — plan

A home screen of cards instead of a list of chats. Bots come to you; chat is
what you open when a card needs more.

## What exists today

Everything the Desk needs already happens, it just ends up as chat:

- **One exit point.** Check-ins, routines, emails, webhooks, delegated tasks
  and long turns all finish in `BotAgent.onChatResponse`. It already decides:
  stay quiet (`NO_UPDATE` → prune), mark unread, or push.
- **Origin is known.** Each turn's trigger carries `MessageMeta.origin`
  (`check-in`, `routine` + name, `email`, `webhook`, …) and `background`.
- **Approvals.** Tool approvals (`pendingApprovalId`), script approvals
  (`scriptApprovals` in state), reminders and expiry (`sweepStuck`). The hub
  already exposes `waitingParts` / `answerApproval` / `answerScriptApproval`,
  and `approval-popover.tsx` answers them outside the chat.
- **Open items.** `open_items` table + `track_item` / `update_item` /
  `resolve_item`. The "why now" for most findings lives here.
- **No repeats.** `reported` table + `mark_reported`.
- **Noise cap.** `proactive_log` + `maxPerDay`, quiet hours in `notify()`.
- **The gap.** Background turns cannot act ("Ask first" is blocked, see
  "Working on your own" in `prompt.ts`), so today they end with "here's what
  I would do" as text. Nothing turns that into a button.

## The card

One shape for every lane. Stored on the **UserHub** (one Desk across bots).

```ts
// src/lib/types.ts
export type DeskLane = "needs_you" | "fyi" | "done"

export interface DeskCard {
  id: string
  botId: string
  lane: DeskLane
  /** One line: what this is. */
  title: string
  /** Why now: the open item, earlier conversation or routine it ties to. */
  why: string
  /** What the bot found or did. Short Markdown. */
  found: string
  sources: { label: string; url: string }[]
  /** Up to 3. The first is the primary button. */
  actions: DeskAction[]
  refs: {
    messageId?: string // jump into the thread
    openItemId?: string
    approvalId?: string // tool approval in the chat
    script?: { runId: string; callId: string }
  }
  createdAt: number
  status: "open" | "acted" | "dismissed" | "snoozed"
  snoozeUntil?: number
  feedback?: { verdict: "useful" | "not_useful"; reason?: DeskReason }
}

export interface DeskAction {
  id: string
  label: string // "Send reply", "Approve", "Add to Friday"
  kind: "approve" | "reject" | "run" | "open_chat"
  /** For "run": what the bot does once you tap. */
  prompt?: string
  /** The draft (email body, invoice lines) shown before you tap. */
  preview?: string
  /** For "run": the one tool this tap pre-approves. */
  tool?: string
}

export type DeskReason = "knew" | "not_important" | "wrong" | "too_early"
```

The fixed nudge format is enforced by the schema: `why` is required, `found`
is capped (~400 chars), max 3 actions, max 3 sources.

## Lanes and where cards come from

| Lane          | Source                                                                                                     | Push?                   |
| ------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------- |
| **Needs you** | Every pending tool/script approval, `ask_user`, secret request, hand-off. Bot-proposed actions (`run`).    | Yes (as today)          |
| **FYI**       | Background findings with no decision attached.                                                             | Yes, outside quiet hours |
| **Done**      | Routine runs that reported, finished delegated tasks, long turns that ended while you were away.          | Never                   |

Cards close themselves: answering an approval anywhere (chat, popover, Desk),
expiry in `sweepStuck`, or the user moving past it in chat
(`repairInterruptedToolPart`) all call `hub.closeCards(botId, ref)`.

## Flow

```
background turn ──► post_card tool ─────────┐
                                             ├─► hub.postCard() ─► desk_cards (SQL)
onChatResponse ──► fallback card from text ──┘                    └► HubState.desk (open cards, ≤60)
approval raised ─► needs_you card                                       │
                                                                        ▼
                                          Desk UI ─► actOnCard / rateCard / snoozeCard
                                                       │
                                     approve/reject ───┴──► bot.answerApproval / answerScriptApproval
                                     run ─────────────────► bot.runFromDesk(card, action)  (foreground turn)
```

- **`post_card` tool (bot).** Background turns post findings as cards. The
  prompt's "Working on your own" section changes from "write one short
  message per finding" to "one `post_card` per finding; fill `why` from your
  open items or memory; offer the action you would take as a `run` action
  with the draft in `preview`". Counts against `maxPerDay`; past the cap it
  returns an error asking the bot to keep only what matters most.
- **Fallback.** A background turn that ends with text but posted no card
  still gets one: `fyi`, title from the first line, `why` from the origin
  ("Routine: Weekly invoices", "Email from …"). Old routines keep working.
- **Turns with cards are not pruned**, even if the final text is
  `NO_UPDATE`, so `refs.messageId` keeps pointing at something.
- **`run` actions.** `runFromDesk` starts a foreground turn:
  `[From your Desk] The user approved: <prompt>`. For that turn, `decide()`
  allows `action.tool` once without asking: the user already saw the draft.
  Anything else still follows the rules.

## Feedback loop

1. **Signals on every card.** Useful / Not useful (with a reason chip),
   acting on it (strong yes), dismissing (weak no), snoozing (`too_early`).
2. **Into the next turn.** Check-in and routine prompts get a "How your
   recent cards landed" section (last ~15 rated cards: title, verdict,
   reason), next to "Recently reported". Built in `prompt.ts` like
   `reportedLines`.
3. **Into memory.** After 5 new "not useful" votes (or weekly), the bot runs
   a short background "tune" turn: read the feedback, write durable rules to
   memory ("Newsletters are not worth a card", "Invoices under $50: skip").
   Memory already keeps revisions.
4. **Shown, undoable.** The tune turn posts a `done` card: "I learned: …"
   with an **Undo** action (`restoreMemory(revisionId)`). This is the trust
   piece: you see what it learned and can take it back.
5. **Per-bot score.** Useful rate over 30 days in bot settings. Later: back
   off check-in frequency for bots that keep missing.

## UI

- **`/` becomes the Desk.** Stop redirecting to the latest bot
  (`routes/_app/index.tsx`). Onboarding stays for users with no bots.
- **Sidebar.** A "Desk" row above the bots with a badge for open
  `needs_you` cards.
- **Layout.** Stacked lanes: Needs you → FYI → "Done while you were away"
  (compact list, collapsed past 5). Cards newer than `lastDeskVisit` (on the
  hub) get a subtle marker.
- **`components/desk-card.tsx`.** Bot avatar + name + time · title · "why"
  line (subtle, with link) · found (Markdown) · source chips · action buttons
  (primary first, `preview` expands inline) · footer: useful / not useful,
  snooze, open chat. Approval cards reuse `describeCall` + `CodeBlock` from
  `approval-popover.tsx`.
- **Empty state.** "All clear" plus how many things the bots are watching
  (open items count).

## Build order

1. **Cards from what exists (no prompt changes).** Types, `desk_cards` on
   the hub, `postCard` / `closeCards` / callables, approvals → `needs_you`,
   fallback cards from background turns, `done` cards from routines/tasks,
   Desk route + card UI + sidebar row. Useful on day one.
2. **The nudge format.** `post_card` tool, prompt rewrite, `run` actions with
   `runFromDesk` and the one-shot pre-approval, no-prune rule.
3. **Feedback.** Rating/snooze UI, feedback section in prompts, tune turn,
   "I learned" card with Undo, per-bot score.
4. **Later.** "Watching" list (open items across bots), morning digest push,
   suggest raising a rule to "allow" after N approvals of the same tool.

## Files

| File                                   | Change                                                           |
| -------------------------------------- | ---------------------------------------------------------------- |
| `src/lib/types.ts`                     | `DeskCard`, `DeskAction`, `DeskLane`, `HubState.desk`            |
| `src/agents/desk.ts` (+ `desk.test.ts`) | Pure helpers: fallback card from a turn, lane rules, cap, feedback summary |
| `src/agents/user-hub.ts`               | `desk_cards` table, `postCard`, `closeCards`, `actOnCard`, `rateCard`, `snoozeCard`, `dismissCard`, `lastDeskVisit` |
| `src/agents/bot-agent.ts`              | `post_card` tool, hooks in `onChatResponse` / approvals / `sweepStuck`, `runFromDesk`, one-shot allow in `decide()`, tune turn |
| `src/agents/prompt.ts`                 | "Working on your own" rewrite, feedback section                  |
| `src/lib/hub-context.tsx`              | Desk callables                                                   |
| `src/routes/_app/index.tsx`            | Desk page                                                        |
| `src/components/desk-card.tsx`, `sidebar.tsx` | Card, Desk row + badge                                   |

## Decisions to make

1. **One-shot pre-approval for `run`.** Tapping "Send reply" allows that one
   tool once, without a second approval in the chat. Recommended: yes, since
   the draft was on the card. Alternative: always ask again in the chat.
2. **Desk replaces "land on the latest bot".** Recommended: yes, that is the
   whole point. Bots stay one click away in the sidebar.
