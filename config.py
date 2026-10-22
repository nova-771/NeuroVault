"""
Single JSON config file for the merged app — replaces the old NeuroVault
config.yaml and time-tracker config.json. All paths are resolved relative
to this file's directory (see utils.app_dir), never hardcoded absolutes,
so the config stays valid if the app folder is moved or copied to another
machine.
"""
import json
import logging
import os
import re  # Build E

from utils import app_dir

log = logging.getLogger(__name__)

CONFIG_PATH = os.path.join(app_dir(), "config.json")

DEFAULT_CONFIG = {
    "app_name": "NeuroVault",
    "default_view": "notes",

    # Leave blank to skip Obsidian export entirely (SQLite still gets everything).
    "obsidian_vault_path": "",
    # Build V: the vault folder; each note is a .md file in it. "" until the setup (or the one-time move) picks one.
    "vault_path": "",

    # UI
    "sidebar_collapsed": False,

    # Reader settings (Settings > Reading & comfort). Checked by
    # check_reader_setting below; anything else is stored as given.
    "theme": "obsidian",          # one of THEMES; no "system" choice
    "last_light_theme": "cream",  # the rail's light/dark button swaps to this
    "accent": {},                 # Build G: {theme: accent id | "custom"}; a theme left out has its first accent (violet; lavender on High contrast)
    "font": "opendyslexic",       # one of FONTS
    "text_size": "m",             # s | m | l
    "row_spacing": "comfortable", # comfortable | compact
    "comfort_letter_spacing": 0.0,   # em, 0 to 0.15
    "comfort_word_spacing": 0.0,     # em, 0 to 0.3
    "comfort_line_height": 1.85,     # 1.4 to 2.2
    "comfort_line_width": 100,       # Page width (QC 89): 55-95 = characters (Narrow 65, Comfortable 80), 100 = Wide, 120 = Full (the whole note area)
    "comfort_ruler": False,          # reading ruler
    "comfort_ruler_lines": 2,        # lines in focus, 1 to 3
    "comfort_bionic": False,         # bionic reading
    "comfort_reduced_motion": False,

    # ---- Phase 5 · settings: the focus sound, the Editor page's switches and the hyperfocus nudge ----
    "comfort_soundscape": "off",     # off | brown | pink | rain (made with Web Audio, no files)
    "comfort_soundscape_volume": 40, # 0 to 100
    "editor_html_zone": True,        # the <HTML> half of the editor toolbar
    "editor_spell_check": True,
    "editor_homophones": True,
    "focus_nudge_minutes": 60,       # 0 (off), 45 or 60
    # ---- end Phase 5 ----

    # ---- Phase 6B · voice rambler: speech to text (Settings → Voice) ----
    "voice_stt_model": "base.en",    # base.en | small.en (sherpa-onnx Whisper, int8, in models/)
    "voice_mic": "",                 # a microphone's name; "" = the Windows default
    # ---- end Phase 6B ----
    # ---- Phase 6C · read aloud (Settings > Voice) ----
    "read_engine": "windows",        # windows (WebView2 speechSynthesis) | sherpa (Kokoro through sherpa-onnx)
    "read_voice_windows": "",        # a Windows voice's voiceURI; "" = the system default
    "read_voice_sherpa": "",         # "<model folder>:<speaker id>"; "" = the first one found
    "read_speed": 1,                 # 0.75 | 1 | 1.25 | 1.5 | 2
    "read_highlight": True,          # tint the sentence and mark the word being spoken
    # ---- end Phase 6C ----
    # ---- Build A · voice ramble v2 and attachments (Settings → Voice, Settings → Vault & files) ----
    "voice_after_keep": "both",      # both (audio + text) | text | audio
    "voice_after_dest": "dump",      # dump (the brain dump) | note (the open note) | new (a new note)
    "voice_after_ask": True,         # ask after Stop; off saves straight away with the two above
    "voice_live": "auto",            # live words in the pill: auto (on with 5 GB or more free) | on | off
    # ---- end Build A ----
    # ---- Build N (mockup R69) · speaking a question in Ask, the Agent and the floating window (Settings → Voice) ----
    "ask_voice_start": "tap",        # tap (tap to start and stop) | hold (hold to talk, or Ctrl+Space) | auto (tap once, it stops after 1.5 s of quiet)
    "ask_voice_where": "pc",         # pc (the speech model already in the app; nothing leaves the PC) | cloud (Groq's Whisper, after the first-use yes)
    "ask_voice_cloud_seen": "",      # the date you said yes to "Let Groq hear what you say?"; "" = not asked yet (nothing is sent before it)
    # ---- end Build N (R69) ----
    # ---- Build K · a PDF or DOCX dropped in (Settings → Vault & files, R47) ----
    "drop_office_default": "ask",    # ask (the one short question) | attach (to this note) | attach_new (to a new note) | convert (to Markdown)
    # ---- end Build K ----
    # ---- Build F · the end-of-day wrap-up and the morning launchpad (Settings → Daily wrap-up) ----
    "wrapup_reminder": True,         # a calm prompt at the wind-down time
    "wrapup_time": "17:00",          # the wind-down time, "HH:MM" (24-hour, local)
    "wrapup_snooze_minutes": 15,     # Snooze, offered while a timer runs: 10 | 15 | 30
    "wrapup_launchpad": True,        # yesterday's note and starter tasks on the first open of a new day
    # ---- end Build F ----

    # File explorer sort order (one of TREE_SORTS)
    # Build B · local AI (local_ai.py): the model in use and the AI models page's settings
    "ai_model": "",                  # a model id from ai_models.json (or a custom .gguf); "" = none yet
    "ai_engine_on": True,            # the built-in engine runs while a model is set
    "ai_keep": "",                   # keep | delete the old model when you change; "" = delete under 20 GB free, else keep
    "ai_long": "local",              # long questions: local (stay on this PC) | cloud (if a key is added)
    "ai_lock_ask": True,             # R68: ask the first time a cloud model is asked about a project (Settings → AI models)
    "ai_lock_once": True,            # R68: a kept-off note offers "Unlock for this question" (asks every time; the lock stays)
    "ai_gpu": "",                    # QC 87: Use graphics card for AI: off | some | full ("" = Some with a usable card, Off without)
    "ai_auto_route": True,           # the smart auto-router; off = ai_route picks each job's model
    "ai_route": {},                  # job -> "auto" | "local:<id>" | "ollama" | "lmstudio"
    "ai_custom_models": [],          # .gguf files the user added (used where they are)
    # ==== Build N · AI summaries, Ask about this note, Tidy up (mockups R43, R45, R46) ====
    "ai_answer_place": "popover",    # where a note summary shows: popover (under its icon) | side (the right sidebar) | card (above the note text)
    "ai_ask_mode": "general",        # Ask about this note may use: general (my notes, then labelled general knowledge) | notes (only my notes)
    # ---- Build N round 6 · the Ask chat (mockup R50, the user's locks 2026-10-18) ----
    "ai_chat_mode": "dock",          # where the Ask chat opens: dock (on the right, the note makes room) | float (a free window)
    "ai_chat_dock_w": 400,           # the docked chat's width, 320 to 640 px (its left edge drags)
    "ai_chat_rect": {},              # the free window's place and size {x, y, w, h}; {} = under its icon the first time
    "ai_chat_esc": "stop",           # Esc in the chat: stop (stops an answer first, then closes) | close (closes; the answer carries on)
    # ---- Build N parity round · the chat's history and settings, and AI on or off (mockups R51, R52; decisions R50-R52) ----
    "ai_enabled": True,              # AI in NeuroVault: off hides every AI control (greyed with a hint is how it looks with no model)
    "ai_chat_follow": "note",        # opening another note: note (each note keeps its own chat) | keep (the chat you're in stays)
    "ai_chat_hist": "whole",         # follow-ups send: whole (the whole chat, the oldest dropped when it's full) | last (the last ai_chat_hist_n)
    "ai_chat_hist_n": 6,             # with "last": how many questions and answers go along (4, 6, 10 or 20)
    "ai_chat_new": "fresh",          # New chat: fresh (starts empty) | summary (starts with a short summary of the last chat)
    # ---- Build N · QC 76: autocorrect learns, on this PC only ----
    "autocorrect_learn_notes": True,  # words used in your notes count as used more (and a word you use 3+ times isn't corrected)
    "autocorrect_learned": {},        # {undone: {word: what it had become}}: corrections you undid, not made again
    "ai_tidy_strength": "standard",  # Tidy up with AI: light (spelling and grammar only) | standard (also paragraphs, no filler) | polished (also smoother sentences)
    "ai_tidy_rule": "",              # Tidy up: your own rule, one line (at most 300 characters), added to the prompt
    # ---- Build N (R56) · AI in the cloud with your own key (the keys are in Windows Credential Manager, never here) ----
    "ai_cloud_seen": {},             # {company id: the date you said yes in its first-use notice}; nothing is sent there before
    "ai_cloud_used": {},             # {company id: the date its free limit was used up (429)}; Automatic skips it that day
    "ai_cloud_acct": {},             # {"cloudflare": your Account ID} (not a secret: it's in your dashboard's address)
    "ai_route_back": {},             # {job: {choice, on}}: "Use this PC" after a free limit, until the date "on", then choice again
    "ai_agent": False,               # R67 (the decision): the Agent in the Ask chat, off by default
    "ai_agent_tools": ["search_notes", "read_note", "summarise_note", "create_task", "append_to_note", "add_tags", "link_notes"],   # R67: what it may do (every change still asks)
    "ai_read_attachments": False,    # QC 93: "Let AI read this note's attachments" (models that can read images and documents only)
    "ai_cloud_autoswitch": False,    # QC 92 (the R60 decision): at a free limit, the same company's next model answers by itself (off: it's offered)
    # ==== end Build N ====
    # ---- Build E · reading fonts (Settings → Reading & comfort → More fonts, fonts.py) ----
    "font_use": "",                  # an added font's id (a folder in .neurovault/fonts) used for the whole app; "" = the built-in `font`
    # ---- end Build E ----
    # ---- Build G · accent colours, any colour as the accent, colour vision (Settings → Reading & comfort → Theme, R33) ----
    "accent_custom": "",             # your own accent, "#rrggbb"; "" = none
    "accent_custom_theme": "",       # the theme it was chosen on: shown as chosen there, shaded to stand out on the others
    "colour_vision": "off",          # off | rg (red–green) | tri (blue–yellow): the state colours, plus a shape for each state
    # ---- end Build G ----
    # ---- Build J · the dictionary (dictionary.py; your words are in .neurovault/glossary.json, not here) ----
    "dict_read": "meanings",         # Read aloud in the dictionary: word (the word only) | meanings (the word, then its meanings)
    "dict_recent": [],               # recent lookups, newest first (at most 12 words)
    # ---- end Build J ----
    "spell_ignore": {},              # Fix A (QC 3 · 26): words "Ignore in this note" keeps, {note id: [words]}
    "autocorrect": True,             # Fix A: a confidently misspelled word becomes its spelling as you finish it
    "autocorrect_strength": "obvious",   # obvious (one slip away, no close rival) | more (two slips away)
    "autocorrect_never": [],         # words never to correct (lower case, up to 500)
    "spell_where": "everywhere",     # Fix A (QC 4 · 30): spelling help (line, menu, F7, autocorrect) in: everywhere (you write) | notes

    # ---- Build H · sticky notes and the quick timer popped out of the app (R34), the two minute sets (R39), check-ins (R38) ----
    "sticky_new_popped": True,                  # a new sticky opens as its own desktop window (Fix C, QC 5: on)
    "timer_minutes_unplanned": [5, 15, 25, 45],  # the quick timer's four choices (unplanned work)
    "timer_minutes_planned": [15, 30, 45, 60],   # the Timer view's four choices (planned work)
    "timer_checkin_minutes": 30,                 # a running timer asks what you finished this often; 0 = never
    "timer_away_answer": "ask",                  # Build L: time a timer ran while NeuroVault was closed: ask | pause | work ("Always do this")
    "timer_pop": {},                             # the quick timer's own window: out, on_top, x, y, w, h, screen
    "ask_pop": {},                               # Build N (QC 103): the Ask chat's own window: out, on_top, x, y, w, h, screen
    "mindmap_pop": {},                           # Build M (QC 107): a note's mind map in its own window: out, on_top, x, y, w, h, screen
    # ---- end Build H ----

    # ---- Build D · guided setup: true once the first-run setup is finished or skipped (an install that's been used
    # is marked done the first time it's seen, so the setup never comes up on it by itself) ----
    "setup_done": False,
    # ---- end Build D ----

    "tree_sort": "name-asc",

    # Notifications (timer view)
    "notify_sound_on_complete": True,
    "notify_desktop": True,
    "notify_taskbar_flash": True,
    "notify_five_min_warning": True,
    "notify_overtime_repeat": True,
    "notify_overtime_interval_min": 5,
    "notify_volume": 0.6,
    "notify_sound": "chime",  # bell | chime | alarm | pop | scifi | silent
    "notify_custom_sound_path": "",

    # Hotkeys (global, requires the optional `keyboard` package)
    "hotkeys_enabled": True,
}


THEMES = ("obsidian", "slate", "cream", "sage", "sky", "buttercup", "paper", "sepia", "contrast")
DARK_THEMES = ("obsidian", "slate", "contrast")
FONTS = ("opendyslexic", "lexend", "atkinson", "system")
TREE_SORTS = ("name-asc", "name-desc", "mod-desc", "mod-asc", "created-desc", "created-asc")

_CHOICES = {
    "theme": THEMES,
    "last_light_theme": tuple(t for t in THEMES if t not in DARK_THEMES),
    "font": FONTS,
    "text_size": ("s", "m", "l"),
    "row_spacing": ("comfortable", "compact"),
    "tree_sort": TREE_SORTS,
}
_RANGES = {
    "comfort_letter_spacing": (0.0, 0.15, float),
    "comfort_word_spacing": (0.0, 0.3, float),
    "comfort_line_height": (1.4, 2.2, float),
    "comfort_line_width": (55, 120, int),   # QC 89: 100 = Wide, 120 = Full
    "comfort_ruler_lines": (1, 3, int),
}
_FLAGS = ("comfort_ruler", "comfort_bionic", "comfort_reduced_motion")

# ---- Phase 5 · settings: checks for the keys above ----
SOUNDSCAPES = ("off", "brown", "pink", "rain")
_CHOICES.update({"comfort_soundscape": SOUNDSCAPES, "focus_nudge_minutes": (0, 45, 60)})
_RANGES["comfort_soundscape_volume"] = (0, 100, int)
_FLAGS += ("editor_html_zone", "editor_spell_check", "editor_homophones")
# Build V (mockup R57): line numbers in code blocks (Settings → Editor), on by default
DEFAULT_CONFIG["code_line_numbers"] = True
_FLAGS += ("code_line_numbers",)
# Build V (mockup R59): text with photos, Settings → Editor: a caption, numbered pins, both or neither
DEFAULT_CONFIG["photo_text"] = "both"
_CHOICES["photo_text"] = ("both", "caption", "pins", "off")
# ---- end Phase 5 ----

# ---- Phase 6B · voice rambler ----
_CHOICES["voice_stt_model"] = ("base.en", "small.en")
# ---- end Phase 6B ----
# ---- Phase 6C · read aloud: checks for the keys above (the two voice ids pass through as text) ----
READ_ENGINES = ("windows", "sherpa")
READ_SPEEDS = (0.75, 1, 1.25, 1.5, 2)
_CHOICES.update({"read_engine": READ_ENGINES, "read_speed": READ_SPEEDS})
_FLAGS += ("read_highlight",)
# ---- end Phase 6C ----
# ---- Build A · voice ramble v2 and attachments: checks for the keys above ----
_CHOICES.update({"voice_after_keep": ("both", "text", "audio"), "voice_after_dest": ("dump", "note", "new"),
                 "voice_live": ("auto", "on", "off")})   # Build M parity: attachments_empty_tab is gone (R45 r45-attnote: "drop the setting")
_FLAGS += ("voice_after_ask",)
# ---- end Build A ----
# ---- Build N (R69): speaking a question ----
_CHOICES.update({"ask_voice_start": ("tap", "hold", "auto"), "ask_voice_where": ("pc", "cloud")})


def _check_date_or_empty(key, value):
    import re
    ok = isinstance(value, str) and (value == "" or re.fullmatch(r"\d{4}-\d\d-\d\d", value))
    return (value, None) if ok else (None, f"{key} must be a date (YYYY-MM-DD) or empty.")
# ---- end Build N (R69) ----
# ---- Build K · the drop default ----
DROP_OFFICE_DEFAULTS = ("ask", "attach", "attach_new", "convert")
_CHOICES["drop_office_default"] = DROP_OFFICE_DEFAULTS
# ---- end Build K ----


# Build B · local AI
_CHOICES.update({"ai_keep": ("keep", "delete"), "ai_long": ("local", "cloud")})
_CHOICES["ai_gpu"] = ("off", "some", "full")   # QC 87
_FLAGS += ("ai_engine_on", "ai_auto_route", "ai_lock_ask", "ai_lock_once")   # R68: the last two
# ==== Build N ====
AI_ANSWER_PLACES = ("popover", "side", "card")
_CHOICES["ai_answer_place"] = AI_ANSWER_PLACES
_CHOICES["ai_ask_mode"] = ("general", "notes")
_CHOICES.update({"ai_chat_mode": ("dock", "float"), "ai_chat_esc": ("stop", "close")})   # Build N round 6
_RANGES["ai_chat_dock_w"] = (320, 640, int)
_CHOICES.update({"ai_chat_follow": ("note", "keep"), "ai_chat_hist": ("whole", "last"), "ai_chat_hist_n": (4, 6, 10, 20),   # Build N parity round
                 "ai_chat_new": ("fresh", "summary")})
_FLAGS += ("ai_enabled",)
_FLAGS += ("autocorrect_learn_notes",)   # Build N (QC 76)
_CHOICES["ai_tidy_strength"] = ("light", "standard", "polished")
# ==== end Build N ====

# ---- Build D · guided setup ----
_FLAGS += ("setup_done",)
# ---- end Build D ----
# ---- Build L · the timer's question after NeuroVault was closed ("Always do this and don't ask") ----
_CHOICES["timer_away_answer"] = ("ask", "pause", "work")
# ---- end Build L ----
# ---- Build F · the wrap-up: checks for the keys above (wrapup_time is "HH:MM", 00:00 to 23:59) ----
WRAPUP_SNOOZES = (10, 15, 30)
_CHOICES["wrapup_snooze_minutes"] = WRAPUP_SNOOZES
_FLAGS += ("wrapup_reminder", "wrapup_launchpad")


def _check_clock(key, value):
    import re
    m = re.fullmatch(r"([01]\d|2[0-3]):([0-5]\d)", value) if isinstance(value, str) else None
    return (value, None) if m else (None, f"{key} must be a time like 17:30.")


_CHECKS = {"wrapup_time": _check_clock}


def _check_tidy_rule(key, value):   # Build N (QC 38): one line of text, at most 300 characters
    if not isinstance(value, str):
        return None, f"{key} must be text."
    v = " ".join(value.split())
    return (v, None) if len(v) <= 300 else (None, f"{key} must be at most 300 characters.")


_CHECKS["ai_tidy_rule"] = _check_tidy_rule


def _check_chat_rect(key, value):   # Build N round 6: the free chat window, {x, y, w, h} in px ({} = not placed yet)
    if value == {}:
        return {}, None
    if not isinstance(value, dict) or set(value) != {"x", "y", "w", "h"}:
        return None, f"{key} must be {{x, y, w, h}}."
    try:
        v = {k: int(value[k]) for k in ("x", "y", "w", "h")}
    except (TypeError, ValueError):
        return None, f"{key} must be whole numbers."
    if any(isinstance(value[k], bool) for k in v) or not (0 <= v["x"] <= 10000 and 0 <= v["y"] <= 10000 and 360 <= v["w"] <= 960 and 380 <= v["h"] <= 900):
        return None, f"{key} is out of range (360-960 wide, 380-900 tall)."
    return v, None


_CHECKS["ai_chat_rect"] = _check_chat_rect


def _check_ac_learned(key, value):   # Build N (QC 76): {undone: {word: correction}}, at most 2,000 words
    if value == {}:
        return {}, None
    und = value.get("undone") if isinstance(value, dict) else None
    if not isinstance(und, dict) or set(value) - {"undone"} or len(und) > 2000 or not all(isinstance(k, str) and isinstance(v, str) and 0 < len(k) <= 60 and len(v) <= 60 for k, v in und.items()):
        return None, f"{key} must be {{undone: {{word: correction}}}}."
    return {"undone": dict(und)}, None


_CHECKS["autocorrect_learned"] = _check_ac_learned


def _check_cloud_map(key, value):   # Build N (R56): {company id: short text} (a date, or Cloudflare's Account ID)
    import re
    ok = isinstance(value, dict) and len(value) <= 20 and all(isinstance(k, str) and re.fullmatch(r"[a-z]{2,20}", k) and isinstance(v, str) and re.fullmatch(r"[A-Za-z0-9-]{1,64}", v) for k, v in value.items())
    return (dict(value), None) if ok else (None, f"{key} must be {{company: text}}.")


def _check_route_back(key, value):   # Build N (R56): {job: {choice, on}}
    import re
    ok = isinstance(value, dict) and all(isinstance(k, str) and isinstance(v, dict) and set(v) == {"choice", "on"} and isinstance(v["choice"], str) and len(v["choice"]) < 200
                                         and isinstance(v["on"], str) and re.fullmatch(r"\d{4}-\d\d-\d\d", v["on"]) for k, v in value.items())
    return (dict(value), None) if ok else (None, f"{key} must be {{job: {{choice, on}}}}.")


for _k in ("ai_cloud_seen", "ai_cloud_acct"):
    _CHECKS[_k] = _check_cloud_map


def _check_cloud_used(key, value):   # QC 91: {"<company>[:<model id>]": date}, a limit per model
    import re
    ok = isinstance(value, dict) and len(value) <= 400 and all(isinstance(k, str) and re.fullmatch(r"[a-z]{2,20}(:[\w.:/@+-]{1,200})?", k) and isinstance(v, str) and re.fullmatch(r"\d{4}-\d\d-\d\d", v) for k, v in value.items())
    return (dict(value), None) if ok else (None, f"{key} must be {{company or company:model: date}}.")


_CHECKS["ai_cloud_used"] = _check_cloud_used
_FLAGS += ("ai_cloud_autoswitch",)
_FLAGS += ("ai_read_attachments",)
_FLAGS += ("ai_agent",)   # R67


def _check_agent_tools(key, value):   # R67: a list of the tools' names (seven, with add_tags and link_notes)
    names = ("search_notes", "read_note", "summarise_note", "create_task", "append_to_note", "add_tags", "link_notes")
    ok = isinstance(value, list) and all(isinstance(v, str) and v in names for v in value)
    return ([n for n in names if n in value], None) if ok else (None, f"{key} must be a list of: {', '.join(names)}.")


_CHECKS["ai_agent_tools"] = _check_agent_tools
_CHECKS["ai_route_back"] = _check_route_back
_CHECKS["ask_voice_cloud_seen"] = _check_date_or_empty   # Build N (R69)
# ---- end Build F ----


def check_reader_setting(key, value):
    """(clean_value, None) if value is allowed for key, else (None, message).
    Keys this doesn't know about pass through unchanged."""
    if key in _CHECKS:  # Build F: keys with their own check (a time of day)
        return _CHECKS[key](key, value)
    if key in _CHOICES:
        if value in _CHOICES[key] and not isinstance(value, bool):  # Phase 5: False == 0 must not pass as "nudge off"
            return value, None
        return None, f"{key} must be one of: {', '.join(map(str, _CHOICES[key]))}."
    if key in _RANGES:
        lo, hi, kind = _RANGES[key]
        try:
            v = kind(value)
        except (TypeError, ValueError):
            return None, f"{key} must be a number."
        if isinstance(value, bool) or not lo <= v <= hi:
            return None, f"{key} must be between {lo} and {hi}."
        return v, None
    if key in _FLAGS:
        if isinstance(value, bool):
            return value, None
        return None, f"{key} must be true or false."
    return value, None


# ---- Build E · Reading & comfort (R31 cards) and reading fonts ----
# Text size sizes the note text only: Small 14, Medium 15, Large 17, Larger 19px (the rest of the app stays Medium).
_CHOICES["text_size"] = ("s", "m", "l", "xl")
FONT_USE_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")   # fonts.FONT_ID: a folder name in the fonts folder
_check_reader_setting_before_e = check_reader_setting


def check_reader_setting(key, value):  # noqa: F811 - Build E adds font_use, then the checks above
    if key == "font_use":
        if value == "" or isinstance(value, str) and FONT_USE_ID.match(value):
            return value, None
        return None, "font_use must be an added font's id, or empty for the built-in font."
    return _check_reader_setting_before_e(key, value)
# ---- end Build E ----


# ---- Build G · accent colours chosen for each theme (R33, locked 2026-10-16): the ids in frontend/js/accents.js's ACCENT_SETS,
# in the same order (the first is the theme's default). Each passes on its theme: 3:1 against the page, card and sidebar,
# 4.5:1 for text on it, and its text shade 4.5:1. Plus any colour ("custom", accent_custom) and colour vision. ----
ACCENT_SETS = {
    "obsidian": ("violet", "blue", "cyan", "teal", "green", "amber", "coral", "pink"),
    "slate": ("violet", "sand", "terracotta", "sage", "steel", "rose", "teal"),
    "cream": ("violet", "terracotta", "olive", "teal", "indigo", "plum", "brown"),
    "sage": ("violet", "forest", "teal", "navy", "plum", "rust", "berry"),
    "sky": ("violet", "navy", "teal", "berry", "rust", "indigo", "graphite"),
    "buttercup": ("violet", "bronze", "indigo", "forest", "crimson", "teal", "plum"),
    "paper": ("violet", "blue", "teal", "green", "orange", "crimson", "pink", "graphite"),
    "sepia": ("violet", "rust", "olive", "teal", "brown", "plum", "navy"),
    "contrast": ("lavender", "yellow", "cyan", "lime", "pink", "orange", "sky"),
}
ACCENTS = tuple(dict.fromkeys(a for s in ACCENT_SETS.values() for a in s))   # every accent id, on some theme
COLOUR_VISIONS = ("off", "rg", "tri")
HEX_COLOUR = re.compile(r"^#[0-9a-fA-F]{6}$")
_CHOICES["colour_vision"] = COLOUR_VISIONS
_check_reader_setting_before_g = check_reader_setting


def check_reader_setting(key, value):  # noqa: F811 - Build G adds the accent keys, then the checks above
    if key == "accent":
        if isinstance(value, dict) and all(th in ACCENT_SETS and isinstance(a, str) and (a in ACCENT_SETS[th] or a == "custom")
                                           for th, a in value.items()):
            return dict(value), None
        return None, "accent must be {theme: one of that theme's accents, or \"custom\"}."
    if key == "accent_custom":
        if value == "" or isinstance(value, str) and HEX_COLOUR.match(value):
            return value.lower(), None
        return None, "accent_custom must be a colour like #0e7490, or empty."
    if key == "accent_custom_theme":
        if value == "" or value in THEMES:
            return value, None
        return None, "accent_custom_theme must be a theme, or empty."
    return _check_reader_setting_before_g(key, value)
# ---- end Build G ----


# ---- Build J · the dictionary's settings ----
_CHOICES["dict_read"] = ("word", "meanings")
_check_reader_setting_before_j = check_reader_setting


def check_reader_setting(key, value):  # noqa: F811 - Build J adds the recent lookups, then the checks above
    if key == "dict_recent":
        if isinstance(value, list) and len(value) <= 12 and all(isinstance(w, str) and 0 < len(w) <= 80 for w in value):
            return list(dict.fromkeys(value)), None
        return None, "dict_recent must be a list of up to 12 words."
    return _check_reader_setting_before_j(key, value)
# ---- end Build J ----


# ==== Fix A (QC 3 · 26): the words a note's spelling leaves alone ====
_check_reader_setting_before_fix_a = check_reader_setting
_CHOICES["autocorrect_strength"] = ("obvious", "more")
_CHOICES["spell_where"] = ("everywhere", "notes")  # QC 4 · 30
_FLAGS += ("autocorrect",)


def check_reader_setting(key, value):  # noqa: F811 - Fix A adds spell_ignore, then the checks above
    if key == "spell_ignore":
        ok = (isinstance(value, dict) and len(value) <= 2000 and all(
            isinstance(k, str) and 0 < len(k) <= 40 and isinstance(ws, list) and len(ws) <= 500
            and all(isinstance(w, str) and 0 < len(w) <= 60 for w in ws) for k, ws in value.items()))
        if ok:
            return {k: list(dict.fromkeys(w.lower() for w in ws)) for k, ws in value.items() if ws}, None
        return None, "spell_ignore must be {note id: [up to 500 words]}."
    if key == "autocorrect_never":
        if isinstance(value, list) and len(value) <= 500 and all(isinstance(w, str) and 0 < len(w.strip()) <= 60 for w in value):
            return list(dict.fromkeys(w.strip().lower() for w in value)), None
        return None, "autocorrect_never must be a list of up to 500 words."
    return _check_reader_setting_before_fix_a(key, value)
# ==== end Fix A ====


def _upgrade(cfg):
    """Older config.json files used theme dark | light | system."""
    if cfg.get("theme") not in THEMES:
        cfg["theme"] = "cream" if cfg.get("theme") == "light" else "obsidian"
    if not isinstance(cfg.get("accent"), dict):  # Build G: the one "violet" became a pick for each theme
        cfg["accent"] = {}
    return cfg


def load_config():
    if not os.path.exists(CONFIG_PATH):
        save_config(DEFAULT_CONFIG)
        return dict(DEFAULT_CONFIG)
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            cfg = json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        log.warning("Could not read config.json (%s) — falling back to defaults", e)
        return dict(DEFAULT_CONFIG)
    merged = dict(DEFAULT_CONFIG)
    merged.update(cfg)
    return _upgrade(merged)


def save_config(cfg: dict):
    try:
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(cfg, f, indent=2)
    except OSError as e:
        log.error("Could not write config.json: %s", e)


# ---- Build H · the two minute sets and the check-in interval ----
TIMER_MINUTES_DEFAULT = {"timer_minutes_unplanned": [5, 15, 25, 45], "timer_minutes_planned": [15, 30, 45, 60]}
CHECKIN_CHOICES = (0, 15, 20, 30, 45, 60)
_FLAGS += ("sticky_new_popped",)
_CHOICES["timer_checkin_minutes"] = CHECKIN_CHOICES
_check_reader_setting_before_h = check_reader_setting


def check_reader_setting(key, value):  # noqa: F811 - Build H adds the minute sets and the timer's window, then the checks above
    if key in TIMER_MINUTES_DEFAULT:
        if (isinstance(value, list) and len(value) == 4
                and all(isinstance(m, int) and not isinstance(m, bool) and 1 <= m <= 240 for m in value)):
            return sorted(value), None
        return None, f"{key} must be four whole numbers of minutes, from 1 to 240."
    if key in ("timer_pop", "ask_pop", "mindmap_pop"):   # Build N (QC 103): the Ask chat's window too; Build M (QC 107): the mind map's
        if isinstance(value, dict):
            return dict(value), None
        return None, f"{key} must be an object."
    return _check_reader_setting_before_h(key, value)
# ---- end Build H ----


# ---- Build M · note history: how many versions each note keeps (Settings → Vault & files, mockup R42) ----
NOTE_VERSIONS_KEPT = (3, 5, 10)
DEFAULT_CONFIG["note_versions_kept"] = 5
_CHOICES["note_versions_kept"] = NOTE_VERSIONS_KEPT
# ---- end Build M ----


# ---- Build M · R44 / R45: the split screen (Settings → Editor → Split screen) ----
# pane_focus_style: how the pane you work in shows (QC 4 · 42: an accent frame, a tinted header or an accent underline on its
# header, like an open tab); pane_fade: the other panes fade, with any of them; pane_split: where a new pane goes
# (Automatic: beside while there's room, else below); pane_restore: the panes and note tabs come back as you left them,
# or notes only; pane_layout: what was left (panes.js)
PANE_FOCUS_STYLES = ("frame", "tint", "underline")
PANE_SPLITS = ("auto", "side", "stacked")
PANE_RESTORES = ("last", "notes")
DEFAULT_CONFIG.update({"pane_focus_style": "frame", "pane_fade": False, "pane_split": "auto", "pane_restore": "last", "pane_layout": None})
_FLAGS += ("pane_fade",)
_CHOICES.update({"pane_focus_style": PANE_FOCUS_STYLES, "pane_split": PANE_SPLITS, "pane_restore": PANE_RESTORES})
_check_reader_setting_before_m = check_reader_setting


def check_reader_setting(key, value):  # noqa: F811
    """pane_layout: an object (or null), small: note tabs, the panes and the one you work in."""
    if key == "pane_layout":
        import json
        if value is None:
            return None, None
        if isinstance(value, dict) and len(json.dumps(value)) <= 20000:
            return dict(value), None
        return None, "pane_layout must be a small object (or null)."
    return _check_reader_setting_before_m(key, value)


_upgrade_before_m = _upgrade


def _upgrade(cfg):  # noqa: F811
    """QC 4 · 42: "Frame, others faded" (dim) was two things in one: it is now the accent frame with "Fade the other panes" on."""
    cfg = _upgrade_before_m(cfg)
    if cfg.get("pane_focus_style") == "dim":
        cfg["pane_focus_style"], cfg["pane_fade"] = "frame", True
    elif cfg.get("pane_focus_style") not in PANE_FOCUS_STYLES:
        cfg["pane_focus_style"] = "frame"
    if not isinstance(cfg.get("pane_fade"), bool):
        cfg["pane_fade"] = False
    return cfg
# ---- end Build M · R44 ----


# ---- Build M · round 6: the Brain Dump as a free window (mockup R49, r49dump "float", locked 2026-10-18) ----
# brain_dump_mode: a free window you drag and resize, or a dialog centred at the top; brain_dump_rect: where you left the free
# window, {x, y, w, h} in the window's own pixels (the page keeps it on screen), or null for "centred over the note"
BRAIN_DUMP_MODES = ("float", "centre")
DEFAULT_CONFIG.update({"brain_dump_mode": "float", "brain_dump_rect": None})
_CHOICES["brain_dump_mode"] = BRAIN_DUMP_MODES
_check_reader_setting_before_m6 = check_reader_setting


def check_reader_setting(key, value):  # noqa: F811
    if key == "brain_dump_rect":
        if value is None:
            return None, None
        if (isinstance(value, dict) and set(value) == {"x", "y", "w", "h"}
                and all(isinstance(v, (int, float)) and not isinstance(v, bool) and -10000 <= v <= 10000 for v in value.values())):
            return {k: round(value[k]) for k in ("x", "y", "w", "h")}, None
        return None, "brain_dump_rect must be {x, y, w, h} in pixels (or null)."
    return _check_reader_setting_before_m6(key, value)
# ---- end Build M · round 6 ----


# ---- Build M · parity round (mockup R52, the R51 / R52 decisions) ----
# side_w / insp_w: the left and right side panels' widths, dragged like Obsidian's (null: the default); toolbar_*: the editor
# toolbar's place (top, or a column at the left or right), its width (full width of the note area, or the text column) and
# Autohide (off, on hover, while typing); drop_dialog: how a dropped file asks, one file at a time (choice rows, or a bar over the note)
PANEL_MIN, PANEL_MAX = 200, 480
DEFAULT_CONFIG.update({"side_w": None, "insp_w": None, "toolbar_position": "top", "toolbar_width": "full", "toolbar_autohide": "off",
                       "drop_dialog": "rows"})
_CHOICES.update({"toolbar_position": ("top", "left", "right"), "toolbar_width": ("full", "text"),
                 "toolbar_autohide": ("off", "hover", "caret"), "drop_dialog": ("rows", "bar")})
_check_reader_setting_before_par = check_reader_setting


def check_reader_setting(key, value):  # noqa: F811
    if key in ("side_w", "insp_w"):
        if value is None:
            return None, None
        if isinstance(value, (int, float)) and not isinstance(value, bool) and PANEL_MIN <= value <= PANEL_MAX:
            return int(round(value)), None
        return None, f"{key} must be {PANEL_MIN} to {PANEL_MAX} pixels (or null)."
    return _check_reader_setting_before_par(key, value)
# ---- end Build M · parity round ----


# ---- Build M · R54 (the decision r54-tbw, QC 66): the editor toolbar's width gains "fit" (as wide as its buttons, centred
# on the text column, growing before ⋯, never wider than the note area), the new default. toolbar_width_picked is set when you
# pick a width in Settings; every save writes the whole config, so a "full" without it is the old default, not a choice, and
# moves to "fit" once. A width you picked is kept. ----
DEFAULT_CONFIG.update({"toolbar_width": "fit", "toolbar_width_picked": False})
_CHOICES["toolbar_width"] = ("fit", "text", "full")
_FLAGS += ("toolbar_width_picked",)
_upgrade_before_r54 = _upgrade


def _upgrade(cfg):  # noqa: F811
    cfg = _upgrade_before_r54(cfg)
    if cfg.get("toolbar_width") == "full" and not cfg.get("toolbar_width_picked"):
        cfg["toolbar_width"] = "fit"
    return cfg
# ---- end Build M · R54 ----


# ---- Build M · QC 68: where a copied file's location is named first (the Attachments tab, file details, Show in folder):
# "source" the original it came from (the default, the user's rule), "vault" the copy in attachments/ ----
DEFAULT_CONFIG.update({"attach_show_first": "source"})
_CHOICES["attach_show_first"] = ("source", "vault")
# ---- end Build M · QC 68 ----


# ---- Build M · R56: the online dictionary lookup. dict_online: "ask" (the default: "Look it up online" asks first, the word
# only), "always" (Settings → Editor → Dictionary → "Look words up online without asking"), "off" (never offered);
# dict_online_seen: the first-time notice was answered ----
DEFAULT_CONFIG.update({"dict_online": "ask", "dict_online_seen": False})
_CHOICES["dict_online"] = ("ask", "always", "off")
_FLAGS += ("dict_online_seen",)
# ---- end Build M · R56 ----


# ---- Build M · R59: where tasks live. tasks_keep_out: off (in their notes, as before) | on (only in Tasks: new tasks never go
# into a note's text, a note links to its tasks); tasks_keep_out_left: when it was turned on, the tasks already in notes were
# left there (they still show in their notes); tasks_keep_out_since: when it was turned on (ISO), or "" ----
DEFAULT_CONFIG.update({"tasks_keep_out": False, "tasks_keep_out_left": False, "tasks_keep_out_since": ""})
_FLAGS += ("tasks_keep_out", "tasks_keep_out_left")
_check_reader_setting_before_r59 = check_reader_setting


def check_reader_setting(key, value):  # noqa: F811
    if key == "tasks_keep_out_since":
        if value in ("", None):
            return "", None
        if isinstance(value, str) and len(value) <= 40 and value[:4].isdigit():
            return value, None
        return None, "tasks_keep_out_since must be an ISO date and time, or empty."
    return _check_reader_setting_before_r59(key, value)
# ---- end Build M · R59 ----


# ---- Build M · R57: the mind map of a note (frontend/js/mindmap-r57.js). mindmap_layout: tidy (a tree, left to right; the user's
# pick) | centre (the note in the middle, its sections either side) | radial (sections around it). Its head and Settings → Editor ----
DEFAULT_CONFIG.update({"mindmap_layout": "tidy"})
_CHOICES["mindmap_layout"] = ("tidy", "centre", "radial")
# ---- end Build M · R57 ----
