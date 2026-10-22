/* =====================================================================
   BUILD J · THE WHOLE YEAR ON TIMER → INSIGHTS (mockup R37 "fit", locked 2026-10-16)
   53 weeks × 7 days (Monday first) with month and weekday labels, stretched to the card; under 640px it folds into two
   halves, January–June over July–December. A day's square both fills and darkens with its focus time, in fixed steps
   (under 30 min, 30 min–1 h, 1–2 h, 2 h or more), so colour is never the only cue. It opens on the past 12 months,
   like GitHub; the year picker also has the calendar years. Hover, focus or the arrow keys show a day's date, focus
   minutes and sessions; clicking a day opens History at that day. A key and the year's totals sit under it.
   On a real vault the days come from api.get_year_heatmap() (db.get_year_heatmap); on the sample vault they're
   counted from D.sessions the same way. render-timer.js calls yearCard() in place of the 12-week card.
   ===================================================================== */
'use strict';
const YH = { sel: 'past', tip: null, focus: null, cache: {}, wait: {}, days: null, scrollTo: null };
const YH_LVL = [[0, 'None'], [1, 'Under 30 min'], [2, '30 min–1 h'], [3, '1–2 h'], [4, '2 h or more']];
const YH_STEPS = [1800, 3600, 7200];   // db.HEAT_STEPS
const yhLvl = s => !s ? 0 : 1 + YH_STEPS.filter(x => s >= x).length;
const yhAdd = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const yhMonday = d => yhAdd(d, -((d.getDay() + 6) % 7));
const yhDay0 = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const yhParse = k => new Date(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10));
const MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const yhDate = (d, long) => d.toLocaleDateString('en-GB', long ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' } : { weekday: 'short', day: 'numeric', month: 'short' });
const yhSay = x => x.future ? `${yhDate(x.d, true)}: still to come` : `${yhDate(x.d, true)}: ${x.sec ? fmtDur(x.sec) + ' of focus, ' + x.n + ' session' + (x.n === 1 ? '' : 's') : 'no focus logged'}`;
const yhLive = () => D.live && !!api() && new URLSearchParams(location.search).get('check') !== '1';
const yhSessKey = () => `${D.sessions.length}|${D.sessions[0]?.id ?? ''}|${D.sessions[0]?.actual_seconds ?? ''}`;

// The days of the year shown, from the backend (a real vault) or counted from D.sessions (the sample): [{key, sec, n, future}]
function yhSource(sel) {
  const today = yhDay0(tNow());
  if (yhLive()) {
    const ck = sel + '|' + yhSessKey(), hit = YH.cache[ck];
    if (hit) return hit;
    if (!YH.wait[ck]) YH.wait[ck] = nv('get_year_heatmap', sel).then(r => {
      delete YH.wait[ck];
      if (!r || !Array.isArray(r.days)) { YH.cache[ck] = { error: true }; }
      else YH.cache[ck] = { sel, days: r.days.map(x => ({ key: x.date, sec: x.total_seconds, n: x.sessions, future: !!x.future })), years: r.years, from: r.from, to: r.to };
      if (UI.view === 'timer' && UI.tpage === 'insights') renderAll();
    });
    return null;
  }
  const from = sel === 'past' ? yhAdd(today, -364) : new Date(sel, 0, 1), to = sel === 'past' ? today : new Date(sel, 11, 31), by = {};
  D.sessions.forEach(s => { const b = by[s.start_time.slice(0, 10)] ||= [0, 0]; b[0] += s.actual_seconds; b[1]++; });
  const days = []; for (let d = new Date(from); d <= to; d = yhAdd(d, 1)) { const k = dayKey(d), f = d > today, v = f ? [0, 0] : by[k] || [0, 0]; days.push({ key: k, sec: v[0], n: v[1], future: f }); }
  const years = ['past', ...[...new Set([today.getFullYear(), ...D.sessions.map(s => +s.start_time.slice(0, 4))])].sort((a, b) => b - a)];
  return { sel, days, years, from: dayKey(from), to: dayKey(to) };
}
// The grid: each day's week column and weekday row, plus the totals (the same as db.get_year_heatmap's)
function yhData(src) {
  const from = yhParse(src.from), to = yhParse(src.to), m0 = yhMonday(from);
  const days = src.days.map(x => { const d = yhParse(x.key); return { ...x, d, w: Math.round((yhMonday(d) - m0) / 6048e5), dow: (d.getDay() + 6) % 7 }; });
  const past = days.filter(x => !x.future), act = past.filter(x => x.sec);
  let run = 0, best = 0; past.forEach(x => { run = x.sec ? run + 1 : 0; best = Math.max(best, run); });
  const top = act.reduce((a, x) => x.sec > (a?.sec || 0) ? x : a, null);
  return { days, weeks: (days[days.length - 1]?.w ?? 0) + 1, from, to, total: act.reduce((a, x) => a + x.sec, 0), sessions: act.reduce((a, x) => a + x.n, 0), active: act.length, sofar: past.length, streak: best, top };
}
const yhStep = (years, sel) => { const cal = years.filter(y => y !== 'past'), b = sel === 'past' ? tNow().getFullYear() + .5 : sel; return [cal.filter(y => y < b).sort((a, c) => c - a)[0] ?? null, cal.filter(y => y > b).sort((a, c) => a - c)[0] ?? null]; };
function yhCell(x, focusKey, extra = '') {
  return `<button class="yh-cell${x.future ? ' is-future' : ''}${extra}" data-act="hm-day" data-hd="${x.key}" data-lvl="${x.future ? 0 : yhLvl(x.sec)}" style="--w:${x.w};--d:${x.dow}" tabindex="${x.key === focusKey ? 0 : -1}" aria-label="${esc(yhSay(x))}"${x.key === dayKey(tNow()) ? ' aria-current="date"' : ''}${x.future ? ' aria-disabled="true"' : ''}></button>`;
}
function yearCard() {
  let src = yhSource(YH.sel);
  if (src && !src.error && YH.sel !== 'past' && !src.years.includes(YH.sel)) { YH.sel = 'past'; src = yhSource('past'); }
  const head = (title, pick) => `<div class="card-head"><div><h2 class="card-title">Focus · ${esc(title)}</h2><span class="card-sub">Each square is a day: the fuller and darker, the more focus. Hover or Tab to a day for its numbers.</span></div>${pick}</div>`;
  const loading = !src && YH.last;   // another year still loading: the last one stays (dimmed), so nothing jumps
  if (loading) src = YH.last;
  if (!src || src.error) return `<div class="card card-pad yh-card">${head(YH.sel === 'past' ? 'past 12 months' : String(YH.sel), '')}${src?.error ? `<div class="yh-empty">${ic('alert')}<span>The year couldn't be loaded. Try again from another page.</span></div>` : '<div class="skel yh-skel"></div>'}</div>`;
  if (!loading) YH.last = src;
  const Y = yhData(src), sel = loading ? src.sel : YH.sel, today = dayKey(tNow()); YH.days = Y.days;
  const focusKey = YH.focus && Y.days.some(x => x.key === YH.focus && !x.future) ? YH.focus : (Y.days.find(x => x.key === today) || [...Y.days].reverse().find(x => !x.future) || Y.days[0])?.key;
  const title = sel === 'past' ? `${MON3[Y.from.getMonth()]} ${Y.from.getFullYear()} – ${MON3[Y.to.getMonth()]} ${Y.to.getFullYear()}` : String(sel);
  const [prevY, nextY] = yhStep(src.years, sel);
  const pick = `<div class="yh-pick" role="group" aria-label="Year"><button class="icon-btn" data-act="hm-prev" aria-label="Earlier year" title="Earlier year"${prevY == null ? ' disabled' : ''}>${ic('left')}</button>
    <select class="field yh-year" data-act="hm-year" aria-label="Year to show">${src.years.map(y => `<option value="${y}"${y === sel ? ' selected' : ''}>${y === 'past' ? 'Past 12 months' : y}</option>`).join('')}</select>
    <button class="icon-btn" data-act="hm-next" aria-label="Later year" title="Later year"${nextY == null ? ' disabled' : ''}>${ic('right')}</button></div>`;
  // month labels over the week that holds the 1st; weekday labels Mon, Wed, Fri; a second set for the folded half
  const mons = Y.days.filter((x, i) => x.d.getDate() === 1 || i === 0), firstH2 = Y.days.find(x => x.w === 27), h2 = x => x.w >= 27 ? ' yh-h2' : '';
  const wd = second => [[0, 'Mon'], [2, 'Wed'], [4, 'Fri']].map(([d, l]) => `<span class="yh-wd${second ? ' yh-wd--h2' : ''}" style="--d:${d}" aria-hidden="true">${l}</span>`).join('');
  const labels = mons.map(x => `<span class="yh-mon${h2(x)}${x.w === 26 ? ' yh-mon--h1end' : ''}" style="--w:${x.w}" aria-hidden="true">${MON3[x.d.getMonth()]}</span>`).join('')
    + (firstH2 && !mons.some(x => x.w === 27 || x.w === 28) ? `<span class="yh-mon yh-mon--h2" aria-hidden="true">${MON3[firstH2.d.getMonth()]}</span>` : '');
  const grid = `<div class="yh-grid" role="group" aria-label="Focus per day, ${esc(title)}. Arrow keys move between days." style="--weeks:${Y.weeks}">${labels}${wd(false)}${wd(true)}<span class="yh-split" aria-hidden="true"></span>${Y.days.map(x => yhCell(x, focusKey, h2(x))).join('')}</div>`;
  const empty = !Y.active ? `<div class="yh-empty">${ic('timer')}<span>${D.sessions.length ? 'No focus logged in this stretch.' : `Nothing logged ${sel === 'past' ? 'in the past 12 months' : 'in ' + sel} yet. Each day you focus fills in a square.`}</span></div>` : '';
  const stats = `<div class="yh-stats"><span><b>${fmtHours(Y.total)}</b> of focus</span><span><b>${Y.sessions.toLocaleString('en-GB')}</b> session${Y.sessions === 1 ? '' : 's'}</span><span><b>${Y.active}</b> of ${Y.sofar} days</span><span>Longest run <b>${Y.streak} day${Y.streak === 1 ? '' : 's'}</b></span>${Y.top ? `<span>Best day <b>${yhDate(Y.top.d)}</b>, ${fmtDur(Y.top.sec)}</span>` : ''}</div>`;
  const legend = `<div class="yh-legend" aria-label="Key">${YH_LVL.map(([l, t]) => `<span><span class="yh-cell" data-lvl="${l}" aria-hidden="true"></span>${t}</span>`).join('')}${Y.days.some(x => x.future) ? '<span><span class="yh-cell is-future" aria-hidden="true"></span>To come</span>' : ''}</div>`;
  return `<div class="card card-pad yh-card yh--fit${loading ? ' is-loading' : ''}"${loading ? ' aria-busy="true"' : ''}>${head(title, pick)}<div class="yh-wrap">${empty}${grid}</div><div class="yh-foot">${stats}${legend}</div><div class="card yh-tip" role="tooltip" id="yh-tip" hidden></div></div>`;
}
function yhShowTip(key) {
  const tip = app.querySelector('#yh-tip'), cell = key && app.querySelector(`.yh-card [data-hd="${key}"]`), x = YH.days?.find(d => d.key === key);
  if (!tip) return; if (!cell || !x) { tip.hidden = true; YH.tip = null; return; }
  YH.tip = key; tip.innerHTML = `<b>${esc(yhDate(x.d, true))}</b><span>${x.future ? 'Still to come' : x.sec ? `${fmtDur(x.sec)} of focus · ${x.n} session${x.n === 1 ? '' : 's'}` : 'No focus logged'}</span>`; tip.hidden = false;
  const card = tip.parentElement, z = card.getBoundingClientRect().width / card.offsetWidth || 1, cr = card.getBoundingClientRect(), r = cell.getBoundingClientRect();
  const left = (r.left - cr.left) / z + r.width / z / 2 - tip.offsetWidth / 2, top = (r.top - cr.top) / z - tip.offsetHeight - 8;
  tip.style.left = clamp(left, 8, card.offsetWidth - tip.offsetWidth - 8) + 'px'; tip.style.top = (top < 0 ? (r.bottom - cr.top) / z + 8 : top) + 'px';
}
// Clicking a day: History opens at that day (render-timer.js shows it from there, marked)
function yhOpenDay(x) {
  YH.focus = x.key;
  if (!x.n) { status(`${yhDate(x.d, true)}: no focus logged`); yhShowTip(x.key); return; }
  S.histDay = x.key; YH.scrollTo = x.key; UI.tpage = 'history'; status(`History at ${yhDate(x.d, true)}`); renderAll();
}
const yhAfter = afterRender;
afterRender = function () {   // eslint-disable-line no-global-assign
  yhAfter();
  if (YH.tip && app.querySelector('.yh-card')) yhShowTip(YH.tip);
  if (YH.scrollTo && UI.tpage === 'history') { const k = YH.scrollTo; YH.scrollTo = null;   // after renderAll puts the scroll bars back
    setTimeout(() => { const h = app.querySelector(`[data-hist-day="${k}"]`); if (h) { h.scrollIntoView({ block: 'start' }); h.querySelector('.day-head')?.focus({ preventScroll: true }); } }); }
};
document.getElementById('app').addEventListener('click', e => {
  const t = e.target.closest('[data-act]'); if (!t) return; const act = t.dataset.act;
  if (act === 'hm-prev' || act === 'hm-next') { const src = yhSource(YH.sel), y = src && yhStep(src.years, YH.sel)[act === 'hm-prev' ? 0 : 1]; if (y != null) { YH.sel = y; YH.tip = null; YH.focus = null; S.focus = { sel: `[data-act="${act}"]` }; renderAll(); if (app.querySelector(`[data-act="${act}"]`)?.disabled) app.querySelector('.yh-year')?.focus(); } }
  if (act === 'hm-day') { const x = YH.days?.find(y => y.key === t.dataset.hd); if (x && !x.future) yhOpenDay(x); }
  if (act === 'tpage') S.histDay = null;   // another Timer page: History opens at the top next time
  if (act === 'hist-back') { S.histDay = null; UI.tpage = 'insights'; renderAll(); }
});
document.getElementById('app').addEventListener('change', e => { if (e.target.dataset?.act === 'hm-year') { const v = e.target.value; YH.sel = v === 'past' ? 'past' : +v; YH.tip = null; YH.focus = null; S.focus = { sel: '.yh-year' }; renderAll(); } });
document.getElementById('app').addEventListener('keydown', e => {
  if (!e.target.classList?.contains('yh-cell') || !/^Arrow|^Home$|^End$|^Enter$|^ $/.test(e.key)) return;   // one Tab stop; arrows move a day or a week
  e.preventDefault(); const days = YH.days || [], i = days.findIndex(x => x.key === e.target.dataset.hd);
  if (e.key === 'Enter' || e.key === ' ') { const x = days[i]; if (x && !x.future) yhOpenDay(x); return; }
  const step = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 }[e.key], j = step != null ? clamp(i + step, 0, days.length - 1) : e.key === 'Home' ? 0 : days.length - 1;
  const x = days[j]; if (!x) return; app.querySelectorAll('.yh-card .yh-cell[tabindex="0"]').forEach(c => { c.tabIndex = -1; });
  const c = app.querySelector(`.yh-card [data-hd="${x.key}"]`); if (c) { c.tabIndex = 0; c.focus(); YH.focus = x.key; yhShowTip(x.key); }
});
document.getElementById('app').addEventListener('mouseover', e => { const c = e.target.closest?.('.yh-card [data-hd]'); if (c) yhShowTip(c.dataset.hd); });
document.getElementById('app').addEventListener('mouseout', e => { const c = e.target.closest?.('.yh-card [data-hd]'); if (c && !e.relatedTarget?.closest?.('.yh-card [data-hd]')) { const tip = app.querySelector('#yh-tip'); if (tip && document.activeElement?.dataset?.hd !== c.dataset.hd) { tip.hidden = true; YH.tip = null; } } });
document.getElementById('app').addEventListener('focusin', e => { const c = e.target.closest?.('.yh-card [data-hd]'); if (c) yhShowTip(c.dataset.hd); });
/* ===================================================================== end Build J · year */
