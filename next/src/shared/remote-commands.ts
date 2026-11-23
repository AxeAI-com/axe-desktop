import { z } from "zod"

// What a paired phone may ask its Mac over the sealed link (remote control, step 4), and what the Mac
// sends back. The same file lives in axe-mac next/src/shared/remote-commands.ts: keep the two identical.
// Threat model: axe-mac docs/remote-control-SECURITY.md, section 6. This is the whole list: chats, send,
// stop, mode, answer (an approval, a question or a plan), upload (a file to send), image (a picture an
// agent made in a chat) and folders (the Mac's own recent folders, to start an agent in one). No shell,
// files, settings, skills or connectors exist here, so none can be asked. A phone can only pick a folder
// from the list the Mac gives it.
// The Mac checks every command against these schemas after opening it; anything else is dropped.

const id = z.string().min(1).max(100)
export const answererSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("axe"), modelId: id }),
  z.strictObject({ kind: z.literal("agent"), agentId: id }),
])
export type PhoneAnswerer = z.infer<typeof answererSchema>

export const PHONE_MODES = ["ask", "acceptEdits", "plan", "full"] as const
export type PhoneMode = (typeof PHONE_MODES)[number]

/** Files from the phone: the desktop's own limit, sent in pieces small enough for one frame. */
export const UPLOAD_MAX = 25 * 1024 * 1024
export const UPLOAD_PIECE = 96 * 1024
/** Pictures an agent made, sent to the phone in pieces the same size. */
export const IMAGE_MAX = 10 * 1024 * 1024
export const IMAGE_PIECE = 96 * 1024

export const phoneCommandSchema = z.discriminatedUnion("type", [
  /** The Mac's chats, newest first, and what can answer. */
  z.strictObject({ type: z.literal("chats") }),
  /** One chat's messages. */
  z.strictObject({ type: z.literal("read"), chat: id }),
  /** The folders agents worked in on this Mac, most recent first (for a new agent chat). */
  z.strictObject({ type: z.literal("folders") }),
  /**
   * A message. chat null starts a new chat with `answerer`. An agent works in `folder` when it is one of
   * the Mac's own recent folders (exactly as "folders" listed it), else where you last worked with that
   * agent; any other folder is refused. A new chat from a phone starts in Ask unless `mode` says else.
   * In a chat, `answerer` switches the model for this message.
   */
  z.strictObject({
    type: z.literal("send"),
    chat: id.nullable(),
    text: z.string().trim().min(1).max(20_000),
    answerer: answererSchema.optional(),
    mode: z.enum(PHONE_MODES).optional(),
    folder: z.string().min(1).max(1024).optional(),
    /** Files this phone uploaded first (upload ids), each used once. */
    attachments: z
      .array(z.string().regex(/^[A-Za-z0-9_-]{8,40}$/))
      .max(10)
      .optional(),
  }),
  z.strictObject({ type: z.literal("stop"), chat: id }),
  z.strictObject({ type: z.literal("mode"), chat: id, mode: z.enum(PHONE_MODES) }),
  /** Answers a request the agent is waiting on in this chat, with one of the options it offered. */
  z.strictObject({ type: z.literal("answer"), chat: id, request: id, option: id }),
  /**
   * One piece of a file (at most 96 KB before base64). Pieces come in order; the last one makes the file.
   * The Mac picks the file type from the name; the phone's guess isn't used.
   */
  z.strictObject({
    type: z.literal("upload"),
    upload: z.string().regex(/^[A-Za-z0-9_-]{8,40}$/),
    name: z.string().trim().min(1).max(120),
    size: z.number().int().min(1).max(UPLOAD_MAX),
    index: z.number().int().min(0),
    total: z
      .number()
      .int()
      .min(1)
      .max(Math.ceil(UPLOAD_MAX / UPLOAD_PIECE)),
    data: z
      .string()
      .regex(/^[A-Za-z0-9+/]*={0,2}$/)
      .max(Math.ceil(UPLOAD_PIECE / 3) * 4),
  }),
  /**
   * One piece of a picture an agent made in this chat (an `image` part), 96 KB before base64. The Mac
   * serves only image parts of that chat's messages, from its own copy; the phone never names a path.
   */
  z.strictObject({
    type: z.literal("image"),
    chat: id,
    part: id,
    index: z
      .number()
      .int()
      .min(0)
      .max(Math.ceil(IMAGE_MAX / IMAGE_PIECE)),
  }),
])
export type PhoneCommand = z.infer<typeof phoneCommandSchema>

/** Phone → Mac: a command with an id; the Mac answers with the same id. */
export const phoneRequestSchema = z.strictObject({
  type: z.literal("cmd"),
  id: z.string().min(1).max(40),
  cmd: phoneCommandSchema,
})
export type PhoneRequest = z.infer<typeof phoneRequestSchema>
export type PhoneResponse =
  | { type: "res"; id: string; ok: true; data?: unknown }
  | { type: "res"; id: string; ok: false; error: string }

/** The Mac's answer to "image": one piece of the picture (data is base64). */
export type PhoneImagePiece = { mime: string; size: number; total: number; index: number; data: string }

/** A chat as the phone lists it. */
export type PhoneChat = {
  id: string
  title: string
  source: "axe" | "agent" | "local"
  agentId?: string
  mode?: PhoneMode
  running: boolean
  updatedAt: string
}

/** A folder from the Mac's own history, as "folders" lists it. */
export type PhoneFolder = { path: string; label: string; lastUsedAt: string; agentIds: string[] }

/** What can answer on this Mac: Axe's models and the CLI agents that are ready. */
export type PhoneCatalog = {
  axe: { id: string; label: string }[]
  defaultModelId: string
  agents: { id: string; name: string }[]
  /** The mode new agent chats start in on this computer (its Settings). Older apps leave it out. */
  defaultMode?: PhoneMode
}

/** Something the agent waits on, with the answers it offers. */
export type PhoneAsk = {
  id: string
  title: string
  detail?: string
  options: {
    id: string
    label: string
    kind: "allow_once" | "allow_always" | "reject_once" | "reject_always"
  }[]
  plan?: boolean
}

/** Live events the Mac broadcasts (kind of a LinkEvent) and their bodies. */
export type PhoneEventBody =
  | { kind: "chats"; chats: PhoneChat[] }
  | { kind: "reply"; chat: string; message: unknown; done: boolean; error?: string }
  | { kind: "mode"; chat: string; mode: PhoneMode }
  /** The agent waits for an answer: an approval, a question or a plan to start. */
  | { kind: "ask"; chat: string; request: PhoneAsk }
  | { kind: "answered"; chat: string; id: string }
