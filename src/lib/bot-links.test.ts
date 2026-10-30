import { describe, expect, it } from "vitest"
import {
  botIdFromLink,
  botMention,
  linkMentions,
  mentionQuery,
  plainMentions,
  splitMentions,
} from "./bot-links"

const bots = [
  { id: "a1", name: "Sales" },
  { id: "b2", name: "Sales Lead" },
  { id: "c3", name: "Researcher" },
]

describe("botIdFromLink", () => {
  it("reads the id from a bot link", () => {
    expect(botIdFromLink("coworkers://bot/a1")).toBe("a1")
    expect(botIdFromLink(" coworkers://bot/a1/ ")).toBe("a1")
  })

  it("ignores anything else", () => {
    expect(botIdFromLink("https://example.com")).toBeNull()
    expect(botIdFromLink("Researcher")).toBeNull()
    expect(botIdFromLink("coworkers://bot/")).toBeNull()
    expect(botIdFromLink("coworkers://bot/a1?x=1")).toBeNull()
    expect(botIdFromLink(undefined)).toBeNull()
  })
})

describe("linkMentions", () => {
  it("links every named bot, longest name first", () => {
    expect(
      linkMentions("Ask @sales lead and @Researcher, then @Sales.", bots)
    ).toBe(
      "Ask [@Sales Lead](coworkers://bot/b2) and [@Researcher](coworkers://bot/c3), then [@Sales](coworkers://bot/a1)."
    )
  })

  it("leaves emails, partial words and existing links alone", () => {
    const text =
      "Mail sales@acme.com, ping @Salesforce, see [@Researcher](coworkers://bot/c3)"
    expect(linkMentions(text, bots)).toBe(text)
  })

  it("uses the first bot of a shared name", () => {
    expect(
      linkMentions("@Helper", [
        { id: "x9", name: "Helper" },
        { id: "y8", name: "Helper" },
      ])
    ).toBe("[@Helper](coworkers://bot/x9)")
  })
})

describe("splitMentions", () => {
  it("splits text around bot links", () => {
    expect(
      splitMentions(`Hi ${botMention("Researcher", "c3")}, thanks`)
    ).toEqual([
      { kind: "text", text: "Hi " },
      { kind: "bot", botId: "c3", label: "Researcher" },
      { kind: "text", text: ", thanks" },
    ])
  })

  it("keeps other links as text", () => {
    expect(splitMentions("[site](https://a.com)")).toEqual([
      { kind: "text", text: "[site](https://a.com)" },
    ])
  })
})

describe("mentionQuery", () => {
  it("finds the @ being typed", () => {
    expect(mentionQuery("Ask @Res", 8)).toEqual({ start: 4, query: "Res" })
    expect(mentionQuery("@", 1)).toEqual({ start: 0, query: "" })
    expect(mentionQuery("Ask @Sales Le", 13)).toEqual({
      start: 4,
      query: "Sales Le",
    })
  })

  it("ignores emails, finished lines and a space right after the @", () => {
    expect(mentionQuery("me@acme", 7)).toBeNull()
    expect(mentionQuery("@Res\nmore", 9)).toBeNull()
    expect(mentionQuery("@ hi", 4)).toBeNull()
  })
})

describe("plainMentions", () => {
  it("shows bot links as @Name", () => {
    expect(
      plainMentions(`Told ${botMention("Community Pulse", "c9")} to wait`)
    ).toBe("Told @Community Pulse to wait")
  })
})
