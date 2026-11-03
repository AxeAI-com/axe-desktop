import type { Json } from "@shared/types"

import type { Brain } from "./loop"

/** The test's command, written for the shell it runs in (PowerShell on Windows). */
export const SORT_COMMAND =
  process.platform === "win32"
    ? "gc notes.txt | sort -Descending | sc sorted.txt; gc sorted.txt"
    : "sort -r notes.txt > sorted.txt && cat sorted.txt"

// The stand-in for the model in unit tests and self-tests (AXE_FAKE_BRAIN=1): fixed plans that drive
// the real loop, tools, browser and approval gate without spending anyone's free quota.
// - A goal with "form": fill the order form (tests/fixtures/doit-form.html, or a data: copy) and press Send.
// - Anything else: write a file, run a command on it and read it back, in the workspace.

export const FORM_PAGE = `data:text/html,${encodeURIComponent(
  `<title>Order form</title><h1>Order form</h1><form onsubmit="event.preventDefault();document.title='Sent';document.body.dataset.sent='1'">` +
    `<input name="name" placeholder="Your name"><input name="email" placeholder="Email"><textarea name="note" placeholder="Note"></textarea>` +
    `<button type="submit">Send order</button></form>`,
)}`

const call = (n: number, name: string, input: Json): Json => ({ type: "tool-input-available", toolCallId: `fake-${n}`, toolName: name, input })
const say = (text: string): Json => ({ type: "text-delta", delta: text })

export function fakeBrain(formUrl = process.env.AXE_DOIT_FORM_URL || FORM_PAGE): Brain {
  return async function* ({ messages }) {
    const first = messages.find((m) => (m as { role?: string }).role === "user") as { content?: string } | undefined
    const goal = String(first?.content ?? "")
    const turns = messages.filter((m) => (m as { role?: string }).role === "tool")
    const done = turns.length
    const lastResult = JSON.stringify(turns[turns.length - 1] ?? "")
    if (/said no/.test(lastResult)) {
      yield say("You said no, so I stopped before pressing Send order. The form is filled in and waiting.")
      return
    }
    if (/form/i.test(goal)) {
      switch (done) {
        case 0:
          yield say("I'll fill in the form and stop at Send.")
          yield call(done, "update_plan", { steps: ["Open the form", "Fill in the fields", "Press Send order"], current: 0 })
          return
        case 1:
          yield call(done, "browser_open", { url: formUrl })
          return
        case 2:
          yield call(done, "update_plan", { steps: ["Open the form", "Fill in the fields", "Press Send order"], current: 1 })
          return
        case 3:
          yield call(done, "browser_type", { element: 1, text: "Mia Lane" })
          return
        case 4:
          yield call(done, "browser_type", { element: 2, text: "mia@example.com" })
          return
        case 5:
          yield call(done, "update_plan", { steps: ["Open the form", "Fill in the fields", "Press Send order"], current: 2 })
          return
        case 6:
          // A risky click: Ask first must stop here; Full access goes straight on.
          yield call(done, "browser_click", { element: 4, irreversible: true, why: "Sends the order form to the shop." })
          return
        default:
          yield say("Done: filled in the form and pressed Send order.")
          return
      }
    }
    switch (done) {
      case 0:
        yield call(done, "write_file", { path: "notes.txt", content: "apples\npears\nplums\n" })
        return
      case 1:
        yield call(done, "run_command", { command: SORT_COMMAND })
        return
      case 2:
        yield call(done, "edit_file", { path: "notes.txt", old_text: "pears", new_text: "figs" })
        return
      case 3:
        yield call(done, "read_file", { path: "notes.txt" })
        return
      default:
        yield say("Made notes.txt, sorted it into sorted.txt and swapped pears for figs.")
    }
  }
}
