import type { AccessLevel, ActionClass, RulePolicy } from "@/lib/types"
import { LEVEL_RANK, fail, levelOf } from "./operation"
import type { Caller, Failure, Operation, OperationContext } from "./operation"

/**
 * The one checker every transport goes through. In order: who may call it,
 * the caller's level, the input, approval for destructive operations, the
 * ceiling. Only then does the operation run.
 */
export async function runOperation<I, O>(
  op: Operation<I, O>,
  ctx: OperationContext,
  rawInput: unknown
): Promise<O | Failure> {
  const { caller } = ctx
  if (op.callers && !op.callers.includes(caller.kind)) {
    return fail("unavailable", `${op.name} is not available to this caller.`)
  }
  if (LEVEL_RANK[levelOf(caller)] < LEVEL_RANK[op.level]) {
    return fail(
      "denied",
      `${op.name} needs "${op.level}" access, and this caller has "${levelOf(caller)}".`
    )
  }
  const parsed = op.input.safeParse(rawInput)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".") || "input"}: ${i.message}`)
      .join("; ")
    return fail("invalid", issues)
  }
  if (op.effect === "destructive" && caller.kind !== "user" && !ctx.approved) {
    return fail("needs_approval", `${op.name} needs the user's approval.`)
  }
  const over = op.ceiling?.(caller, parsed.data)
  if (over) return over
  return op.run(ctx, parsed.data)
}

const POLICY_RANK: Record<RulePolicy, number> = { block: 0, ask: 1, allow: 2 }

/**
 * Rules a caller may set: none looser than its own. The user has no
 * ceiling; outside clients get one once they can configure bots.
 */
export function rulesCeiling(
  caller: Caller,
  rules: Partial<Record<ActionClass, RulePolicy>> | undefined
): Failure | null {
  if (!rules || caller.kind !== "bot") return null
  const looser = (Object.keys(rules) as ActionClass[]).filter(
    (cls) => POLICY_RANK[rules[cls]!] > POLICY_RANK[caller.rules[cls]]
  )
  if (!looser.length) return null
  return fail(
    "ceiling",
    `Cannot set rules looser than your own: ${looser.join(", ")}.`
  )
}

/** Each class at the stricter of the two policies. */
export function capRules(
  rules: Record<ActionClass, RulePolicy>,
  ceiling: Record<ActionClass, RulePolicy>
): Record<ActionClass, RulePolicy> {
  const out = { ...rules }
  for (const cls of Object.keys(out) as ActionClass[]) {
    if (POLICY_RANK[out[cls]] > POLICY_RANK[ceiling[cls]])
      out[cls] = ceiling[cls]
  }
  return out
}

/** Access a caller may give a bot: never more than its own. */
export function accessCeiling(
  caller: Caller,
  access: AccessLevel | undefined
): Failure | null {
  if (!access || LEVEL_RANK[access] <= LEVEL_RANK[levelOf(caller)]) return null
  return fail(
    "ceiling",
    `Cannot give "${access}" access: you have "${levelOf(caller)}".`
  )
}

/** Both ceilings, for operations that set a bot's rules and access. */
export function settingsCeiling(
  caller: Caller,
  input: {
    rules?: Partial<Record<ActionClass, RulePolicy>>
    access?: AccessLevel
  }
): Failure | null {
  return (
    rulesCeiling(caller, input.rules) ?? accessCeiling(caller, input.access)
  )
}
