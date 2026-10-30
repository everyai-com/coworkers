import { useEffect, useState } from "react"
import { Button } from "@cloudflare/kumo/components/button"
import { Select } from "@cloudflare/kumo/components/select"
import { MODELS, PROVIDERS, formatPrice, providerOf } from "@coworkers/models"
import type { ProviderId } from "@coworkers/models"
import type { InstallPlan, InstallerState, NameCheck, Zone } from "../shared"
import type { InstallerAgent } from "./App"
import { XIcon } from "./icons"

const FIELD =
  "w-full bg-transparent text-sm text-kumo-default outline-none placeholder:text-kumo-placeholder"

function Group({
  title,
  hint,
  children,
}: {
  title: string
  hint?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="space-y-2">
      <h2 className="px-1.5 text-sm font-medium text-kumo-default">{title}</h2>
      <ul className="overflow-hidden rounded-2xl bg-kumo-base outline outline-1 -outline-offset-1 outline-black/[0.06]">
        {children}
      </ul>
      {hint ? (
        <p className="px-1.5 text-xs text-pretty text-kumo-subtle">{hint}</p>
      ) : null}
    </section>
  )
}

function Row({
  label,
  detail,
  children,
}: {
  label: string
  detail?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <li className="flex min-h-14 items-center gap-4 border-t border-kumo-line py-3 pr-3 pl-4 first:border-t-0">
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-kumo-default">{label}</span>
        {detail ? (
          <span className="mt-0.5 block text-xs text-pretty break-words text-kumo-subtle">
            {detail}
          </span>
        ) : null}
      </span>
      {children}
    </li>
  )
}

/** Debounced name check against the account. */
function useNameCheck(agent: InstallerAgent, accountId: string, name: string) {
  const [check, setCheck] = useState<NameCheck | null>(null)
  useEffect(() => {
    setCheck(null)
    const timer = setTimeout(() => {
      agent.stub
        .checkName(accountId, name)
        .then(setCheck)
        .catch((err: Error) => setCheck({ ok: false, reason: err.message }))
    }, 350)
    return () => clearTimeout(timer)
  }, [agent, accountId, name])
  return check
}

/** Choose the account, name, URL, people and model, then build. */
export function Setup({
  agent,
  state,
}: {
  agent: InstallerAgent
  state: InstallerState
}) {
  const [accountId, setAccountId] = useState(state.accounts[0]?.id ?? "")
  const [name, setName] = useState("coworkers")
  const [where, setWhere] = useState<"workers-dev" | "domain">("workers-dev")
  const [zones, setZones] = useState<Zone[] | null>(null)
  const [zoneId, setZoneId] = useState("")
  const [hostLabel, setHostLabel] = useState("bots")
  const [emails, setEmails] = useState<string[]>(
    state.user ? [state.user.email] : []
  )
  const [draft, setDraft] = useState("")
  const [provider, setProvider] = useState<ProviderId>("workers-ai")
  const [model, setModel] = useState(MODELS[0].id)
  const [gateway, setGateway] = useState("coworkers")
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const check = useNameCheck(agent, accountId, name)

  useEffect(() => {
    if (where !== "domain" || !accountId) return
    setZones(null)
    agent.stub
      .zones(accountId)
      .then((list) => {
        setZones(list)
        setZoneId(list[0]?.id ?? "")
      })
      .catch(() => setZones([]))
  }, [agent, accountId, where])

  const zone = zones?.find((z) => z.id === zoneId)
  const hostname = zone ? `${hostLabel ? `${hostLabel}.` : ""}${zone.name}` : ""
  const info = MODELS.find((m) => m.id === model)

  function addEmail(value = draft) {
    const email = value.trim().toLowerCase()
    if (!email) return
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setError(`"${email}" does not look like an email address.`)
      return
    }
    setError(null)
    setEmails((list) => (list.includes(email) ? list : [...list, email]))
    setDraft("")
  }

  async function start() {
    const plan: InstallPlan = {
      accountId,
      name,
      domain:
        where === "domain" && zone
          ? { zoneId: zone.id, zoneName: zone.name, hostname }
          : null,
      emails: draft.trim() ? [...emails, draft.trim().toLowerCase()] : emails,
      model,
      gateway,
    }
    setStarting(true)
    setError(null)
    try {
      await agent.stub.install(plan)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start.")
      setStarting(false)
    }
  }

  const ready =
    check?.ok === true &&
    emails.length + (draft.trim() ? 1 : 0) > 0 &&
    (where === "workers-dev" || !!zone)

  return (
    <div className="screen-in w-full max-w-[560px] space-y-8">
      <header className="space-y-1 px-1.5">
        <h1 className="text-2xl font-semibold tracking-tight text-kumo-default">
          Set up your Coworkers
        </h1>
        <p className="text-sm text-kumo-subtle">
          Signed in as {state.user?.email}.{" "}
          <a
            href="/api/auth/logout"
            className="underline decoration-kumo-line underline-offset-2 hover:decoration-current"
          >
            Not you?
          </a>
        </p>
      </header>

      <Group
        title="Where it lives"
        hint={
          check && !check.ok ? (
            <span className="text-kumo-danger">{check.reason}</span>
          ) : check?.ok && check.updating ? (
            "Coworkers is already installed under this name. Continuing updates it and keeps every bot."
          ) : undefined
        }
      >
        {state.accounts.length > 1 ? (
          <Row label="Account">
            <Select
              aria-label="Account"
              size="sm"
              className="w-48 shrink-0"
              value={accountId}
              items={Object.fromEntries(
                state.accounts.map((a) => [a.id, a.name])
              )}
              onValueChange={(v) => v && setAccountId(v)}
            />
          </Row>
        ) : null}
        <Row
          label="Name"
          detail={
            where === "workers-dev"
              ? check?.ok
                ? check.url.replace("https://", "")
                : "Checking…"
              : "The Worker's name in your dashboard"
          }
        >
          <input
            aria-label="Name"
            value={name}
            maxLength={54}
            spellCheck={false}
            onChange={(e) =>
              setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))
            }
            className={`${FIELD} h-8 max-w-[45%] text-right font-mono text-[13px]`}
          />
        </Row>
        <Row label="URL">
          <Select
            aria-label="URL"
            size="sm"
            className="w-48 shrink-0"
            value={where}
            items={{ "workers-dev": "workers.dev", domain: "My own domain" }}
            onValueChange={(v) => v && setWhere(v as typeof where)}
          />
        </Row>
        {where === "domain" ? (
          zones === null ? (
            <Row label="Domain" detail="Loading your zones…" />
          ) : zones.length === 0 ? (
            <Row
              label="Domain"
              detail="This account has no active zones. Use workers.dev, or add a domain to Cloudflare first."
            />
          ) : (
            <Row label="Hostname" detail={hostname}>
              <span className="flex shrink-0 items-center gap-1.5">
                <input
                  aria-label="Subdomain"
                  value={hostLabel}
                  spellCheck={false}
                  onChange={(e) =>
                    setHostLabel(
                      e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "")
                    )
                  }
                  className={`${FIELD} h-8 w-20 text-right font-mono text-[13px]`}
                />
                <span className="text-sm text-kumo-subtle">.</span>
                <Select
                  aria-label="Zone"
                  size="sm"
                  className="w-40"
                  value={zoneId}
                  items={Object.fromEntries(zones.map((z) => [z.id, z.name]))}
                  onValueChange={(v) => v && setZoneId(v)}
                />
              </span>
            </Row>
          )
        ) : null}
      </Group>

      <Group
        title="Who can sign in"
        hint="Cloudflare Access emails each person a one-time code. You can change the list later in Zero Trust."
      >
        <li className="flex flex-wrap items-center gap-1.5 px-3 py-3">
          {emails.map((email) => (
            <span
              key={email}
              className="inline-flex h-7 items-center gap-1 rounded-full bg-(--fill-hover) pr-1 pl-2.5 text-[13px] text-kumo-default"
            >
              {email}
              <button
                type="button"
                aria-label={`Remove ${email}`}
                onClick={() =>
                  setEmails((list) => list.filter((e) => e !== email))
                }
                className="flex size-5 items-center justify-center rounded-full text-kumo-subtle hover:bg-(--fill-hover) hover:text-kumo-default"
              >
                <XIcon size={12} />
              </button>
            </span>
          ))}
          <input
            aria-label="Add an email"
            placeholder={emails.length ? "Add someone else" : "you@example.com"}
            value={draft}
            type="email"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === "," || e.key === " ") {
                e.preventDefault()
                addEmail()
              }
            }}
            onBlur={() => addEmail()}
            className={`${FIELD} h-7 min-w-40 flex-1 px-1.5`}
          />
        </li>
      </Group>

      <Group
        title="Brain"
        hint={
          provider === "workers-ai"
            ? "Runs on Cloudflare with nothing else to set up. You can switch models any time on the Models page."
            : "Other labs need AI Gateway credits (Unified Billing) or your own key on the gateway. If neither is there yet, bots fall back to Workers AI."
        }
      >
        <Row label="Provider">
          <Select
            aria-label="Provider"
            size="sm"
            className="w-48 shrink-0"
            value={provider}
            items={Object.fromEntries(PROVIDERS.map((p) => [p.id, p.name]))}
            onValueChange={(v) => {
              if (!v) return
              setProvider(v as ProviderId)
              setModel(MODELS.find((m) => m.provider === v)?.id ?? MODELS[0].id)
            }}
          />
        </Row>
        <Row
          label="Model"
          detail={
            info
              ? `${info.blurb}${info.price ? ` · ${formatPrice(info.price)}` : ""}`
              : undefined
          }
        >
          <Select
            aria-label="Model"
            size="sm"
            className="w-48 shrink-0"
            value={providerOf(model) === provider ? model : ""}
            items={Object.fromEntries(
              MODELS.filter((m) => m.provider === provider).map((m) => [
                m.id,
                m.name,
              ])
            )}
            onValueChange={(v) => v && setModel(v)}
          />
        </Row>
        <Row
          label="AI Gateway"
          detail="Logs, analytics and spend limits for every call"
        >
          <input
            aria-label="AI Gateway name"
            value={gateway}
            spellCheck={false}
            onChange={(e) =>
              setGateway(
                e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-")
              )
            }
            className={`${FIELD} h-8 max-w-[40%] text-right font-mono text-[13px]`}
          />
        </Row>
      </Group>

      <div className="flex items-center justify-end gap-3 px-1.5">
        {error ? (
          <p
            role="alert"
            className="flex-1 text-xs text-pretty text-kumo-danger"
          >
            {error}
          </p>
        ) : (
          <p className="flex-1 text-xs text-kumo-subtle">
            {state.release ? `Coworkers ${state.release}` : null}
          </p>
        )}
        <Button
          variant="primary"
          className="btn-ink rounded-full px-5"
          loading={starting}
          disabled={!ready}
          onClick={() => void start()}
        >
          {check?.ok && check.updating ? "Update my bots" : "Build my bots"}
        </Button>
      </div>
    </div>
  )
}
