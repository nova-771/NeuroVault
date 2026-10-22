# Third-party notices

NeuroVault: Copyright (C) 2026 nova-771.

NeuroVault is licensed under the GNU General Public License, version 3 ([LICENSE](LICENSE)), and shipped as a packaged
installer. It uses the open-source software, fonts, data and models below. Each keeps its own licence, and NeuroVault
doesn't change them. Most are permissive (MIT, BSD, Apache and similar); the few copyleft parts (LGPL and GPL) are
listed under [Parts with copyleft licences](#parts-with-copyleft-licences). All the code is compatible with GPL-3.0. A few
fonts are separate data files under their own licences (see [Fonts](#fonts-sil-open-font-license-11-httpsopenfontlicenseorg),
OpenDyslexic and the PDF viewer's Liberation Sans); they are shipped beside the program, not linked into it.
"Downloaded" means the app fetches it from the official source only when you ask, and checks its size and sha256 first.

Each Python package's full licence text ships inside its install (`site-packages/<package>-<version>.dist-info/`).

## PDF to Markdown (Build K, added 2026-10-17)

| Package | Version | Licence | What it does here |
|---|---|---|---|
| [pdfplumber](https://github.com/jsvine/pdfplumber) | 0.11.10 | MIT | Reads a PDF's words, fonts, ruled tables, links and pictures |
| [pdfminer.six](https://github.com/pdfminer/pdfminer.six) | 20260107 | MIT | The PDF parser under pdfplumber |
| [pypdfium2](https://github.com/pypdfium2-team/pypdfium2) | 5.13.0 | BSD-3-Clause or Apache-2.0 | Draws a PDF picture as a PNG when it isn't a plain JPEG |

pdfplumber and pdfminer.six also use these packages, which were already installed:

| Package | Version | Licence |
|---|---|---|
| [Pillow](https://python-pillow.org) | 12.3.0 | MIT-CMU (HPND) |
| [cryptography](https://github.com/pyca/cryptography) | 48.0.1 | Apache-2.0 or BSD-3-Clause |
| [charset-normalizer](https://github.com/jawah/charset_normalizer) | 3.4.4 | MIT |

**PDFium inside pypdfium2.** pypdfium2 ships Google's PDFium (BSD-3-Clause) and the libraries it's built with. Their
licences are in `pypdfium2-5.13.0.dist-info/licenses/data/windows_x64/BUILD_LICENSES/`. All of them are permissive:
- pdfium-binaries (the build of PDFium that pypdfium2 uses): MIT;
- abseil, LLVM libc: Apache-2.0 (LLVM's adds the "LLVM exception");
- AGG 2.3, fast_float, simdutf: BSD, MIT or Apache-2.0;
- FreeType: used under the FreeType Licence (FTL). FreeType lets you choose FTL or GPLv2, and FTL is permissive;
- ICU: the Unicode licence. Its file also quotes the GPL text of the Autoconf build scripts, which aren't part of the
  library;
- Little CMS: MIT;
- libjpeg-turbo: the IJG and BSD-3-Clause licences;
- OpenJPEG: BSD-2-Clause;
- libpng: the libpng licence;
- libtiff: the libtiff (BSD-style) licence;
- zlib: the zlib licence.

Word `.docx` files are read with Python's standard library (`zipfile`, `xml.etree`), so they need no package.

<!-- Fix B (QC round 3, item 22): the licence audit's draft notices, merged below Build K's section and updated for
     GPL-3.0 and the packaged installer (2026-10-17). -->

## Cloud AI keys in Windows Credential Manager (Build N, R56, added 2026-10-19)

| Package | Version | Licence | What it does here |
|---|---|---|---|
| [keyring](https://github.com/jaraco/keyring) | 25.7.0 | MIT | Keeps each person's own cloud AI key in Windows Credential Manager, never in a file |
| [pywin32-ctypes](https://github.com/enthought/pywin32-ctypes) | 0.2.3 | BSD-3-Clause | keyring's way into Credential Manager on Windows |
| [jaraco.classes](https://github.com/jaraco/jaraco.classes) | 3.4.0 | MIT | Used by keyring |
| [jaraco.functools](https://github.com/jaraco/jaraco.functools) | 4.6.0 | MIT | Used by keyring |
| [jaraco.context](https://github.com/jaraco/jaraco.context) | 6.1.2 | MIT | Used by keyring |
| [more-itertools](https://github.com/more-itertools/more-itertools) | 11.1.0 | MIT | Used by jaraco.classes and jaraco.functools |
| [backports.tarfile](https://github.com/jaraco/backports.tarfile) | 1.2.0 | MIT | Used by jaraco.context on Python 3.11 |
| [importlib_metadata](https://github.com/python/importlib_metadata) | 9.0.1 | Apache-2.0 | Used by keyring on Python 3.11 to find its Windows backend |
| [zipp](https://github.com/jaraco/zipp) | 4.1.0 | MIT | Used by importlib_metadata |

NeuroVault ships no cloud key and talks to a company only after you add your own key and say yes once. The companies
(Groq, Google Gemini, OpenRouter, Cloudflare Workers AI, Cerebras, Hugging Face, Anthropic, OpenAI) are services with
their own terms, linked from each card in Settings → AI models; no code of theirs is included.

## Included in this repository

### marked 18.0.14: MIT
Copyright (c) 2018+, MarkedJS (https://github.com/markedjs/)
Copyright (c) 2011-2018, Christopher Jeffrey (https://github.com/chjj/)
Includes the BSD-style Markdown notice, Copyright (c) 2004, John Gruber.
Full text: `frontend/vendor/marked-18.0.14.LICENSE`

### Turndown 7.2.4: MIT
Copyright (c) 2017 Dom Christie
Full text: `frontend/vendor/turndown-7.2.4.LICENSE`

### truststore 0.10.4: MIT (bundled with the app)
Copyright (c) 2022 Seth Michael Larson. HTTPS certificates checked with Windows' own certificate store (QC 81, netssl.py).
Wheel `truststore-0.10.4-py3-none-any.whl`, 18,660 bytes, sha256 adaeaecf1cbb5f4de3b1959b42d41f6fab57b2b1666adb59e89cb0b53361d981.
Full text: https://github.com/sethmlarson/truststore/blob/main/LICENSE

### highlight.js 11.11.1: BSD-3-Clause
Copyright (c) 2006, Ivan Sagalaev; (c) 2006-2024 Josh Goebel and other contributors.
The code blocks' colours (Build V, mockup R57). The "common" bundle, `@highlightjs/cdn-assets@11.11.1/highlight.min.js`
(127,496 bytes, sha256 xKOZ3W9Ii8l6NUbjR2dHs+cUyZxXuUcxVMb7jSWbk4E=), unchanged.
Full text: `frontend/vendor/highlight-11.11.1.LICENSE`

### Icons: Lucide (ISC) and Feather (MIT)
Some icons are drawn in, or copied from, Lucide (https://lucide.dev).
Copyright (c) 2026 Lucide Icons and Contributors. ISC Licence.
Icons derived from Feather: Copyright (c) 2013-present Cole Bemis. MIT Licence.
Full texts: `frontend/licences/lucide-feather-LICENSE.txt`.

### Fonts: SIL Open Font License 1.1 (https://openfontlicense.org)
- (Licence text: `frontend/fonts/OFL-LICENSE.txt`.)
- Lexend, Copyright 2018 The Lexend Project Authors (https://github.com/googlefonts/lexend)
- Atkinson Hyperlegible, Copyright 2020 Braille Institute of America, Inc.
  (https://github.com/googlefonts/atkinson-hyperlegible)
- **OpenDyslexic** (the default font), by Abelardo Gonzalez: `frontend/fonts/OpenDyslexic-Regular.woff` and
  `OpenDyslexic-Bold.woff`, version 2.001 (the 2012–2013 web font, as shipped). Their name tables say:
  "Original Fonts are © Bitstream. OpenDyslexic changes and additional glyphs by Abelardo Gonzalez are licensed under a
  Creative Commons Attribution 3.0 Unported License. Based on a work at http://dyslexicfonts.com. ♡2012 by Abelardo
  Gonzalez. Copying is an act of love. Please copy."
  - Bitstream's original glyphs: the Bitstream Vera Fonts licence (OpenDyslexic is derived from Bitstream Vera Sans).
  - Abelardo Gonzalez's changes: CC BY 3.0 Unported, https://creativecommons.org/licenses/by/3.0/.
  - Both texts, with the notice above: `frontend/fonts/OpenDyslexic-LICENSE.txt`.
  - CC BY 3.0 is not on the FSF's list of GPL-compatible licences. The two font files are separate data files, not part of
    NeuroVault's program, so they stay under their own terms beside it. If that ever matters to you, the later
    OpenDyslexic releases (SIL OFL 1.1) are a drop-in replacement.
  - The two files are Latin subsets of that web font (see `frontend/fonts/README.md`), with its name tables kept. Both
    licences allow this; the Bitstream licence asks only that a changed font isn't named "Bitstream" or "Vera".
  - Later OpenDyslexic releases are under the SIL OFL 1.1; NeuroVault ships this earlier version.
- The small preview files in `frontend/fonts/previews` are cut-down copies of the fonts in "More fonts" below, with
  their copyright and licence notices kept.

The fonts are not sold on their own.

### PDF.js 6.4.299 (pdfjs-dist): Apache-2.0 (the document viewer, Build DV)
Copyright Mozilla Foundation and the PDF.js contributors. Draws PDFs in the viewer window, with no scripting, no XFA,
no eval and no network (docviewer.py, frontend/viewer/renderers.js). Not older than 6.2.108 (CVE-2026-16633).
Files: `build/pdf.min.mjs`, `build/pdf.worker.min.mjs`, `cmaps/` (Adobe's character maps, BSD-3-Clause, their LICENSE
inside), `standard_fonts/` (Foxit's fonts, BSD-3-Clause, and Liberation Sans 1.x, GPL-2.0 with the Liberation font exception, their licences inside: the fonts are separate data files the viewer loads, not part of NeuroVault's program, so the licences don't combine).
Tarball `pdfjs-dist-6.4.299.tgz`, sha512 `AVl138zALtfaAPvADulE0PZThbYzCBS79nL4pOSL/6Sm/4AH5A21BD9VHt97OlCuzJuCpmeZtAtkinisF4Vb1g==`.
Full text: `frontend/viewer/vendor/pdfjs/LICENSE`

### docx-preview 0.4.1: Apache-2.0 (the document viewer, Build DV)
Copyright Volodymyr Baydalka and the docxjs contributors. Lays out Word (.docx) files as pages in the viewer window;
its output is cleaned by DOMPurify before it's shown, with embedded HTML (altChunks) off.
File: `dist/docx-preview.min.js`. Tarball `docx-preview-0.4.1.tgz`, sha512 `Dv4g+LeE0swHpPvNC0lAT0YsR5Zq5pAxw7d3vHQ8EChBLgIrqqe9VPL5nVt2HBJap8bEZbXUI0TJob7kBeNU9w==`.
Full text: `frontend/viewer/vendor/docx/LICENSE`

### JSZip 3.10.2: MIT (dual MIT or GPL-3.0-or-later; NeuroVault uses it under MIT)
Copyright (c) 2009-2016 Stuart Knightley, David Duponchel, Franz Buchinger, António Afonso. Opens .docx files (they are
zip files) for docx-preview. Includes pako (MIT). File: `dist/jszip.min.js`.
Tarball `jszip-3.10.2.tgz`, sha512 `3l+rb15IOWtUhU0H5MFqES/T6Kh7abYwjosBey/vD6hDt8zoEffkSC5Ws5SGtgVw3gBx2NEbhTeSW1+kWkpyTQ==`.
Full text: `frontend/viewer/vendor/jszip/LICENSE.markdown`

### DOMPurify 3.4.17: Apache-2.0 (dual MPL-2.0 or Apache-2.0; NeuroVault uses it under Apache-2.0)
Copyright Cure53 (Dr.-Ing. Mario Heiderich) and the DOMPurify contributors. Cleans each Word page's HTML before the viewer
shows it (never in IN_PLACE mode). File: `dist/purify.min.js`.
Tarball `dompurify-3.4.17.tgz`, sha512 `B/pSlYVHQ58kqISD/yDjuJ1yfzI34m1gF4lAod2bwSRhiN4K5Cl3H8Af7hqB2PmTL911tdEudnnXn5FnhRoz0w==`.
Full text: `frontend/viewer/vendor/dompurify/LICENSE`

## Downloaded when you choose to

### More fonts
Atkinson Hyperlegible Next (Braille Institute), Lexend Deca / Exa / Giga (Lexend Project Authors), Andika (SIL
International), Comic Neue (Craig Rozynski), Inter (Rasmus Andersson), Literata (TypeTogether for Google). All SIL Open
Font License 1.1, from the Google Fonts repository (https://github.com/google/fonts).

### Dictionary data
Open English WordNet 2025 by the Open English WordNet team (https://en-word.net), licensed under CC BY 4.0
(https://creativecommons.org/licenses/by/4.0/). Based on Princeton WordNet: WordNet 3.1 Copyright 2011 by Princeton
University. All rights reserved. The Princeton WordNet licence is in `frontend/licences/wordnet-licence.txt`.
Princeton's name is not used to promote NeuroVault.
Reference: McCrae, Rademaker, Bond, Rudnicka, Fellbaum (2019), "English WordNet 2019 - An Open-Source WordNet for
English", Proceedings of GWC 2019.

### Word frequencies for autocorrect (Build N, QC 76, added 2026-10-18)
`frequency_dictionary_en_82_765.txt` from SymSpell by Wolf Garbe (https://github.com/wolfgarbe/SymSpell, MIT License,
Copyright (c) 2025 Wolf Garbe), 1,332,881 bytes, shipped unchanged inside the packaged app (`_internal\`; the source keeps it
in `packaging/data/`). Its counts were
made by intersecting Google Books Ngram data (http://storage.googleapis.com/books/ngrams/books/datasetsv2.html, licensed CC BY
3.0, https://creativecommons.org/licenses/by/3.0/) with SCOWL, Spell Checker Oriented Word Lists (http://wordlist.aspell.net/,
http://wordlist.aspell.net/scowl-readme/). NeuroVault's own code ranks spellings with it (autocorrect.py, written for
NeuroVault after SymSpell's method); no SymSpell code is included. The notice is in `frontend/licences/symspell-frequencies.txt`.

### llama.cpp (llama-server): MIT
Copyright (c) 2023-2026 The ggml authors. https://github.com/ggml-org/llama.cpp. Its release includes cpp-httplib (MIT),
nlohmann/json (MIT), stb and miniaudio (public domain), and BoringSSL (OpenSSL/ISC-style licences).

### AI and voice models (they run on your PC)
| Model | By | Licence |
|---|---|---|
| Qwen3.5 0.8B, 2B, 4B, 9B | Alibaba Qwen | Apache-2.0 |
| Gemma 4 E2B | Google | Apache-2.0 |
| Phi-4-mini-instruct | Microsoft | MIT |
| Whisper base.en, small.en (sherpa-onnx int8 export) | OpenAI | MIT |
| Streaming Zipformer 20M, English | k2-fsa / icefall | Apache-2.0 |
| Kokoro v0.19 voices (read aloud) | hexgrad | Apache-2.0 (the download also holds espeak-ng-data, GPL-3.0-or-later) |

GGUF files come from unsloth's Hugging Face repositories; the voice and speech models from csukuangfj / k2-fsa
(sherpa-onnx). Their licences follow the original models. Model files you add yourself keep their own licences.

Piper's `en_US-amy` and `en_GB-alan` voices are no longer offered: Alan's data is "All Rights Reserved" and Amy's card
names no licence. If one is already on a PC, NeuroVault doesn't list it, and read aloud uses Kokoro instead.

## Other Python packages

| Package | Licence |
|---|---|
| pywebview | BSD-3-Clause |
| pythonnet, bottle, proxy_tools, cffi | MIT |
| clr-loader | MIT |
| typing_extensions | PSF-2.0 |
| pycparser | BSD-3-Clause |
| numpy | BSD-3-Clause (and 0BSD, MIT, Zlib, CC0-1.0 for parts) |
| sounddevice (with PortAudio) | MIT |
| soundfile | BSD-3-Clause (its bundled libsndfile: see below) |
| sherpa-onnx | Apache-2.0 (its compiled library includes espeak-ng: see below) |
| ONNX Runtime (inside sherpa-onnx) | MIT |
| keyboard (optional) | MIT |
| pystray (optional) | LGPL-3.0 (see below) |

## Parts with copyleft licences

All of these are compatible with NeuroVault's GPL-3.0.
- **sherpa-onnx** is Apache-2.0, but its compiled library (`_sherpa_onnx.pyd`, `sherpa-onnx-c-api.dll`) includes
  **espeak-ng** (GPL-3.0-or-later, https://github.com/espeak-ng/espeak-ng), and the voice downloads contain
  `espeak-ng-data`. Speech to text and read aloud use it. NeuroVault is GPL-3.0 too, so the installer may include it.
  Its source: https://github.com/k2-fsa/sherpa-onnx, and the espeak-ng fork it builds, https://github.com/csukuangfj/espeak-ng.
- **soundfile** bundles libsndfile, which includes libmpg123 (LGPL-2.1) and LAME (LGPL-2.0-or-later). The other
  libraries in it (libogg, libopus, libvorbis, libFLAC) are BSD-3-Clause. Source: https://github.com/libsndfile/libsndfile.
  Without soundfile, voice clips are saved as .wav.
- **pystray** (optional) is LGPL-3.0-or-later (https://github.com/moses-palmer/pystray). It keeps NeuroVault in the tray
  while a sticky or the timer is popped out.

## Windows components
NeuroVault shows its window with Microsoft Edge WebView2. Windows 11 already has the WebView2 Runtime; when a PC
doesn't, the installer runs Microsoft's **WebView2 Evergreen Bootstrapper** (`MicrosoftEdgeWebview2Setup.exe`, shipped
inside the installer and deleted after use), which downloads the runtime from Microsoft. pywebview includes the
Microsoft.Web.WebView2 .NET libraries, and the packaged app includes **`VCRUNTIME140.dll` / `VCRUNTIME140_1.dll`** (the
Microsoft Visual C++ runtime Python is built with). All of these are Microsoft's, under Microsoft's own redistribution
terms. They ship as **System Libraries**, which GPL-3.0 section 1 leaves out of the "Corresponding Source": NeuroVault's
GPL-3.0 doesn't cover them, and their source isn't offered. The same goes for the Microsoft Visual C++ 2015-2022
Redistributable, if a later installer includes it for the AI engine. NeuroVault also uses parts of Windows itself
(.NET Framework 4.8, the spell checker, DWM), which are never shipped.

## What the packaged app contains
The installer is built with [PyInstaller](https://pyinstaller.org) 6.22 (GPL-2.0-or-later with its bootloader
exception, which lets the bootloader in `NeuroVault.exe` ship with any app) and [Inno Setup](https://jrsoftware.org/isinfo.php)
6.7 (Inno Setup Licence). Beside the packages above, the app folder holds:

| File | What | Licence |
|---|---|---|
| `python311.dll`, `python3.dll`, `base_library.zip`, `*.pyd` | Python 3.11.15 | PSF-2.0 |
| `libssl-3-x64.dll`, `libcrypto-3-x64.dll` | OpenSSL 3 (Python's ssl) | Apache-2.0 |
| `libffi-8.dll` | libffi (Python's ctypes) | MIT |
| `sqlite3.dll` | SQLite | Public domain |
| `pythonnet/runtime/*` | Python.NET's runtime and .NET Standard facades | MIT (facades: Microsoft, MIT) |
| `setuptools/` (pulled in by PyInstaller's runtime) | setuptools | MIT |
| `PIL/` | Pillow (pdfplumber uses it) | MIT-CMU |
| `cryptography/`, `charset_normalizer/` | pdfminer.six's dependencies | Apache-2.0 OR BSD-3-Clause; MIT |

Each package's own licence text is in its `*.dist-info` folder inside `_internal`, where it ships one.

**Source code.** NeuroVault is GPL-3.0, so its complete source travels with it: `source\NeuroVault-<commit>-source.zip`
in the app folder is the exact commit the app was built from, including `packaging\` (the build script, the
PyInstaller spec and this installer's script). The source of the GPL and LGPL parts is linked above.

## Packaging the installer (checklist, done by `packaging/build_exe.py`)
- **Leave out sounddevice's `libportaudio64bit-asio.dll`** (in `_sounddevice_data/portaudio-binaries/`). It is built
  with Steinberg's ASIO SDK, which is proprietary (or GPL-3.0 since October 2025, depending on the SDK version used).
  NeuroVault uses the plain `libportaudio64bit.dll`, which is MIT. (The spec filters it out; the build fails if it's there.)
- **Ship the LGPL notices**: soundfile's `_soundfile_data/COPYING` (the LGPL-2.1 text that covers libsndfile,
  libmpg123 and LAME) stays next to `libsndfile_x64.dll`. The build is one folder, not one file, so `libsndfile_x64.dll`
  stays a separate, replaceable file, as the LGPL asks. pystray is not included.
- **GPL-3.0 parts:** `LICENSE`, this file and the source zip sit next to `NeuroVault.exe`.
- Before each release, compare the frozen file list (`dist\NeuroVault\_internal`) with the table above.
