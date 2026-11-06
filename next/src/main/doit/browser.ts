import { BrowserWindow } from "electron"

import { INDEX_SCRIPT, SECRET_FIELD_JS } from "./page-script"
import type { PageBrowser } from "./toolbox"

// Axe's own browser, driven by structure (links, buttons, fields), not screenshots. Real Chromium
// in a window of its own, with its own session (not the app's), no preload and no way into the app's
// IPC. It shows without taking focus so you can watch and take over; self-tests keep it hidden
// (AXE_HEADLESS). Ported from desktop/src/main/agent/browser.ts; the page script is the Mac's.

type PageItem = { id: number; kind: string; label: string; value: string; href: string }

/** Turns "example.com" into a URL and plain words into a search. */
export function target(text: string): string {
  const t = text.trim()
  if (/^(https?|file|data):/i.test(t)) return t
  if (/^localhost(:\d+)?(\/|$)/i.test(t)) return `http://${t}`
  if (t.includes(".") && !t.includes(" ")) return `https://${t}`
  return `https://duckduckgo.com/html/?q=${encodeURIComponent(t)}`
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** The isolated world describe() runs in (any number above 0 that nothing else uses). */
const DESCRIBE_WORLD = 1009

export class OwnBrowser implements PageBrowser {
  private win?: BrowserWindow

  private get wc() {
    if (!this.win || this.win.isDestroyed()) {
      const win = new BrowserWindow({
        width: 1100,
        height: 800,
        show: false,
        title: "Axe browser",
        webPreferences: { partition: "persist:axe-browser", sandbox: true, contextIsolation: true, nodeIntegration: false },
      })
      // Pop-ups open in the same window, so the model keeps one page to read.
      win.webContents.setWindowOpenHandler(({ url }) => {
        void win.webContents.loadURL(url)
        return { action: "deny" }
      })
      // Its own windows never ask for the camera, location or notifications.
      win.webContents.session.setPermissionRequestHandler((_wc, _permission, done) => done(false))
      this.win = win
    }
    return this.win.webContents
  }

  /** Shows the window without taking focus (not in self-tests). */
  private reveal() {
    if (process.env.AXE_HEADLESS || !this.win || this.win.isDestroyed() || this.win.isVisible()) return
    this.win.showInactive()
  }

  get url() {
    return this.win && !this.win.isDestroyed() ? this.win.webContents.getURL() : ""
  }

  where() {
    try {
      return new URL(this.url).host || "the page"
    } catch {
      return "the page"
    }
  }

  async open(text: string) {
    const wc = this.wc
    await Promise.race([wc.loadURL(target(text)).catch(() => {}), sleep(20_000)])
    this.reveal()
    await sleep(150)
  }

  private ensureOpen() {
    if (!this.url) throw new Error("No page is open. Use browser_open first.")
  }

  async read(maxText = 6000): Promise<string> {
    this.ensureOpen()
    const page = (await this.wc.executeJavaScript(INDEX_SCRIPT, true)) as { title: string; url: string; items: PageItem[]; text: string }
    const lines = [`Page: ${page.title}`, `Address: ${page.url}`, ""]
    for (const e of page.items) {
      let line = `[${e.id}] ${e.kind}`
      if (e.label) line += ` “${e.label}”`
      if (e.value) line += ` = ${e.value.slice(0, 80)}`
      if (e.href) line += ` → ${e.href.slice(0, 100)}`
      lines.push(line)
    }
    lines.push("", "Text:", page.text.slice(0, maxText))
    return lines.join("\n")
  }

  async click(id: number) {
    this.ensureOpen()
    const ok = await this.wc.executeJavaScript(
      `(() => { const el = document.querySelector('[data-axe-id="${Math.trunc(id)}"]'); if (!el) return false; el.scrollIntoView({block: 'center'}); el.click(); return true; })()`,
      true,
    )
    if (!ok) throw new Error(`Element ${id} isn't on the page any more. Read the page again.`)
    await this.settle()
  }

  async type(id: number, text: string, submit: boolean) {
    this.ensureOpen()
    const t = JSON.stringify(text)
    const ok = await this.wc.executeJavaScript(
      `(() => { const el = document.querySelector('[data-axe-id="${Math.trunc(id)}"]'); if (!el) return false;
        el.focus();
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value');
        if (el.isContentEditable) { el.textContent = ${t}; } else if (setter) { setter.set.call(el, ${t}); } else { el.value = ${t}; }
        el.dispatchEvent(new Event('input', {bubbles: true}));
        el.dispatchEvent(new Event('change', {bubbles: true}));
        if (${submit ? "true" : "false"}) {
          el.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true}));
          if (el.form) { el.form.requestSubmit ? el.form.requestSubmit() : el.form.submit(); }
        }
        return true; })()`,
      true,
    )
    if (!ok) throw new Error(`Field ${id} isn't on the page any more. Read the page again.`)
    if (submit) await this.settle()
  }

  async describe(id: number): Promise<{ label: string; isSearch: boolean; submits?: boolean; searchOnly?: boolean }> {
    if (!this.url) return { label: "", isSearch: false }
    try {
      // An isolated world: the page shares the DOM but not its JavaScript, so it can't patch what this
      // reads. Form properties go through the prototypes, since a control named "method" or "elements"
      // shadows them on the form itself.
      return (await this.wc.executeJavaScriptInIsolatedWorld(DESCRIBE_WORLD, [
        {
          code: `(() => { ${SECRET_FIELD_JS}
          const attr = (n, a) => Element.prototype.getAttribute.call(n, a);
          const el = document.querySelector('[data-axe-id="${Math.trunc(id)}"]'); if (!el) return { label: '', isSearch: false };
          const label = (attr(el, 'aria-label') || el.innerText || (isSecret(el) ? '' : el.value) || attr(el, 'placeholder') || attr(el, 'title') || '').trim();
          const tag = el.tagName;
          const form = tag === 'BUTTON' ? Object.getOwnPropertyDescriptor(HTMLButtonElement.prototype, 'form').get.call(el)
            : tag === 'INPUT' ? Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'form').get.call(el) : null;
          const isSearch = el.type === 'search' || attr(el, 'role') === 'searchbox' || /search/i.test(el.name || '') || /search/i.test(label);
          // Clicking it sends a form: a submit button or input (a <button> in a form submits unless typed otherwise).
          const submits = !!form && ((tag === 'BUTTON' && (attr(el, 'type') || 'submit').toLowerCase() === 'submit') || (tag === 'INPUT' && /^(submit|image)$/i.test(el.type)));
          // A form that is only a search, judged by what it would send, not by markers the page adds
          // (role="search", a hidden search box): sent with GET by a button that doesn't change where
          // or how, and holding nothing but one visible search box with the query and plain buttons.
          let searchOnly = false;
          if (submits) {
            const shown = f => { const r = f.getBoundingClientRect(); const cs = getComputedStyle(f); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
            const controls = Array.from(Object.getOwnPropertyDescriptor(HTMLFormElement.prototype, 'elements').get.call(form));
            const isButton = f => f.tagName === 'BUTTON' || (f.tagName === 'INPUT' && /^(submit|button|image|reset)$/i.test(attr(f, 'type') || ''));
            const fields = controls.filter(f => !isButton(f) && f.tagName !== 'FIELDSET' && f.tagName !== 'OUTPUT');
            const box = fields.length === 1 ? fields[0] : null;
            const overrides = ['formaction', 'formmethod', 'formtarget', 'formenctype'].some(a => Element.prototype.hasAttribute.call(el, a));
            searchOnly = (attr(form, 'method') || 'get').trim().toLowerCase() === 'get' && !overrides && !!box && box.tagName === 'INPUT'
              && (attr(box, 'type') === 'search' || attr(box, 'role') === 'searchbox') && !isSecret(box) && shown(box) && !!(box.value || '').trim();
          }
          return { label: label.slice(0, 80), isSearch, submits, searchOnly }; })()`,
        },
      ])) as { label: string; isSearch: boolean; submits?: boolean; searchOnly?: boolean }
    } catch {
      // If the page can't be read, a click asks (it may submit something).
      return { label: "", isSearch: false, submits: true, searchOnly: false }
    }
  }

  async capture(): Promise<Buffer> {
    this.ensureOpen()
    return (await this.wc.capturePage()).toPNG()
  }

  /** Runs a script in the page (self-tests check the form's state with it). */
  evaluate<T>(script: string): Promise<T> {
    return this.wc.executeJavaScript(script, true) as Promise<T>
  }

  close() {
    if (this.win && !this.win.isDestroyed()) this.win.destroy()
    this.win = undefined
  }

  /** After a click: if navigation starts, wait for it; else a short pause. */
  private async settle() {
    await sleep(300)
    const wc = this.wc
    if (wc.isLoading()) {
      await Promise.race([new Promise<void>((r) => wc.once("did-stop-loading", () => r())), sleep(20_000)])
      await sleep(150)
    } else {
      await sleep(200)
    }
  }
}

export const browser = new OwnBrowser()
