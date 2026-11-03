import { describe, expect, it } from "vitest"

import { isUnifiedDiff, parseUnifiedDiff } from "../../../src/renderer/src/lib/diff"

const GIT = `diff --git a/src/stock.js b/src/stock.js
index 1a2b3c4..5d6e7f8 100644
--- a/src/stock.js
+++ b/src/stock.js
@@ -1,3 +1,3 @@ export function inStock(item) {
 export function inStock(item) {
-  return item.qty > 1
+  return item.qty > 0
 }
diff --git a/README.md b/README.md
new file mode 100644
--- /dev/null
+++ b/README.md
@@ -0,0 +1,2 @@
+# shop-cart
+Run npm test.
`

describe("diffs in answers", () => {
  it("knows a diff by its fence or its shape", () => {
    expect(isUnifiedDiff("diff", "+a")).toBe(true)
    expect(isUnifiedDiff("", GIT)).toBe(true)
    expect(isUnifiedDiff("text", GIT)).toBe(true)
    expect(isUnifiedDiff("js", GIT)).toBe(false)
    expect(isUnifiedDiff("", "- a list item\n- another")).toBe(false)
  })

  it("splits a git diff into files with counts, dropping headers", () => {
    const files = parseUnifiedDiff(GIT)
    expect(files.map((f) => [f.path, f.added, f.removed])).toEqual([
      ["src/stock.js", 1, 1],
      ["README.md", 2, 0],
    ])
    expect(files[0]!.lines[0]).toEqual({ hunk: "export function inStock(item) {" })
    expect(files[0]!.lines).toContainEqual({ sign: "-", text: "  return item.qty > 1" })
    expect(files[1]!.lines.some((l) => "text" in l && l.text.startsWith("index"))).toBe(false)
  })

  it("reads a diff without git's header line", () => {
    const files = parseUnifiedDiff("--- a/x.txt\n+++ b/x.txt\n@@ -1 +1 @@\n-old\n+new")
    expect(files).toHaveLength(1)
    expect(files[0]).toMatchObject({ path: "x.txt", added: 1, removed: 1 })
  })
})
