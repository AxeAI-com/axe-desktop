import { existsSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { cleanElementTarget } from "@shared/watching/elements"
import { cleanFolder, inProtected } from "@shared/watching/more"
import { cleanTarget } from "@shared/watching/target"

import type { CheckDeps } from "../../src/main/watching/checks/deps"
import { checkOutdated, checkTests, REFUSED, safeFolder } from "../../src/main/watching/checks/local"
import { checkGitRepos, findRepos } from "../../src/main/watching/checks/mac"

// Desktop, Documents, Downloads and Library stay untouched by watches that run things in a folder
// (tests, outdated packages, git repos): refused as typed, and again in the engine with links followed.

describe("folders as typed", () => {
  const home = "/Users/mia"
  it("allows project folders, as ~/ when they're in home", () => {
    expect(cleanFolder("~/Work/x", home)).toBe("~/Work/x")
    expect(cleanFolder("~/Work/x/", home)).toBe("~/Work/x")
    expect(cleanFolder("~/Work/./x", home)).toBe("~/Work/x")
    expect(cleanFolder("/Users/mia/Work/x", home)).toBe("~/Work/x")
    expect(cleanFolder("/opt/projects/shop", home)).toBe("/opt/projects/shop")
    expect(cleanTarget("tests", "~/Work/shop", home)).toBe("~/Work/shop")
  })
  it("refuses absolute paths into protected folders, with or without home", () => {
    expect(cleanFolder("/Users/mia/Desktop/proj", home)).toBeNull()
    expect(cleanFolder("/Users/mia/Desktop", home)).toBeNull()
    expect(cleanFolder("/Users/mia/Library/x")).toBeNull()
    expect(cleanFolder("/Users/someone/Documents/x", home)).toBeNull()
    expect(cleanFolder("/System/Volumes/Data/Users/mia/Downloads/x", home)).toBeNull()
    expect(cleanFolder("~/desktop/proj", home)).toBeNull()
    expect(cleanTarget("tests", "/Users/mia/Desktop/proj", home)).toBeNull()
    expect(cleanTarget("outdated", "/Users/mia/Documents/shop")).toBeNull()
    expect(cleanElementTarget("gitrepos", "/Users/mia/Downloads", home)).toBeNull()
  })
  it("refuses .. anywhere, and home itself", () => {
    expect(cleanFolder("~/Code/../Desktop/proj", home)).toBeNull()
    expect(cleanFolder("~/x/../Library/y", home)).toBeNull()
    expect(cleanFolder("~/Work/../Work/x", home)).toBeNull()
    expect(cleanFolder("/Users/mia/Work/../Desktop", home)).toBeNull()
    expect(cleanFolder("/Users/mia", home)).toBeNull()
    expect(cleanTarget("tests", "~/Code/../Desktop/proj", home)).toBeNull()
    expect(inProtected("/a/../b", home)).toBe(true)
  })
})

describe("folders before a run", () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "axe-folders-")))
  const home = join(base, "home")
  for (const p of ["Desktop/proj", "Work/shop", "Work/repos/a/.git"]) mkdirSync(join(home, p), { recursive: true })
  writeFileSync(join(home, "Desktop/proj/package.json"), JSON.stringify({ scripts: { test: "vitest run" } }))
  writeFileSync(join(home, "Work/shop/package.json"), JSON.stringify({ scripts: { test: "vitest run" } }))
  symlinkSync(join(home, "Desktop/proj"), join(home, "Work/to-desktop"))
  symlinkSync("../Desktop", join(home, "Work/rel-desktop"))
  symlinkSync(join(home, "Work/shop"), join(home, "Work/to-shop"))
  symlinkSync(join(home, "Desktop"), join(home, "Work/repos/b"))

  const ran: string[] = []
  const d = {
    now: () => 0,
    home: () => home,
    exists: (p: string) => existsSync(p),
    exec: async () => ({ stdout: "", code: 0 }),
    run: async (cmd: string, args: string[], o: { cwd: string }) => (ran.push(`${o.cwd}: ${[cmd, ...args].join(" ")}`), { stdout: "{}", code: 0 }),
  } as unknown as CheckDeps

  it("follows links to allowed folders", async () => {
    expect(await safeFolder("~/Work/shop", d)).toBe(join(home, "Work/shop"))
    expect(await safeFolder("~/Work/to-shop", d)).toBe(join(home, "Work/shop"))
    expect(await safeFolder(join(home, "Work/shop"), d)).toBe(join(home, "Work/shop"))
    expect(await safeFolder("~/Work/not-yet", d)).toBe(join(home, "Work/not-yet"))
  })
  it("refuses links into a protected folder, absolute or relative", async () => {
    expect(await safeFolder("~/Work/to-desktop", d)).toBeNull()
    expect(await safeFolder("~/Work/rel-desktop/proj", d)).toBeNull()
    expect(await safeFolder(join(home, "Desktop/proj"), d)).toBeNull()
    expect(await safeFolder("~/Work/../Desktop/proj", d)).toBeNull()
  })
  it("runs nothing there", async () => {
    ran.length = 0
    expect(await checkTests("~/Work/to-desktop", d)).toMatchObject({ status: "failed", error: REFUSED })
    expect(await checkOutdated("~/Work/to-desktop", d)).toMatchObject({ status: "failed", error: REFUSED })
    expect(await checkGitRepos("~/Work/rel-desktop", d)).toMatchObject({ status: "failed", error: REFUSED })
    expect(await findRepos(join(home, "Desktop"), d)).toEqual([])
    expect(ran).toEqual([])
    await checkTests("~/Work/to-shop", d)
    expect(ran).toEqual([`${join(home, "Work/shop")}: npm test --silent`])
  })
  it("walks git repos without following links", async () => {
    expect(await findRepos(join(home, "Work/repos"), d)).toEqual([join(home, "Work/repos/a")])
  })
})

describe("git repos from a root above home", () => {
  // /Users/mia: Desktop, Documents, Downloads and Library hold repos too, and none of them is looked in.
  const root = realpathSync(mkdtempSync(join(tmpdir(), "axe-above-")))
  const mia = join(root, "Users/mia")
  for (const f of ["Desktop/a", "Documents/b", "downloads/c", "Library/d", "Work/shop", "Code"]) mkdirSync(join(mia, f), { recursive: true })
  for (const f of ["Desktop", "Documents/b", "downloads/c", "Library/d", "Work/shop"]) mkdirSync(join(mia, f, ".git"))
  const looked: string[] = []
  const d = { home: () => mia, exists: (p: string) => (looked.push(p), existsSync(p)) } as unknown as CheckDeps
  it("skips protected folders while walking", async () => {
    looked.length = 0
    expect(await findRepos(join(root, "Users"), d)).toEqual([])
    // Users/mia/Work/shop is three levels down; what matters is that nothing protected was asked about.
    expect(looked.filter((p) => /\/(Desktop|Documents|Downloads|Library)(\/|$)/i.test(p))).toEqual([])
  })
  it("still finds repos in a project folder you picked", async () => {
    expect(await findRepos(join(mia, "Work"), d)).toEqual([join(mia, "Work/shop")])
  })
})
