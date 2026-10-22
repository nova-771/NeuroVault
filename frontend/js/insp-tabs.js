/* ==== Build N · the right sidebar's tabs are icons, and the docked chat is one of them (mockup R54; the decisions: r54-tabs "icons only", r54-chat "when its opened it gets put into the tab in the sidebar") ====
   - Outline, Backlinks, Tags and Attachments are wireframe icons (render-shell.js tabBtn); our own tooltip names each with its
     key, on hover and on keyboard focus. Ask is the fifth tab while the chat is docked (ai-chat.js).
   - Keys: Alt+1 to Alt+4 open those tabs, Alt+5 the Ask tab when the chat is docked; the sidebar opens if it was hidden. In the
     strip, ← → Home End move between the tabs (one tab stop, the ARIA tabs pattern). The number row only: Alt + the number pad
     types Windows' Alt codes. */
'use strict';
function inspTabGo(k, focus) {
  const tabs = inspTabs(note()); if (!tabs.some(t => t[0] === k)) return false;
  if (UI.inspector === 'hidden') { UI.inspector = 'shown'; document.body.dataset.inspector = 'shown'; }
  S.tab = k;
  if (k === 'ask') AIC.focus = '#aic-in'; else if (focus) S.focus = { sel: `#insp-tab-${k}` };
  renderAll(); return true;
}
document.addEventListener('keydown', e => {   // Alt+1–5 (before the editor's keys; never in a dialog or a popped-out window)
  if (POP || e.isComposing || !e.altKey || e.ctrlKey || e.shiftKey || e.metaKey || !/^Digit[1-5]$/.test(e.code)) return;
  if (S.modal || UI.view !== 'notes' || UI.zen === 'on' || typeof SETUP !== 'undefined' && SETUP.open) return;
  const t = inspTabs(note()).find(x => x[3] === +e.code.slice(-1)); if (!t) return;
  e.preventDefault(); e.stopImmediatePropagation(); if (!e.repeat) inspTabGo(t[0], !!e.target.closest?.('#right-sidebar'));
}, true);
app.addEventListener('keydown', e => {   // ← → Home End in the strip
  const b = e.target.closest?.('#right-sidebar [role="tab"]'); if (!b || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
  const all = [...b.closest('[role="tablist"]').querySelectorAll('[role="tab"]')], i = all.indexOf(b);
  const j = e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + all.length) % all.length;
  e.preventDefault(); inspTabGo(all[j].dataset.v, true);
});
app.addEventListener('click', e => {   // the Ask tab clicked: its input takes the focus, as when the chat opens
  if (e.target.closest?.('#right-sidebar [data-act="tab"][data-v="ask"]')) AIC.focus = '#aic-in';
}, true);
// Settings → Keyboard shortcuts lists them (run here, not by shortcuts.js, so the number pad stays Windows')
KEYS.push(...INSP_TABS.map(([, l, , n]) => ({ g: 'win', l: `Right sidebar: ${l}`, k: ['Alt', String(n)] })),
  { g: 'win', l: 'Right sidebar: Ask (when the chat is docked)', k: ['Alt', '5'] });
/* ==== end Build N · the right sidebar's tabs ==== */
