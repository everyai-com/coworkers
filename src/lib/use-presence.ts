import { useEffect, useState } from "react"

interface Leaving<T> {
  item: T
  /** Where it was, so it folds away in place. */
  index: number
  /** When to drop it. */
  until: number
}

function idsOf(items: { id: string }[]) {
  return items.map((i) => i.id).join("\n")
}

/**
 * Keep items that left `items` on screen for `holdMs`, flagged as exiting,
 * so they can animate out wherever they were removed (here, in another
 * tab, or by the server). An item that comes back is live again.
 *
 * Removals are noticed during render, not in an effect, so the element
 * never unmounts in between: it is the same node that animates out.
 */
export function usePresence<T extends { id: string }>(
  items: T[],
  holdMs: (item: T) => number
): { item: T; exiting: boolean }[] {
  const [previous, setPrevious] = useState(items)
  const [leaving, setLeaving] = useState<Map<string, Leaving<T>>>(new Map())

  if (idsOf(previous) !== idsOf(items)) {
    const ids = new Set(items.map((i) => i.id))
    const now = Date.now()
    const gone = previous.flatMap((item, index) =>
      ids.has(item.id) ? [] : [{ item, index, until: now + holdMs(item) }]
    )
    setPrevious(items)
    if (gone.length) {
      setLeaving((current) => {
        const next = new Map(current)
        for (const g of gone) next.set(g.item.id, g)
        return next
      })
    }
  }

  useEffect(() => {
    if (!leaving.size) return
    const soonest = Math.min(...[...leaving.values()].map((g) => g.until))
    const timer = setTimeout(
      () => {
        const now = Date.now()
        setLeaving((current) => {
          const next = new Map(current)
          for (const [id, g] of current) if (g.until <= now) next.delete(id)
          return next
        })
      },
      Math.max(0, soonest - Date.now())
    )
    return () => clearTimeout(timer)
  }, [leaving])

  const shown = items.map((item) => ({ item, exiting: false }))
  const ids = new Set(items.map((i) => i.id))
  for (const [id, g] of leaving) {
    if (ids.has(id)) continue
    shown.splice(Math.min(g.index, shown.length), 0, {
      item: g.item,
      exiting: true,
    })
  }
  return shown
}
