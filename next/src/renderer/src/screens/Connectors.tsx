import { useEffect, useState } from "react"

import type { CatalogConnector, Connector } from "@shared/types"

import { invoke } from "@/lib/bridge"
import { addCustomConnector, cancelConnect, connect, loadConnectors, removeConnector, setConnectorEnabled } from "@/lib/libraries"
import { useStore } from "@/lib/store"

import { CheckIcon, ExternalIcon, TrashIcon } from "@/components/Icons"
import { Card, ConnectorLogo, ErrorLine, Field, FilterChips, ghost, Grid, inputClass, LibraryPage, primary, Sheet, small, Switch } from "@/components/Library"

// Connectors: the apps your models and CLIs can reach, as MCP servers. Sign in once; it stays on this
// computer. Axe models use them in chats where you switch them on; CLI agents get the ones that are on.

type Filter = "all" | CatalogConnector["category"]

function stateLine(c: Connector): { text: string; tone: string } {
  if (c.state === "connecting") return { text: "Connecting", tone: "text-ink-3" }
  if (c.state === "signin") return { text: c.error ?? "Waiting for you to sign in", tone: "text-ink-3" }
  if (c.state === "error") return { text: c.error ?? "Couldn't connect", tone: "text-bad" }
  if (!c.enabled) return { text: "Off", tone: "text-ink-3" }
  if (!c.tools.length) return { text: c.url ?? c.command ?? "Connected", tone: "text-ink-3" }
  return { text: c.tools.length === 1 ? "1 tool" : `${c.tools.length} tools`, tone: "text-ink-3" }
}

export function Connectors() {
  const view = useStore((s) => s.library.connectors)
  const [filter, setFilter] = useState<Filter>("all")
  const [waiting, setWaiting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [token, setToken] = useState<CatalogConnector | null>(null)
  const [custom, setCustom] = useState(false)

  useEffect(() => {
    if (!view) void loadConnectors()
  }, [view])

  // The one you're signing in to shows on its card until it's done.
  const connected = (view?.connected ?? []).filter((c) => !(waiting && c.catalogId === waiting && c.state !== "connected"))
  const catalog = (view?.catalog ?? []).filter((c) => filter === "all" || c.category === filter)
  const categories = [...new Set((view?.catalog ?? []).map((c) => c.category))]

  const start = async (c: CatalogConnector) => {
    if (c.auth === "token") return setToken(c)
    setError(null)
    setWaiting(c.id)
    const e = await connect(c.id)
    setWaiting(null)
    if (e && e !== "Cancelled.") setError(`${c.name}: ${e}`)
  }

  return (
    <LibraryPage
      title="Connectors"
      tab="connectors"
      subtitle="Your apps, for your models and CLIs."
      actions={
        <button className={ghost} onClick={() => setCustom(true)}>
          Add your own
        </button>
      }
    >
      <ErrorLine text={error} />
      {connected.length > 0 && (
        <section aria-label="Connected" className="flex flex-col gap-[12px]">
          <h2 className="m-0 flex h-[28px] items-center text-[15px] leading-6 font-normal text-ink">Connected</h2>
          <div className="flex flex-col overflow-hidden rounded-[16px] bg-card py-[4px]">
            {connected.map((c) => {
              const line = stateLine(c)
              return (
                <div key={c.id} className="flex h-[56px] items-center gap-[12px] px-[16px]">
                  <ConnectorLogo catalogId={c.catalogId} name={c.name} size={32} />
                  <div className="flex min-w-0 flex-1 flex-col gap-[1px]">
                    <span className="text-[14px] leading-5 text-ink">{c.name}</span>
                    <span className={`truncate text-[12px] leading-4 ${line.tone}`}>{line.text}</span>
                  </div>
                  {c.state === "signin" && c.catalogId && (
                    <button className={small} onClick={() => void start(view!.catalog.find((x) => x.id === c.catalogId)!)}>
                      Sign in
                    </button>
                  )}
                  <button
                    aria-label={`Remove ${c.name}`}
                    title="Remove"
                    onClick={() => void removeConnector(c.id)}
                    className="flex size-[28px] shrink-0 items-center justify-center rounded-full border-0 bg-transparent text-ink-3 hover:bg-fill hover:text-ink"
                  >
                    <TrashIcon size={14} />
                  </button>
                  <Switch flat on={c.enabled} onChange={(on) => void setConnectorEnabled(c.id, on)} label={`Use ${c.name}`} />
                </div>
              )
            })}
          </div>
        </section>
      )}
      <section aria-label="Directory" className="flex flex-col gap-[12px]">
        <div className="flex h-[28px] items-center gap-[16px]">
          <h2 className="m-0 flex-1 text-[15px] leading-6 font-normal text-ink">Directory</h2>
          <FilterChips label="Category" value={filter} onChange={setFilter} options={[{ id: "all", label: "All" }, ...categories.map((c) => ({ id: c, label: c }))]} />
        </div>
        <Grid>
          {catalog.map((c, i) => {
            const have = connected.find((x) => x.catalogId === c.id)
            const isOn = have && have.state === "connected"
            return (
              <Card key={c.id} i={i} label={c.name}>
                <div className="flex h-[36px] items-center gap-[12px]">
                  <ConnectorLogo catalogId={c.id} name={c.name} />
                  <span className="min-w-0 flex-1 truncate text-[15px] text-ink">{c.name}</span>
                </div>
                <p className="m-0 truncate text-[13px] leading-[20px] text-ink-3">{c.about}</p>
                <div className="mt-auto flex h-[28px] items-center gap-[8px]">
                  {c.auth === "soon" ? (
                    <span className="text-[13px] text-ink-3">Coming soon</span>
                  ) : isOn ? (
                    <span className="flex h-[28px] items-center gap-[6px] rounded-full bg-brand-soft px-[12px] text-[13px] text-brand-text">
                      <CheckIcon size={12} />
                      Connected
                    </span>
                  ) : waiting === c.id ? (
                    <>
                      <span className="text-[12px] text-ink-2">Waiting for your browser</span>
                      <span className="flex-1" />
                      <button className={small} onClick={() => void cancelConnect()}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button className={small} disabled={!!waiting} onClick={() => void start(c)}>
                      Connect
                    </button>
                  )}
                </div>
              </Card>
            )
          })}
        </Grid>
      </section>
      <TokenSheet entry={token} onClose={() => setToken(null)} />
      <CustomSheet open={custom} onClose={() => setCustom(false)} />
    </LibraryPage>
  )
}

function TokenSheet({ entry, onClose }: { entry: CatalogConnector | null; onClose: () => void }) {
  const [value, setValue] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setValue("")
    setError(null)
  }, [entry])
  const go = async () => {
    if (!entry) return
    setBusy(true)
    const e = await connect(entry.id, value)
    setBusy(false)
    setError(e)
    if (!e) onClose()
  }
  return (
    <Sheet open={!!entry} onClose={onClose} label={entry ? `Connect ${entry.name}` : "Connect"}>
      {entry && (
        <>
          <div className="flex items-center gap-[12px] pr-[32px]">
            <ConnectorLogo catalogId={entry.id} name={entry.name} size={40} />
            <h2 className="m-0 text-[20px] leading-7 font-normal">Connect {entry.name}</h2>
          </div>
          <p className="m-0 text-[13px] leading-[22px] text-ink-2">
            {entry.name} connects with a token you make. It stays on this computer, encrypted.
          </p>
          {entry.tokenHelp && (
            <button className={`${ghost} flex w-fit items-center gap-[6px]`} onClick={() => void invoke("app:openExternal", entry.tokenHelp!.url)}>
              {entry.tokenHelp.label}
              <ExternalIcon size={12} />
            </button>
          )}
          <Field label="Token">
            <input className={inputClass} type="password" value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void go()} />
          </Field>
          <ErrorLine text={error} />
          <div className="flex justify-end gap-[8px]">
            <button className={ghost} onClick={onClose}>
              Cancel
            </button>
            <button className={primary} disabled={!value.trim() || busy} onClick={() => void go()}>
              {busy ? "Connecting" : "Connect"}
            </button>
          </div>
        </>
      )}
    </Sheet>
  )
}

function CustomSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [kind, setKind] = useState<"url" | "command">("url")
  const [name, setName] = useState("")
  const [where, setWhere] = useState("")
  const [token, setToken] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const close = () => {
    setError(null)
    onClose()
  }
  const go = async () => {
    setBusy(true)
    const parts = where.trim().split(/\s+/)
    const e = await addCustomConnector(
      kind === "url" ? { name, url: where.trim(), ...(token.trim() ? { token: token.trim() } : {}) } : { name, command: parts[0] ?? "", args: parts.slice(1) },
    )
    setBusy(false)
    setError(e)
    if (!e) {
      setName("")
      setWhere("")
      setToken("")
      onClose()
    }
  }
  return (
    <Sheet open={open} onClose={close} label="Add your own connector">
      <h2 className="m-0 text-[20px] leading-7 font-normal">Add your own</h2>
      <p className="m-0 -mt-[8px] text-[13px] text-ink-3">Any MCP server: an address on the web, or a command on this computer.</p>
      <FilterChips
        label="Kind"
        value={kind}
        onChange={setKind}
        options={[
          { id: "url", label: "Web address" },
          { id: "command", label: "Command" },
        ]}
      />
      <Field label="Name">
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Team wiki" />
      </Field>
      <Field label={kind === "url" ? "Address" : "Command"} hint={kind === "url" ? "If it asks you to sign in, your browser opens." : "Runs on this computer when a chat needs it."}>
        <input
          className={`${inputClass} font-mono text-[13px]`}
          value={where}
          onChange={(e) => setWhere(e.target.value)}
          placeholder={kind === "url" ? "https://mcp.example.com/mcp" : "npx -y @modelcontextprotocol/server-filesystem ~/Notes"}
        />
      </Field>
      {kind === "url" && (
        <Field label="Token (if it uses one)">
          <input className={inputClass} type="password" value={token} onChange={(e) => setToken(e.target.value)} />
        </Field>
      )}
      <ErrorLine text={error} />
      <div className="flex justify-end gap-[8px]">
        <button className={ghost} onClick={close}>
          Cancel
        </button>
        <button className={primary} disabled={!name.trim() || !where.trim() || busy} onClick={() => void go()}>
          {busy ? "Connecting" : "Add"}
        </button>
      </div>
    </Sheet>
  )
}
