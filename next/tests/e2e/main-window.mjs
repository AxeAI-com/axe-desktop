// The chat window, never the quick bar's (its page ends in #quick). Which window opens first differs by
// platform: on Linux the hidden quick bar can come first.
export async function mainWindow(app, timeout = 60_000) {
  const end = Date.now() + timeout
  for (;;) {
    const win = app.windows().find((w) => !w.url().endsWith("#quick") && w.url() !== "about:blank")
    if (win) return win
    if (Date.now() > end) throw new Error("The chat window never opened.")
    await app.waitForEvent("window", { timeout: Math.max(1, end - Date.now()) }).catch(() => {})
  }
}
