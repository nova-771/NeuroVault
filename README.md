# NeuroVault

A calm, local-first notes app for Windows, built for people with ADHD, dyslexia and Irlen syndrome, and for the people who
live with them. Notes, tasks, a focus timer, sticky notes, voice notes, a document viewer and optional AI help, in one
window that stays out of the way.

> **Early days.** NeuroVault is an early prototype under active development. Expect rough edges and changes; it is built and tested on Windows first.

NeuroVault is free software under the [GNU General Public License, version 3](LICENSE). Copyright (C) 2026 nova-771.

## What it is

- **Notes** are plain Markdown files in a folder you choose (an Obsidian vault works too: its files are read, not moved or
  changed). Tabs, a Word-like editor, tables, code blocks, photos with notes, a mind map of a note, Timeline history.
- **Tasks, a focus timer and sticky notes** that can pop out onto the desktop.
- **Made for reading comfort:** OpenDyslexic by default, other reader fonts, nine themes, accent colours with a
  colour-blind mode, a reading ruler, bionic reading, spelling help and autocorrect.
- **PDF and Word viewer** in its own window, with annotations.
- **Voice:** record a ramble and get a note; read aloud. Speech models run on your PC.

## Local first, and private

- Your notes stay on your PC. NeuroVault has no account and no server of its own. It goes online only when you ask: a model or font download, a dictionary lookup, or a cloud AI answer you have allowed.
- **AI is optional.** Models can run on your PC (llama.cpp, downloaded only when you ask). Cloud AI (Groq, Google Gemini,
  OpenRouter and others) needs **your own key**, which is stored in **Windows Credential Manager**, never in a file, and
  NeuroVault asks once before a cloud model reads a note. Nothing ships with a key.
- Notes that came from the web or an imported file are treated as data, never instructions, when an AI reads them.

## Run it from source

Windows 10 or 11 with the Microsoft Edge WebView2 runtime (already in Windows 11), and Python 3.11.

```bash
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python main.py
```

From source, the app writes `config.json` and its database beside `main.py`; the packaged app uses `%LOCALAPPDATA%\NeuroVault`. Both are ignored by git.

## Tests

```bash
.venv\Scripts\python test_api.py        # the backend, against a temp folder: it never touches a real vault or config
```

The front end has its own browser checks (`frontend/js/check.js`, opened with `?check=1`) and editor/Markdown suites under
`frontend/tests/`. Run browser checks muted, in a throw-away profile.

## Build the installer

`packaging/build_exe.py` builds the one-folder app with PyInstaller (`packaging/neurovault.spec`) and, with `--installer`,
an Inno Setup installer (`packaging/neurovault.iss`). It builds from a `git archive` of `HEAD`, so only committed files
get in, and it ships the matching GPL source zip with the app. Pinned build packages: `packaging/requirements-lock.txt`.

## Layout

| Path | What |
|---|---|
| `main.py`, `api.py`, `db.py`, `vault.py`, … | the pywebview app and its Python backend |
| `frontend/` | the user interface (plain HTML, CSS and JavaScript, no build step), the viewer window and the front-end checks |
| `platform_layer/` | the per-OS parts (Windows today) |
| `packaging/` | PyInstaller spec, Inno Setup script, build script |
| `design/` | the API contract, editor behaviour notes and the logo |

## Third-party software and fonts

See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) for every library, font, dictionary and model, with its licence.
Licence texts sit beside the files they cover (`frontend/vendor/`, `frontend/viewer/vendor/`, `frontend/fonts/`,
`frontend/licences/`).
