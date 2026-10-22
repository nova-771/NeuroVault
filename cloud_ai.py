"""
cloud_ai.py — Build N (mockup R56): AI in the cloud with your own key, for a PC that's slow at AI.

Feedback: "I want people to still use ai in the app even if they have slow pcs", then "id like to build for all - but we
must be transparent in the application" (R56 decisions, 2026-10-19).

    PROVIDERS           the companies, from frontend/cloud_providers.json (the page reads the same file): who runs it, what
                        it keeps, its links, its OpenAI-compatible endpoint and the model NeuroVault asks
    get_key / set_key / del_key / has_key
                        each person's own key, in Windows Credential Manager through keyring (MIT). Never in config.json,
                        the vault or a log. NeuroVault ships no key.
    body                the request each company takes (all speak OpenAI's chat completions)
    rows                what Settings → AI models shows per company: the facts, a key or not (shown masked), the yes
                        (ai_cloud_seen), today's free limit used up (ai_cloud_used)
    free_ready          the first free company with a key whose limit isn't used up today: what Automatic may pick on a
                        slow PC

Nothing goes to a company until its key is added and the person says yes once, in the first-use notice (ai_cloud_seen);
local_ai.Manager.run refuses otherwise.
"""
import copy
import datetime
import json
import logging
import os
import sys
import threading

import platform_layer  # cross-platform step 0: the data folder and the key store's name

log = logging.getLogger(__name__)

SERVICE = "NeuroVault"   # Credential Manager: "cloud:<id>@NeuroVault"


def _here():
    return getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))


def _load():
    with open(os.path.join(_here(), "frontend", "cloud_providers.json"), encoding="utf-8") as f:
        return json.load(f)


DATA = _load()
PROVIDERS = {p["id"]: p for p in DATA["providers"]}
ORDER = [p["id"] for p in DATA["providers"]]
FREE = [i for i in ORDER if PROVIDERS[i]["group"] == "free"]
KEY_MAX = 512   # characters; a real key is far shorter
ACCT_MAX = 64

try:
    import keyring
    from keyring.errors import KeyringError, PasswordDeleteError
except ImportError:   # the app still runs: Settings says keys need keyring
    keyring = None
    KeyringError = PasswordDeleteError = Exception

_lock = threading.Lock()
_cache = {}   # id -> the masked key, or "" for none (Credential Manager is read once per company)


class KeyStoreError(Exception):
    """Credential Manager couldn't be used: said to the user as it is."""


def keys_ok():
    return keyring is not None


def _user(pid):
    return "cloud:" + pid


def masked(key):
    key = key or ""
    return key[:4] + "…" + key[-4:] if len(key) > 12 else "…" + key[-2:] if key else ""


def get_key(pid):
    if pid not in PROVIDERS or keyring is None:
        return None
    try:
        return keyring.get_password(SERVICE, _user(pid)) or None
    except KeyringError as e:
        log.warning("%s: %s", platform_layer.keystore_name(), e)
        return None


def has_key(pid):
    with _lock:
        if pid not in _cache:
            _cache[pid] = masked(get_key(pid))
        return bool(_cache[pid])


def shown(pid):
    return _cache.get(pid, "") if has_key(pid) else ""


def set_key(pid, key):
    if keyring is None:
        raise KeyStoreError("Cloud keys need the keyring package, which isn't installed.")
    try:
        keyring.set_password(SERVICE, _user(pid), key)
    except KeyringError as e:
        raise KeyStoreError(plain_error(e, "save the key in " + platform_layer.keystore_name()))
    with _lock:
        _cache[pid] = masked(key)


def del_key(pid):
    if keyring is not None:
        try:
            keyring.delete_password(SERVICE, _user(pid))
        except PasswordDeleteError:
            pass   # it wasn't there
        except KeyringError as e:
            raise KeyStoreError(plain_error(e, "remove the key from Windows Credential Manager"))
    with _lock:
        _cache[pid] = ""


def forget_cache():
    with _lock:
        _cache.clear()


def clean_key(s):
    s = s.strip() if isinstance(s, str) else ""
    return s if 8 <= len(s) <= KEY_MAX and not any(c.isspace() or ord(c) < 32 for c in s) else ""


def clean_acct(s):
    s = s.strip() if isinstance(s, str) else ""
    return s if 8 <= len(s) <= ACCT_MAX and s.isalnum() else ""


def endpoint(p, cfg):
    acct = (cfg.get("ai_cloud_acct") or {}).get(p["id"], "") if p.get("acct") else ""
    return p["url"].replace("{acct}", acct)


def body(p, messages, schema=None, max_tokens=1200, temperature=0.2, stream=False, model=None):
    """The chat completions request this company takes: its model, its own name for the length limit, no
    llama-server-only fields (chat_template_kwargs, response_format, grammars). A JSON schema goes in the instructions (not
    every company takes response_format). QC 94: a thinking model gets its company's reasoning settings (params: low effort,
    the thinking left out of the reply) and at least min_tokens, since its thinking counts toward the limit; temperature is
    left out where the company refuses it (Anthropic below 1, OpenAI's reasoning models)."""
    if schema:
        rule = "Answer with JSON only, no other words, following this JSON schema: " + json.dumps(schema)
        messages = [dict(messages[0], content=messages[0]["content"] + "\n\n" + rule)] + messages[1:] if messages and messages[0].get("role") == "system" \
            else [{"role": "system", "content": rule}] + list(messages)
    b = {"model": model or p["model"], "messages": messages, p.get("tokens", "max_tokens"): max(int(max_tokens), int(p.get("min_tokens") or 0)), "stream": stream}
    if p.get("temperature", True):
        b["temperature"] = temperature
    b.update(copy.deepcopy(p.get("params") or {}))
    return b


def today():
    return datetime.date.today().isoformat()


def used_key(pid, mid=None):   # QC 91: a free limit is per model (OpenRouter's free models share one: its key)
    return pid if pid == "openrouter" else f"{pid}:{mid or rec_model(pid)}"


def used_today(cfg, pid, mid=None):
    return (cfg.get("ai_cloud_used") or {}).get(used_key(pid, mid)) == today()


def seen(cfg, pid):
    return (cfg.get("ai_cloud_seen") or {}).get(pid, "")


def free_ready(cfg):
    return next((i for i in FREE if has_key(i) and not used_today(cfg, i)), None)


def ready(cfg, pid):
    p = PROVIDERS.get(pid)
    return bool(p and has_key(pid) and (not p.get("acct") or (cfg.get("ai_cloud_acct") or {}).get(pid)))


def rows(cfg):
    out = []
    for pid in ORDER:
        p = PROVIDERS[pid]
        has = has_key(pid)
        models, at, state = models_of(pid)
        for m in models:
            m["used"] = used_today(cfg, pid, m["id"])
            m["use"] = use_of(pid, m["id"])   # QC 92
        out.append({k: v for k, v in p.items() if k not in ("url", "tokens", "temperature", "params", "min_tokens", "models_url", "stt_url")}
                   | {"has_key": has, "masked": shown(pid) if has else "", "seen": seen(cfg, pid), "used": used_today(cfg, pid),
                      "models": models, "listed_at": at, "list_state": state,
                      "acct_set": bool((cfg.get("ai_cloud_acct") or {}).get(pid)) if p.get("acct") else None})
    return out


# ==== Build N · QC 91: each company's own model list (mockup R60; the user pasted Groq's "Get All Available Models" docs) ====
# After a key is added, and on Test or Refresh, NeuroVault asks the company for its models (only the key is sent, never a note),
# keeps the list in LOCALAPPDATA\NeuroVault\cloud_models.json, and offers every chat model in every model menu, with the fixed
# model (cloud_providers.json "model") as the recommended one while the company still lists it. Offline: the saved list, then
# the fixed model alone. OpenRouter shows only its free models. Fields as each company documents them (read 19 Oct 2026).
import re as _re
import urllib.error as _urlerr
import urllib.request as _urlreq
from errors import plain_error  # v0.1.1 (QC 90): failures in plain words, the detail in the log

LIST_TIMEOUT = 15
LIST_MAX = 200
_SKIP = {
    "groq": r"whisper|tts|guard|orpheus|playai|speech|transcri|embed|compound|allam",
    "gemini": r"embed|imagen|veo|tts|image|aqa|live|audio|robotics|computer-use|learnlm",
    "openai": r"audio|realtime|tts|transcri|image|search|embed|instruct|codex|computer|moderation|dall|whisper|davinci|babbage|sora",
}
_VISION = {   # where a company's list doesn't say (Anthropic and OpenRouter do)
    "groq": r"vision|scout|maverick|qwen3\.8|muse", "gemini": r"gemini|gemma-3", "openai": r"gpt-4o|gpt-4\.1|gpt-5|gpt-6|^o\d",
    "anthropic": r".", "cerebras": r"vision", "cloudflare": r"vision|llava", "hf": r"vision|-vl|vl-",
}
_store_lock = threading.Lock()
_store = None   # {"lists": {pid: {"models": [...], "at": iso}}, "use": {...}} (QC 92 keeps its counts here too)


def _cache_path():
    return os.environ.get("NEUROVAULT_CLOUD_CACHE") or os.path.join(platform_layer.data_dir(), "cloud_models.json")


def cache():
    global _store
    with _store_lock:
        if _store is None:
            try:
                with open(_cache_path(), encoding="utf-8") as f:
                    _store = json.load(f)
            except (OSError, ValueError):
                _store = {}
            if not isinstance(_store, dict):
                _store = {}
            _store.setdefault("lists", {})
            _store.setdefault("use", {})
        return _store


def save_cache():
    c = cache()
    path = _cache_path()
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = f"{path}.{os.getpid()}.{threading.get_ident()}.tmp"   # each save its own (the lists come in on their own threads)
        with _store_lock:
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(c, f, ensure_ascii=False)
            os.replace(tmp, path)
    except OSError as e:
        log.warning("cloud_models.json: %s", e)


def forget_lists():   # tests
    global _store
    with _store_lock:
        _store = None


def pretty(mid):
    """A model id as a name: "llama-3.3-70b-versatile" → "Llama 3.3 70B", "openai/gpt-oss-20b" → "GPT-OSS 20B"."""
    base = _re.sub(r":free$", "", str(mid).split("/")[-1])
    drop = {"instruct", "versatile", "instant", "chat", "it", "hf", "fp8", "awq", "latest", "preview", "exp", "16e"}
    out = []
    for w in _re.split(r"[-_ ]+", base):
        lw = w.lower()
        if not w or lw in drop:
            continue
        if _re.fullmatch(r"\d+(\.\d+)?[bmk]", lw) or lw in ("gpt", "oss", "ai", "vl", "r1", "v3"):
            out.append(w.upper())
        elif w.islower():
            out.append(w.capitalize())
        else:
            out.append(w)
    return " ".join(out).replace("GPT OSS", "GPT-OSS") or str(mid)


def _ctx(n):
    try:
        n = int(n)
    except (TypeError, ValueError):
        return ""
    return f"{round(n / 1_000_000)}M" if n >= 1_000_000 else f"{round(n / 1000)}K" if n >= 1000 else ""


def parse_models(pid, data):
    """[{id, name, ctx, vision}] from a company's own list: chat models only, OpenRouter's free ones only."""
    items = data.get("data") if isinstance(data, dict) and "data" in data else data.get("result") if isinstance(data, dict) else data
    out, seen = [], set()
    for x in items or []:
        if not isinstance(x, dict):
            continue
        mid = str(x.get("id") or x.get("name") or "").strip()
        if pid == "gemini":
            mid = mid.removeprefix("models/")
        if not mid or mid in seen or len(mid) > 200:
            continue
        if pid in _SKIP and _re.search(_SKIP[pid], mid, _re.I):
            continue
        if pid == "groq" and x.get("active") is False:
            continue
        if pid == "gemini" and not _re.search(r"gemini|gemma", mid):
            continue
        if pid == "openai" and (not _re.match(r"(gpt-|o\d|chatgpt)", mid) or x.get("shutdown_date")):
            continue
        if pid == "cloudflare" and not mid.startswith("@cf/"):
            continue
        if pid == "openrouter":
            price = x.get("pricing") or {}
            free = mid.endswith(":free") or bool(price) and all(str(price.get(k, "0")) in ("0", "0.0") for k in ("prompt", "completion"))
            outs = (x.get("architecture") or {}).get("output_modalities") or ["text"]
            if not free or "text" not in outs:
                continue
        name = x.get("display_name") or (_re.sub(r"\s*\(free\)\s*$", "", str(x.get("name") or "")).split(": ", 1)[-1] if pid in ("openrouter", "cloudflare") and x.get("name") != mid else "") or pretty(mid)
        mods = (x.get("architecture") or {}).get("input_modalities")
        img = ((x.get("capabilities") or {}).get("image_input") or {}).get("supported") if isinstance(x.get("capabilities"), dict) else None
        vision = img if isinstance(img, bool) else ("image" in mods) if isinstance(mods, list) else bool(_re.search(_VISION.get(pid, r"$^"), mid, _re.I))
        ctx = x.get("context_window") or x.get("context_length") or x.get("max_input_tokens") or (x.get("top_provider") or {}).get("context_length")
        out.append({"id": mid, "name": str(name)[:80], "ctx": _ctx(ctx), "vision": bool(vision)})
        seen.add(mid)
        if len(out) >= LIST_MAX:
            break
    return out


def models_request(p, cfg, key):
    url = p["models_url"].replace("{acct}", (cfg.get("ai_cloud_acct") or {}).get(p["id"], ""))
    headers = {"User-Agent": "NeuroVault", "Accept": "application/json"}
    if p["id"] == "anthropic":
        headers.update({"x-api-key": key, "anthropic-version": "2023-06-01"})
    else:
        headers["Authorization"] = "Bearer " + key
    return url, headers


def fetch_models(pid, cfg):
    """Ask the company for its models now (only the key goes). {ok, models, at, message}. The list is kept for next time."""
    p = PROVIDERS[pid]
    key = get_key(pid)
    if not key:
        return {"ok": False, "models": [], "at": "", "message": f"There's no {p['name']} key."}
    url, headers = models_request(p, cfg, key)
    try:
        with _urlreq.urlopen(_urlreq.Request(url, headers=headers), timeout=LIST_TIMEOUT) as r:
            models = parse_models(pid, json.loads(r.read().decode("utf-8")))
    except _urlerr.HTTPError as e:
        return {"ok": False, "models": [], "at": "", "message": plain_error(e, f"ask {p['name']} for its models")}
    except (OSError, ValueError) as e:
        return {"ok": False, "models": [], "at": "", "message": plain_error(e, f"ask {p['name']} for its models")}
    if not models:
        return {"ok": False, "models": [], "at": "", "message": f"{p['name']} listed no models NeuroVault can use."}
    at = datetime.datetime.now().isoformat(timespec="minutes")
    cache()["lists"][pid] = {"models": models, "at": at}
    save_cache()
    return {"ok": True, "models": models, "at": at, "message": f"{p['name']} lists {len(models)} models. Only your key was sent."}


def models_of(pid):
    """(models, at, state): the saved list ("saved"), or the fixed model alone ("default"). Each model has rec: the fixed model
    while the company lists it, else its first."""
    p = PROVIDERS[pid]
    saved = cache()["lists"].get(pid) or {}
    models = [dict(m) for m in saved.get("models") or []]
    state = "saved" if models else "default"
    if not models:
        models = [{"id": p["model"], "name": p.get("model_name") or pretty(p["model"]), "ctx": "", "vision": bool(_re.search(_VISION.get(pid, r"$^"), p["model"], _re.I))}]
    rec = p["model"] if any(m["id"] == p["model"] for m in models) else models[0]["id"]
    for m in models:
        m["rec"] = m["id"] == rec
        if m["id"] == p["model"] and p.get("model_name"):
            m["name"] = p["model_name"]
    models.sort(key=lambda m: not m["rec"])
    return models, saved.get("at", ""), state


def rec_model(pid):
    return next(m["id"] for m in models_of(pid)[0] if m["rec"])


def model_info(pid, mid):
    return next((m for m in models_of(pid)[0] if m["id"] == mid), None)


def split_key(choice):
    """"cloud:groq" → ("groq", None); "cloud:groq:openai/gpt-oss-20b" → ("groq", "openai/gpt-oss-20b")."""
    rest = str(choice)[6:] if str(choice).startswith("cloud:") else ""
    pid, _, mid = rest.partition(":")
    return (pid, mid or None) if pid in PROVIDERS else (None, None)
# ==== end Build N · QC 91 ====


# ==== Build N · QC 92: how much of a free limit is left (mockup R60; the R60 decisions: a small ring; the Ask ring becomes the
# limits with a cloud model, its hover shows the limits and reset times). No extra calls: Groq, OpenAI and Anthropic say what's left
# in every answer's headers (Groq: requests per day, tokens per minute); OpenRouter reports its free-model use on Refresh only
# (/api/v1/key; its free models share one limit); for the rest (Gemini, Cerebras, Cloudflare, Hugging Face) NeuroVault counts what
# it sent today and says so. Read on each company's docs, 19 Oct 2026. ====
REQ_WINDOW = {"groq": "day"}   # what "requests" means in a company's headers; the others' are per minute
_DUR = _re.compile(r"(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m(?!s))?(?:(\d+(?:\.\d+)?)s)?(?:(\d+(?:\.\d+)?)ms)?$")


def _reset_at(v, now):
    """A reset as an ISO time: "2m59.56s" / "6m0s" / "1s" (Groq, OpenAI), or an RFC 3339 time (Anthropic)."""
    v = str(v or "").strip()
    if not v:
        return ""
    if _re.fullmatch(r"\d+(?:\.\d+)?", v):   # QC 98: Cerebras says seconds, as a bare number
        return (now + datetime.timedelta(seconds=float(v))).isoformat(timespec="seconds")
    m = _DUR.fullmatch(v)
    if m and any(m.groups()):
        h, mi, s, ms = (float(x or 0) for x in m.groups())
        return (now + datetime.timedelta(hours=h, minutes=mi, seconds=s + ms / 1000)).isoformat(timespec="seconds")
    try:
        t = datetime.datetime.fromisoformat(v.replace("Z", "+00:00"))
        return t.astimezone().replace(tzinfo=None).isoformat(timespec="seconds")
    except ValueError:
        return ""


def _int(v):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


def read_limits(pid, headers, now=None):
    """{requests: {limit, remaining, reset_at, window}, tokens: {...}} from an answer's headers, or {} when it says nothing."""
    now = now or datetime.datetime.now()
    h = {str(k).lower(): v for k, v in (headers or {}).items()}
    out = {}
    for kind in ("requests", "tokens"):
        # Groq/OpenAI "x-ratelimit-limit-requests"; Cerebras "x-ratelimit-limit-requests-day" (QC 98); Anthropic "anthropic-ratelimit-requests-limit"
        for lk, rk, sk, win in ((f"x-ratelimit-limit-{kind}", f"x-ratelimit-remaining-{kind}", f"x-ratelimit-reset-{kind}", None),
                                (f"x-ratelimit-limit-{kind}-day", f"x-ratelimit-remaining-{kind}-day", f"x-ratelimit-reset-{kind}-day", "day"),
                                (f"x-ratelimit-limit-{kind}-minute", f"x-ratelimit-remaining-{kind}-minute", f"x-ratelimit-reset-{kind}-minute", "minute"),
                                (f"anthropic-ratelimit-{kind}-limit", f"anthropic-ratelimit-{kind}-remaining", f"anthropic-ratelimit-{kind}-reset", None)):
            lim, rem = _int(h.get(lk)), _int(h.get(rk))
            if lim and rem is not None:
                out[kind] = {"limit": lim, "remaining": max(0, min(lim, rem)), "reset_at": _reset_at(h.get(sk), now),
                             "window": win or (REQ_WINDOW.get(pid, "minute") if kind == "requests" else "minute")}
                if kind == "requests" and (PROVIDERS.get(pid) or {}).get("rolling"):
                    out[kind]["rolling"] = True   # QC 98: Groq's day refills gradually; its reset is the time until the next one is back
                break
    return out


def record_use(pid, mid, headers=None, sent=True):
    """After each answer (or a 429): what the headers say, and NeuroVault's own count of what it sent today."""
    key = used_key(pid, mid)
    use = cache()["use"]
    u = use.get(key) if isinstance(use.get(key), dict) else {}
    day = today()
    if u.get("day") != day:   # QC 98: a new day starts the count again, but the last-known limits stay (use_of rolls them over)
        u = {k: v for k, v in u.items() if k in ("requests", "tokens", "source", "at")} | {"day": day, "sent": 0}
    if sent:
        u["sent"] = int(u.get("sent") or 0) + 1
    got = read_limits(pid, headers)
    if got:
        u.update(got)
        u["source"] = "headers"
    u["at"] = datetime.datetime.now().isoformat(timespec="seconds")
    use[key] = u
    save_cache()
    return u


def fetch_key_usage(pid, cfg):
    """OpenRouter only, on Refresh: its key's free-model use today (/api/v1/key: free_model_daily_requests)."""
    p = PROVIDERS[pid]
    if pid != "openrouter":
        return {"ok": True, "message": f"{p['name']} doesn’t say what’s left, so NeuroVault counts what it sent today. Its own page has the limits."}
    key = get_key(pid)
    if not key:
        return {"ok": False, "message": "There's no OpenRouter key."}
    try:
        req = _urlreq.Request(p["models_url"].rsplit("/models", 1)[0] + "/key", headers={"Authorization": "Bearer " + key, "User-Agent": "NeuroVault"})
        with _urlreq.urlopen(req, timeout=LIST_TIMEOUT) as r:
            d = (json.loads(r.read().decode("utf-8")) or {}).get("data") or {}
    except (OSError, ValueError) as e:
        return {"ok": False, "message": plain_error(e, "reach OpenRouter")}
    f = d.get("free_model_daily_requests") or {}
    lim, used = _int(f.get("limit")), _int(f.get("used"))
    if not lim or used is None:
        return {"ok": False, "message": "OpenRouter didn't say how many free requests are left."}
    u = cache()["use"].get("openrouter") if isinstance(cache()["use"].get("openrouter"), dict) else {}
    if u.get("day") != today():
        u = {"day": today(), "sent": 0, **{k: v for k, v in u.items() if k == "tokens"}}
    midnight = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    u.update({"requests": {"limit": lim, "remaining": max(0, lim - used), "reset_at": midnight.astimezone().replace(tzinfo=None).isoformat(timespec="seconds"), "window": "day"},
              "source": "key", "at": datetime.datetime.now().isoformat(timespec="seconds")})
    cache()["use"]["openrouter"] = u
    save_cache()
    return {"ok": True, "message": f"OpenRouter: {used:,} of {lim:,} free requests used today. Only your key was sent."}


def use_of(pid, mid=None, now=None):
    """What a model's meter shows: {sent, source: headers | key | counted, requests?, tokens?, reset_in (s), at}. QC 98: the
    last-known limits stay across restarts and days (cloud_models.json): a window that has turned over since shows full again,
    and a rolling one (Groq's day) gets back one request per slot (limit per day), so the ring shows a % at once."""
    u = cache()["use"].get(used_key(pid, mid))
    if not isinstance(u, dict):
        return {"sent": 0, "source": "counted"}
    now = now or datetime.datetime.now()
    fresh = u.get("day") == today()
    out = {"sent": int(u.get("sent") or 0) if fresh else 0, "source": u.get("source") or "counted"}
    for kind in ("requests", "tokens"):
        x = u.get(kind)
        if isinstance(x, dict) and x.get("limit"):
            try:
                at = datetime.datetime.fromisoformat(x["reset_at"]) if x.get("reset_at") else None
            except ValueError:
                at = None
            lim, used = x["limit"], x["limit"] - x["remaining"]
            left = max(0, int((at - now).total_seconds())) if at else None
            if at and now >= at:
                if x.get("rolling") and used:   # one back at the reset, then one per slot
                    slot = (86400 if x.get("window") == "day" else 60) / lim
                    gone = (now - at).total_seconds()
                    used = max(0, used - 1 - int(gone // slot))
                    left = int(slot - gone % slot) + 1 if used else None
                else:   # the window has turned over since the last answer: full again
                    used, left = 0, None
            elif not fresh and not at:
                continue   # yesterday's, and no reset time to roll it over by: unknown now
            out[kind] = {"used": used, "of": lim, "left": lim - used, "reset_in": left, "window": x.get("window", "minute")}
            if x.get("rolling"):
                out[kind]["rolling"] = True
    if u.get("at") and ("requests" in out or "tokens" in out):
        out["at"] = u["at"]
    return out
# ==== end Build N · QC 92 ====


# ==== Build N · R69: speaking a question, heard by a cloud model (Settings → Voice: "Where your words are heard") ====
# Groq's Whisper (OpenAI's /audio/transcriptions shape). The recording goes to the company, so nothing is sent before a key is added AND
# the person has said yes to "Let Groq hear what you say?" (config ask_voice_cloud_seen); the page and api.py both check. Only the
# recording goes (no note, no question). The key is the same one Ask uses, from Windows Credential Manager.
import uuid as _uuid

STT_TIMEOUT = 60
STT = [i for i in ORDER if PROVIDERS[i].get("stt_url")]   # companies that turn speech into text: Groq
STT_PID = STT[0] if STT else None


class SttError(Exception):
    """A cloud transcription that didn't happen, in plain words. code: key (refused) | limit | error."""
    code = "error"


def stt_info(cfg, pid=None):
    """What Settings and the mic need to know about the cloud ear: {id, name, model, has_key, seen}."""
    pid = pid or STT_PID
    p = PROVIDERS.get(pid) if pid else None
    if not p or not p.get("stt_url"):
        return None
    return {"id": pid, "name": p["name"], "model": p.get("stt_name") or p.get("stt_model", ""), "has_key": has_key(pid),
            "seen": bool(cfg.get("ask_voice_cloud_seen"))}


def multipart(fields, file_field, filename, content_type, data):
    """(body, content type) for a multipart/form-data upload: text fields, then one file."""
    boundary, crlf = "nv" + _uuid.uuid4().hex, b"\r\n"
    out = []
    for k, v in fields.items():
        out.append(f'--{boundary}'.encode() + crlf + f'Content-Disposition: form-data; name="{k}"'.encode() + crlf + crlf + str(v).encode("utf-8") + crlf)
    out.append(f'--{boundary}'.encode() + crlf + f'Content-Disposition: form-data; name="{file_field}"; filename="{filename}"'.encode() + crlf
               + f"Content-Type: {content_type}".encode() + crlf + crlf)
    out.append(data)
    out.append(crlf + f"--{boundary}--".encode() + crlf)
    return b"".join(out), f"multipart/form-data; boundary={boundary}"


def transcribe(pid, wav, cfg):
    """The words in a 16 kHz mono .wav, heard by the company. Refuses (SttError) with no key or no yes; never sends before both."""
    import netssl
    p = PROVIDERS.get(pid)
    if not p or not p.get("stt_url"):
        raise SttError("That company doesn’t turn speech into text.")
    if not cfg.get("ask_voice_cloud_seen"):
        raise SttError(f"Nothing was sent: say yes to {p['name']} hearing you first.")
    key = get_key(pid)
    if not key:
        e = SttError(f"There's no {p['name']} key. Settings → AI models can add one.")
        e.code = "key"
        raise e
    body, ctype = multipart({"model": p["stt_model"], "language": "en", "response_format": "json", "temperature": "0"}, "file", "speech.wav", "audio/wav", wav)
    req = _urlreq.Request(p["stt_url"], data=body, method="POST", headers={"Authorization": "Bearer " + key, "Content-Type": ctype, "Accept": "application/json", "User-Agent": "NeuroVault"})
    try:
        with netssl.urlopen(req, timeout=STT_TIMEOUT) as r:
            data = json.loads(r.read().decode("utf-8"))
    except _urlerr.HTTPError as e:
        err = SttError(f"{p['name']} didn’t accept the key. Settings → AI models can test or change it." if e.code in (401, 403)
                       else f"{p['name']}’s limit is reached for now. Nothing was sent anywhere else, and the words can be typed." if e.code == 429
                       else plain_error(e, f"have {p['name']} write down what you said"))
        err.code = "key" if e.code in (401, 403) else "limit" if e.code == 429 else "error"
        raise err
    except (OSError, ValueError) as e:
        raise SttError(plain_error(e, f"reach {p['name']}"))
    text = data.get("text") if isinstance(data, dict) else None
    return text.strip() if isinstance(text, str) else ""
# ==== end Build N · R69 ====
