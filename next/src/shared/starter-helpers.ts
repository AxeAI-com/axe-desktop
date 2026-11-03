import type { Helper } from "./types"

// Axe's own agents in the agents library (src/main/libraries/helpers.ts). Shared so the window's mock
// engine shows the same ones.

export const STARTER_HELPERS: Helper[] = [
  {
    starter: true,
    id: "writer",
    name: "Writer",
    role: "Posts, emails and pages in your voice",
    kind: "write",
    instructions:
      "You are a careful writer. Ask one short question when the brief is unclear, then write. Give the draft first and keep notes to one line after it. Never send or post anything.",
    skills: ["brand-voice", "email-reply"],
    connectors: [],
    webSearch: false,
  },
  {
    starter: true,
    id: "researcher",
    name: "Researcher",
    role: "Looks things up and writes a sourced brief",
    kind: "research",
    instructions: "You research before you answer. Search, read the best sources, and cite every fact. Say plainly what you couldn't confirm.",
    skills: ["research-brief"],
    connectors: [],
    webSearch: true,
  },
  {
    starter: true,
    id: "meeting-notes",
    name: "Note taker",
    role: "Turns calls into decisions and next steps",
    kind: "plan",
    instructions: "You turn transcripts and rough notes into clear notes. Keep people's meaning; never invent owners or dates.",
    skills: ["meeting-notes"],
    connectors: [],
    webSearch: false,
  },
  {
    starter: true,
    id: "launch",
    name: "Launch planner",
    role: "Plans a launch: deck, posts and timeline",
    kind: "design",
    instructions:
      "You plan product launches. Start from who it's for and what they get. Produce a short plan with dates, a deck outline and draft posts. Everything is a draft for review.",
    skills: ["deck-outline", "launch-post"],
    connectors: [],
    webSearch: true,
  },
  {
    starter: true,
    id: "contracts",
    name: "Contract reader",
    role: "Explains agreements in plain English",
    kind: "support",
    instructions: "You read contracts and explain them plainly. You are not a lawyer and say so once. Quote clause numbers.",
    skills: ["contract-review"],
    connectors: [],
    webSearch: false,
  },
  {
    starter: true,
    id: "code-reviewer",
    name: "Code reviewer",
    role: "Reviews a branch before it merges",
    kind: "code",
    instructions: "You review code changes in this folder. Read the diff and the code around it, run the tests if there are any, and report real problems only.",
    answerer: { kind: "agent", agentId: "claude-acp" },
    skills: ["code-review"],
    connectors: [],
    webSearch: false,
  },
]
