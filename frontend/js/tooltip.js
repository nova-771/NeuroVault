/* ==== Build N · QC 70: only NeuroVault's own tooltips (design profile "Only NeuroVault's own tooltips", 2026-10-18) ====
   Feedback: "hover and waiting to see what an icon is name should be done through the app and not windows".
   - One shared tooltip, #nv-tip: the theme's card surface and font, after about a second of hovering (QC 79) and at once on
     keyboard focus, and only for an icon-only control (QC 79: none where the name shows in words, none on the window buttons). A shortcut at its end ("Timer · Ctrl+Alt+3", or the element's
     aria-keyshortcuts) shows as a key. It sits under its element (over it when there's no room) and never past the window's edge.
   - The shim: no element keeps a native `title`. `el.title = …`, setAttribute('title', …) and getAttribute('title') go to and from
     data-tip; a `title` that arrives in rendered HTML moves to data-tip after each draw (and a MutationObserver catches the rest).
     An SVG <title> goes too: its words become the drawing's aria-label (and its tooltip, if nothing above it has one).
     An element whose name was only its title (an icon button) gets the words as its aria-label; one with words of its own gets
     them as aria-description. So the 29 files that write title="…" stay as they are.
   - Not touched: the note's own text (the editor's .doc and other contenteditable areas), where a Markdown link's "title" is part
     of the note and the editor's history must not see a change. */
'use strict';
const TIP = { el: null, host: null, on: null, t: null, warm: 0, wait: 1000 };   // QC 79: about a second of hovering ("we can also add a bigger delay")
const TIP_SKIP = '.doc, [contenteditable="true"], [data-tip-skip]';
const tipAttr = Element.prototype.getAttribute, tipSet = Element.prototype.setAttribute, tipHas = Element.prototype.hasAttribute, tipDel = Element.prototype.removeAttribute;
const tipSkip = el => !!el.closest?.(TIP_SKIP);

/* ---- the shim ---- */
function tipMove(el) {   // one element: its title becomes data-tip (and its accessible name or description)
  const v = tipAttr.call(el, 'title'); if (v == null) return;
  if (tipSkip(el)) return;
  tipDel.call(el, 'title');
  if (!v.trim()) return;
  if (!tipHas.call(el, 'data-tip')) tipSet.call(el, 'data-tip', v);
  if (!tipHas.call(el, 'aria-label') && !tipHas.call(el, 'aria-labelledby')) {
    const own = (el.textContent || '').trim();
    if (!own && !['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) tipSet.call(el, 'aria-label', v);
    else if (own !== v.trim() && !tipHas.call(el, 'aria-description')) tipSet.call(el, 'aria-description', v);
  }
}
function tipSvgTitle(t) {   // an SVG <title>: the drawing keeps its name, Windows doesn't show it
  const svg = t.closest('svg') || t.parentElement; if (!svg || tipSkip(svg)) return;
  const words = (t.textContent || '').trim(); t.remove(); if (!words) return;
  if (!svg.hasAttribute('aria-label') && svg.getAttribute('aria-hidden') !== 'true') tipSet.call(svg, 'aria-label', words);
  if (!svg.closest('[data-tip]')) tipSet.call(svg, 'data-tip', words);
}
function tipSweep(root = document) {   // everything under root, at once
  if (root.nodeType === 1 && tipHas.call(root, 'title')) tipMove(root);
  root.querySelectorAll?.('[title]').forEach(tipMove);
  root.querySelectorAll?.('svg title').forEach(tipSvgTitle);
}
const tipObs = new MutationObserver(recs => tipRecords(recs));
function tipRecords(recs) {
  for (const r of recs) {
    if (r.type === 'attributes') tipMove(r.target);
    else r.addedNodes.forEach(n => { if (n.nodeType === 1) { if (n.tagName?.toLowerCase() === 'title' && n.closest?.('svg')) tipSvgTitle(n); else tipSweep(n); } });
  }
}
const tipFlush = () => tipRecords(tipObs.takeRecords());   // what the observer hasn't handled yet, now (the layout check uses it)
tipObs.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['title'] });
// el.title, setAttribute / getAttribute / hasAttribute('title') read and write the app's tooltip instead
Object.defineProperty(HTMLElement.prototype, 'title', { configurable: true,
  get() { return tipAttr.call(this, 'data-tip') ?? tipAttr.call(this, 'title') ?? ''; },
  set(v) { if (tipSkip(this)) { tipSet.call(this, 'title', v); return; } tipDel.call(this, 'title'); const s = String(v ?? ''); if (s) tipSet.call(this, 'data-tip', s); else tipDel.call(this, 'data-tip'); } });   // the newest words win over a title the HTML brought
Element.prototype.setAttribute = function (name, v) {
  if (String(name).toLowerCase() === 'title' && this.namespaceURI === 'http://www.w3.org/1999/xhtml' && !tipSkip(this)) { tipDel.call(this, 'title'); return String(v ?? '') ? tipSet.call(this, 'data-tip', v) : tipDel.call(this, 'data-tip'); }
  return tipSet.call(this, name, v);
};
Element.prototype.getAttribute = function (name) {   // everywhere, the note too: a link made before it went into the note keeps its title for the Markdown
  if (String(name).toLowerCase() === 'title' && this.namespaceURI === 'http://www.w3.org/1999/xhtml') return tipSkip(this) ? tipAttr.call(this, 'title') ?? tipAttr.call(this, 'data-tip') : tipAttr.call(this, 'data-tip') ?? tipAttr.call(this, 'title');
  return tipAttr.call(this, name);
};
Element.prototype.hasAttribute = function (name) {
  if (String(name).toLowerCase() === 'title' && this.namespaceURI === 'http://www.w3.org/1999/xhtml' && !tipSkip(this)) return tipHas.call(this, 'title') || tipHas.call(this, 'data-tip');
  return tipHas.call(this, name);
};

/* ---- the tooltip ---- */
function tipHost() {   // inside a small .app of its own, so it has the theme's tokens and font; outside #app, which every draw rebuilds
  if (TIP.el?.isConnected) return TIP.el;
  TIP.host = document.createElement('div'); TIP.host.className = 'app nv-tip-host'; TIP.host.setAttribute('aria-hidden', 'true');
  TIP.el = document.createElement('div'); TIP.el.className = 'nv-tip'; TIP.el.id = 'nv-tip'; TIP.el.setAttribute('role', 'tooltip'); TIP.el.hidden = true;
  TIP.host.appendChild(TIP.el); document.body.appendChild(TIP.host); return TIP.el;
}
const TIP_KEY = /^(?:(?:Ctrl|Alt|Shift|Win)\+)+\S+$|^F\d{1,2}$|^Esc$/;
function tipText(el) {   // [the words, the key]: a key at the end after " · ", or the element's aria-keyshortcuts
  const s = el.getAttribute('data-tip') || el.getAttribute('aria-label') || ''; const parts = s.split(' · '), last = parts[parts.length - 1];
  if (parts.length > 1 && TIP_KEY.test(last)) return [parts.slice(0, -1).join(' · '), last];
  const ks = el.getAttribute('aria-keyshortcuts'); return [s, ks && !s.includes(ks) ? ks.split(' ')[0].replace(/Control/g, 'Ctrl') : ''];
}
function tipShow(el) {
  const t = tipHost(), [words, key] = tipText(el); if (!words) { tipHide(); return; }
  t.textContent = words; if (key) { const k = document.createElement('span'); k.className = 'nv-tip-key'; k.textContent = key; t.append(' ', k); }
  t.hidden = false; TIP.on = el; tipPlace();
}
function tipPlace() {   // under its element, centred; over it when there's no room; 8px inside the window
  const el = TIP.on, t = TIP.el; if (!el || !t || t.hidden) return;
  if (!el.isConnected) { tipHide(); return; }
  const r = el.getBoundingClientRect(), W = innerWidth, H = innerHeight, w = t.offsetWidth, h = t.offsetHeight, gap = 6;
  let top = r.bottom + gap; if (top + h > H - 8 && r.top - gap - h >= 8) top = r.top - gap - h;
  const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), Math.max(8, W - w - 8));
  t.style.left = Math.round(left) + 'px'; t.style.top = Math.round(Math.min(Math.max(8, top), H - h - 8)) + 'px';
}
function tipHide() { clearTimeout(TIP.t); if (TIP.el && !TIP.el.hidden) { TIP.el.hidden = true; TIP.warm = Date.now(); } TIP.on = null; }
/* QC 79 (design profile, tooltips, "Only where there's no visible name"; feedback: "not every damn ui elements needs a hover over
   label... Only the ones that dont have visible names... the windows ones for sure dont need it"): a tooltip is for an icon-only
   control. One that shows its name in words, a field, and the window's own buttons get none; aria-label and aria-description stay
   for screen readers either way. */
const TIP_CTL = 'button, a, [role="button"], [role="tab"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="switch"], [role="option"], label, .list-item';
function tipNamed(el) {   // true: it needs no tooltip (its name is in words beside or on it, it's a field, or it's a window button)
  if (el.closest('.win-controls, .win-btn')) return true;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable) return true;
  const ctl = el.closest(TIP_CTL) || el;
  return !!(ctl.innerText || '').trim();
}
// v0.1.1 should-fix 6: a spelling or homophone mark in the note is a hint, not a name: it gets the tooltip, inside .doc too
const TIP_MARK = '.spell[data-tip], .homophone[data-tip]';
const tipCut = el => [...el.querySelectorAll('.cl-mid-a, .truncate')].some(x => x.scrollWidth > x.clientWidth + 1);   // QC 106: a name cut short shows in full
const tipFor = e => { const mk = e.target?.closest?.(TIP_MARK); if (mk) return mk; const cut = e.target?.closest?.('[data-tip-cut]'); if (cut) return tipCut(cut) ? cut : null;
  const el = e.target?.closest?.('[data-tip], button[aria-label], a[aria-label], [role="button"][aria-label], [role="tab"][aria-label]'); return el && !el.closest('[data-tip-skip]') && !tipNamed(el) ? el : null; };
document.addEventListener('pointerover', e => {
  const el = tipFor(e); if (el === TIP.on) return; clearTimeout(TIP.t);
  if (!el) { if (TIP.on && !TIP.on.matches(':focus-visible')) tipHide(); return; }
  if (TIP.on) tipHide();
  TIP.t = setTimeout(() => tipShow(el), TIP.wait);   // QC 79: every hover waits (fewer tooltips); keyboard focus shows at once
}, true);
document.addEventListener('pointerout', e => { const el = tipFor(e); if (el && el === TIP.on && !el.contains(e.relatedTarget)) tipHide(); else if (el && !TIP.on) clearTimeout(TIP.t); }, true);
document.addEventListener('focusin', e => { const el = tipFor(e); if (el && el.matches(':focus-visible')) { clearTimeout(TIP.t); tipShow(el); } else if (TIP.on && !el) tipHide(); }, true);
document.addEventListener('focusout', e => { if (TIP.on && TIP.on === tipFor(e)) tipHide(); }, true);
['pointerdown', 'wheel', 'scroll'].forEach(k => document.addEventListener(k, () => tipHide(), { capture: true, passive: true }));
document.addEventListener('keydown', e => { if (e.key === 'Escape' && TIP.on) tipHide(); }, true);
addEventListener('resize', tipPlace);

/* ---- after each draw: move what came in with the HTML, and keep the tooltip on its element (or hide it) ---- */
const tipAfter0 = afterRender;
afterRender = function () {   // eslint-disable-line no-global-assign
  tipAfter0.apply(this, arguments); tipSweep(app); tipFlush();
  if (TIP.on && !TIP.on.isConnected) tipHide(); else tipPlace();
};
tipSweep(document);
/* ==== end Build N · QC 70 ==== */
