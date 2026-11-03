import { readFile } from "node:fs/promises"
import { basename } from "node:path"

import type { AxeModel, Json } from "@shared/types"

import { SSEReader } from "./stream"

// Talks to axeai.com with the desktop session token, exactly like the website
// does with its cookie (ImperiumAxe/AxeClient.swift on the Mac).

export const CLIENT_HEADER = "Axe AI Desktop"

export class AxeError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message || `Something went wrong (${status}).`)
  }

  /** Plain words for the codes people actually hit. */
  get plain(): string {
    switch (this.code) {
      case "insufficient_credits":
        return "You're out of credits for this model. Add credits or pick a free model."
      case "daily_limit":
        return "You've used today's free messages for this model. Try another model or come back tomorrow."
      case "auto_free_used_up":
        return "Today's free messages are used up. Pick a paid model to keep going."
      case "vision_unsupported":
        return "This model can't read images. Pick one that can, or remove the image."
      case "model_unavailable":
        return "That model isn't available right now. Pick another one."
      case "unauthorized":
      case "sign_in_required":
        return "Your Axe session ended. Sign in again."
      case "rate_limited":
        return "Too many requests. Wait a moment and try again."
      default:
        return this.message
    }
  }

  get signedOut() {
    return this.status === 401 || this.code === "unauthorized" || this.code === "sign_in_required"
  }
}

/** The server's thread shape (packages/contracts chatThreadSchema). */
export type AxeThread = { id: string; slug?: string | null; title: string; pinned: boolean; archived: boolean; createdAt: string; updatedAt: string }

/** GET /api/chat/models. */
export type AxeModelsResponse = { defaultModelId: string; free: AxeModel[]; paid: AxeModel[] }

export type AxeSendOptions = {
  modelId: string
  webSearch: boolean
  attachments: string[]
  /** Deep research instead of a normal answer (models that can use tools). */
  research?: boolean
  /** Paid models ask first; true once you approved the run. */
  researchApproved?: boolean
  /** Redo the last answer instead of adding a message (approving research does this). */
  regenerate?: boolean
}

export const joinURL = (base: string, path: string) => new URL(path.replace(/^\//, ""), base.endsWith("/") ? base : `${base}/`).toString()

export class AxeClient {
  constructor(
    readonly baseURL: string,
    readonly token: string | undefined,
  ) {}

  url(path: string) {
    return joinURL(this.baseURL, path)
  }

  private headers(accept = "application/json", contentType?: string): Record<string, string> {
    const h: Record<string, string> = { Accept: accept, "X-Client": CLIENT_HEADER }
    if (this.token) h.Authorization = `Bearer ${this.token}`
    if (contentType) h["Content-Type"] = contentType
    return h
  }

  async request(path: string, init: { method?: string; json?: unknown; body?: BodyInit; contentType?: string; signal?: AbortSignal } = {}): Promise<Response> {
    const contentType = init.json !== undefined ? "application/json" : init.contentType
    const res = await fetch(this.url(path), {
      method: init.method ?? "GET",
      headers: this.headers("application/json", contentType),
      body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
      signal: init.signal,
      credentials: "omit",
    })
    if (!res.ok) throw await AxeClient.error(res)
    return res
  }

  async json<T = Json>(path: string, init?: Parameters<AxeClient["request"]>[1]): Promise<T> {
    const res = await this.request(path, init)
    const text = await res.text()
    return (text ? JSON.parse(text) : null) as T
  }

  static async error(res: Response): Promise<AxeError> {
    let code = `http_${res.status}`
    let message = ""
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } | string }
      if (typeof body.error === "string") code = body.error
      else {
        code = body.error?.code ?? code
        message = body.error?.message ?? ""
      }
    } catch {}
    return new AxeError(res.status, code, message)
  }

  // Models and threads

  models() {
    return this.json<AxeModelsResponse>("api/chat/models")
  }

  async threads(): Promise<AxeThread[]> {
    return (await this.json<{ threads?: AxeThread[] }>("api/chat/threads"))?.threads ?? []
  }

  async createThread(): Promise<AxeThread> {
    return (await this.json<{ thread: AxeThread }>("api/chat/threads", { method: "POST", json: {} })).thread
  }

  async updateThread(id: string, patch: { title?: string; pinned?: boolean; archived?: boolean }) {
    await this.request(`api/chat/threads/${encodeURIComponent(id)}`, { method: "PATCH", json: patch })
  }

  async deleteThread(id: string) {
    await this.request(`api/chat/threads/${encodeURIComponent(id)}`, { method: "DELETE" })
  }

  async messages(threadId: string): Promise<Json[]> {
    const json = await this.json<{ messages?: Json[] }>(`api/chat/threads/${encodeURIComponent(threadId)}/messages`)
    return json?.messages ?? []
  }

  /** Uploads a file for a message (POST /api/chat/attachments); returns its id. */
  async upload(path: string, name = basename(path), mime = "application/octet-stream"): Promise<string> {
    const form = new FormData()
    form.append("file", new Blob([await readFile(path)], { type: mime }), name)
    const res = await fetch(this.url("api/chat/attachments"), { method: "POST", headers: this.headers(), body: form, credentials: "omit" })
    if (!res.ok) throw await AxeClient.error(res)
    const json = (await res.json()) as { attachment?: { id?: string } }
    if (!json.attachment?.id) throw new AxeError(500, "bad_reply", "The upload didn't return a file id.")
    return json.attachment.id
  }

  /** Speech to text (POST /api/voice/transcribe, Whisper on the server); returns the words heard. */
  async transcribe(audio: Uint8Array, mime: string): Promise<string> {
    const ext = /mp4|m4a|aac/.test(mime) ? "m4a" : /ogg/.test(mime) ? "ogg" : /wav/.test(mime) ? "wav" : "webm"
    const form = new FormData()
    form.append("file", new Blob([new Uint8Array(audio)], { type: mime.split(";")[0] || "audio/webm" }), `voice.${ext}`)
    const res = await fetch(this.url("api/voice/transcribe"), { method: "POST", headers: this.headers(), body: form, credentials: "omit" })
    if (!res.ok) throw await AxeClient.error(res)
    const json = (await res.json()) as { text?: string }
    return (json.text ?? "").trim()
  }

  // Sending: the website's send body; the reply streams as UI message chunks.

  send(threadId: string, messageId: string, text: string, options: AxeSendOptions, signal?: AbortSignal) {
    const body = {
      modelId: options.modelId,
      webSearch: options.research ? false : options.webSearch,
      research: !!options.research,
      researchApproved: !!options.researchApproved,
      autoPaid: options.modelId === "auto",
      // This app draws rich cards; the website tells the model in the system prompt (rich.ts has the blocks).
      clientHints: ["rich-cards"],
      trigger: options.regenerate ? "regenerate" : "submit",
      ...(options.regenerate
        ? {}
        : { message: { id: messageId, role: "user", parts: text ? [{ type: "text", text }] : [], attachments: options.attachments } }),
    }
    return this.stream(`api/chat/threads/${encodeURIComponent(threadId)}/messages`, body, signal)
  }

  /** Marks a research approval card as cancelled (nothing is charged). */
  async cancelResearch(threadId: string, messageId: string) {
    await this.request(`api/chat/threads/${encodeURIComponent(threadId)}/messages/${encodeURIComponent(messageId)}/research-approval`, {
      method: "PATCH",
      json: { status: "cancelled" },
    })
  }

  async *stream(path: string, body: unknown, signal?: AbortSignal): AsyncGenerator<Json> {
    const res = await fetch(this.url(path), {
      method: "POST",
      headers: this.headers("text/event-stream", "application/json"),
      body: JSON.stringify(body),
      signal,
      credentials: "omit",
    })
    if (!res.ok || !res.body) throw await AxeClient.error(res)
    const reader = new SSEReader()
    const decoder = new TextDecoder()
    for await (const bytes of res.body as unknown as AsyncIterable<Uint8Array>) {
      for (const chunk of reader.push(decoder.decode(bytes, { stream: true }))) yield chunk
    }
    for (const chunk of reader.push(`${decoder.decode()}\n`)) yield chunk
  }
}
