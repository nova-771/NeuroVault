/* NeuroVault logo colours: one theme and accent in, the logo's CSS variables out.
   It matches design/logo-options.html (the "Every theme and accent" grid, lit from the upper left, Accent inside) colour for colour.
   bg and text are the theme's --bg and --text (tokens.css); accent is the hex the app puts in --accent
   (accents.js accentHex(theme), so a custom colour arrives already shaded for that theme). */
'use strict';

// The page's mix(): each channel moved t of the way from a to b, rounded like Math.round
function logoMix(a, b, t) {
  const h = x => [1, 3, 5].map(i => parseInt(x.slice(i, i + 2), 16));
  const A = h(a), B = h(b);
  return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

function logoVars({ bg, text, accent }) {
  return {
    '--logo-bg': bg,                          // the shades are each colour mixed toward this
    '--logo-ink': text,                       // the big cube
    '--logo-accent': accent,                  // the small cube and its beams
    '--logo-tile': logoMix(bg, text, .12),    // the tile: a step from the background toward the text
    '--logo-light-theme': parseInt(bg.slice(1, 3), 16) > 128 ? 1 : 0   // the page's own light-theme test
  };
}

// For an <img>, a canvas or a Windows icon: put the variables on the SVG's root, where its shapes can read them
function logoSvgFor(svgText, vars) {
  const style = Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';');
  return svgText.replace('<svg ', `<svg style="${style}" `);
}

// Draw the logo at one size: for the window and taskbar icon, hypercube-icon.svg at every size (QC 78)
async function logoPng(svgText, vars, size) {
  const url = URL.createObjectURL(new Blob([logoSvgFor(svgText, vars)], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    cv.getContext('2d').drawImage(img, 0, 0, size, size);
    return cv.toDataURL('image/png');
  } finally { URL.revokeObjectURL(url); }
}

if (typeof module !== 'undefined') module.exports = { logoMix, logoVars, logoSvgFor, logoPng };
