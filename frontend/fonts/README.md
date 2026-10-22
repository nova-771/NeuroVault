# Reader fonts

Decoded from the fonts embedded in `design/vault-notes-mockups.html` (R20): Latin subsets, so the app needs no internet.

| File | Family | Licence |
|---|---|---|
| `OpenDyslexic-Regular.woff`, `OpenDyslexic-Bold.woff` | OpenDyslexic (the default), version 2.001 (the 2012–2013 web font) | Bitstream's original glyphs: Bitstream Vera Fonts licence. Abelardo Gonzalez's changes: CC BY 3.0 Unported. Both as the name tables say; the texts are in `OpenDyslexic-LICENSE.txt` |
| `Lexend-Variable.woff2` | Lexend, weights 400–700 | SIL Open Font License 1.1 (`OFL-LICENSE.txt`) |
| `AtkinsonHyperlegible-Regular.woff2`, `AtkinsonHyperlegible-Bold.woff2` | Atkinson Hyperlegible | SIL Open Font License 1.1 (`OFL-LICENSE.txt`) |

**A note on OpenDyslexic.** Its CC BY 3.0 terms are not on the FSF's list of GPL-compatible licences. The two files are separate font data that the page loads, not part of NeuroVault's program, so they stay under their own terms beside the GPL-3.0 code. If that ever matters, the later OpenDyslexic releases (SIL OFL 1.1) can replace them.

`css/tokens.css` declares them with `@font-face`. The fourth choice, System, uses the machine's own sans-serif.

## Previews for More fonts (Build E)

`previews/<id>.woff`, one per font in `font_list.json`: each family's Google Fonts file (the same file and sha256 the app downloads), instanced at Regular (400) and cut down with fontTools 4.66.1 to the sample line `bdpq · Il1 · 0O · Reading feels calmer when the letters stay put.` and the font's name, as WOFF. 4–6 KB each. They keep the fonts' copyright and SIL Open Font License 1.1 notices in their name tables. Settings → Reading & comfort → More fonts registers them as `nvp-<id>` so each row shows the real face before you download it.
