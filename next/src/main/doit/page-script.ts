// The page script Axe's own browser runs to read a page: numbered links,
// buttons and fields, plus the text. Same as ImperiumHands/Browser.swift on the
// Mac. No Electron imports, so unit tests can run it against a fake page.

// Password fields (type=password, a password or one-time-code autocomplete, or
// text masked with -webkit-text-security): the model sees the field and whether
// it's filled in, never its value.
export const HIDDEN_VALUE = "(filled in, hidden)"
export const SECRET_FIELD_JS = `const isSecret = el => { if (!el || el.tagName !== 'INPUT') return false;
  const type = (el.getAttribute('type') || '').toLowerCase();
  const ac = (el.getAttribute('autocomplete') || '').toLowerCase();
  const mask = (getComputedStyle(el).webkitTextSecurity || 'none').toLowerCase();
  return type === 'password' || ac.includes('password') || ac.includes('one-time-code') || mask !== 'none'; };`

export const INDEX_SCRIPT = `(() => {
  ${SECRET_FIELD_JS}
  const visible = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const sel = 'a[href], button, input:not([type=hidden]), textarea, select, [role=button], [role=link], [role=tab], [role=checkbox], [contenteditable=true], summary';
  const items = []; let n = 0;
  document.querySelectorAll('[data-axe-id]').forEach(el => el.removeAttribute('data-axe-id'));
  for (const el of document.querySelectorAll(sel)) {
    if (!visible(el) || n >= 250) continue;
    n += 1; el.setAttribute('data-axe-id', String(n));
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    const kind = tag === 'a' ? 'link' : tag === 'input' ? (type === 'submit' || type === 'button' ? 'button' : (type || 'text') + ' field')
      : tag === 'textarea' ? 'text area' : tag === 'select' ? 'menu' : el.getAttribute('role') || tag;
    const secret = isSecret(el);
    const label = (el.getAttribute('aria-label') || el.innerText || (secret ? '' : el.value) || el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('name') || '').trim().replace(/\\s+/g, ' ').slice(0, 100);
    const value = secret ? (el.value ? '${HIDDEN_VALUE}' : '')
      : (tag === 'input' || tag === 'textarea') && type !== 'submit' && type !== 'button' ? (el.value || '') : '';
    items.push({ id: n, kind, label, value, href: tag === 'a' ? el.href : '' });
  }
  const text = (document.body ? document.body.innerText : '').replace(/\\n{3,}/g, '\\n\\n');
  return { title: document.title, url: location.href, items, text };
})()`
