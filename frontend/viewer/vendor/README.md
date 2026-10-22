# frontend/viewer/vendor: the document viewer's libraries (Build DV)

Filled on 2026-10-19 after the user's yes ("Yes, download them (Recommended)": PDF.js, docx-preview, jszip and DOMPurify;
not mammoth) by `python packaging/fetch_viewer_vendor.py --yes`, from the npm registry, each tarball's sha512 and each file's
sha256 checked against `vendor-plan.json`. The app only hands a library to the viewer page when every one of its files is here
with its pinned hash (`docviewer.vendor_status`), and the build checks the same (`packaging/build_exe.py`). `.gitattributes`
keeps git from changing their line endings, so the hashes hold in every checkout.

```
frontend/viewer/vendor/
  vendor-plan.json            the pins: versions, tarball URLs, sha512 integrity, each file's sha256 and size
  NOTICES-ready.md            the THIRD-PARTY-NOTICES entries, added as each library goes in
  pdfjs/                      pdfjs-dist 6.4.299, Apache-2.0
    pdf.min.mjs               458,904 bytes   57456c8e0c81e46be31174b499ef77f2b9f5ee46d04412ba627320a36755d4c2
    pdf.worker.min.mjs      1,264,342 bytes   9536359f1b8367850d485731ca1d5e45c159a7b7a0912325e539937aa21ceb18
    LICENSE                    10,174 bytes   0d542e0c8804e39aa7f37eb00da5a762149dc682d7829451287e11b938e94594
    cmaps/                  169 files, 1,167,747 bytes (read through ViewerApi.vendor_file: the page has no network)
    standard_fonts/          16 files,   798,046 bytes (likewise)
  docx/                       docx-preview 0.4.1, Apache-2.0
    docx-preview.min.js        75,527 bytes   c4a133c65a112799e35b143c572dfff9e923a3bf39b5fd3b07a06aa0f8f530c2
    LICENSE                    11,558 bytes   8668bf4417d161e4eb4d47d6044526e4914d9eb3c748573d9bb7e87708c1253f
  jszip/                      jszip 3.10.2, MIT or GPL-3.0-or-later
    jszip.min.js               97,781 bytes   7f839b2d4688b845c105ebf5d2f9803075f91ea0fe72bdaac176c3a04dd3d2c1
    LICENSE.markdown           33,753 bytes   566c953c6090b1218ca6217dd7359d45dde46581968586dc607d59a78af6a9c4
  dompurify/                  dompurify 3.4.17, MPL-2.0 or Apache-2.0
    purify.min.js              29,828 bytes   cd37898f9782adf54820c413191b5691803f0f137c799d6edcfd38523b4c2c31
    LICENSE                    11,358 bytes   cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30
  mammoth/ (optional)         mammoth 1.13.0, BSD-2-Clause, only with --mammoth (not wired into the viewer yet)
```

Total in the app: about 3.9 MB (PDF.js 3.7 MB with its maps and fonts; the Word reader 0.2 MB). Not taken: PDF.js's
`web/` viewer components (we draw our own overlay), `wasm/` (useWasm is off, so the CSP needs no `'wasm-unsafe-eval'`),
`legacy/` and `types/`. Hashes come from jsDelivr's listing of each published package and npm's own `integrity`, read
2026-10-19; nothing was downloaded to get them.
