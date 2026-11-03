import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { beforeEach, describe, expect, it } from "vitest"

import { kindOfPlugin } from "@shared/community"

import { agentEntry, Community, firstSentence, humanName, parseIndex, resolveLink, skillFolder } from "../../src/main/libraries/community"
import { SkillStore } from "../../src/main/libraries/skills"

// The open-source libraries on the Skills and Agents pages, against a fake GitHub.

describe("reading the libraries", () => {
  it("follows index links to the repo that holds the skill", () => {
    expect(resolveLink("https://officialskills.sh/anthropics/skills/docx")).toEqual({ repo: "anthropics/skills", skill: "docx" })
    expect(resolveLink("https://github.com/AgriciDaniel/claude-seo")).toEqual({ repo: "AgriciDaniel/claude-seo" })
    expect(resolveLink("https://github.com/o/r/tree/main/skills/seo")).toEqual({ repo: "o/r", path: "skills/seo" })
    expect(resolveLink("https://github.com/o/r/blob/main/skills/seo/SKILL.md")).toEqual({ repo: "o/r", path: "skills/seo" })
    expect(resolveLink("https://www.notion.so/page")).toBeNull()
  })

  it("parses VoltAgent's index with its sections", () => {
    const readme = [
      "## Official",
      "### Skills by Stripe",
      "- **[stripe/stripe-best-practices](https://officialskills.sh/stripe/ai/stripe-best-practices)** - Build payments well",
      "<summary><h3 style=\"display:inline\">Marketing</h3></summary>",
      "- **[BrianRWagner/ai-marketing-skills](https://github.com/BrianRWagner/ai-marketing-skills)** - 17 marketing frameworks",
      "- **[odd/link](https://example.com/x)** - not on GitHub, skipped",
      "- plain line, skipped",
    ].join("\n")
    const list = parseIndex(readme)
    expect(list.map((s) => s.key)).toEqual(["voltagent/stripe/stripe-best-practices", "voltagent/BrianRWagner/ai-marketing-skills"])
    expect(list[0]).toMatchObject({ name: "Stripe best practices", category: "Skills by Stripe", repo: "stripe/ai", skill: "stripe-best-practices" })
    expect(list[1]).toMatchObject({ category: "Marketing", repo: "BrianRWagner/ai-marketing-skills" })
  })

  it("finds the skill's folder, or says the repo holds several", () => {
    const paths = ["README.md", "skills/docx/SKILL.md", "skills/docx/scripts/a.py", "skills/pdf/SKILL.md", "other/pdf/SKILL.md"]
    expect(skillFolder(paths, { skill: "docx" })).toBe("skills/docx")
    expect(skillFolder(paths, { path: "skills/pdf" })).toBe("skills/pdf")
    expect(skillFolder(paths, { skill: "pdf" })).toBe("other/pdf")
    expect(skillFolder(paths, {})).toBeNull()
    expect(skillFolder(["SKILL.md", "scripts/run.sh"], {})).toBe("")
  })

  it("reads an agent file, names it and gives it a kind", () => {
    const a = agentEntry("plugins/ui-design/agents/ui-visual-validator.md", "---\nname: ui-visual-validator\ndescription: Checks UI changes. Use PROACTIVELY after edits.\n---\nYou check UIs.")
    expect(a).toMatchObject({ key: "wshobson/ui-design/ui-visual-validator", name: "UI visual validator", description: "Checks UI changes.", plugin: "ui-design" })
    expect(agentEntry("README.md", "")).toBeNull()
    expect(kindOfPlugin("ui-design")).toBe("design")
    expect(kindOfPlugin("backend-development")).toBe("code")
    expect(kindOfPlugin("seo-content-creation")).toBe("write")
    expect(humanName("api-scaffolding")).toBe("API scaffolding")
    expect(firstSentence("One thing. Then more.")).toBe("One thing.")
  })
})

/** A fake GitHub: the tree API and raw files. */
function fakeGitHub(repos: Record<string, Record<string, string>>) {
  const calls: string[] = []
  const f = (async (input: string | URL | Request) => {
    const url = String(input)
    calls.push(url)
    const t = /api\.github\.com\/repos\/([^/]+\/[^/]+)\/git\/trees\//.exec(url)
    if (t) {
      const files = repos[t[1]!]
      if (!files) return new Response("{}", { status: 404 })
      return Response.json({ tree: Object.keys(files).map((path) => ({ path, type: "blob" })) })
    }
    const r = /raw\.githubusercontent\.com\/([^/]+\/[^/]+)\/HEAD\/(.+)$/.exec(url)
    const body = r ? repos[r[1]!]?.[r[2]!.split("/").map(decodeURIComponent).join("/")] : undefined
    return body === undefined ? new Response("", { status: 404 }) : new Response(body)
  }) as typeof fetch
  return { f, calls }
}

describe("adding from the libraries", () => {
  let data: string
  let home: string
  beforeEach(() => {
    data = mkdtempSync(join(tmpdir(), "axe-community-"))
    home = mkdtempSync(join(tmpdir(), "axe-home-"))
    process.env.AXE_DATA_DIR = data
  })

  const repos = {
    "obra/superpowers": {
      "skills/brainstorming/SKILL.md": "---\nname: brainstorming\ndescription: Shape an idea first. Then build.\n---\n\nAsk one question at a time.",
      "README.md": "",
    },
    "VoltAgent/awesome-agent-skills": {
      "README.md": "### Marketing\n- **[acme/seo](https://github.com/acme/seo-skills/tree/main/seo)** - SEO audits\n",
    },
    "acme/seo-skills": {
      "seo/SKILL.md": "---\nname: seo\ndescription: SEO audits\n---\n\nCheck titles.",
      "seo/scripts/check.sh": "echo ok",
      "README.md": "",
    },
    "wshobson/agents": {
      "plugins/backend-development/agents/backend-architect.md": "---\nname: backend-architect\ndescription: Designs APIs. Use often.\n---\n\nStart from the data.",
      "plugins/other/agents/backend-architect.md": "---\nname: backend-architect\ndescription: Duplicate.\n---\n\nSame.",
    },
  }

  it("lists both skill libraries, then serves the list from the cache", async () => {
    const gh = fakeGitHub(repos)
    const c = new Community(new SkillStore(() => home, () => join(data, "skills")), gh.f)
    const list = await c.skillList()
    expect(list.map((s) => s.key)).toEqual(["superpowers/brainstorming", "voltagent/acme/seo"])
    expect(list[0]).toMatchObject({ name: "Brainstorming", description: "Shape an idea first." })
    const n = gh.calls.length
    await c.skillList()
    expect(gh.calls.length).toBe(n)
  })

  it("downloads a skill's whole folder into Axe and the CLIs you pick", async () => {
    const gh = fakeGitHub(repos)
    const store = new SkillStore(() => home, () => join(data, "skills"))
    const c = new Community(store, gh.f)
    const lib = await c.installSkill("voltagent/acme/seo", [])
    expect(lib.skills.find((s) => s.id === "seo")?.installedIn).toContain("axe")
    expect(readFileSync(join(data, "skills", "seo", "scripts", "check.sh"), "utf8")).toBe("echo ok")
    await expect(c.installSkill("voltagent/acme/seo", [])).rejects.toThrow(/already/)
  })

  it("lists agents once each and copies one into your agents", async () => {
    const gh = fakeGitHub(repos)
    const c = new Community(new SkillStore(() => home, () => join(data, "skills")), gh.f)
    const agents = await c.agentList()
    expect(agents.map((a) => a.name)).toEqual(["Backend architect"])
    const helpers = await c.addAgent(agents[0]!.key)
    const mine = helpers.find((h) => h.name === "Backend architect")
    expect(mine).toMatchObject({ role: "Designs APIs.", instructions: "Start from the data.", kind: "code" })
  })

  it("says plainly when GitHub can't be reached", async () => {
    const down = (async () => {
      throw new Error("offline")
    }) as typeof fetch
    const c = new Community(new SkillStore(() => home, () => join(data, "skills")), down)
    await expect(c.skillList()).rejects.toThrow(/Couldn't reach GitHub/)
  })
})
