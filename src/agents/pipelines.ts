import { parseCron } from "@/lib/cron"
import type { PipelineDraft, PipelineStep } from "@/lib/types"

export const MAX_PIPELINE_STEPS = 10
export const MAX_PIPELINE_INPUT_CHARS = 20_000
const MAX_INSTRUCTIONS_CHARS = 4_000
const MAX_NAME_CHARS = 60

/**
 * Check a pipeline the browser sent and return it trimmed, or throw with a
 * message the editor can show.
 */
export function validatePipeline(
  draft: PipelineDraft,
  botIds: ReadonlySet<string>
): PipelineDraft {
  const name = draft.name.trim().slice(0, MAX_NAME_CHARS)
  if (!name) throw new Error("Give the pipeline a name.")
  if (!Array.isArray(draft.steps) || draft.steps.length === 0) {
    throw new Error("Add at least one step.")
  }
  if (draft.steps.length > MAX_PIPELINE_STEPS) {
    throw new Error(`A pipeline has at most ${MAX_PIPELINE_STEPS} steps.`)
  }
  const steps = draft.steps.map((step, i): PipelineStep => {
    if (step.kind === "approval") {
      if (i === 0) {
        throw new Error(
          "The first step has to be a bot: there is nothing to approve yet."
        )
      }
      return {
        kind: "approval",
        note: String(step.note ?? "")
          .trim()
          .slice(0, 500),
      }
    }
    if (step.kind !== "bot")
      throw new Error(`Step ${i + 1} has an unknown kind.`)
    if (!botIds.has(step.botId)) {
      throw new Error(`Pick a bot for step ${i + 1}.`)
    }
    const instructions = String(step.instructions ?? "").trim()
    if (!instructions) {
      throw new Error(`Tell the bot in step ${i + 1} what to do.`)
    }
    return {
      kind: "bot",
      botId: step.botId,
      instructions: instructions.slice(0, MAX_INSTRUCTIONS_CHARS),
    }
  })
  const cron = draft.cron?.trim() || null
  if (cron && !parseCron(cron)) {
    throw new Error("The schedule is not a valid 5-field cron expression.")
  }
  return { name, steps, cron }
}

/** What a bot sees when another bot hands it a task. */
export function delegationPrompt(
  from: string,
  task: string,
  sender: "bot" | "agent" = "bot"
) {
  const header =
    sender === "agent"
      ? `[Task from ${from}, an outside agent the user connected]`
      : `[Task from the ${from} bot]`
  return `${header}\n${task}\n\nWhen you finish, your final reply is sent back to ${from} as the result.`
}

/** What a bot sees when it runs one step of a pipeline. */
export function pipelineStepPrompt(input: {
  pipeline: string
  step: number
  steps: number
  instructions: string
  /** Who produced the input: a bot's name, or "the user". */
  from: string
  input: string
  /** Who gets this step's result: the next bot, or "the user". */
  next: string
}) {
  return [
    `[Pipeline "${input.pipeline}", step ${input.step + 1} of ${input.steps}]`,
    input.instructions,
    "",
    `## Input from ${input.from}`,
    input.input.trim() || "(nothing)",
    "",
    `Your final reply is passed on to ${input.next}. Make it the complete result, not a summary of what you did. To pass files on, attach them with attach_result_files.`,
  ].join("\n")
}
