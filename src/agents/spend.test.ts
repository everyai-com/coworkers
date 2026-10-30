import { describe, expect, it } from "vitest"
import { advance, afterFilter, newLogs, summarize, tally } from "./spend"
import type { GatewayLog } from "./spend"

const log = (
  id: string,
  at: string,
  cost: number,
  metadata: GatewayLog["metadata"]
): GatewayLog => ({
  id,
  created_at: at,
  cost,
  tokens_in: 100,
  tokens_out: 10,
  metadata,
})

describe("tally", () => {
  it("adds up each bot's calls by day and kind of turn", () => {
    const rows = tally(
      [
        log("1", "2026-10-27T10:00:00.000Z", 0.02, {
          botId: "a",
          turn: "background",
        }),
        log(
          "2",
          "2026-10-27T11:00:00.000Z",
          0.01,
          '{"botId":"a","turn":"background"}'
        ),
        log("3", "2026-10-27T12:00:00.000Z", 0.05, {
          botId: "a",
          turn: "chat",
        }),
        log("4", "2026-10-28T00:00:01.000Z", 0.03, {
          botId: "a",
          turn: "chat",
        }),
      ],
      new Set(["a"])
    )
    const bg = rows.find(
      (r) => r.day === "2026-10-27" && r.turn === "background"
    )
    expect(bg?.cost).toBeCloseTo(0.03)
    expect(bg?.requests).toBe(2)
    expect(bg?.tokensIn).toBe(200)
    expect(rows).toHaveLength(3)
  })

  it("leaves out calls from bots this hub does not own", () => {
    const rows = tally(
      [
        log("1", "2026-10-27T10:00:00.000Z", 1, { botId: "someone-else" }),
        log("2", "2026-10-27T10:00:00.000Z", 1, null),
        log("3", "2026-10-27T10:00:00.000Z", 1, "not json"),
      ],
      new Set(["a"])
    )
    expect(rows).toEqual([])
  })
})

describe("the cursor", () => {
  const at = "2026-10-27T10:00:00.000Z"
  it("skips logs it already counted at the same instant", () => {
    const first = [log("1", at, 1, {}), log("2", at, 1, {})]
    const cursor = advance(first, null)
    expect(cursor).toEqual({ at, ids: ["1", "2"] })
    const next = newLogs(
      [log("1", at, 1, {}), log("2", at, 1, {}), log("3", at, 1, {})],
      cursor
    )
    expect(next.map((l) => l.id)).toEqual(["3"])
    expect(advance(next, cursor)).toEqual({ at, ids: ["1", "2", "3"] })
  })

  it("asks from just before the cursor, since the API only has gt", () => {
    expect(JSON.parse(afterFilter(at))).toEqual([
      {
        key: "created_at",
        operator: "gt",
        value: ["2026-10-27T09:59:59.999Z"],
      },
    ])
  })

  it("keeps the old cursor when nothing new came in", () => {
    const cursor = { at, ids: ["1"] }
    expect(advance([], cursor)).toBe(cursor)
  })
})

describe("summarize", () => {
  it("splits today from the month and ranks bots by cost", () => {
    const now = Date.parse("2026-10-28T09:00:00.000Z")
    const row = (
      day: string,
      botId: string,
      turn: "chat" | "background",
      cost: number
    ) => ({
      day,
      botId,
      turn,
      cost,
      tokensIn: 0,
      tokensOut: 0,
      requests: 1,
    })
    const s = summarize(
      [
        row("2026-09-30", "a", "chat", 5),
        row("2026-10-01", "a", "background", 1),
        row("2026-10-28", "a", "chat", 0.5),
        row("2026-10-28", "b", "background", 2),
      ],
      now
    )
    expect(s.month).toBe("2026-10")
    expect(s.total.month).toBeCloseTo(3.5)
    expect(s.total.today).toBeCloseTo(2.5)
    expect(s.bots.map((b) => b.botId)).toEqual(["b", "a"])
    expect(s.bots[1].background).toBeCloseTo(1)
    expect(s.days[0]).toEqual({ day: "2026-09-30", cost: 5 })
  })
})
