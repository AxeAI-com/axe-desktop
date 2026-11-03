import { randomBytes } from "node:crypto"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"

import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js"
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js"

// Signing in to a brand's MCP server the standard way (OAuth 2.1 with PKCE and dynamic client
// registration): the SDK finds the brand's sign-in, registers Axe, and trades the code for tokens;
// this file keeps what it hands us and catches the browser coming back on 127.0.0.1.

export type ConnectorSecret = {
  /** A token you pasted (GitHub). */
  token?: string
  tokens?: OAuthTokens
  client?: OAuthClientInformationMixed
  verifier?: string
  redirect?: string
}

export type SecretBox = {
  get(id: string): ConnectorSecret | undefined
  set(id: string, secret: ConnectorSecret | undefined): void
}

/** Keeps one connector's client, tokens and PKCE verifier in the secret box. */
export class ConnectorAuth implements OAuthClientProvider {
  private wanted?: URL
  private readonly expected = randomBytes(16).toString("hex")

  constructor(
    private readonly id: string,
    private readonly box: SecretBox,
    private readonly redirect?: string,
  ) {}

  private get secret(): ConnectorSecret {
    return this.box.get(this.id) ?? {}
  }
  private patch(p: Partial<ConnectorSecret>) {
    this.box.set(this.id, { ...this.secret, ...p })
  }

  get redirectUrl() {
    return this.redirect ?? this.secret.redirect ?? "http://127.0.0.1/callback"
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "Axe AI",
      client_uri: "https://axeai.com",
      redirect_uris: [String(this.redirectUrl)],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }
  }

  state() {
    return this.expected
  }

  clientInformation() {
    return this.secret.client
  }
  saveClientInformation(client: OAuthClientInformationMixed) {
    this.patch({ client, ...(this.redirect ? { redirect: this.redirect } : {}) })
  }
  tokens() {
    return this.secret.tokens
  }
  saveTokens(tokens: OAuthTokens) {
    this.patch({ tokens })
  }
  redirectToAuthorization(url: URL) {
    this.wanted = url
  }
  saveCodeVerifier(verifier: string) {
    this.patch({ verifier })
  }
  codeVerifier() {
    const v = this.secret.verifier
    if (!v) throw new Error("The sign-in started somewhere else. Try connecting again.")
    return v
  }
  invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery") {
    const s = { ...this.secret }
    if (scope === "all" || scope === "client") delete s.client
    if (scope === "all" || scope === "tokens") delete s.tokens
    if (scope === "all" || scope === "verifier") delete s.verifier
    this.box.set(this.id, s)
  }

  /** The brand's sign-in page, once the SDK asked for it. */
  get signInUrl() {
    return this.wanted
  }
  get stateValue() {
    return this.expected
  }
}

/** A one-shot listener on 127.0.0.1 for the browser coming back with ?code=…&state=… */
export class Callback {
  private server?: Server
  private settle?: { resolve: (code: string) => void; reject: (e: Error) => void }
  url = ""

  async start(): Promise<string> {
    const server = createServer((req, res) => {
      const u = new URL(req.url ?? "/", "http://127.0.0.1")
      if (u.pathname !== "/callback") {
        res.writeHead(404).end()
        return
      }
      const code = u.searchParams.get("code")
      const error = u.searchParams.get("error_description") ?? u.searchParams.get("error")
      const ok = !!code && !error && u.searchParams.get("state") === this.expectedState
      res.writeHead(ok ? 200 : 400, { "content-type": "text/html; charset=utf-8" })
      res.end(page(ok ? "Connected. You can close this tab and go back to Axe." : "That didn't work. Go back to Axe and try again."))
      if (ok) this.settle?.resolve(code)
      else this.settle?.reject(new Error(error ? `The sign-in said: ${error}` : "The sign-in didn't come back right. Try again."))
    })
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(0, "127.0.0.1", () => resolve())
    })
    this.server = server
    this.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/callback`
    return this.url
  }

  expectedState = ""

  /** Resolves with the code; rejects on a bad return, cancel or timeout. */
  wait(state: string, signal: AbortSignal, ms = 5 * 60_000): Promise<string> {
    this.expectedState = state
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("The sign-in took too long. Try again.")), ms)
      const done = () => clearTimeout(timer)
      this.settle = {
        resolve: (c) => (done(), resolve(c)),
        reject: (e) => (done(), reject(e)),
      }
      signal.addEventListener("abort", () => (done(), reject(new Error("Cancelled."))), { once: true })
    })
  }

  close() {
    this.server?.close()
    this.server = undefined
  }
}

const page = (text: string) =>
  `<!doctype html><meta charset="utf-8"><title>Axe AI</title><body style="font:15px system-ui;display:grid;place-items:center;height:90vh;color:#333">${text}</body>`
