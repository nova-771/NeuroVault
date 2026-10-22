/* BUILD E · Settings → Reading & comfort as R31's "Cards with presets, a sample inside each card" (locked 2026-10-16),
   More fonts (download, use, remove), your own font, and Reset to defaults with Undo.
   Extracted from design/vault-notes-mockups.html at R32 (f6bd3e9): comfortCards ('dense'), cfCards, cfCard, cfRow, cfSeg,
   cfToggle, cfPreset, cfPreview, cfSums, cfFonts, fontBad, fontPicker, fontAct, CF_SECS, CF_PRESETS, TEXT_SIZES; Reset is
   R33's default (resets at once; the button becomes "Undo reset" for 10 seconds and the message above the dialog has
   Undo too, because the status bar sits under the dialog). R33's accents and colour vision are left for their own build.
   Fonts come from the backend (fonts.py, api.py font_*): the NeuroVault font list, each font's official release with its
   size and sha256 checked, kept in .neurovault/fonts. An added font applies to the whole app, like the built-in four.
   Without the app (a browser, ?check=1) feDemo() shows the mockup's font states.
   Build G (R33, locked 2026-10-16): the Theme card adds the accent chips, Custom… and Colour vision (accents.js); Reset to
   defaults asks first, on the page, and also resets the accent, your colour and Colour vision; a card that differs from the
   defaults gets its own Reset in its heading, with Undo. */
'use strict';
const FE = { st: null, real: null, use: '', page: false, bad: null, loaded: {}, meta: {}, timer: null, demo: null, custom: new Set(), undo: null, asked: false, sig: '', ask: false };   // Build G: ask = Reset's question is open
const FONTS_FALLBACK = "system-ui, 'Segoe UI', sans-serif";
const FONT_SAMPLE = 'bdpq · Il1 · 0O · Reading feels calmer when the letters stay put.';
// The font list without the app (dev in a browser): names and sizes as in font_list.json
const FE_SAMPLE = [['atkinson-next', 'Atkinson Hyperlegible Next', 'Braille Institute', 'The 2025 update: more weights, more languages', 114552, "'Atkinson Hyperlegible', sans-serif"],
  ['lexend-deca', 'Lexend Deca', 'Bonnie Shaver-Troup, Thomas Jockin', 'Lexend with a little more room between letters', 175928, "'Lexend', sans-serif"],
  ['lexend-exa', 'Lexend Exa', 'Bonnie Shaver-Troup, Thomas Jockin', 'Wider: for letters that seem to crowd together', 189908, "'Lexend', sans-serif"],
  ['lexend-giga', 'Lexend Giga', 'Bonnie Shaver-Troup, Thomas Jockin', 'Wider still', 192100, "'Lexend', sans-serif"],
  ['andika', 'Andika', 'SIL International', 'Made for new readers: letters that are hard to mix up', 1350836, 'Verdana, sans-serif'],
  ['comic-neue', 'Comic Neue', 'Craig Rozynski', 'Round and friendly, like Comic Sans but tidier', 112964, "'Comic Sans MS', sans-serif"],
  ['inter', 'Inter', 'Rasmus Andersson', 'Plain and clear, made for screens', 876576, "'Segoe UI', system-ui, sans-serif"],
  ['literata', 'Literata', 'TypeTogether', 'A book serif made for long reading on screens', 955132, "'Sitka Text', Georgia, serif"]]
  .map(([id, name, by, why, bytes, fb]) => ({ id, name, by, why, bytes, mb: +(bytes / 1e6).toFixed(1), licence: 'SIL Open Font License 1.1', preview: `fonts/previews/${id}.woff`,
    family: 'nvf-' + id, stack: `'nvf-${id}', ${fb}`, fallback: fb, installed: false, download: null }));
const FE_OWN_DEMO = { id: 'own-luciole', name: 'Luciole', file: 'Luciole-Regular.ttf', bytes: 300000, mb: .3, family: 'nvf-own-luciole', stack: "'nvf-own-luciole', system-ui, sans-serif", own: true, installed: true, download: null };

/* ---- The fonts: status from the backend, the font in use, previews ---- */
const feFonts = () => FE.st?.fonts || (api() ? [] : FE_SAMPLE);
const feOwn = () => FE.st?.own || [];
const feById = id => feFonts().find(f => f.id === id) || feOwn().find(f => f.id === id) || null;
const feAdded = () => [...feFonts().filter(f => f.installed), ...feOwn()];
const feBusy = f => f.download && ['downloading', 'checking'].includes(f.download.state);
const feDl = () => feFonts().filter(feBusy);
const fePct = f => f.download?.total ? Math.min(100, Math.round(100 * f.download.done / f.download.total)) : 0;
const feOffline = () => !!FE.st?.offline || UI.state === 'offline' || (!CHECK && navigator.onLine === false);
const feSize = b => b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`;
const feCount = () => feFonts().length || FE_SAMPLE.length;
const feUseFont = () => FE.use && (FE.loaded[FE.use] === 'ok' || FE.demo) ? feById(FE.use) || FE.meta[FE.use] || null : null;   // meta: loaded before the list came
const feOptStack = x => x.own ? x.stack : `'${x.family}', 'nvp-${x.id}', ${x.fallback || 'sans-serif'}`;   // the preview face until the font is loaded
const feQ = s => String(s).replace(/"/g, '&quot;');
const fontName = () => feUseFont()?.name || FONTS.find(b => b[0] === READER.font)?.[1] || '';
// The tiny preview files (only the sample's letters and the font's name, a few KB each) ship in frontend/fonts/previews
function fePreviews() {
  const css = feFonts().filter(f => f.preview).map(f => `@font-face{font-family:'nvp-${f.id}';src:url(${f.preview}) format('woff');font-display:block}`).join('\n');
  let el = document.getElementById('nv-font-previews');
  if (!el) { el = document.createElement('style'); el.id = 'nv-font-previews'; document.head.appendChild(el); }
  if (el.textContent !== css) el.textContent = css;
}
// An added font: its files come through the bridge (the page can't open file:/// paths) and become FontFaces
async function feLoad(id) {
  if (FE.loaded[id] === 'ok') return true;
  if (FE.loaded[id] instanceof Promise) return FE.loaded[id];
  return FE.loaded[id] = (async () => {
    const r = await nv('font_data', id);
    if (failed(r)) { FE.loaded[id] = 'failed'; return false; }
    try {
      for (const f of r.files) {
        const bin = Uint8Array.from(atob(f.data), c => c.charCodeAt(0));
        const face = new FontFace(r.family, bin, { weight: String(f.weight), style: f.style || 'normal' });
        await face.load(); document.fonts.add(face);
      }
      FE.meta[id] = { id, name: r.name, family: r.family, stack: `'${r.family}', ${FONTS_FALLBACK}` }; FE.loaded[id] = 'ok'; return true;
    } catch (e) { console.warn('font not loaded', id, e); FE.loaded[id] = 'failed'; return false; }
  })();
}
function feSaveUse(id) { FE.use = id; if (FE.demo || !api()) saveSettings({ font_use: id }); else nv('font_use', id).then(r => { if (failed(r)) toast(r.message); }); }
async function feRefresh() {
  if (FE.demo || !api()) return;
  clearTimeout(FE.timer); FE.timer = null;
  const r = await nv('fonts_status'); if (failed(r) || FE.demo) return;
  const was = FE.st, sig = JSON.stringify([r.fonts.map(f => [f.id, f.installed, f.download?.state, f.download?.message]), r.own.map(o => o.id), r.use, r.offline]);
  (was?.fonts || []).forEach(f => { const now = r.fonts.find(x => x.id === f.id); if (feBusy(f) && now?.installed) toast(`${f.name} is ready: pick it under Font`); });
  FE.st = FE.real = r; fePreviews();
  if (sig !== FE.sig) { FE.sig = sig; renderAll(); }
  else r.fonts.filter(feBusy).forEach(f => {   // only the numbers moved: update them in place
    app.querySelectorAll(`[data-font-pct="${f.id}"]`).forEach(el => { el.textContent = fePct(f) + '%'; });
    app.querySelectorAll(`[data-font-bar="${f.id}"]`).forEach(el => { el.style.width = fePct(f) + '%'; el.parentElement.setAttribute('aria-valuenow', fePct(f)); });
    app.querySelectorAll(`[data-font-done="${f.id}"]`).forEach(el => { el.textContent = `${feSize(f.download.done)} of ${feSize(f.download.total)}`; }); });
  if (r.fonts.some(feBusy)) FE.timer = setTimeout(feRefresh, 400);
}
// The mockup's font states, for ?check=1 and a browser without the app: none | downloading | added | badfile | offline; null = the real ones
function feDemo(state) {
  clearTimeout(FE.timer);
  if (!state) { FE.demo = null; FE.st = FE.real; FE.bad = null; FE.use = FE.real?.use || ''; return; }
  const fonts = (FE.real?.fonts || FE_SAMPLE).map(f => ({ ...f, installed: (state === 'added' || state === 'offline') && ['literata', 'lexend-exa'].includes(f.id),
    download: state === 'downloading' && f.id === 'atkinson-next' ? { state: 'downloading', done: Math.round(f.bytes * .46), total: f.bytes, message: '' } : null }));
  const own = state === 'added' ? [{ ...FE_OWN_DEMO }] : [], used = [...fonts.filter(f => f.installed), ...own].reduce((t, f) => t + f.bytes, 0);
  FE.demo = state; FE.use = ''; FE.bad = state === 'badfile' ? { file: 'Luciole-Bold.woff2', message: "Luciole-Bold.woff2 couldn't be added: it isn't a font file, or it's damaged." } : null;
  FE.st = { status: 'success', demo: true, fonts, own, use: '', offline: state === 'offline', folder: 'C:\\Users\\you\\NeuroVault\\.neurovault\\fonts', used_bytes: used, used_mb: +(used / 1e6).toFixed(1) };
  fePreviews();
}
function feDemoAct(act, id) {   // what each button does in the demo (no files move)
  const f = feById(id);
  if (act === 'font-dl' && f) f.download = { state: 'downloading', done: 0, total: f.bytes, message: '' };
  if (act === 'font-cancel' && f) { f.download = null; toast('Download cancelled: the part file is deleted'); }
  if (act === 'font-remove' && f) { const was = FE.use === id; f.installed = false; FE.st.own = feOwn().filter(o => o.id !== id); if (was) FE.use = '';
    toast(`${f.name} removed: ${feSize(f.bytes)} freed${was ? `; back to ${FONTS.find(b => b[0] === READER.font)[1]}` : ''}`); }
  if (act === 'font-own') { if (feOwn().some(o => o.id === FE_OWN_DEMO.id)) toast('Opens a file picker for a .ttf, .otf or .woff2 file'); else { FE.st.own = [...feOwn(), { ...FE_OWN_DEMO }]; FE.bad = null; toast(`Luciole added from ${FE_OWN_DEMO.file}: it's under Font now`); } }
}
const feDemoFinish = id => { const f = feById(id); if (f?.download) { f.download = null; f.installed = true; toast(`${f.name} is ready: pick it under Font`); } };   // the check finishes a demo download

/* ---- The cards (R31 dense): each card is its name and current value, then rows (bold label, a muted line, the control on the right) ---- */
const CF_SECS = [['theme', 'Theme', 'sun'], ['text', 'Text', 'type'], ['spacing', 'Spacing', 'columns'], ['aids', 'Reading aids', 'ruler'], ['motion', 'Motion', 'focus']];
const CF_PRESETS = { letter: [[0, 'Normal'], [.05, 'Wide'], [.1, 'Wider']], word: [[0, 'Normal'], [.1, 'Wide'], [.2, 'Wider']],
  line: [[1.5, 'Snug'], [1.85, 'Normal'], [2.1, 'Loose']], width: [[65, 'Narrow'], [80, 'Comfortable'], [100, 'Wide'], [120, 'Full']] };   // locked 2026-10-16; QC 89: Page width, four choices
const CF_RANGE = { letter: [0, .15, .01], word: [0, .3, .02], line: [1.4, 2.2, .05], width: [55, 95, 5] };
const cfPresetOf = k => CF_PRESETS[k].find(p => Math.abs(p[0] - S.a11y[k]) < 1e-6)?.[1] ?? null;
const cfCustomOn = k => FE.custom.has(k) || cfPresetOf(k) == null;
const cfSpaceSum = k => cfCustomOn(k) ? SL_FMT[k](S.a11y[k]) : cfPresetOf(k);
const cfSize = () => TEXT_SIZES.find(t => t[0] === READER.textsize) || TEXT_SIZES[1];
function cfSums() {
  const a = S.a11y, on = b => b ? 'on' : 'off';
  return { theme: [THEMES.find(t => t[0] === READER.theme)?.[1] || '', accentName(accTheme()), AC.cvd === 'off' ? '' : CVD.find(c => c[0] === AC.cvd)[1]].filter(Boolean).join(' · '), text: `${fontName()} · ${cfSize()[1]}`, spacing: `Letters ${cfSpaceSum('letter')} · Words ${cfSpaceSum('word')} · Lines ${cfSpaceSum('line')} · Width ${cfSpaceSum('width')}`,
    aids: `Ruler ${on(a.ruler)} · Bionic ${on(a.bionic)}`, motion: a.still ? 'Reduced' : 'Full' };
}
const cfRow = (id, label, desc, ctl, mod = '') => `<div class="set-row cf-row${mod}"><div class="cf-row-text"><div class="set-label" id="${id}">${label}</div>${desc ? `<div class="set-desc">${desc}</div>` : ''}</div><div class="cf-ctl">${ctl}</div></div>`;
const cfToggle = (k, label, desc) => cfRow(`cf-${k}`, label, desc, `<button class="toggle" role="switch" aria-checked="${S.a11y[k]}" aria-labelledby="cf-${k}" data-act="a11y-toggle" data-v="${k}"></button>`);
const cfSeg = (id, label, desc, opts, act, k, cur) => cfRow(id, label, desc, `<div class="seg" role="group" aria-labelledby="${id}">${opts.map(([v, l]) => `<button class="seg-opt" data-act="${act}" data-k="${k}" data-v="${v}" aria-pressed="${String(cur) === String(v)}">${l}</button>`).join('')}</div>`, ' cf-row--seg');
const cfCard = (id, title, val, body) => `<section class="card cf-card cf-card--${id}" aria-labelledby="cfc-${id}"><div class="cf-card-head"><h4 class="cf-card-title" id="cfc-${id}" tabindex="-1">${title}</h4><span class="cf-card-val" title="${esc(val)}">${esc(val)}</span>${cfDiffers(id) ? `<button class="btn btn--ghost btn--sm cf-card-reset" data-act="cf-reset-card" data-v="${id}" aria-label="Reset ${title} to the defaults" title="${CF_CARD_WHAT[id]} go back to how NeuroVault starts">${ic('restore')}Reset</button>` : ''}</div>${body}</section>`;   // Build G: a Reset once the card differs
function cfPreset(k, label, desc) {
  const [min, max, step] = CF_RANGE[k], custom = cfCustomOn(k), cur = S.a11y[k];
  return `<div class="set-row cf-row cf-row--seg cf-row--preset"><div class="cf-row-text"><div class="set-label" id="cf-${k}">${label}</div><div class="set-desc">${desc}</div></div>
    <div class="cf-ctl"><div class="seg" role="group" aria-labelledby="cf-${k}">${CF_PRESETS[k].map(([pv, pl]) => `<button class="seg-opt" data-act="cf-preset" data-k="${k}" data-v="${pv}" aria-pressed="${!custom && Math.abs(pv - cur) < 1e-6}">${pl}</button>`).join('')}<button class="seg-opt" data-act="cf-custom" data-v="${k}" aria-pressed="${custom}" aria-expanded="${custom}">Custom</button></div></div>
    ${custom ? `<div class="cf-custom"><div class="cf-range"><input class="range" type="range" min="${min}" max="${max}" step="${step}" value="${cur}" data-act="a11y-range" data-k="${k}" aria-labelledby="cf-${k}"><b class="cf-val" data-sl-val="${k}">${SL_FMT[k](cur)}</b></div></div>` : ''}</div>`;
}
function cfPreview(kind) {   // a small sample inside the card whose settings it shows: 'text', 'spacing', 'aids', 'motion'
  const a = S.a11y;
  const bion = s => !a.bionic ? esc(s) : s.split(/(\s+)/).map(w => /^\s+$/.test(w) || !w ? w : `<b class="bionic">${esc(w.slice(0, Math.max(1, Math.ceil(w.length * .45))))}</b>${esc(w.slice(Math.max(1, Math.ceil(w.length * .45))))}`).join('');
  const para = 'Change a setting and this paragraph follows straight away. Pick the theme, font and spacing that keep the words still, then read a line or two here before you go back to your notes.';
  if (kind === 'motion') return `<div class="cf-page cf-motion set-desc"><span class="cf-pulse" aria-hidden="true"></span>${a.still ? 'Still: nothing slides, fades or pulses' : 'Moving things pulse and slide, like this dot'}</div>`;
  if (kind === 'text') return `<div class="cf-page" aria-label="Preview"><div class="cf-body"><p>${bion('Change a setting and this line follows straight away.')}</p></div></div>`;
  return `<div class="cf-page" aria-label="Preview"><div class="cf-body"><p>${bion(para)}</p>${kind === 'aids' && a.ruler ? `<div class="cf-band" style="--cf-lines:${a.rulerLines}" aria-hidden="true"></div>` : ''}</div></div>`;
}
const fontBad = () => { const b = FE.bad; if (!b) return ''; const m = b.message.startsWith(b.file) ? b.message.slice(b.file.length) : ' ' + b.message;
  return `<div class="alert alert--danger cf-alert" role="alert">${ic('alert')}<span><b>${esc(b.file)}</b>${esc(m)}</span><button class="btn btn--secondary btn--sm" data-act="font-own">Try another file…</button></div>`; };
function cfFonts() {
  const off = feOffline(), n = feCount();
  return `<div class="fonts" role="group" aria-label="Font">${FONTS.map(([v, l]) => `<button class="font-opt font-opt--${v}" data-act="cf-font" data-v="${v}" aria-pressed="${READER.font === v && !feUseFont()}"><span class="truncate">${l}</span></button>`).join('')}
    ${feAdded().map(x => `<button class="font-opt" style="font-family:${feQ(feOptStack(x))}" data-act="font-use" data-v="${x.id}" aria-pressed="${FE.use === x.id && !!feUseFont()}" title="${x.own ? `Added from ${esc(x.file)}` : 'Downloaded from More fonts'}"><span class="truncate">${esc(x.name)}</span><span class="chip chip--neutral">${x.own ? 'Your file' : 'Added'}</span></button>`).join('')}
    ${feDl().map(x => `<button class="font-opt" disabled style="font-family:${feQ(feOptStack(x))}" title="Downloading: it can be picked once it's here"><span class="truncate">${esc(x.name)}</span><span class="chip chip--neutral num" data-font-pct="${x.id}">${fePct(x)}%</span></button>`).join('')}</div>
    <div class="cf-font-acts"><button class="btn btn--tint" data-act="fonts-more">${ic('download')}More fonts<span class="chip chip--accent">${n} free</span></button><button class="btn btn--secondary" data-act="font-own">${ic('plus')}Add your own font…</button></div>
    <div class="set-desc">${off ? 'You\'re offline: More fonts can\'t download right now, but a font file you already have can still be added.' : `${n} free reading fonts to download, or a .ttf, .otf or .woff2 file you already have.`}</div>${fontBad()}`;
}
function cfCards() {
  const a = S.a11y, sum = cfSums();
  return {
    theme: cfCard('theme', 'Theme', sum.theme, `<div class="swatches" role="group" aria-label="Theme">${THEMES.map(([v, l]) => `<button class="swatch swatch--${v}" data-act="set-reader" data-k="theme" data-v="${v}" aria-pressed="${READER.theme === v}"><span class="swatch-aa" aria-hidden="true">Aa</span><span class="truncate">${l}</span></button>`).join('')}</div><div>${accRow()}${cvRow()}</div>`),   // Build G: accent and colour vision
    text: cfCard('text', 'Text', sum.text, `${cfPreview('text')}${cfFonts()}<div>${cfSeg('cf-size', 'Text size', 'The size of your note text', TEXT_SIZES.map(([v, l]) => [v, l]), 'set-reader', 'textsize', READER.textsize)}</div>`),
    spacing: cfCard('spacing', 'Spacing', sum.spacing, `${cfPreview('spacing')}<div>${cfPreset('letter', 'Letter spacing', 'Room between letters')}${cfPreset('word', 'Word spacing', 'Room between words')}${cfPreset('line', 'Line height', 'Room between lines')}${cfPreset('width', 'Page width', 'How wide a note’s page is, so how long a line gets before it wraps')}</div>`),
    aids: cfCard('aids', 'Reading aids', sum.aids, `${cfPreview('aids')}<div>${cfToggle('ruler', 'Reading ruler', 'Dims all but the lines you\'re reading; follows the pointer or the caret · Ctrl+Alt+R')}${a.ruler ? cfSeg('cf-lines', 'Lines in focus', 'How tall the clear band is', [[1, '1'], [2, '2'], [3, '3']], 'a11y-set', 'rulerLines', a.rulerLines) : ''}${cfToggle('bionic', 'Bionic reading', 'Bolds the start of each word. Editing pauses while it\'s on')}</div>`),
    motion: cfCard('motion', 'Motion', sum.motion, `<div>${cfToggle('still', 'Reduced motion', 'Turns off slides, fades and pulses')}</div>${cfPreview('motion')}`) };
}
const comfortCards = () => { const c = cfCards(); return `<div class="cf cf-cards cf-dense"><div class="cf-main">${cfConfirm()}${CF_SECS.map(([k]) => c[k]).join('')}</div></div>`; };   // Build G: Reset's question on top

/* ---- More fonts: a page inside Reading & comfort, with Back ---- */
function fontPicker() {
  const off = feOffline();
  const row = x => { const dl = feBusy(x) ? x.download : null, err = x.download?.state === 'error' ? x.download.message : '', inst = x.own || x.installed, use = FE.use === x.id && !!feUseFont();
    const act = dl ? `<div class="ai-dl"><div class="progress" role="progressbar" aria-label="Downloading ${esc(x.name)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${fePct(x)}"><span data-font-bar="${x.id}" style="width:${fePct(x)}%"></span></div><span class="set-desc num" data-font-done="${x.id}">${dl.state === 'checking' ? 'Checking…' : `${feSize(dl.done)} of ${feSize(dl.total)}`}</span><button class="btn btn--ghost btn--sm" data-act="font-cancel" data-v="${x.id}">Cancel</button></div>`
      : inst ? `${use ? '<span class="chip chip--success">In use</span>' : `<button class="btn btn--secondary btn--sm" data-act="font-use" data-v="${x.id}">Use</button>`}<button class="btn btn--ghost btn--sm" data-act="font-remove" data-v="${x.id}" title="Delete the font file${x.bytes ? ` (${feSize(x.bytes)})` : ''}">Delete</button>`   /* QC 88: remove and delete are two different things */
      : `<button class="btn btn--secondary btn--sm" data-act="font-dl" data-v="${x.id}"${off ? ' disabled title="You\'re offline: downloads wait until you\'re back online"' : ` title="${feSize(x.bytes)} from ${esc(x.source || 'its official release')}"`} aria-label="Download ${esc(x.name)}, ${feSize(x.bytes)}">${ic('download')}Download</button>`;
    return `<div class="ai-model cf-font-row${use ? ' is-use' : ''}" data-font-row="${x.id}"><div class="provider-main"><div class="ai-name"><span class="set-label">${esc(x.name)}</span>${x.own ? '<span class="chip chip--neutral">Your file</span>' : inst ? '<span class="chip chip--neutral">Added</span>' : ''}</div>
      <div class="cf-font-sample" style="font-family:${feQ(feOptStack(x))}${x.ls ? `;letter-spacing:${x.ls}` : ''}">${FONT_SAMPLE}</div>
      <div class="set-desc ai-meta">${x.own ? `${esc(x.file)} · ${feSize(x.bytes)} · copied into NeuroVault's fonts folder` : `${esc(x.why)} · ${feSize(x.bytes)} · ${esc(x.licence)} · ${esc(x.by)}`}</div>
      ${err ? `<div class="set-desc cf-font-err" role="alert">${ic('alert')}<span>${esc(err)}</span></div>` : ''}</div><div class="ai-act">${act}</div></div>`; };
  return `<div class="cf cf-fontpage"><div class="set-desc">Free fonts with open licences, picked for reading. Each one downloads once from its official release, then works offline. The sample line shows letters that are easy to mix up.</div>
    ${off ? `<div class="alert alert--warning cf-alert">${ic('cloud')}<span>You're offline. Fonts you've added still work, and you can add a font file; downloads wait until you're back online.</span></div>` : ''}
    <div><div class="eyebrow">Free reading fonts</div>${feFonts().map(row).join('') || '<div class="set-desc">Loading the font list…</div>'}</div>
    <div><div class="eyebrow">Your fonts</div>${feOwn().length ? feOwn().map(row).join('') : '<div class="set-desc cf-none">None yet.</div>'}
    <div class="ai-foot"><button class="btn btn--secondary btn--sm" data-act="font-own">${ic('plus')}Add your own font…</button><span class="set-desc">A .ttf, .otf or .woff2 file. NeuroVault checks it's a font, then copies it into its fonts folder.</span></div>${fontBad()}</div>
    <div class="set-desc ai-meta cf-folder">Fonts folder: <span class="code">${esc(FE.st?.folder || '.neurovault\\fonts')}</span> (${(FE.st?.used_mb || 0).toFixed(1)} MB used). It moves into your vault with the vault folder.</div></div>`;
}

/* ---- Reset to defaults. Build G (R33, locked): the page's Reset asks first, on the page, and resets every card; a card's own
        Reset (in its heading once it differs) resets that card at once, with Undo for 10 seconds ---- */
const CF_DEF = { theme: 'obsidian', font: 'opendyslexic', use: '', textsize: 'm', letter: 0, word: 0, line: 1.85, width: 100, ruler: false, rulerLines: 2, bionic: false, still: false,
  picks: {}, accCustom: '', accTheme: '', cvd: 'off' };   // config.py DEFAULT_CONFIG (Build G: accent, accent_custom, accent_custom_theme, colour_vision)
const CF_A11Y = ['letter', 'word', 'line', 'width', 'ruler', 'rulerLines', 'bionic', 'still'];
const CF_CARD_KEYS = { theme: ['theme', 'picks', 'accCustom', 'accTheme', 'cvd'], text: ['font', 'use', 'textsize'], spacing: ['letter', 'word', 'line', 'width'], aids: ['ruler', 'rulerLines', 'bionic'], motion: ['still'] };
const CF_CARD_WHAT = { theme: 'Theme, accent, your colour and colour vision', text: 'Font and text size', spacing: 'Letter and word spacing, line height and line width', aids: 'The reading ruler and bionic reading', motion: 'Reduced motion' };
const CF_RESET_WHAT = 'Theme, accent, your colour, colour vision, font, text size, spacing, line height, line width, the ruler, bionic reading and reduced motion';
function cfDiffers(card) {
  const a = S.a11y;
  if (card === 'theme') return READER.theme !== CF_DEF.theme || AC.cvd !== CF_DEF.cvd || !!AC.custom || Object.keys(THEME_COL).some(th => accPick(th) !== accDefault(th));
  if (card === 'text') return READER.font !== CF_DEF.font || !!FE.use || READER.textsize !== CF_DEF.textsize;
  if (card === 'spacing') return ['letter', 'word', 'line', 'width'].some(k => a[k] !== CF_DEF[k]) || FE.custom.size > 0;
  if (card === 'aids') return ['ruler', 'rulerLines', 'bionic'].some(k => a[k] !== CF_DEF[k]);
  if (card === 'motion') return a.still !== CF_DEF.still;
  return false;
}
const cfSnap = () => ({ theme: READER.theme, font: READER.font, textsize: READER.textsize, use: FE.use, ...Object.fromEntries(CF_A11Y.map(k => [k, S.a11y[k]])), custom: new Set(FE.custom),
  picks: { ...AC.picks }, accCustom: AC.custom, accTheme: AC.customTheme, cvd: AC.cvd });
function cfPut(x) {   // every reset setting at once, saved in one patch
  READER.theme = x.theme; READER.font = x.font; READER.textsize = x.textsize; if (!DARK_THEMES.includes(x.theme)) READER.lastLight = x.theme;
  CF_A11Y.forEach(k => { S.a11y[k] = x[k]; }); FE.custom = new Set(x.custom);
  AC.picks = { ...x.picks }; AC.custom = x.accCustom; AC.customTheme = x.accTheme; AC.cvd = x.cvd; AC.draft = null; AC.open = false; applyReader();
  const patch = { theme: x.theme, font: x.font, text_size: x.textsize, accent: { ...x.picks }, accent_custom: x.accCustom, accent_custom_theme: x.accTheme, colour_vision: x.cvd,
    ...Object.fromEntries(CF_A11Y.map(k => [COMFORT_KEYS[k][0], x[k]])) };
  saveSettings(patch); if (FE.use !== x.use) { if (x.use && !FE.demo) feLoad(x.use).then(() => renderAll()); feSaveUse(x.use); }
}
function cfReset(cards) {   // the cards' settings back to the defaults, the rest as they are; returns how it was, for Undo
  const snap = cfSnap(), to = { ...snap, custom: new Set(snap.custom) };
  cards.forEach(c => { CF_CARD_KEYS[c].forEach(k => { to[k] = CF_DEF[k]; }); if (c === 'spacing') to.custom = new Set(); });
  cfPut(to); return snap;
}
function cfResetAll() {
  cfReset(CF_SECS.map(x => x[0])); FE.ask = false; clearTimeout(cfReset.t); FE.undo = null;
  const msg = 'Reading & comfort is back to the defaults'; status(msg); S.focus = { sel: '#cf-page-title' }; toast(msg);
}
function cfResetCard(card) {
  const name = CF_SECS.find(x => x[0] === card)[1], snap = cfReset([card]), msg = `${name} is back to the defaults`;
  FE.undo = { snap, msg, card }; clearTimeout(toast.t); clearTimeout(cfReset.t); S.toast = msg; status(msg);
  cfReset.t = setTimeout(() => { FE.undo = null; if (S.toast === msg) S.toast = null; renderAll(); }, CHECK ? 600000 : 10000);
  S.focus = { sel: `#cfc-${card}` }; renderAll();
}
function cfUndo() {
  if (!FE.undo) return;
  const card = FE.undo.card; cfPut(FE.undo.snap); FE.undo = null; clearTimeout(cfReset.t); S.focus = { sel: `.cf-card-reset[data-v="${card}"]` }; status('Undone: your settings are back'); toast('Undone: your settings are back');
}
function cfResetBtn() {
  const n = CF_SECS.filter(([k]) => cfDiffers(k)).length;
  return `<button class="btn btn--secondary btn--sm cf-reset" data-act="cf-reset" aria-expanded="${FE.ask}"${n ? ` title="${CF_RESET_WHAT} go back to how NeuroVault starts"` : ' disabled title="Everything here is already the default"'}>${ic('restore')}Reset to defaults</button>`;
}
const cfConfirm = () => !FE.ask ? '' : `<div class="card cf-confirm" role="alertdialog" aria-labelledby="cf-ask-t" aria-describedby="cf-ask-d"><div class="cf-row-text"><div class="set-label" id="cf-ask-t">Reset Reading &amp; comfort?</div><div class="set-desc" id="cf-ask-d">${CF_RESET_WHAT} go back to how NeuroVault starts.${CF_SECS.some(([k]) => cfDiffers(k)) ? ` ${CF_SECS.filter(([k]) => cfDiffers(k)).map(x => x[1]).join(', ')} differ now.` : ''}</div></div><div class="cf-ctl"><button class="btn btn--secondary btn--sm" data-act="cf-ask-no">Cancel</button><button class="btn btn--primary btn--sm" data-act="cf-reset-yes">${ic('restore')}Reset to defaults</button></div></div>`;

/* ---- Into the app: the Settings page, the font for the whole app, the clicks ---- */
const _settingsPaneE = settingsPane;
settingsPane = function (sec) { return sec === 'appearance' ? (FE.page ? fontPicker() : comfortCards()) : _settingsPaneE(sec); };
const _settingsModalE = settingsModal;
settingsModal = function () {   // the cards stand on the pane, under the title and Reset; More fonts is a page with Back
  const html = _settingsModalE(), at = html.indexOf('<div class="settings-pane">');
  if (S.setSec !== 'appearance' || at < 0) return html;
  const label = SET_SECTIONS.find(x => x[0] === 'appearance')[1];
  const head = FE.page ? `<div class="cf-sub-head"><button class="btn btn--ghost btn--sm" data-act="fonts-back">${ic('left')}${label}</button></div><h3 class="view-title">More fonts</h3>` : `<div class="cf-page-head"><h3 class="view-title" id="cf-page-title" tabindex="-1">${label}</h3>${cfResetBtn()}</div>`;
  return html.slice(0, at) + `<div class="settings-pane">${head}${FE.page ? `<div class="card card-pad">${fontPicker()}</div>` : comfortCards()}</div></div></div></div>`;
};
const _applyComfortE = applyComfort;
applyComfort = function () { _applyComfortE(); const f = feUseFont(); if (f) app.style.setProperty('--font', f.stack); else app.style.removeProperty('--font'); };
const _readerFromConfigE = readerFromConfig;
readerFromConfig = function (c) {
  _readerFromConfigE(c);
  if (typeof c.font_use !== 'string' || FE.demo) return;
  FE.use = c.font_use;
  if (FE.use && api()) feLoad(FE.use).then(ok => { if (!ok && FE.use) { const id = FE.use; feSaveUse(''); status(`The font you added (${id}) wasn't found, so NeuroVault is back to ${FONTS.find(b => b[0] === READER.font)[1]}`); } renderAll(); feRefresh(); });
};
const _afterRenderE = afterRender;
afterRender = function () {
  _afterRenderE();
  if (S.modal === 'settings' && S.setSec === 'appearance' && !FE.asked && api() && !FE.demo) { FE.asked = true; feRefresh(); }   // the list, once the page first opens
  if (S.modal !== 'settings') { FE.asked = false; FE.ask = false; AC.open = false; }   // Build G: Reset's question and the colour picker close with Settings
  const t = app.querySelector('.toast');
  if (t && FE.undo && S.toast === FE.undo.msg && !t.querySelector('[data-act="cf-undo"]')) t.insertAdjacentHTML('beforeend', '<button class="btn btn--ghost btn--sm" data-act="cf-undo">Undo</button>');
};
function feTop(sel) { renderAll(); const p = app.querySelector('.settings-pane'); if (p) p.scrollTop = 0; if (sel) app.querySelector(sel)?.focus({ preventScroll: true }); }
async function fontAct(act, id) {
  const x = id && feById(id);
  if (act === 'fonts-more') { FE.page = true; feTop('[data-act="fonts-back"]'); feRefresh(); return; }
  if (act === 'fonts-back') { FE.page = false; renderAll(); const b = app.querySelector('[data-act="fonts-more"]'); b?.scrollIntoView({ block: 'center' }); b?.focus({ preventScroll: true }); return; }
  if (act === 'font-use') {
    if (!x) return;
    if (!FE.demo && api() && !await feLoad(id)) { toast(`${x.name} couldn't be loaded: try Remove, then add it again`); return; }
    feSaveUse(id); FE.loaded[id] ||= 'ok'; S.focus = { sel: `[data-act="font-use"][data-v="${id}"], [data-font-row="${id}"] [data-act="font-remove"]` }; toast(`${x.name} is your reading font`); return;
  }
  if (FE.demo || !api()) { feDemoAct(act, id); renderAll(); return; }
  if (act === 'font-dl') { const r = await nv('font_download', id); if (failed(r)) toast(r.message); FE.sig = ''; await feRefresh(); S.focus = { sel: `[data-act="font-cancel"][data-v="${id}"]` }; renderAll(); return; }
  if (act === 'font-cancel') { await nv('font_cancel', id); toast('Download cancelled: the part file is deleted'); FE.sig = ''; await feRefresh(); return; }
  if (act === 'font-remove') {
    const r = await nv('font_remove', id); if (failed(r)) { toast(r.message); return; }
    if (r.was_in_use) FE.use = ''; delete FE.loaded[id];
    toast(`${x?.name || 'The font'} removed: ${feSize(r.freed_bytes)} freed${r.was_in_use ? `; back to ${FONTS.find(b => b[0] === READER.font)[1]}` : ''}`); FE.sig = ''; await feRefresh(); return;
  }
  if (act === 'font-own') {   // straight to the bridge: the file picker waits for you, so no time limit
    let r; try { r = await api().font_add_file(); } catch (e) { r = { status: 'error', message: "Couldn't reach the app." }; }
    if (!r || r.status === 'cancelled') return;
    if (failed(r)) { if (r.bad) { FE.bad = { file: r.file, message: r.message }; S.focus = { sel: '.cf-alert [data-act="font-own"]' }; renderAll(); } else toast(r.message); return; }
    FE.bad = null; FE.sig = ''; await feRefresh();
    if (!await feLoad(r.font.id)) { await nv('font_remove', r.font.id); FE.bad = { file: r.font.file, message: `${r.font.file} couldn't be added: it isn't a font file, or it's damaged.` }; FE.sig = ''; await feRefresh(); return; }
    toast(`${r.font.name} added from ${r.font.file}: it's under Font now`); renderAll();
  }
}
app.addEventListener('click', e => {
  const t = e.target.closest('[data-act]'); if (!t || e.target.closest('[data-soon]') || t.disabled) return;
  const act = t.dataset.act, v = t.dataset.v;
  if (act === 'cf-preset') { const k = t.dataset.k; setComfort(k, +v); FE.custom.delete(k); status('Setting saved'); S.focus = { sel: `[data-act="cf-preset"][data-k="${k}"][data-v="${v}"]` }; renderAll(); return; }
  if (act === 'cf-custom') { const on = !FE.custom.has(v) && cfPresetOf(v) != null; if (on) FE.custom.add(v); else FE.custom.delete(v); S.focus = { sel: on ? `.cf-custom [data-k="${v}"]` : `[data-act="cf-custom"][data-v="${v}"]` }; renderAll(); return; }
  if (act === 'cf-font') { setReader('font', v); if (FE.use) feSaveUse(''); status('Setting saved'); S.focus = { sel: `[data-act="cf-font"][data-v="${v}"]` }; renderAll(); return; }
  if (act === 'cf-reset') { FE.ask = true; S.focus = { sel: '[data-act="cf-ask-no"]' }; renderAll(); return; }   // Build G: asks first
  if (act === 'cf-ask-no') { FE.ask = false; S.focus = { sel: '.settings-pane .cf-reset' }; renderAll(); return; }
  if (act === 'cf-reset-yes') { cfResetAll(); return; }
  if (act === 'cf-reset-card') { cfResetCard(v); return; }
  if (act === 'cf-undo') { cfUndo(); return; }
  if (/^fonts?-/.test(act)) fontAct(act, v).then(() => applyComfort());
});

/* ==== Build N · QC 89: Page width, also in Settings → Editor and the note's ⋮ More (the same setting as Reading & comfort → Spacing,
   comfort_line_width; render-settings.js pageCol draws it). The user's first real user: "the borders on each side of the 'page'
   is too wide feels limiting" ==== */
const pageWidthName = w => CF_PRESETS.width.find(p => p[0] === w)?.[1] || `Custom, ${w} characters`;
function pageWidthRow() {
  const cur = S.a11y.width, custom = !CF_PRESETS.width.some(p => p[0] === cur);
  return `<div class="set-row pw-row"><div><div class="set-label" id="pw-l">Page width</div><div class="set-desc">${custom ? `Custom: ${cur} characters (Reading &amp; comfort → Spacing)` : 'How wide a note’s page is. Wide uses most of the note area, never edge to edge on a wide screen'}</div></div>
    <div class="seg" role="group" aria-labelledby="pw-l">${CF_PRESETS.width.map(([v, l]) => `<button class="seg-opt" data-act="pw-set" data-v="${v}" aria-pressed="${cur === v}">${l}</button>`).join('')}</div></div>`;
}
{ const sp0 = settingsPane; settingsPane = sec => (sec === 'editor' ? pageWidthRow() : '') + sp0(sec); }   // eslint-disable-line no-global-assign
{ const h0 = renderHeader; renderHeader = function () {   // eslint-disable-line no-global-assign
  const h = h0.apply(this, arguments), at = '<div class="menu-sep"></div><button class="menu-item" role="menuitem" data-act="sync">'; if (!S.menu || !h.includes(at)) return h;
  const items = CF_PRESETS.width.map(([v, l]) => `<button class="menu-item" role="menuitemradio" aria-checked="${S.a11y.width === v}" data-act="pw-set" data-v="${v}"><span class="pw-tick" aria-hidden="true">${S.a11y.width === v ? ic('check') : ''}</span>${l}</button>`).join('');
  return h.replace(at, `<div class="menu-sep"></div><div class="menu-label pw-label" role="presentation">Page width</div>${items}${at}`); }; }
app.addEventListener('click', e => {
  const t = e.target.closest?.('[data-act="pw-set"]'); if (!t) return; e.preventDefault(); e.stopImmediatePropagation();
  const v = +t.dataset.v, inMenu = !!t.closest('.menu'); setComfort('width', v); FE.custom.delete('width'); applyComfort();
  status(`Page width: ${pageWidthName(v)}`); if (inMenu) { S.menu = false; S.focus = { sel: '[data-act="menu"]' }; } else S.focus = { sel: `[data-act="pw-set"][data-v="${v}"]` }; renderAll();
}, true);
/* ==== end Build N · QC 89 ==== */
