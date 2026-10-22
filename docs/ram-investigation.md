# NeuroVault RAM investigation (2026-10-17)

Branch `claude/investigate-ram-d720ca`, cut from `build/new-frontend` at `a1ddf3d`. Pop-out windows (Build H) and the
WordNet dictionary (Build J) are not on this branch yet, so they are covered as checks to do once they land.

## In short

- **The window itself is small.** With 800 notes, Python plus WebView2 settle at about **250–300 MB of private memory**.
- **The big numbers come from three engines that stay loaded once they start:**
  - **Speech-to-text:** Whisper base.en adds **+410 MB**; small.en adds **+800 MB**.
  - **Read aloud:** Kokoro adds **+285 MB**.
  - **Local AI:** `llama-server` starts **at every launch** when a model is set, and its prompt cache grew by
    **+1.2 GB after six prompts**. That growth is now fixed.

  Any of these on top of the window gives the 900 MB – 1.5 GB you saw.
- **Five quick fixes are committed** (below):
  - the AI prompt cache;
  - numpy's thread buffers;
  - a Settings → Voice freeze;
  - DevTools opening by itself;
  - trimming memory while minimised.

  The biggest remaining wins are proposals for you to pick: **unload speech models when idle** and **start the AI
  engine only when it's used**.

## How it was measured

- **The app:** the worktree's own `main.py`, unchanged, launched by a scratch harness. The harness walked the views
  through `evaluate_js` (no mouse or keyboard).
- **The data:** a test `neurovault.db` holding 800 synthetic notes (4.4 MB of Markdown), with links and tags.
- **The steps, in order:**
  1. boot;
  2. open 60 notes in tabs;
  3. visit Graph, Tasks, Timer and Timeline;
  4. 300 full re-renders, 25 ms apart;
  5. close the tabs;
  6. open Settings → Voice;
  7. minimise.
- **The numbers:** for every process in NeuroVault's tree (Python → msedgewebview2 children → llama-server), from
  `Win32_Process.PrivatePageCount` (**commit**) and `Win32_PerfRawData_PerfProc_Process.WorkingSetPrivate`
  (**private WS**, which is what Task Manager's "Memory" column shows).
- **The engines on their own:**
  - Python imports and the speech engines were measured in a separate Python process;
  - `llama-server` was run on its own with the app's exact arguments
    (Qwen3.5 4B Q4_K_M, Vulkan on the RX 7900 XTX, `-ngl 99`, ctx 8192).

Which Task Manager column you read changes the number a lot:
- **"Memory" (private working set):** the RAM really in use.
- **"Commit size":** memory promised to the process, even if it never touches it.
- **"Working set":** also counts the AI model file mapped into memory (2.6 GB), which Windows can drop at any time.

## 1. Process map (test copy, 800 notes)

| Process | What it is | Commit | Private WS | Notes |
|---|---|---:|---:|---|
| `python.exe` (venv launcher) | the `venv\Scripts\python.exe` stub | 1 MB | 0.6 MB | starts the real interpreter |
| `python.exe` (real) | api.py, db.py, pywebview, pythonnet/.NET | **83 MB** | 65 MB | about 34 MB of it is pythonnet/.NET for WinForms |
| `msedgewebview2` browser | WebView2's main process | 48 MB | 38 MB | |
| `msedgewebview2` GPU | compositing, canvas | 100–170 MB | 54–68 MB | |
| `msedgewebview2` renderer | the page | **70–125 MB** settled | 60–115 MB | rises to 300–400 MB during heavy re-rendering, then falls (§2.4) |
| `msedgewebview2` renderer (DevTools) | DevTools, opened by itself at start | 70–76 MB | 60–65 MB | **fixed**: no longer opens unasked |
| `msedgewebview2` network / storage / crashpad | utility processes | 15 / 7 / 3 MB | 10 / 3 / 2 MB | |
| **Window total** | | **~360–420 MB** | **~250 MB** | after the fixes, no speech or AI used |
| `llama-server.exe` | local AI engine, child of Python | **3,755 MB** | **160 MB** at idle | 2.8 GB working set = the mapped model file (shareable); private WS reached **1,353 MB** after 6 prompts before the fix |
| + Whisper base.en in `python.exe` | speech to text, after first use | +410 MB | +355 MB | stays loaded until the app closes |
| + Whisper small.en | | +810 MB | +680 MB | stays loaded |
| + live words (zipformer) | | +45 MB | +45 MB | stays loaded |
| + Kokoro read-aloud voice | | +285 MB | +245 MB | stays loaded; Piper is about 95 MB less |
| + numpy (OpenBLAS) | first voice, read-aloud or setup call | **+490 MB** | +10 MB | **fixed**: now about +8 MB (83 → 91 MB in the app) |

The four speech rows were measured with numpy already loaded on one BLAS thread. Unloading each one gave back all
but about 17 MB (433 → 39 MB for Whisper base.en).

## 2. Causes, with numbers, confidence and fix

| # | Cause | MB | Sure? | Fix |
|---|---|---:|---|---|
| 1 | **Speech models never unload.** Whisper is cached in `voice._RECOGNIZERS` and `_LIVE_REC`; the read-aloud voice in `read_aloud._engine`. | +410 (base.en) / +810 (small.en) / +285 (Kokoro), commit and RAM | High (measured, and unloading frees it) | **Proposal P1** |
| 2 | **`llama-server` starts at every launch** when a model is set (`render-ai.js` → `ai_boot`), even if no AI feature is used that session. | 3.6 GB commit, 160 MB private, 2.6 GB mapped file | High | **Proposal P2** |
| 3 | **llama-server's prompt cache in system RAM** (`--cache-ram`, default 8192 MiB) grows with each long prompt. | +1,194 MB after 6 × 2.4k-token prompts; can reach 8 GB | High | **Fixed** (`68c180e`): `--cache-ram 0` gave +124 MB |
| 4 | **numpy's OpenBLAS commits ~32 MB per CPU thread** on import (16 threads). `voice.audio_ext()` imports soundfile → numpy, and runs from Settings → Voice, the voice dialog and the setup. | +480 MB commit (not RAM in use) | High | **Fixed** (`c9ac831`): `OPENBLAS_NUM_THREADS=1` (548 → 65 MB) |
| 5 | **Settings → Voice froze the page in a render loop.** `sttRows()` → `refreshVoiceStatus().then(renderAll)` → `sttRows()`… while `voice_status` was pending. | renderer 123 → 309 MB and climbing; page frozen 60 s+ | High (reproduced; gone after the fix) | **Fixed** (`9b651b8`) |
| 6 | **DevTools opened by itself** (`webview.start(debug=True)`, pywebview's `OPEN_DEVTOOLS_IN_DEBUG` defaults to True). | 70–76 MB commit, 60–65 MB RAM | High | **Fixed** (`c653b06`); `NEUROVAULT_DEVTOOLS=1` brings it back, F12 still works |
| 7 | **WebView2 kept its memory while minimised.** | 414 → 251 MB private WS with the fix | High (tested with the fix off) | **Fixed** (`ccdca73`): `MemoryUsageTargetLevel = Low` while minimised |
| 8 | **Whole-app `innerHTML` rebuild on every `renderAll()`**, garbage faster than GC: 60 tabs opened → 385 MB; 300 re-renders → 216–323 MB; a forced GC → 133 MB. No leak: it always falls back to 110–125 MB. | +200–300 MB peaks | High | **Proposal P4** |
| 9 | **All note bodies loaded at boot** (`list_notes(..., True)`) and kept in the JS heap. | JS heap 22–25 MB for 4.4 MB of notes | Medium (fine now; scales with the vault) | **Proposal P5** |
| 10 | **llama-server's 4 parallel slots** (`-np` auto). | −155 MB commit with `--parallel 1` (RAM the same) | High | **Proposal P6** |

### Checked and ruled out

- **Frontend size:** 800 KB of JS, 150 KB of CSS, and fonts as separate files. No base64 fonts or big inline data.
  `check.js` (118 KB) is QC-only.
- **Timers:**
  - `timerTick` (1 s) paints only the timer;
  - the wrap-up check runs every 30 s;
  - the graph's animation stops after 260 frames;
  - voice polls run only while the voice dialog is open.
- **Listener or canvas leaks:** none found. The renderer goes back to the same size after 300 re-renders and a GC.
- **Python at import:** `api.py` and every module come to 22 MB. numpy, sherpa-onnx, sounddevice and soundfile were
  already imported lazily.
- **SQLite:** WAL, default 2 MB page cache. The whole Python process is 83 MB with 800 notes.
- **WebView2 flags:** `--disable-gpu` would save the GPU process (~55–65 MB) but moves painting onto the CPU (not
  recommended). Flags can be passed through the `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` environment variable, even
  though pywebview sets its own arguments (checked with `--js-flags=--expose-gc`).

## 3. Fixes, ranked by MB saved against effort

### Done on this branch (each its own commit, with before/after in the message)

| Rank | Commit | Saves | Effort |
|---|---|---|---|
| 1 | `68c180e` llama-server `--cache-ram 0` (only when the build knows the flag) | **−1.07 GB RAM** after 6 long prompts; stops growth toward 8 GB | 2 lines |
| 2 | `c9ac831` `OPENBLAS_NUM_THREADS=1` in `main.py` | **−480 MB commit** once voice, read aloud or the setup is used | 1 line |
| 3 | `9b651b8` Settings → Voice render loop | **−190 MB and a frozen page** | 1 condition |
| 4 | `ccdca73` WebView2 memory target Low while minimised | **−160 MB RAM** while minimised | 20 lines |
| 5 | `c653b06` DevTools no longer opens by itself | **−70 MB** | 1 line |

The voice, read-aloud and local-AI tests in `test_api.py` pass (`test_phase6b_voice`, `test_phase6c_read_aloud`,
`test_build_b_local_ai`).

The window fixes were checked in the app run: one renderer, Python at 91 MB after Settings → Voice, the page still
responding, and the trim on minimise.

### Proposals: pick the ones you want

| Rank | Proposal | Saves | Effort | Trade-off |
|---|---|---|---|---|
| **P1** | **Unload speech models after a few idle minutes**: clear `voice._RECOGNIZERS`, `_LIVE_REC` and `read_aloud._engine`, say 3 min after the last recording or sentence, behind the existing locks. | **285–810 MB per model** (all of it comes back: 433 → 39 MB) | Small–medium | The next use reloads it: about 1 s for base.en or Kokoro, 2–3 s for small.en |
| **P2** | **Start the AI engine on first use, not at launch, and stop it after N idle minutes** (a setting, e.g. 10 min). | **3.6 GB commit, 160 MB RAM, 2.6 GB mapped** whenever AI isn't being used | Medium | First AI action after a pause waits about 2.3 s for the model to load (measured from its log) |
| P3 | Use the 0.8B model for the quick jobs (clean-ups, breakdowns) and keep 4B for long ones. | 4B → 0.8B: commit 3,755 → 1,312 MB, mapped 2.6 → 0.5 GB | Small (routing exists) | Lower quality on those jobs |
| P4 | Re-render only the part that changed (the sidebar, the tab strip, the note) instead of the whole app on every `renderAll()`. | 200–300 MB peaks in heavy use; also smoother | Large | Touches every view |
| P5 | Load note bodies when a note opens, not all at boot. | Small now (~20 MB at 800 notes); grows with the vault | Medium | Search and the graph need a backend query |
| P6 | `--parallel 1` for llama-server. | −155 MB commit | 1 line | Two AI jobs at once would queue |

**What I'd do: P1, then P2.** Together they take NeuroVault back to the ~250–300 MB window whenever you're not
actively using voice, read aloud or AI.

## 4. For the builds still landing

- **Pop-out sticky and timer windows (Build H):** each pywebview window adds one WebView2 renderer (about 60–100 MB
  here); the browser and GPU processes are shared.
  - Destroy a pop-out when it closes rather than hiding it.
  - Check that a hidden main window gets the same low memory target.
  - Measure with the harness below once it's merged.
- **WordNet dictionary (Build J):** keep the index on disk (SQLite or a memory-mapped file) and look words up there.
  Python dicts and sets of all of WordNet run to hundreds of MB, and they'd stay for the whole session.
- **Read aloud and voice:** P1 covers them. Only one Whisper model is loaded at a time unless both are used in one
  session.

## 5. Reproducing

The scratch scripts were not committed: the harness `nv_launcher.py`, `measure.ps1`, `seed.py` and the llama tests.
How they work:

- **`seed.py`** writes 800 synthetic notes into the worktree's own gitignored `neurovault.db`.
- **`nv_launcher.py`** runs `main.py` through `runpy`. It wraps `webview.start` with a driver thread that calls
  `evaluate_js` and then `measure.ps1` after each step.
- **`measure.ps1`** walks `Win32_Process` from the Python process by `ParentProcessId`. It reads `PrivatePageCount`
  and `WorkingSetPrivate`, leaving out its own `powershell.exe`.
