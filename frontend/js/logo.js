/* ==== Build N · the hypercube logo, in your theme and accent (design profile "The logo wears your theme", 2026-10-18;
   the files come from design/logo/ on claude/logo-04b80e at 0794bb2: img/logo/*.svg and logo-vars.js) ====
   Feedback: "the icon must dynamically change based on what the theme/accent colour the user chooses".
   - QC 74 (design profile, logo, "Where it shows"; feedback: "remove the logo from the top bar its pointless there, also use a
     large icon for the windows icon I can barrely see it. Where we can have the icon is the settings page!"): no mark in the
     window bar. The large mark is in Settings, at the foot of its sections, with the app's name (an About area). Its colours
     are CSS variables (logoVars) taken from the theme's --bg, --text and --accent as drawn, so every theme, accent, custom
     colour and colour vision setting redraws it.
   - The window and taskbar icon (QC 78; feedback: "windows task bar icon still tiny"): the bare icon, the cube alone with no
     tile, lit from the upper left and filling its square (hypercube-icon.svg, design/logo/export_logo.py), drawn at 16, 20, 24,
     32, 40, 48, 64 and 256 px (logoPng) and sent
     to api.window_icon, which sets it on the main window and every pop-out (winframe.set_icon). Sent once at start and
     after a theme or accent change, debounced. Until then Windows shows the static neurovault.ico. */
'use strict';
const LOGO = { svg: {}, want: '', sent: '', t: null, wait: 400, force: false };
const LOGO_FILES = { mark: 'img/logo/hypercube-mark.svg', icon: 'img/logo/hypercube-icon.svg' };   // QC 78: the bare icon (no tile) for Windows, the mark for Settings
const LOGO_PX = [16, 20, 24, 32, 40, 48, 64, 256];   // QC 78: every size Windows may pick for the window and the taskbar
const logoHex = c => { const x = logoHex.cx ||= document.createElement('canvas').getContext('2d'); x.fillStyle = '#000000'; x.fillStyle = c; return x.fillStyle; };   // any CSS colour → #rrggbb
function logoNow() {   // the logo's variables for the theme and accent as they're drawn now
  const cs = getComputedStyle(app), v = k => logoHex(cs.getPropertyValue(k).trim() || '#000000');
  return logoVars({ bg: v('--bg'), text: v('--text'), accent: v('--accent') });
}
const logoStyle = vars => Object.entries(vars).map(([k, x]) => `${k}:${x}`).join(';');
function logoMarkHtml(cls = 'nv-logo', vars = logoNow()) {
  if (!LOGO.svg.mark) return '';
  return `<span class="${cls}" data-nv-logo aria-hidden="true" style="${logoStyle(vars)}">${LOGO.svg.mark.replace(/<title>[\s\S]*?<\/title>/, '').replace(/<desc>[\s\S]*?<\/desc>/, '').replace('<svg ', '<svg aria-hidden="true" focusable="false" ').replace(/ role="img" aria-label="NeuroVault"/, '')}</span>`;
}

/* ---- Settings: the mark and the app's name in the dialog's header, on a dark band in every theme (design profile "AI models uses
   four tabs; Settings has a dark header", 2026-10-19; feedback: "for the settings, I prefer a dark header!"). The band is the theme's
   darkest surface: a dark theme's background, darker; a light theme's ink. Its text passes AA (title 7:1 or more, the name 4.5:1),
   and the logo is drawn for the band (its accent lifted to 3:1 when the theme's accent is too dark on it). QC 74's place at the foot
   of the sections gives way to it. ---- */
const logoLum = h => { const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; };
const logoContrast = (a, b) => { const x = logoLum(a), y = logoLum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
function setHeadTones() {   // the user, 2026-10-19: "i meant it should be the same ad the side bar settings - which changes with the themes!":
  // the head takes the Settings sidebar's surface (.settings-nav: --panel) and the theme's own text, muted and accent colours
  const cs = getComputedStyle(app), v = k => logoHex(cs.getPropertyValue(k).trim() || '#000000');
  return { band: v('--panel'), fg: v('--text'), sub: v('--muted'), acc: v('--accent') };
}
{ const s0 = settingsModal; settingsModal = function () {   // eslint-disable-line no-global-assign
  const h = s0.apply(this, arguments), t = setHeadTones(), logo = logoMarkHtml('nv-logo nv-logo--head', logoVars({ bg: t.band, text: t.fg, accent: t.acc }));
  return h.replace('<div class="modal-head">', `<div class="modal-head set-head" style="--set-band:${t.band};--set-fg:${t.fg};--set-sub:${t.sub}" data-set-head>${logo}`)
    .replace('<h2 class="modal-title" id="set-title">Settings</h2>', '<h2 class="modal-title" id="set-title">Settings</h2><div class="modal-sub set-head-sub">NeuroVault</div>'); }; }
/* ---- end Settings ---- */

/* ---- the window and taskbar icon ---- */
function logoIconSoon() {   // after each draw: when the colours changed, send the icon once things settle
  if (POP || !LOGO.svg.icon || !api() || CHECK && !LOGO.force) return;
  const key = JSON.stringify(logoNow()); if (key === LOGO.want) return;
  LOGO.want = key; clearTimeout(LOGO.t); LOGO.t = setTimeout(logoIconSend, LOGO.wait);
}
async function logoIconSend() {
  const vars = logoNow(), key = JSON.stringify(vars); if (key === LOGO.sent) return; LOGO.sent = key;
  const pngs = {};
  const late = ms => new Promise((_, no) => setTimeout(() => no(new Error('drawing the icon took too long')), ms));   // a hidden or minimised window can stall a decode
  try { for (const px of LOGO_PX) pngs[px] = await Promise.race([logoPng(LOGO.svg.icon, vars, px), late(5000)]); }   // QC 78: the bare icon at every size, filling its square
  catch (e) { console.warn('the icon', e); LOGO.sent = ''; return; }
  const r = await nv('window_icon', pngs); if (failed(r)) { console.warn('the icon', r?.message); LOGO.sent = ''; return; }
  // Build N (QC 111): the Ask chat's own window has its own taskbar button, and its own icon: the logo with a chat mark in the accent
  const ask = {}, svg = logoAskSvg(LOGO.svg.icon);
  try { for (const px of LOGO_PX) ask[px] = await Promise.race([logoPng(svg, vars, px), late(5000)]); } catch (e) { console.warn('the Ask icon', e); return; }
  const r2 = await nv('window_icon', ask, 'ask'); if (failed(r2)) console.warn('the Ask icon', r2?.message);
}
// QC 111: a speech bubble at the lower right, in the accent, cut out of the logo by a ring of its background (24 x 24 viewBox)
const LOGO_ASK_MARK = '<g data-nv-ask="1"><path d="M13.2 12.6h8.6a2.2 2.2 0 0 1 2.2 2.2v4.6a2.2 2.2 0 0 1-2.2 2.2h-4.4L14.6 23.8v-2.2h-1.4a2.2 2.2 0 0 1-2.2-2.2v-4.6a2.2 2.2 0 0 1 2.2-2.2z" fill="var(--logo-accent)" stroke="var(--logo-bg)" stroke-width="1.1" stroke-linejoin="round"/>'
  + '<circle cx="14.9" cy="17.1" r="1" fill="var(--logo-bg)"/><circle cx="17.5" cy="17.1" r="1" fill="var(--logo-bg)"/><circle cx="20.1" cy="17.1" r="1" fill="var(--logo-bg)"/></g>';
const logoAskSvg = svg => String(svg || '').replace(/<\/svg>\s*$/, LOGO_ASK_MARK + '</svg>');
const logoAfter0 = afterRender;
afterRender = function () { logoAfter0(); logoIconSoon(); };   // eslint-disable-line no-global-assign

// The three drawings, read once; the window bar draws again when they're in
Promise.all(Object.entries(LOGO_FILES).map(([k, f]) => fetch(f).then(r => r.ok ? r.text() : Promise.reject(new Error(f))).then(t => { LOGO.svg[k] = t; })))
  .then(() => { if (started) renderAll(); }).catch(e => console.warn('the logo', e));   // before the first draw, that draw has them
/* ==== end Build N · the logo ==== */
