# THIRD-PARTY-NOTICES entries for the document viewer: ready, not shipped yet

These go into THIRD-PARTY-NOTICES.md (under "Included in this repository") only once the files are in
frontend/viewer/vendor/: `packaging/fetch_viewer_vendor.py --yes` adds each one after its files pass their hash checks.
Until then nothing below is in the app. Every licence is GPL-3.0-compatible (Apache-2.0, MIT, MPL-2.0, BSD-2-Clause).
Check each copyright line against the LICENSE file that arrives with the package.

<!-- notice:pdfjs -->
### PDF.js 6.4.299 (pdfjs-dist): Apache-2.0 (the document viewer, Build DV)
Copyright Mozilla Foundation and the PDF.js contributors. Draws PDFs in the viewer window, with no scripting, no XFA,
no eval and no network (docviewer.py, frontend/viewer/renderers.js). Not older than 6.2.108 (CVE-2026-16633).
Files: `build/pdf.min.mjs`, `build/pdf.worker.min.mjs`, `cmaps/` (Adobe's character maps, BSD-3-Clause, their LICENSE
inside), `standard_fonts/` (Foxit's fonts, BSD-3-Clause, and Liberation Sans 1.x, GPL-2.0 with the Liberation font exception, their licences inside).
Tarball `pdfjs-dist-6.4.299.tgz`, sha512 `AVl138zALtfaAPvADulE0PZThbYzCBS79nL4pOSL/6Sm/4AH5A21BD9VHt97OlCuzJuCpmeZtAtkinisF4Vb1g==`.
Full text: `frontend/viewer/vendor/pdfjs/LICENSE`
<!-- /notice -->

<!-- notice:docx -->
### docx-preview 0.4.1: Apache-2.0 (the document viewer, Build DV)
Copyright Volodymyr Baydalka and the docxjs contributors. Lays out Word (.docx) files as pages in the viewer window;
its output is cleaned by DOMPurify before it's shown, with embedded HTML (altChunks) off.
File: `dist/docx-preview.min.js`. Tarball `docx-preview-0.4.1.tgz`, sha512 `Dv4g+LeE0swHpPvNC0lAT0YsR5Zq5pAxw7d3vHQ8EChBLgIrqqe9VPL5nVt2HBJap8bEZbXUI0TJob7kBeNU9w==`.
Full text: `frontend/viewer/vendor/docx/LICENSE`
<!-- /notice -->

<!-- notice:jszip -->
### JSZip 3.10.2: MIT (dual MIT or GPL-3.0-or-later; NeuroVault uses it under MIT)
Copyright (c) 2009-2016 Stuart Knightley, David Duponchel, Franz Buchinger, António Afonso. Opens .docx files (they are
zip files) for docx-preview. Includes pako (MIT). File: `dist/jszip.min.js`.
Tarball `jszip-3.10.2.tgz`, sha512 `3l+rb15IOWtUhU0H5MFqES/T6Kh7abYwjosBey/vD6hDt8zoEffkSC5Ws5SGtgVw3gBx2NEbhTeSW1+kWkpyTQ==`.
Full text: `frontend/viewer/vendor/jszip/LICENSE.markdown`
<!-- /notice -->

<!-- notice:dompurify -->
### DOMPurify 3.4.17: Apache-2.0 (dual MPL-2.0 or Apache-2.0; NeuroVault uses it under Apache-2.0)
Copyright Cure53 (Dr.-Ing. Mario Heiderich) and the DOMPurify contributors. Cleans each Word page's HTML before the viewer
shows it (never in IN_PLACE mode). File: `dist/purify.min.js`.
Tarball `dompurify-3.4.17.tgz`, sha512 `B/pSlYVHQ58kqISD/yDjuJ1yfzI34m1gF4lAod2bwSRhiN4K5Cl3H8Af7hqB2PmTL911tdEudnnXn5FnhRoz0w==`.
Full text: `frontend/viewer/vendor/dompurify/LICENSE`
<!-- /notice -->

<!-- notice:mammoth -->
### mammoth 1.13.0: BSD-2-Clause (optional: a simple view of Word files)
Copyright (c) 2013, Michael Williamson. Only if a Word file breaks docx-preview; its HTML goes through DOMPurify too.
Not older than 1.11.0 (CVE-2025-11849). File: `mammoth.browser.min.js`.
Tarball `mammoth-1.13.0.tgz`, sha512 `2cawcYFcP7ISfXbBcL9lmVgTNWo88v/52ND1gnywHtVT/pX0//puPnf0iMPV9ZgmuvNOE+zkIhDgZ9M2c2dDDg==`.
Full text: `frontend/viewer/vendor/mammoth/LICENSE`
<!-- /notice -->
