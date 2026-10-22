/* ==== Build M · QC 95: the page's errors and long stalls go into the app log (neurovault.log / trial.log), so the next hiccup
   leaves a trace. The user's ultrawide stall (a note dragged into split view) left nothing: Python was fine and the page didn't
   reload. Loaded second (after mute.js), before anything else can fail.
   - window.onerror and unhandledrejection: the message and where (file:line, the view, how many panes, the window size).
   - A long stall: a frame (or a task) that held the page for over a second, with what ran in it when the browser says.
   - Never note text: only error messages, file names and numbers; long quoted runs are cut here and again in api.py.
   - At most 10 a minute from here, the same line only once a minute; api.log_client also rate-limits. ==== */
'use strict';
const LOG95 = { q: [], times: [], seen: new Map(), off: false };
const log95Clean = s => String(s ?? '').replace(/\s+/g, ' ').replace(/(["'“‘`])[^"'”’`]{24,}["'”’`]/g, '$1…$1').trim().slice(0, 300);
function log95Ctx() {   // where the app was: no note text, only the view, the panes and the window
  try {
    const bits = [];
    if (typeof UI !== 'undefined') bits.push('view ' + UI.view + (UI.zen === 'on' ? ' (zen)' : ''));
    if (typeof pnAll === 'function') { const n = pnAll().length; if (n > 1) bits.push(n + ' panes'); }
    if (typeof PN !== 'undefined' && PN.drag) bits.push('dragging ' + (PN.drag.v || (PN.drag.tab ? 'a note tab' : 'a note')));
    if (typeof S !== 'undefined' && S.a11y) bits.push('page width ' + S.a11y.width);
    bits.push(innerWidth + '×' + innerHeight + (devicePixelRatio !== 1 ? ' @' + devicePixelRatio : ''));
    return bits.join(' · ');
  } catch (e) { return innerWidth + '×' + innerHeight; }
}
function log95(level, message, where) {
  if (LOG95.off) return false;
  const msg = log95Clean(message), at = log95Clean(where).slice(0, 160); if (!msg) return false;
  const now = Date.now(), key = msg + '@' + at;
  LOG95.times = LOG95.times.filter(t => now - t < 60000);
  if (LOG95.times.length >= 10 || now - (LOG95.seen.get(key) || -1e9) < 60000) return false;
  LOG95.times.push(now); LOG95.seen.set(key, now); if (LOG95.seen.size > 200) LOG95.seen.clear();
  const a = window.pywebview?.api;
  if (a?.log_client) { try { Promise.resolve(a.log_client(level, msg, at)).catch(() => {}); } catch (e) { /* never a loop */ } }
  else if (LOG95.q.length < 10) LOG95.q.push([level, msg, at]);   // the bridge isn't up yet: sent when it is
  return true;
}
function log95Flush() { const a = window.pywebview?.api; if (!a?.log_client) return; LOG95.q.splice(0).forEach(([l, m, w]) => { try { Promise.resolve(a.log_client(l, m, w)).catch(() => {}); } catch (e) { /* ignore */ } }); }
window.addEventListener('pywebviewready', log95Flush);
setTimeout(log95Flush, 3000);   // the dev bridge has no ready event
const log95Where = (src, line, col, stack) => {
  const frames = [...String(stack || '').matchAll(/([\w.-]+\.js):(\d+):(\d+)/g)].slice(0, 3).map(m => `${m[1]}:${m[2]}`);
  const first = src ? `${String(src).split(/[\\/]/).pop().split('?')[0]}:${line || 0}:${col || 0}` : '';
  return [...new Set([first, ...frames].filter(Boolean))].join(' < ');
};
window.addEventListener('error', e => {
  if (!e.message && e.target && e.target !== window) return;   // a missing image or font: not a page error
  log95('error', e.message || 'Script error', `${log95Where(e.filename, e.lineno, e.colno, e.error?.stack)} · ${log95Ctx()}`);
});
window.addEventListener('unhandledrejection', e => {
  const r = e.reason, m = r instanceof Error ? `${r.name}: ${r.message}` : typeof r === 'string' ? r : r?.message || 'a promise failed';
  log95('error', 'Unhandled: ' + m, `${log95Where('', 0, 0, r?.stack)} · ${log95Ctx()}`);
});
// Long stalls: the browser's long-animation-frame entries say what ran (WebView2 has them); long tasks where it doesn't
const LOG95_STALL = 1000;
function log95Stall(ms, what) { log95('warn', `The page stalled for ${(ms / 1000).toFixed(1)} s`, `${what ? what + ' · ' : ''}${log95Ctx()}`); }
try {
  const types = PerformanceObserver.supportedEntryTypes || [];
  if (types.includes('long-animation-frame')) new PerformanceObserver(l => l.getEntries().forEach(f => {
    if (f.duration < LOG95_STALL || document.visibilityState !== 'visible') return;
    const top = [...(f.scripts || [])].sort((a, b) => b.duration - a.duration).slice(0, 2)
      .map(s => `${s.invoker || s.invokerType || 'script'}${s.sourceURL ? ' ' + s.sourceURL.split(/[\\/]/).pop().split('?')[0] + (s.sourceCharPosition >= 0 ? '@' + s.sourceCharPosition : '') : ''} ${Math.round(s.duration)} ms`);
    const layout = Math.round(f.duration - (f.scripts || []).reduce((a, s) => a + s.duration, 0));
    log95Stall(f.duration, [...top, `style and layout ${layout} ms`].join(', '));
  })).observe({ type: 'long-animation-frame', buffered: false });
  else if (types.includes('longtask')) new PerformanceObserver(l => l.getEntries().forEach(t => { if (t.duration >= LOG95_STALL && document.visibilityState === 'visible') log95Stall(t.duration, 'a long task'); })).observe({ type: 'longtask', buffered: false });
} catch (e) { /* an old engine: errors are still logged */ }
/* ==== end Build M · QC 95 ==== */
