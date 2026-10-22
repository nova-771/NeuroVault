/* BUILD G · R33 (locked 2026-10-16): accent colours chosen for each theme, any colour as the accent, a plain line when a colour
   is hard to see (with the nearest shade that isn't), and Colour vision. Extracted from design/vault-notes-mockups.html at R33
   (0acdaa5): THEME_COL, ACCENTS (here ACCENT_SETS), the colour maths, accentTokens, accentCheck, accentFix, accNote, accPicker,
   accRow, accInput, CVD, cvSample and cvRow. Your answers: a custom colour follows you to the other themes, shaded to stand out
   on each (it stays exactly as you chose it on the theme you chose it on); the contrast line is one plain sentence and one
   button; Colour vision ships Off, Red–green and Blue–yellow.
   Saved in config.json (config.py checks each): accent {theme: id | "custom"}, accent_custom "#rrggbb", accent_custom_theme,
   colour_vision off | rg | tri. reading.js puts the rows in the Theme card and resets them. */
'use strict';
// bg, card and panel of each theme: tokens.css's own (the check measures that they match what the page draws)
const THEME_COL = { obsidian: ['#16161a', '#23232b', '#1c1c22'], slate: ['#1e2024', '#2a2d33', '#23262b'], cream: ['#f6efdf', '#faf5e8', '#eee5cf'], sage: ['#e7efe3', '#f0f5ed', '#dce7d7'],
  sky: ['#e4edf5', '#eef4f9', '#d8e3ee'], buttercup: ['#f7f0cf', '#fbf7e2', '#efe6bd'], paper: ['#f6f5f2', '#ffffff', '#f0efea'], sepia: ['#f4ecd8', '#fbf6ea', '#ece2c9'], contrast: ['#000000', '#121212', '#0b0b0b'] };
// 6–8 per theme, each picked to suit it: violet first (today's accent), then hues that sit well with the theme's own colours.
// Every one passes as it is: 3:1 or more against the page, card and sidebar, 4.5:1 for text on it, and its text shade 4.5:1 everywhere.
// config.py's ACCENT_SETS has the same ids in the same order (test_api checks).
const ACCENT_SETS = {
  obsidian: [['violet', 'Violet', '#a29bfe'], ['blue', 'Blue', '#7aa7ff'], ['cyan', 'Cyan', '#22d3ee'], ['teal', 'Teal', '#2dd4bf'], ['green', 'Green', '#4ade80'], ['amber', 'Amber', '#fbbf24'], ['coral', 'Coral', '#fb8a6b'], ['pink', 'Pink', '#f472b6']],
  slate: [['violet', 'Violet', '#a29bfe'], ['sand', 'Sand', '#d9b97a'], ['terracotta', 'Terracotta', '#e8916b'], ['sage', 'Sage', '#9cc69a'], ['steel', 'Steel blue', '#8fb8e8'], ['rose', 'Rose', '#ef9ab0'], ['teal', 'Teal', '#2dd4bf']],
  cream: [['violet', 'Violet', '#5b4ae6'], ['terracotta', 'Terracotta', '#b4532a'], ['olive', 'Olive', '#5c6b12'], ['teal', 'Teal', '#0f766e'], ['indigo', 'Indigo', '#4338ca'], ['plum', 'Plum', '#86198f'], ['brown', 'Brown', '#8a4b1f']],
  sage: [['violet', 'Violet', '#5b4ae6'], ['forest', 'Forest', '#1f6b3a'], ['teal', 'Teal', '#0f766e'], ['navy', 'Navy', '#1e3a8a'], ['plum', 'Plum', '#86198f'], ['rust', 'Rust', '#a63d14'], ['berry', 'Berry', '#9d1b54']],
  sky: [['violet', 'Violet', '#5b4ae6'], ['navy', 'Navy', '#1e3a8a'], ['teal', 'Teal', '#0f766e'], ['berry', 'Berry', '#9d1b54'], ['rust', 'Rust', '#a63d14'], ['indigo', 'Indigo', '#4338ca'], ['graphite', 'Graphite', '#4b5563']],
  buttercup: [['violet', 'Violet', '#5b4ae6'], ['bronze', 'Bronze', '#7c5a12'], ['indigo', 'Indigo', '#4338ca'], ['forest', 'Forest', '#1f6b3a'], ['crimson', 'Crimson', '#b4182e'], ['teal', 'Teal', '#0f766e'], ['plum', 'Plum', '#86198f']],
  paper: [['violet', 'Violet', '#5b4ae6'], ['blue', 'Blue', '#2463d6'], ['teal', 'Teal', '#0f766e'], ['green', 'Green', '#15803d'], ['orange', 'Orange', '#b45309'], ['crimson', 'Crimson', '#b4182e'], ['pink', 'Pink', '#be185d'], ['graphite', 'Graphite', '#4b5563']],
  sepia: [['violet', 'Violet', '#5b4ae6'], ['rust', 'Rust', '#a63d14'], ['olive', 'Olive', '#5c6b12'], ['teal', 'Teal', '#0f766e'], ['brown', 'Brown', '#8a4b1f'], ['plum', 'Plum', '#86198f'], ['navy', 'Navy', '#1e3a8a']],
  contrast: [['lavender', 'Lavender', '#c4b5fd'], ['yellow', 'Yellow', '#ffd23f'], ['cyan', 'Cyan', '#22d3ee'], ['lime', 'Lime', '#a3e635'], ['pink', 'Pink', '#f472b6'], ['orange', 'Orange', '#fb923c'], ['sky', 'Sky', '#7cc8ff']] };
const CVD = [['off', 'Off'], ['rg', 'Red–green'], ['tri', 'Blue–yellow']];
// picks: {theme: id | 'custom'}; custom: '#rrggbb' or ''; customTheme: where it was chosen; open: the picker; draft: a hex being typed that isn't one yet
const AC = { picks: {}, custom: '', customTheme: '', cvd: 'off', open: false, draft: null, saveT: null, memo: new Map() };

/* ---- Colour maths: WCAG contrast, and HSL to shade one colour lighter or darker ---- */
const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const rgbHex = c => '#' + c.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const hexLum = h => { const [r, g, b] = hexRgb(h).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * r + .7152 * g + .0722 * b; };
const cRatio = (a, b) => { const x = hexLum(a), y = hexLum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
const mixHex = (a, b, t) => rgbHex(hexRgb(a).map((v, i) => v * (1 - t) + hexRgb(b)[i] * t));
function shadeHex(hex, dl) {
  let [r, g, b] = hexRgb(hex).map(v => v / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b); let h = 0, sa = 0, l = (mx + mn) / 2;
  if (mx !== mn) { const d = mx - mn; sa = l > .5 ? d / (2 - mx - mn) : d / (mx + mn); h = (mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4) / 6; }
  l = Math.max(0, Math.min(1, l + dl)); if (!sa) return rgbHex([l * 255, l * 255, l * 255]);
  const q = l < .5 ? l * (1 + sa) : l + sa - l * sa, pp = 2 * l - q, f = t => { t = (t + 1) % 1; return t < 1 / 6 ? pp + (q - pp) * 6 * t : t < .5 ? q : t < 2 / 3 ? pp + (q - pp) * (2 / 3 - t) * 6 : pp; };
  return rgbHex([f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255]);
}
const darkTheme = th => DARK_THEMES.includes(th);
const accMemo = (k, fn) => { if (!AC.memo.has(k)) { if (AC.memo.size > 400) AC.memo.clear(); AC.memo.set(k, fn()); } return AC.memo.get(k); };
// one colour in, the accent tokens out: fill, tint, text shade (4.5:1 on page, card, sidebar and the tint), the colour for text on it, and hover
function accentTokens(hex, th) {
  return accMemo(`t${hex}${th}`, () => {
    const [bg, card, panel] = THEME_COL[th], dark = darkTheme(th), on = cRatio(hex, '#ffffff') >= cRatio(hex, '#16161a') ? '#ffffff' : '#16161a';
    const tint = mixHex(card, hex, dark ? .2 : .13); let text = hex;
    for (let i = 0; i < 200 && Math.min(...[bg, card, panel, tint].map(x => cRatio(text, x))) < 4.5; i++) text = shadeHex(text, dark ? .005 : -.005);
    return { accent: hex, bg: tint, text, on, hover: shadeHex(hex, dark ? .06 : -.06) };
  });
}
function accentCheck(hex, th) { const [bg, card, panel] = THEME_COL[th], t = accentTokens(hex, th);
  return { ...t, ui: Math.min(cRatio(hex, bg), cRatio(hex, card), cRatio(hex, panel)), btn: cRatio(t.on, hex), txt: Math.min(...[bg, card, panel, t.bg].map(x => cRatio(t.text, x))) }; }
const accentOk = c => c.ui >= 3 && c.btn >= 4.5 && c.txt >= 4.5;
function accentFix(hex, th) {   // the nearest passing shade: same hue, a little darker on light themes, lighter on dark ones
  return accMemo(`f${hex}${th}`, () => { const dir = darkTheme(th) ? 1 : -1; for (let i = 1; i <= 400; i++) { const x = shadeHex(hex, dir * i / 400); if (accentOk(accentCheck(x, th))) return x; } return null; });
}
const accHexOk = v => /^#[0-9a-f]{6}$/i.test(v);

/* ---- The accent on each theme ---- */
const accTheme = () => THEME_COL[READER.theme] ? READER.theme : 'obsidian';
const accDefault = th => ACCENT_SETS[th][0][0];
const accPick = th => { const p = AC.picks[th]; return p === 'custom' && AC.custom ? 'custom' : ACCENT_SETS[th].some(a => a[0] === p) ? p : accDefault(th); };
// your colour on a theme: as you chose it on the theme you chose it on; on the others, shaded to stand out if it doesn't already
const accCustomOn = th => !AC.custom || th === AC.customTheme || accentOk(accentCheck(AC.custom, th)) ? AC.custom : accentFix(AC.custom, th) || AC.custom;
const accentHex = th => accPick(th) === 'custom' ? accCustomOn(th) : ACCENT_SETS[th].find(a => a[0] === accPick(th))[2];
const accentName = th => accPick(th) === 'custom' ? 'Custom ' + accentHex(th) : ACCENT_SETS[th].find(a => a[0] === accPick(th))[1];
const themeName = th => THEMES.find(t => t[0] === th)?.[1] || 'this theme';
function applyAccent() {
  let st = document.getElementById('nv-accent'); if (!st) { st = document.createElement('style'); st.id = 'nv-accent'; document.head.appendChild(st); }
  const th = accTheme(), t = accentTokens(accentHex(th), th);
  const css = `body .app.app.app { --accent: ${t.accent}; --accent-bg: ${t.bg}; --accent-text: ${t.text}; --on-accent: ${t.on}; --accent-hover: ${t.hover}; }`;
  if (st.textContent !== css) st.textContent = css;
  document.body.dataset.cvd = AC.cvd;
  READER.accent = accPick(th);
}
function accSave(now) {   // the accent keys in one patch; typing waits a moment so every key press isn't a save
  clearTimeout(AC.saveT);
  const go = () => saveSettings({ accent: { ...AC.picks }, accent_custom: AC.custom, accent_custom_theme: AC.customTheme });
  if (now) go(); else AC.saveT = setTimeout(go, 400);
}
function accSetCustom(hex, now) {   // a colour you chose: it's your accent on every theme, exactly as chosen on this one
  const th = accTheme(); AC.custom = hex.toLowerCase(); AC.customTheme = th; AC.draft = null;
  Object.keys(THEME_COL).forEach(t => { AC.picks[t] = 'custom'; }); applyAccent(); accSave(now);
}

/* ---- The Theme card's rows: accent chips, Custom… with its picker, the contrast line, Colour vision with its samples ---- */
function accNote(hex, th, always) {   // one plain line: hard to see, and one button for the nearest shade that isn't; or, with the picker open, that it stands out
  const c = accentCheck(hex, th), name = themeName(th), nums = `${c.ui.toFixed(1)}:1 against the page (needs 3:1) · ${c.btn.toFixed(1)}:1 for text on it (needs 4.5:1)`;
  if (accentOk(c)) {
    if (!always) return '';
    const shaded = accPick(th) === 'custom' && AC.custom && th !== AC.customTheme && hex !== AC.custom;
    return `<div class="alert alert--success acc-note" role="status" title="${nums}">${ic('ok')}<span>${shaded ? `Shaded to ${hex} so it stands out on ${name}.` : `Stands out well on ${name}.`}</span></div>`;
  }
  const fix = accentFix(hex, th), way = darkTheme(th) ? 'lighter' : 'darker';
  return `<div class="alert alert--warning acc-note" role="status" title="${nums}">${ic('alert')}<span>${c.ui < 3 ? `This colour is hard to see on ${name}.` : `Text on this colour is hard to read on ${name}.`}</span>`
    + `${fix ? `<button class="btn btn--secondary btn--sm" data-act="acc-fix" data-v="${fix}" title="Use ${fix}: the nearest shade that stands out"><span class="proj-dot" style="--proj:${fix}"></span>Use a ${way} shade</button>` : ''}</div>`;
}
function accPicker(th) {   // a colour box and a hex field
  const hex = AC.draft ?? (AC.custom || accentHex(th)), ok = accHexOk(hex), shown = ok && hex.toLowerCase() === AC.custom && th !== AC.customTheme ? accentHex(th) : hex.toLowerCase();
  return `<div class="acc-custom"><input type="color" class="acc-color" data-act="acc-color" value="${ok ? hex.toLowerCase() : '#000000'}" aria-label="Pick any colour">`
    + `<input class="field acc-hex" id="acc-hex" data-act="acc-hex" value="${esc(hex)}" maxlength="7" spellcheck="false" autocomplete="off" aria-label="Colour as a hex code"${ok ? '' : ' aria-invalid="true"'}>`
    + `<div class="acc-note-slot">${ok ? accNote(shown, th, true) : '<div class="field-error">Type # and six digits or letters a–f, like #0e7490</div>'}</div></div>`;
}
function accRow() {
  const th = accTheme(), cur = accPick(th), cus = AC.custom ? accCustomOn(th) : '';
  const chips = ACCENT_SETS[th].map(([id, name, hex]) => `<button class="pick acc-pick" data-act="acc-pick" data-v="${id}" aria-pressed="${cur === id}" style="--proj:${hex}"><span class="proj-dot"></span><span>${name}</span></button>`).join('')
    + `<button class="pick acc-pick acc-custom-pick" data-act="acc-custom" aria-pressed="${cur === 'custom'}" aria-expanded="${AC.open}"${cus ? ` style="--proj:${cus}"` : ''}><span class="proj-dot${cus ? '' : ' acc-any'}"></span><span>${cus ? 'Custom · ' + cus : 'Custom…'}</span></button>`;
  const note = AC.open ? accPicker(th) : `<div class="acc-note-slot">${accNote(accentHex(th), th, false)}</div>`;   // closed: the line shows only when the colour is hard to see
  return `<div class="set-row cf-row acc-row"><div class="cf-row-text"><div class="set-label" id="cf-accent">Accent colour</div><div class="set-desc">Buttons, switches, links and what’s selected. Each is picked to stand out on ${themeName(th)}</div></div><div class="acc-picks" role="group" aria-labelledby="cf-accent">${chips}</div>${note}</div>`;
}
const cvSample = () => `<div class="cv-sample" role="group" aria-label="How state colours look"><span class="cv-item"><span class="eyebrow">Voice check</span><span class="anchor">Friday</span><span class="anchor is-missing">£450</span></span>`
  + `<span class="cv-item"><span class="eyebrow">Energy</span>${energyChip({ energy: 'high' }, true)}${energyChip({ energy: 'low' }, true)}</span>`
  + `<span class="cv-item"><span class="eyebrow">Sync</span><span class="chip chip--success">Synced</span><span class="chip chip--warning">Syncing…</span><span class="chip chip--danger">Not synced</span></span>`
  + `<span class="cv-item"><span class="eyebrow">Save</span><span class="cv-dots"><span><span class="status-dot"></span>Saved</span><span><span class="status-dot is-busy"></span>Saving</span><span><span class="status-dot is-error"></span>Failed</span></span></span>`
  + `<span class="cv-item"><span class="eyebrow">Time left</span>${['calm', 'warm', 'low'].map((b, i) => `<span class="qt-bar" data-band="${b}" role="img" aria-label="${['Plenty', 'Getting low', 'Nearly up'][i]}"><span style="width:${[78, 38, 12][i]}%"></span></span>`).join('')}</span></div>`;
const cvRow = () => cfRow('cf-cvd', 'Colour vision', 'Changes the ready, needs-a-look and problem colours, and adds a shape to each, so nothing is told by colour alone',
  `<div class="seg" role="group" aria-labelledby="cf-cvd">${CVD.map(([v, l]) => `<button class="seg-opt" data-act="set-cvd" data-v="${v}" aria-pressed="${AC.cvd === v}">${l}</button>`).join('')}</div>`, ' cf-row--seg cv-row') + cvSample();
// the voice check's legend says Found and Missing once the colours change
const cvLegend = () => AC.cvd === 'off' ? '<span><span class="anchor">Green</span> found in both</span><span><span class="anchor is-missing">Amber</span> said, but missing from the clean version</span>'
  : '<span><span class="anchor">Found</span> in both</span><span><span class="anchor is-missing">Missing</span> said, but not in the clean version</span>';

/* ---- Into the app ---- */
const _applyReaderG = applyReader;
applyReader = function () { _applyReaderG(); applyAccent(); };
const _readerFromConfigG = readerFromConfig;
readerFromConfig = function (c) {
  _readerFromConfigG(c);
  if (c.accent && typeof c.accent === 'object' && !Array.isArray(c.accent)) AC.picks = Object.fromEntries(Object.entries(c.accent).filter(([th, a]) => ACCENT_SETS[th] && (a === 'custom' || ACCENT_SETS[th].some(x => x[0] === a))));
  if (c.accent_custom === '' || accHexOk(c.accent_custom || '')) AC.custom = (c.accent_custom || '').toLowerCase();
  if (c.accent_custom_theme === '' || THEME_COL[c.accent_custom_theme]) AC.customTheme = c.accent_custom_theme || '';
  if (CVD.some(([v]) => v === c.colour_vision)) AC.cvd = c.colour_vision;
};
function accInput(t, act) {   // the custom accent follows as you type or drag, without a re-draw that would close the colour window
  const th = accTheme(), box = t.closest('.acc-custom'), v = act === 'acc-color' ? t.value : (t.value.startsWith('#') ? t.value : '#' + t.value).toLowerCase();
  if (act === 'acc-hex' && v !== t.value) { const pos = t.selectionStart + 1; t.value = v; t.setSelectionRange(pos, pos); }
  const ok = accHexOk(v); AC.draft = ok ? null : v;
  if (ok) accSetCustom(v, false);
  if (act === 'acc-color') box.querySelector('.acc-hex').value = v; else if (ok) box.querySelector('.acc-color').value = v.toLowerCase();
  const hx = box.querySelector('.acc-hex'); if (ok) hx.removeAttribute('aria-invalid'); else hx.setAttribute('aria-invalid', 'true');
  box.querySelector('.acc-note-slot').innerHTML = ok ? accNote(v.toLowerCase(), th, true) : '<div class="field-error">Type # and six digits or letters a–f, like #0e7490</div>';
  const pick = app.querySelector('.acc-custom-pick'); if (ok && pick) { pick.style.setProperty('--proj', v); pick.lastElementChild.textContent = 'Custom · ' + v.toLowerCase(); pick.firstElementChild.classList.remove('acc-any'); pick.setAttribute('aria-pressed', 'true'); app.querySelectorAll('.acc-pick:not(.acc-custom-pick)').forEach(b => b.setAttribute('aria-pressed', 'false')); }
}
function accAct(act, v) {
  const th = accTheme();
  if (act === 'acc-pick') { if (v === accDefault(th)) delete AC.picks[th]; else AC.picks[th] = v; applyAccent(); accSave(true); status(`Accent: ${accentName(th)}`); S.focus = { sel: `[data-act="acc-pick"][data-v="${v}"]` }; renderAll(); return; }
  if (act === 'acc-custom') {
    if (AC.open && accPick(th) === 'custom') { AC.open = false; S.focus = { sel: '.acc-custom-pick' }; }
    else { AC.open = true; if (AC.custom) { AC.picks[th] = 'custom'; applyAccent(); accSave(true); } S.focus = { sel: '#acc-hex', select: true }; }
    AC.draft = null; renderAll(); return;
  }
  if (act === 'acc-fix') { accSetCustom(v, true); status(`Accent: ${v}`); S.focus = { sel: AC.open ? '#acc-hex' : '.acc-custom-pick' }; renderAll(); return; }
  if (act === 'set-cvd') { AC.cvd = v; applyAccent(); saveSettings({ colour_vision: v }); status(`Colour vision: ${CVD.find(c => c[0] === v)[1]}`); S.focus = { sel: `[data-act="set-cvd"][data-v="${v}"]` }; renderAll(); }
}
app.addEventListener('click', e => {
  const t = e.target.closest('[data-act]'); if (!t || t.disabled) return;
  if (['acc-pick', 'acc-custom', 'acc-fix', 'set-cvd'].includes(t.dataset.act)) accAct(t.dataset.act, t.dataset.v);
});
app.addEventListener('input', e => { const act = e.target.dataset?.act; if (act === 'acc-color' || act === 'acc-hex') accInput(e.target, act); });
app.addEventListener('change', e => {   // done typing or picking: save now and draw the row again
  const act = e.target.dataset?.act; if (act !== 'acc-color' && act !== 'acc-hex') return;
  if (!AC.draft) accSave(true); S.focus = { sel: act === 'acc-hex' ? '#acc-hex' : '.acc-color' }; renderAll();
});
app.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'acc-hex') { e.preventDefault(); e.target.dispatchEvent(new Event('change', { bubbles: true })); } });   // Enter keeps you in the field
