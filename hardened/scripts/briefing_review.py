#!/usr/bin/env python3
"""Briefing review: turn a daily briefing into a keyboard-first answer form and
apply the answers back. Stdlib only, Python 3.9+.

Contract: docs/superpowers/specs/2026-11-12-briefing-review-design.md (engine repo).

    python3 scripts/briefing_review.py items|validate|build|serve|save|plan|mark|annotate|carryover

Vault root = parent of this script's directory, or --vault / MEMEX_VAULT.
Exit codes: 0 ok, 1 validation / not found, 2 usage.
"""
import argparse
import calendar
import datetime as dt
import hashlib
import json
import os
import pathlib
import re
import sys
import tempfile
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ITEMS_SCHEMA = "memex.briefing-items/v1"
ANSWERS_SCHEMA = "memex.briefing-review/v1"
LEDGER_SCHEMA = "memex.briefing-review-ledger/v1"
PLAN_SCHEMA = "memex.briefing-review-plan/v1"
CARRYOVER_SCHEMA = "memex.briefing-carryover/v1"

# Baked at install time by the engine; tests and un-baked runs pass --site.
DEFAULT_SITE = "http://localhost:{{QUARTZ_PORT}}"

SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
APP_JS = "briefing_review_app.js"
APP_CSS = "briefing_review_app.css"

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
SECTION_RE = re.compile(r"^(?:[0-9]|1[01]|asks)$")
SKIPPED_SECTIONS = {"1", "2", "12", "13"}
SURFACES = ("page", "server", "widget", "artifact")
SAVE_SURFACES = SURFACES + ("cli", "export")
SENSITIVITIES = ("normal", "private", "sensitive")
RESULTS = ("applied", "skipped", "failed", "drafted")
MAX_POST_BYTES = 2 * 1024 * 1024
DEFAULT_MAX_BYTES = 60000
EXPORT_TEXT_MAX = 140

# id -> (label, param, colour group). Colour groups are styled by the client CSS.
ACTIONS = {
    "do": ("Do it", None, "accent"),
    "done": ("Done", None, "positive"),
    "defer": ("Defer", "date", "time"),
    "waiting": ("Waiting", "who", "time"),
    "rescope": ("Re-scope", None, "edit"),
    "cancel": ("Cancel", None, "negative"),
    "keep": ("Keep", None, "neutral"),
    "create_task": ("Make task", "title", "edit"),
    "skip": ("Skip", None, "negative"),
    "touched": ("Touched", None, "positive"),
    "push": ("Push", "date", "time"),
    "agenda": ("Agenda", None, "edit"),
    "bump": ("Bump review", "date", "time"),
    "pause": ("Pause", None, "negative"),
    "drop": ("Drop", None, "negative"),
    "file": ("File", None, "positive"),
    "ingest": ("Ingest", None, "positive"),
    "dismiss": ("Dismiss", None, "negative"),
    "decide": ("Decide", None, "positive"),
}

KIND_ACTIONS = {
    "task": ["do", "done", "defer", "waiting", "rescope", "cancel", "keep"],
    "proposal": ["do", "create_task", "skip"],
    "person": ["do", "touched", "push", "agenda", "keep"],
    "project": ["do", "bump", "pause", "drop", "keep"],
    "capture": ["do", "file", "ingest", "dismiss"],
    "tracker": ["do", "defer", "dismiss", "keep"],
    "followup": ["do", "done", "defer", "create_task", "drop"],
    "decision": ["do", "decide", "defer", "create_task", "drop"],
    "job": ["do", "skip", "keep"],
    "item": ["do", "done", "defer", "create_task", "drop", "keep"],
}

# Target folder -> kind, for the Markdown fallback.
FOLDER_KINDS = (
    ("Ops/Tasks/", "task"),
    ("Atlas/People/", "person"),
    ("Atlas/Projects/", "project"),
    ("Atlas/Trackers/", "tracker"),
    ("Ops/Followups/", "followup"),
    ("Atlas/Decisions/", "decision"),
    ("Agents/Jobs/", "job"),
    ("Inbox/", "capture"),
)

# Directories never indexed when resolving wikilinks.
INDEX_SKIP_DIRS = {"node_modules", "quartz", "outputs", "public", "__pycache__"}

# Payload fields the client needs (status/due/signal/threads are already in `text`).
PAYLOAD_FIELDS = ("id", "n", "section", "section_title", "label", "group", "kind", "target",
                  "text", "detail", "also_in", "actions", "carried_from", "previous")


class ReviewError(Exception):
    """A user-facing failure. code 1 = validation / not found, 2 = usage."""

    def __init__(self, message, code=1):
        super().__init__(message)
        self.code = code


# --------------------------------------------------------------------------- utils

def now_iso():
    return dt.datetime.now().astimezone().replace(microsecond=0).isoformat()


def atomic_write(path, text):
    path = pathlib.Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix="." + path.name + ".", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text)
            fh.flush()
            os.fsync(fh.fileno())
        os.chmod(tmp, 0o644)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def dump_json(obj):
    return json.dumps(obj, indent=2, ensure_ascii=False) + "\n"


def read_json(path, what):
    try:
        text = pathlib.Path(path).read_text(encoding="utf-8")
    except FileNotFoundError:
        raise ReviewError(f"{what} not found: {path}")
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise ReviewError(f"{what} is not valid JSON ({path}): {exc}")


def parse_iso_date(text):
    if not isinstance(text, str) or not DATE_RE.match(text):
        return None
    try:
        return dt.date.fromisoformat(text)
    except ValueError:
        return None


def check_date_arg(text):
    if parse_iso_date(text) is None:
        raise ReviewError(f"bad date {text!r}: expected YYYY-MM-DD", code=2)
    return text


# --------------------------------------------------------------------------- date shortcuts

WEEKDAYS = {
    "mon": 0, "monday": 0, "tue": 1, "tues": 1, "tuesday": 1, "wed": 2, "wednesday": 2,
    "thu": 3, "thur": 3, "thurs": 3, "thursday": 3, "fri": 4, "friday": 4,
    "sat": 5, "saturday": 5, "sun": 6, "sunday": 6,
}
MONTHS = {name.lower(): i for i, name in enumerate(calendar.month_abbr) if name}
MONTHS.update({name.lower(): i for i, name in enumerate(calendar.month_name) if name})
MONTHS["sept"] = 9


def _month_day(base, month, day, year=None):
    if year is not None and year < 100:
        year += 2000
    try:
        out = dt.date(year or base.year, month, day)
    except ValueError:
        return None
    if year is None and out < base:
        try:
            out = dt.date(base.year + 1, month, day)
        except ValueError:
            return None
    return out


def resolve_date(value, base):
    """Resolve an ISO date or shortcut relative to `base` (a date). None if unparseable.

    Mirrored by resolveDate() in briefing_review_app.js; keep the two in step.
    """
    if not isinstance(value, str):
        return None
    v = re.sub(r"\s+", " ", value.strip().lower().rstrip("."))
    if not v:
        return None
    if DATE_RE.match(v):
        d = parse_iso_date(v)
        return d.isoformat() if d else None
    out = None
    if v in ("today", "tod"):
        out = base
    elif v in ("tom", "tomorrow", "tmr", "tmrw"):
        out = base + dt.timedelta(days=1)
    elif v in WEEKDAYS:
        out = base + dt.timedelta(days=(WEEKDAYS[v] - base.weekday()) % 7 or 7)
    elif v in ("nw", "next week"):
        out = base + dt.timedelta(days=(0 - base.weekday()) % 7 or 7)
    elif v == "eow":
        out = base + dt.timedelta(days=(4 - base.weekday()) % 7)
    elif v == "eom":
        out = base.replace(day=calendar.monthrange(base.year, base.month)[1])
    else:
        m = re.match(r"^\+?(\d{1,3}) ?([dw])$", v) or re.match(r"^\+(\d{1,3})()$", v)
        if m:
            n = int(m.group(1))
            out = base + dt.timedelta(days=n * 7 if m.group(2) == "w" else n)
        m = None if out else re.match(r"^(\d{1,2})/(\d{1,2})(?:/(\d{2}|\d{4}))?$", v)
        if m:
            out = _month_day(base, int(m.group(1)), int(m.group(2)),
                             int(m.group(3)) if m.group(3) else None)
        m = None if out else re.match(r"^([a-z]+) (\d{1,2})(?:,? (\d{4}))?$", v)
        if m and m.group(1) in MONTHS:
            out = _month_day(base, MONTHS[m.group(1)], int(m.group(2)),
                             int(m.group(3)) if m.group(3) else None)
        m = None if out else re.match(r"^(\d{1,2}) ([a-z]+)(?: (\d{4}))?$", v)
        if m and m.group(2) in MONTHS:
            out = _month_day(base, MONTHS[m.group(2)], int(m.group(1)),
                             int(m.group(3)) if m.group(3) else None)
    return out.isoformat() if out else None


# --------------------------------------------------------------------------- vault paths

def default_vault():
    env = os.environ.get("MEMEX_VAULT")
    return pathlib.Path(env).expanduser().resolve() if env else SCRIPT_DIR.parent


def briefings_dir(vault):
    return vault / "Ops" / "Briefings"


def briefing_md_path(vault, date):
    return briefings_dir(vault) / f"{date}.md"


def items_path(vault, date):
    return briefings_dir(vault) / f"{date}.items.json"


def answers_path(vault, date):
    return vault / "Inbox" / "reviews" / f"{date}.json"


def ledger_path(vault, date):
    return vault / "Inbox" / "reviews" / f"{date}.ledger.json"


def outputs_dir(vault):
    return vault / "outputs" / "briefing-review"


def latest_date(vault):
    found = set()
    folder = briefings_dir(vault)
    if folder.is_dir():
        for p in folder.iterdir():
            m = re.match(r"^(\d{4}-\d{2}-\d{2})(?:\.md|\.items\.json)$", p.name)
            if m and parse_iso_date(m.group(1)):
                found.add(m.group(1))
    if not found:
        raise ReviewError(f"no daily briefing found in {folder}")
    return max(found)


def pick_date(vault, date):
    return check_date_arg(date) if date else latest_date(vault)


# --------------------------------------------------------------------------- markdown helpers

WIKILINK_RE = re.compile(r"\[\[([^\[\]]+?)\]\]")


def strip_frontmatter(text):
    if text.startswith("---"):
        m = re.match(r"^---[^\n]*\n.*?\n---[ \t]*(?:\n|$)", text, re.S)
        if m:
            return text[m.end():]
    return text


def frontmatter_value(text, key):
    if not text.startswith("---"):
        return None
    m = re.match(r"^---[^\n]*\n(.*?)\n---", text, re.S)
    if not m:
        return None
    fm = re.search(r"^" + re.escape(key) + r":\s*[\"']?([^\"'\n#]*?)[\"']?\s*(?:#.*)?$", m.group(1), re.M)
    return fm.group(1).strip() if fm else None


def wikilink_target(inner):
    """`Path/Note#Heading|Alias` -> `Path/Note`."""
    return inner.split("|", 1)[0].split("#", 1)[0].strip()


def plain_text(md):
    """Briefing Markdown -> plain text for exports and hashing. Wikilinks are kept.

    Mirrored by plainText() in briefing_review_app.js.
    """
    s = re.sub(r"`([^`]*)`", r"\1", md or "")
    s = re.sub(r"\*\*(.+?)\*\*", r"\1", s)
    s = re.sub(r"(?<![*\w])\*(?=\S)(.+?)(?<=\S)\*(?![*\w])", r"\1", s)
    s = re.sub(r"(?<!\[)\[([^\[\]]+)\]\(([^)\s]+)\)", r"\1", s)
    return re.sub(r"\s+", " ", s).strip()


def truncate_export(text, limit=EXPORT_TEXT_MAX):
    """Truncate to ~limit chars, keeping a leading [[wikilink]] whole."""
    if len(text) <= limit:
        return text
    keep = 0
    if text.startswith("[["):
        end = text.find("]]")
        if end != -1:
            keep = end + 2
    if keep >= limit:
        return text[:keep] + "\u2026"
    cut = text[:limit]
    space = cut.rfind(" ")
    if space > max(keep, limit // 2):
        cut = cut[:space]
    return cut.rstrip(" ,;:\u2014-") + "\u2026"


def leading_title(md):
    """The item's leading wikilink display title, or None."""
    m = re.match(r"^\s*(?:\*\*)?\[\[([^\[\]]+?)\]\]", md or "")
    if not m:
        return None
    inner = m.group(1)
    if "|" in inner:
        return inner.split("|", 1)[1].strip()
    return wikilink_target(inner).rsplit("/", 1)[-1]


def short_hash(text):
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:8]


# --------------------------------------------------------------------------- note index

class NoteIndex:
    """Resolves wikilinks to vault-relative paths. Built lazily: only the fallback
    parser and link maps need it, and walking a big vault costs a few hundred ms."""

    def __init__(self, vault):
        self.vault = vault
        self._by_stem = None

    def _build(self):
        by_stem = {}
        for dirpath, dirnames, filenames in os.walk(self.vault):
            dirnames[:] = sorted(d for d in dirnames
                                 if not d.startswith(".") and d not in INDEX_SKIP_DIRS)
            for name in filenames:
                if name.endswith(".md"):
                    rel = pathlib.Path(dirpath, name).relative_to(self.vault).as_posix()
                    by_stem.setdefault(name[:-3].lower(), []).append(rel)
        self._by_stem = by_stem

    def resolve(self, link):
        """Return the vault-relative `.md` path for a wikilink target, or None."""
        target = wikilink_target(link)
        if not target:
            return None
        if target.lower().endswith(".md"):
            target = target[:-3]
        if "/" in target and (self.vault / (target + ".md")).is_file():
            return target + ".md"
        if self._by_stem is None:
            self._build()
        stem = target.rsplit("/", 1)[-1].lower()
        candidates = self._by_stem.get(stem, [])
        if "/" in target:
            candidates = [c for c in candidates if c.lower().endswith(target.lower() + ".md")]
        if not candidates:
            return None
        return sorted(candidates, key=lambda c: (c.count("/"), c))[0]

    def sensitivity(self, rel):
        try:
            head = (self.vault / rel).read_text(encoding="utf-8", errors="replace")[:4000]
        except OSError:
            return None
        value = (frontmatter_value(head, "sensitivity") or "").lower()
        return value if value in SENSITIVITIES else None


def kind_for_target(target):
    for prefix, kind in FOLDER_KINDS:
        if target and target.startswith(prefix):
            return kind
    return "item"


def make_id(kind, target, date, section, text):
    if target:
        return f"{kind}:{target[:-3] if target.endswith('.md') else target}"
    return f"{kind}:{date}:{section}:{short_hash(plain_text(text))}"


# --------------------------------------------------------------------------- markdown fallback

LIST_RE = re.compile(r"^(\s*)([-*+]|\d+[.)])\s+(.*)$")
DETAIL_RE = re.compile("^\\s*(?:[-*+]\\s+)?\u21b3\\s*(.*)$")
H2_NUM_RE = re.compile(r"^##\s+(\d+)\.\s*(.*?)\s*$")
H2_ASKS_RE = re.compile("^##\\s+\u2691\\s*(.*?)\\s*$")
EMPTY_ITEM_RE = re.compile(r"^[(_*]*\s*(none|nothing|n/a|no items?)\b", re.I)


def _indent(ws):
    return len(ws.expandtabs(4))


def _next_list_indent(lines, i):
    """Indent of the next non-blank line if it is a list item, else None."""
    for line in lines[i + 1:]:
        if not line.strip():
            continue
        m = LIST_RE.match(line)
        return _indent(m.group(1)) if m else None
    return None


def _letters(i):
    out = ""
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        out = chr(97 + r) + out
    return out


def parse_briefing_markdown(md, date):
    """Parse a briefing's Markdown into raw rows (dicts) in document order.

    Rows have section, section_title, label, group, text, detail. Sections 1, 2,
    12, 13 and `### Upcoming meetings` are skipped; `\u21b3` lines are detail of the
    row above; a childful list item ending in ':' without a wikilink is a group label.
    """
    lines = strip_frontmatter(md).splitlines()
    rows = []
    section = None
    title = ""
    sub = ""
    active = False
    stack = []  # (indent, node); node = {"row": row} | {"group": str} | {"detail_of": row}
    counters = {}

    for i, line in enumerate(lines):
        if line.startswith("## "):
            stack = []
            sub = ""
            m_num, m_ask = H2_NUM_RE.match(line), H2_ASKS_RE.match(line)
            if m_num:
                section, title = str(int(m_num.group(1))), m_num.group(2)
            elif m_ask:
                section, title = "asks", m_ask.group(1) or "Asks"
            else:
                section = None
            active = section is not None and section not in SKIPPED_SECTIONS
            continue
        if line.startswith("### "):
            stack = []
            sub = line[4:].strip()
            active = (section is not None and section not in SKIPPED_SECTIONS
                      and not sub.lower().startswith("upcoming meetings"))
            continue
        if not active or not line.strip() or line.lstrip().startswith(("#", ">", "|")):
            continue

        m_detail = DETAIL_RE.match(line)
        if m_detail:
            if rows and rows[-1]["section"] == section and m_detail.group(1).strip():
                rows[-1]["detail"].append(m_detail.group(1).strip())
            continue
        m = LIST_RE.match(line)
        if not m:
            continue
        indent, marker, text = _indent(m.group(1)), m.group(2), m.group(3).strip()
        text = re.sub(r"^\[[ xX]\]\s+", "", text)
        while stack and stack[-1][0] >= indent:
            stack.pop()
        parent = stack[-1][1] if stack else None
        if parent and "detail_of" in parent:
            parent["detail_of"]["detail"].append(text)
            stack.append((indent, parent))
            continue

        next_indent = _next_list_indent(lines, i)
        has_children = next_indent is not None and next_indent > indent
        if has_children and text.endswith(":") and "[[" not in text:
            stack.append((indent, {"group": text[:-1].strip().strip("*_").strip()}))
            continue
        parent_row = parent.get("row") if parent else None
        if parent_row is not None and section != "0" and "[[" not in text:
            parent_row["detail"].append(text)
            stack.append((indent, {"detail_of": parent_row}))
            continue
        if not text or ("[[" not in text and EMPTY_ITEM_RE.match(text)):
            continue

        group = next((n["group"] for _, n in reversed(stack) if "group" in n), "")
        label = ""
        if section == "0":
            if parent_row is not None and parent_row["label"]:
                k = parent_row["label"]
                counters[k] = counters.get(k, 0) + 1
                label = k + _letters(counters[k] - 1)
            else:
                counters["#"] = counters.get("#", 0) + 1
                num = marker.rstrip(".)") if marker[0].isdigit() else str(counters["#"])
                label = "#" + num
        row = {
            "section": section,
            "section_title": f"{title} \u2014 {sub}" if sub else title,
            "label": label,
            "group": group,
            "text": text,
            "detail": [],
        }
        rows.append(row)
        stack.append((indent, {"row": row}))
    return rows


def rows_to_items(rows, date, index):
    """Resolve targets/kinds/ids for parsed rows; dedupe repeated ids into also_in."""
    items, by_id = [], {}
    for row in rows:
        link = WIKILINK_RE.search(row["text"])
        target = index.resolve(link.group(1)) if link else None
        kind = kind_for_target(target)
        item_id = make_id(kind, target, date, row["section"], row["text"])
        if item_id in by_id:
            first = by_id[item_id]
            if row["section"] != first["section"] and row["section"] not in first["also_in"]:
                first["also_in"].append(row["section"])
            continue
        item = {"id": item_id, "section": row["section"], "section_title": row["section_title"],
                "label": row["label"], "group": row["group"], "kind": kind, "text": row["text"],
                "detail": row["detail"], "also_in": []}
        if target:
            item["target"] = target
        status = re.search(r"status:\s*`?([a-z_]+)", row["text"])
        if status:
            item["status"] = status.group(1)
        due = re.search(r"\bdue:?\s*(\d{4}-\d{2}-\d{2})", row["text"])
        if due:
            item["due"] = due.group(1)
        signal = next((d.split(":", 1)[1].strip() for d in row["detail"]
                       if d.lower().startswith("signal:")), None)
        if signal:
            item["signal"] = signal
        item["sensitivity"] = (index.sensitivity(target) if target else None) or "private"
        by_id[item_id] = item
        items.append(item)
    return items


def items_from_markdown(vault, date, index=None):
    path = briefing_md_path(vault, date)
    if not path.is_file():
        raise ReviewError(f"briefing not found: {path}")
    rows = parse_briefing_markdown(path.read_text(encoding="utf-8"), date)
    items = rows_to_items(rows, date, index or NoteIndex(vault))
    return {"schema": ITEMS_SCHEMA, "date": date, "generated_at": now_iso(),
            "source": "markdown", "items": items}


# --------------------------------------------------------------------------- items.json

def validate_items(doc, date=None):
    """Return a list of problems (empty when valid)."""
    if not isinstance(doc, dict):
        return ["top level must be a JSON object"]
    problems = []
    if doc.get("schema") != ITEMS_SCHEMA:
        problems.append(f"schema must be {ITEMS_SCHEMA!r} (got {doc.get('schema')!r})")
    if parse_iso_date(doc.get("date")) is None:
        problems.append(f"date must be YYYY-MM-DD (got {doc.get('date')!r})")
    elif date and doc["date"] != date:
        problems.append(f"date {doc['date']!r} does not match {date!r}")
    items = doc.get("items")
    if not isinstance(items, list):
        return problems + ["items must be a list"]
    seen = set()
    for i, item in enumerate(items, 1):
        problems.extend(f"item {i}: {p}" for p in _item_problems(item, seen))
    return problems


def _item_problems(item, seen):
    if not isinstance(item, dict):
        return ["must be an object"]
    out = []
    for key in ("id", "section", "kind", "text"):
        if not isinstance(item.get(key), str) or not item.get(key).strip():
            out.append(f"missing required string {key!r}")
    item_id = item.get("id")
    if isinstance(item_id, str):
        if item_id in seen:
            out.append(f"duplicate id {item_id!r}")
        seen.add(item_id)
    if isinstance(item.get("section"), str) and not SECTION_RE.match(item["section"]):
        out.append(f"section must be \"0\"-\"11\" or \"asks\" (got {item['section']!r})")
    kind = item.get("kind")
    if isinstance(kind, str) and kind not in KIND_ACTIONS:
        out.append(f"unknown kind {kind!r}")
    actions = item.get("actions")
    if actions is not None:
        if not isinstance(actions, list) or not all(isinstance(a, str) for a in actions):
            out.append("actions must be a list of strings")
        else:
            unknown = [a for a in actions if a not in ACTIONS]
            if unknown:
                out.append(f"unknown actions {unknown}")
            if not actions or actions[0] != "do":
                out.append("actions must start with \"do\"")
            if len(set(actions)) != len(actions):
                out.append("actions contain duplicates")
            if len(actions) > 9:
                out.append("at most 9 actions (Alt+1..9)")
    for key in ("detail", "also_in", "threads"):
        val = item.get(key)
        if val is not None and (not isinstance(val, list) or not all(isinstance(v, str) for v in val)):
            out.append(f"{key} must be a list of strings")
    for key in ("section_title", "label", "group", "target", "status", "due", "signal", "carried_from"):
        if item.get(key) is not None and not isinstance(item[key], str):
            out.append(f"{key} must be a string")
    if item.get("sensitivity") is not None and item["sensitivity"] not in SENSITIVITIES:
        out.append(f"sensitivity must be one of {list(SENSITIVITIES)}")
    prev = item.get("previous")
    if prev is not None and (not isinstance(prev, dict) or
                             (prev.get("action") is not None and prev.get("action") not in ACTIONS)):
        out.append("previous must be an object {date, action, params, note}")
    if "n" in item:
        out.append("n is display-only and must not be stored")
    return out


def normalize_items(doc):
    """Fill optional fields with defaults (in place) and return the doc."""
    for item in doc["items"]:
        item.setdefault("section_title", "")
        item.setdefault("label", "")
        item.setdefault("group", "")
        item.setdefault("detail", [])
        item.setdefault("also_in", [])
        item.setdefault("sensitivity", "private")
        if not item.get("actions"):
            item["actions"] = list(KIND_ACTIONS[item["kind"]])
    return doc


def load_items(vault, date, index=None):
    """items.json when present, else the Markdown fallback. Validated + normalized."""
    path = items_path(vault, date)
    if path.is_file():
        doc = read_json(path, "items file")
        problems = validate_items(doc, date)
        if problems:
            raise ReviewError(f"{path} is invalid:\n  " + "\n  ".join(problems))
        return normalize_items(doc)
    doc = items_from_markdown(vault, date, index)
    return normalize_items(doc)


def item_map(doc):
    """id -> (n, item)."""
    return {item["id"]: (n, item) for n, item in enumerate(doc["items"], 1)}


# --------------------------------------------------------------------------- answers

def _clean_params(action, params, base):
    param = ACTIONS[action][1] if action else None
    params = params if isinstance(params, dict) else {}
    if param == "date":
        raw = params.get("date") or params.get("date_raw") or ""
        raw = raw if isinstance(raw, str) else str(raw)
        if not raw.strip():
            return {}
        resolved = resolve_date(raw, base)
        return {"date": resolved} if resolved else {"date_raw": raw.strip()}
    if param in ("who", "title"):
        val = params.get(param)
        return {param: val.strip()} if isinstance(val, str) and val.strip() else {}
    return {}


def normalize_answers(doc, items_doc, date):
    """Validate an answers object against the items. Returns (answers, unanswered)."""
    if not isinstance(doc, dict):
        raise ReviewError("answers must be a JSON object")
    if doc.get("schema") not in (None, ANSWERS_SCHEMA):
        raise ReviewError(f"schema must be {ANSWERS_SCHEMA!r}")
    if doc.get("date") not in (None, date):
        raise ReviewError(f"answers are for {doc.get('date')!r}, not {date!r}")
    raw = doc.get("answers")
    if not isinstance(raw, list):
        raise ReviewError("answers must contain an \"answers\" list")
    lookup = item_map(items_doc)
    base = dt.date.fromisoformat(date)
    out, seen, problems = [], set(), []
    for i, ans in enumerate(raw, 1):
        if not isinstance(ans, dict):
            problems.append(f"answer {i}: must be an object")
            continue
        aid, action, note = ans.get("id"), ans.get("action"), ans.get("note") or ""
        if aid not in lookup:
            problems.append(f"answer {i}: unknown id {aid!r}")
            continue
        if aid in seen:
            problems.append(f"answer {i}: duplicate id {aid!r}")
            continue
        n, item = lookup[aid]
        if action is not None and action not in item["actions"]:
            problems.append(f"answer {i}: action {action!r} is not allowed for {aid!r}")
            continue
        if not isinstance(note, str):
            problems.append(f"answer {i}: note must be a string")
            continue
        note = note.strip()
        if action is None and not note:
            continue  # nothing answered
        seen.add(aid)
        out.append({"id": aid, "n": n, "action": action,
                    "params": _clean_params(action, ans.get("params"), base),
                    "note": note, "kind": item["kind"], "target": item.get("target", ""),
                    "text": plain_text(item["text"])})
    if problems:
        raise ReviewError("answers are invalid:\n  " + "\n  ".join(problems))
    out.sort(key=lambda a: a["n"])
    unanswered = [item["id"] for item in items_doc["items"] if item["id"] not in seen]
    return out, unanswered


def load_answers(vault, date, include_draft=True):
    path = answers_path(vault, date)
    doc = read_json(path, "answers file")
    if not include_draft and not doc.get("submitted"):
        raise ReviewError(f"{path} is an unsubmitted draft; pass --include-draft to use it")
    return doc


def save_answers(vault, date, doc, surface, draft=False, part=None, items_doc=None):
    """Validate and write Inbox/reviews/<date>.json. Returns (path, kept_submitted).

    A draft never replaces a submitted file. `part` = (lo, hi) row range of a
    widget page export: answers outside that range are kept from the file on disk.
    """
    items_doc = items_doc or load_items(vault, date)
    answers, _ = normalize_answers(doc, items_doc, date)
    path = answers_path(vault, date)
    existing = None
    if path.is_file():
        try:
            existing = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            existing = None
    if draft and existing and existing.get("submitted"):
        return path, True
    if part and existing:
        lo, hi = part
        keep = [a for a in existing.get("answers", []) if isinstance(a, dict)
                and not lo <= item_map(items_doc).get(a.get("id"), (0,))[0] <= hi]
        answers, _ = normalize_answers({"answers": keep + answers}, items_doc, date)
    answered = {a["id"] for a in answers}
    stamp = now_iso()
    out = {
        "schema": ANSWERS_SCHEMA,
        "date": date,
        "submitted_at": None if draft else stamp,
        "saved_at": stamp,
        "surface": surface,
        "submitted": not draft,
        "answers": answers,
        "unanswered": [i["id"] for i in items_doc["items"] if i["id"] not in answered],
    }
    atomic_write(path, dump_json(out))
    return path, False


# --------------------------------------------------------------------------- text export

EXPORT_HEADER_RE = re.compile(r"^Briefing review \u2014 (\d{4}-\d{2}-\d{2})\b")
EXPORT_PART_RE = re.compile(r"^Part (\d+) of (\d+) \u2014 rows (\d+)-(\d+)\.?\s*$")
EXPORT_ROW_RE = re.compile(r"^- \[(\d+)\] (?:(.*?) )?([A-Z_]+)(?:\((.*?)\))? \u2014 ")
EXPORT_NOTE_RE = re.compile(r"^\s+\u2192 ?(.*)$")


def section_heading(item):
    sec = item["section"]
    title = item.get("section_title") or ""
    return (f"\u00a7{sec} {title}" if sec != "asks" else f"\u2691 {title or 'Asks'}").rstrip()


def param_display(action, params):
    param = ACTIONS[action][1] if action else None
    if not param or not params:
        return ""
    if param == "date":
        return params.get("date") or params.get("date_raw") or ""
    return params.get(param) or ""


def format_export(date, items_doc, answers, part=None):
    """The clipboard / sendPrompt text. Mirrored by exportText() in the client."""
    by_id = {a["id"]: a for a in answers}
    lines = [f"Briefing review \u2014 {date} (apply with the apply-review skill)"]
    if part:
        lines.append(f"Part {part[0]} of {part[1]} \u2014 rows {part[2]}-{part[3]}.")
    lines.append("")
    current, unanswered = None, 0
    for n, item in enumerate(items_doc["items"], 1):
        if part and not part[2] <= n <= part[3]:
            continue
        ans = by_id.get(item["id"])
        if not ans:
            unanswered += 1
            continue
        heading = section_heading(item)
        if heading != current:
            if current is not None:
                lines.append("")
            lines.append(heading)
            current = heading
        action = ans["action"].upper() if ans.get("action") else "NOTE"
        shown = param_display(ans.get("action"), ans.get("params"))
        label = f" {item['label']}" if item.get("label") else ""
        param = f"({shown})" if shown else ""
        lines.append(f"- [{n}]{label} {action}{param} \u2014 {truncate_export(plain_text(item['text']))}")
        if ans.get("note"):
            lines.append("    \u2192 " + " / ".join(x.strip() for x in ans["note"].splitlines() if x.strip()))
    if current is not None:
        lines.append("")
    if unanswered:
        noun = "row" if unanswered == 1 else "rows"
        lines.append(f"({unanswered} {noun} left unanswered \u2014 leave as is.)")
    else:
        lines.append("(All rows answered.)")
    return "\n".join(lines) + "\n"


def parse_export(text, items_doc=None):
    """Text export -> (date, answers-object, part range or None)."""
    lines = text.replace("\r\n", "\n").split("\n")
    date, part, answers = None, None, []
    for line in lines:
        m = EXPORT_HEADER_RE.match(line.strip())
        if m:
            date = m.group(1)
            break
    if not date:
        raise ReviewError("export header not found (expected 'Briefing review \u2014 YYYY-MM-DD')")
    current = None
    for line in lines:
        m_part = EXPORT_PART_RE.match(line.strip())
        if m_part:
            part = (int(m_part.group(3)), int(m_part.group(4)))
            continue
        m = EXPORT_ROW_RE.match(line)
        if m:
            action = m.group(3)
            current = {"n": int(m.group(1)), "action": None if action == "NOTE" else action.lower(),
                       "param": m.group(4), "note": ""}
            answers.append(current)
            continue
        m_note = EXPORT_NOTE_RE.match(line)
        if m_note and current is not None:
            current["note"] = (current["note"] + " / " if current["note"] else "") + m_note.group(1).strip()
            continue
        if line.strip() and not line.startswith(" "):
            current = None
    return date, answers, part


def export_to_answers(parsed_rows, items_doc):
    items = items_doc["items"]
    out, problems = [], []
    for row in parsed_rows:
        n, action = row["n"], row["action"]
        if not 1 <= n <= len(items):
            problems.append(f"row [{n}] is out of range (1-{len(items)})")
            continue
        if action is not None and action not in ACTIONS:
            problems.append(f"row [{n}]: unknown action {action.upper()!r}")
            continue
        param = ACTIONS[action][1] if action else None
        params = {}
        if param and row["param"]:
            params = {"date" if param == "date" else param: row["param"]}
        out.append({"id": items[n - 1]["id"], "action": action, "params": params, "note": row["note"]})
    if problems:
        raise ReviewError("export is invalid:\n  " + "\n  ".join(problems))
    return {"schema": ANSWERS_SCHEMA, "answers": out}


# --------------------------------------------------------------------------- ledger + plan

DIRECT_EDITS = {
    ("task", "defer"), ("task", "waiting"), ("task", "rescope"),
    ("person", "touched"), ("person", "push"),
    ("project", "bump"), ("project", "pause"), ("project", "drop"),
    ("followup", "done"), ("followup", "defer"), ("followup", "drop"),
    ("tracker", "defer"),
}


def fingerprint(answer):
    params = json.dumps(answer.get("params") or {}, sort_keys=True, separators=(",", ":"))
    raw = f"{answer['id']}|{answer.get('action') or ''}|{params}|{answer.get('note') or ''}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


def route_for(kind, action, vault=None):
    if action is None or action == "do":
        return "run-trackers" if (kind, action) == ("tracker", "do") else "agent"
    if action in ("keep", "skip"):
        return "noop"
    if action == "create_task":
        return "create-task"
    if kind == "task" and action in ("done", "cancel"):
        return "close-task"
    if (kind, action) in DIRECT_EDITS:
        return "frontmatter"
    if kind == "person" and action == "agenda":
        installed = vault is not None and (vault / ".claude" / "skills" / "meeting-agenda").is_dir()
        return "meeting-agenda" if installed else "agenda-section"
    if kind == "capture":
        return {"file": "triage-inbox", "ingest": "ingest-source", "dismiss": "dismiss"}[action]
    if (kind, action) == ("decision", "decide"):
        return "capture-decision"
    return "agent"


def load_ledger(vault, date):
    path = ledger_path(vault, date)
    if not path.is_file():
        return {"schema": LEDGER_SCHEMA, "date": date, "entries": {}}
    doc = read_json(path, "ledger")
    if not isinstance(doc, dict) or not isinstance(doc.get("entries"), dict):
        raise ReviewError(f"ledger is malformed: {path}")
    return doc


def build_plan(vault, date, include_draft=False):
    answers_doc = load_answers(vault, date, include_draft=include_draft)
    items_doc = load_items(vault, date)
    lookup = item_map(items_doc)
    entries = load_ledger(vault, date)["entries"]
    plan, applied = [], 0
    for ans in answers_doc.get("answers", []):
        fp = fingerprint(ans)
        prior = entries.get(ans["id"])
        if prior and prior.get("fingerprint") == fp:
            applied += 1
            continue
        item = lookup.get(ans["id"], (ans.get("n"), {}))[1]
        kind = ans.get("kind") or item.get("kind", "item")
        route = route_for(kind, ans.get("action"), vault)
        entry = {
            "id": ans["id"], "n": ans.get("n"), "kind": kind, "action": ans.get("action"),
            "params": ans.get("params") or {}, "note": ans.get("note") or "",
            "target": ans.get("target") or item.get("target", ""), "text": ans.get("text", ""),
            "sensitivity": item.get("sensitivity", "private"), "route": route,
            "also": ["agent"] if ans.get("note") and route != "agent" else [],
            "fingerprint": fp, "changed": bool(prior),
        }
        plan.append(entry)
    return {"schema": PLAN_SCHEMA, "date": date, "answers_file": str(answers_path(vault, date)),
            "submitted": bool(answers_doc.get("submitted")), "already_applied": applied,
            "entries": plan}


def format_plan(plan):
    lines = [f"Apply plan \u2014 {plan['date']} ({len(plan['entries'])} to apply, "
             f"{plan['already_applied']} already in ledger)"
             + ("" if plan["submitted"] else " [DRAFT]")]
    for e in plan["entries"]:
        shown = param_display(e["action"], e["params"])
        act = (e["action"] or "note").upper() + (f"({shown})" if shown else "")
        also = " + agent (note)" if e["also"] else ""
        changed = " [changed]" if e["changed"] else ""
        lines.append(f"- [{e['n']}] {act} \u2192 {e['route']}{also}{changed} \u2014 "
                     f"{truncate_export(e['text'], 100)}")
        if e["note"]:
            lines.append(f"    \u2192 {e['note']}")
    return "\n".join(lines) + "\n"


def mark_answer(vault, date, answer_id, result, summary=""):
    answers_doc = load_answers(vault, date)
    ans = next((a for a in answers_doc.get("answers", []) if a.get("id") == answer_id), None)
    if ans is None:
        raise ReviewError(f"no answer for id {answer_id!r} in {answers_path(vault, date)}")
    ledger = load_ledger(vault, date)
    ledger["entries"][answer_id] = {"fingerprint": fingerprint(ans), "result": result,
                                    "summary": summary or "", "at": now_iso()}
    atomic_write(ledger_path(vault, date), dump_json(ledger))
    return ledger_path(vault, date)


# --------------------------------------------------------------------------- annotate

BLOCK_START = "<!-- briefing-review:resolved:start -->"
BLOCK_END = "<!-- briefing-review:resolved:end -->"


def resolved_block(vault, date):
    ledger = load_ledger(vault, date)["entries"]
    if not ledger:
        return None
    answers = {}
    if answers_path(vault, date).is_file():
        answers = {a["id"]: a for a in load_answers(vault, date).get("answers", [])}
    rows = []
    for aid, entry in ledger.items():
        ans = answers.get(aid, {"id": aid})
        shown = param_display(ans.get("action"), ans.get("params"))
        act = (ans.get("action") or "note").upper() + (f"({shown})" if shown else "")
        text = truncate_export(ans.get("text") or aid, 100)
        summary = f": {entry['summary']}" if entry.get("summary") else ""
        rows.append((ans.get("n") or 10**6, aid,
                     f"- [{ans.get('n', '?')}] {act} \u2014 {text} \u2014 {entry.get('result')}{summary}"))
    rows.sort()
    stamp = max((e.get("at") or "" for e in ledger.values()), default="")
    counts = {}
    for e in ledger.values():
        counts[e.get("result")] = counts.get(e.get("result"), 0) + 1
    tally = ", ".join(f"{counts[r]} {r}" for r in RESULTS if counts.get(r))
    head = f"**Review resolved** \u2014 {tally} (as of {stamp})"
    return "\n".join([BLOCK_START, head, ""] + [r[2] for r in rows] + [BLOCK_END])


def annotate_text(md, block):
    """Insert or replace the managed block (pure function, idempotent)."""
    start, end = md.find(BLOCK_START), md.find(BLOCK_END)
    if start != -1 and end > start:
        return md[:start] + block + md[end + len(BLOCK_END):]
    lines = md.split("\n")
    sec0 = next((i for i, l in enumerate(lines) if re.match(r"^##\s+0\.", l)), None)
    if sec0 is not None:
        stop = next((i for i in range(sec0 + 1, len(lines)) if lines[i].startswith("## ")), len(lines))
        insert = stop
        while insert > sec0 + 1 and not lines[insert - 1].strip():
            insert -= 1
        new = lines[:insert] + ["", block, ""] + lines[stop:] if stop < len(lines) \
            else lines[:insert] + ["", block, ""]
        return "\n".join(new)
    return md.rstrip("\n") + "\n\n## Review resolved\n\n" + block + "\n"


def annotate(vault, date):
    path = briefing_md_path(vault, date)
    if not path.is_file():
        raise ReviewError(f"briefing not found: {path}")
    block = resolved_block(vault, date)
    if block is None:
        return path, False
    md = path.read_text(encoding="utf-8")
    new = annotate_text(md, block)
    if new != md:
        atomic_write(path, new)
    return path, new != md


# --------------------------------------------------------------------------- carryover

def carryover(vault, date):
    items_doc = load_items(vault, date)
    answers = []
    path = answers_path(vault, date)
    if path.is_file():
        doc = load_answers(vault, date)
        if doc.get("submitted"):
            answers = doc.get("answers", [])
    by_id = {a["id"]: a for a in answers}
    next_day = (dt.date.fromisoformat(date) + dt.timedelta(days=1)).isoformat()
    carry = []
    for item in items_doc["items"]:
        ans = by_id.get(item["id"])
        reason = None
        if ans is None:
            reason = "unanswered"
        elif ans.get("action") is None:
            reason = "note_only"
        elif ans["action"] == "keep":
            reason = "keep"
        elif ans["action"] in ("defer", "push", "bump"):
            when = (ans.get("params") or {}).get("date")
            if not when or when <= next_day:
                reason = "defer_due"
        if not reason:
            continue
        out = {k: v for k, v in item.items() if k not in ("previous", "carried_from")}
        out["carried_from"] = date
        out["previous"] = ({"date": date, "action": ans.get("action"), "params": ans.get("params") or {},
                            "note": ans.get("note") or ""} if ans else None)
        out["reason"] = reason
        carry.append(out)
    return {"schema": CARRYOVER_SCHEMA, "date": date, "next_date": next_day,
            "submitted": bool(answers), "carry": carry,
            "answers": [{"id": a["id"], "n": a.get("n"), "action": a.get("action"),
                         "params": a.get("params") or {}, "note": a.get("note") or ""} for a in answers]}


def format_carryover(doc):
    lines = [f"Carry-over from {doc['date']} into {doc['next_date']}: {len(doc['carry'])} items"]
    for item in doc["carry"]:
        lines.append(f"- [{item['reason']}] {item['id']} \u2014 {truncate_export(plain_text(item['text']), 100)}")
    return "\n".join(lines) + "\n"


# --------------------------------------------------------------------------- build

def app_assets():
    try:
        js = (SCRIPT_DIR / APP_JS).read_text(encoding="utf-8")
        css = (SCRIPT_DIR / APP_CSS).read_text(encoding="utf-8")
    except FileNotFoundError as exc:
        raise ReviewError(f"client app file missing next to the script: {exc.filename}")
    if "</script" in js.lower() or "</style" in css.lower():
        raise ReviewError("client app files must not contain closing script/style tags")
    return js, css


def script_json(obj):
    """JSON safe to embed inside <script>: no '<', '>', '&', U+2028/9 survive raw."""
    text = json.dumps(obj, ensure_ascii=True, separators=(",", ":"))
    return (text.replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
            .replace("\u2028", "\\u2028").replace("\u2029", "\\u2029"))


def compact_source(text, kind):
    """Cheap size reduction for the widget: drop indentation, blank lines and
    whole-line comments. Safe because the app sources avoid multi-line strings."""
    out = []
    in_comment = False
    for line in text.splitlines():
        s = line.strip()
        if kind == "css":
            if in_comment:
                in_comment = "*/" not in s
                continue
            if s.startswith("/*"):
                in_comment = "*/" not in s
                continue
        elif s.startswith("//"):
            continue
        if s:
            out.append(s)
    return "\n".join(out)


def widget_css(css):
    """Scope the page CSS to #review-root: tokens move off :root, page-only rules go."""
    css = re.sub(r"/\* page-only \*/.*?/\* end page-only \*/", "", css, flags=re.S)
    return css.replace(":root", "#review-root")


def redact_items(items, level):
    """Artifact sensitivity gate. Returns (kept items, withheld count)."""
    kept, withheld = [], 0
    for item in items:
        sens = item.get("sensitivity", "private")
        if sens == "sensitive" or (sens not in SENSITIVITIES and level != "none"):
            withheld += 1
            continue
        if level == "private" and sens == "private":
            title = leading_title(item["text"])
            item = {k: item[k] for k in ("id", "n", "section", "section_title", "label", "group",
                                         "kind", "actions", "also_in", "carried_from") if k in item}
            item["text"] = f"[[{title}]]" if title else "(private item)"
            item["detail"] = []
            item["private"] = True
        kept.append(item)
    return kept, withheld


def collect_links(items, index, site):
    """wikilink target text -> vault path (no .md), for the client's link renderer."""
    if not site:
        return {}
    links = {}
    for item in items:
        if item.get("target"):
            stem = item["target"][:-3] if item["target"].endswith(".md") else item["target"]
            links[stem.rsplit("/", 1)[-1]] = stem
        for chunk in [item.get("text", "")] + list(item.get("detail") or []):
            for m in WIKILINK_RE.finditer(chunk):
                name = wikilink_target(m.group(1))
                if name and name not in links:
                    rel = index.resolve(name)
                    links[name] = rel[:-3] if rel else name
    return links


def previous_state(vault, date):
    """Stored answers for this date as a client state map (for pre-fill), or None."""
    path = answers_path(vault, date)
    if not path.is_file():
        return None
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    state = {a["id"]: {"action": a.get("action"), "params": a.get("params") or {}, "note": a.get("note") or ""}
             for a in doc.get("answers", []) if isinstance(a, dict) and a.get("id")}
    return {"state": state, "submitted": bool(doc.get("submitted")),
            "saved_at": doc.get("saved_at") or doc.get("submitted_at")}


def build_payload(vault, date, items_doc, surface, site, redact, index):
    items = []
    for n, item in enumerate(items_doc["items"], 1):
        p = {k: item[k] for k in PAYLOAD_FIELDS if k in item}
        p["n"] = n
        p["sensitivity"] = item.get("sensitivity", "private")
        items.append(p)
    withheld = 0
    if redact != "none":
        items, withheld = redact_items(items, redact)
    for p in items:
        p.pop("sensitivity", None)
    if surface == "artifact":
        site = ""
    return {
        "date": date,
        "items": items,
        "actions": {a: {"label": l, "param": p, "group": g} for a, (l, p, g) in ACTIONS.items()},
        "kinds": KIND_ACTIONS,
        "surface": surface,
        "site": site,
        "links": collect_links(items, index, site),
        "previous": None if surface == "artifact" else previous_state(vault, date),
        "withheld": withheld,
        "total": len(items_doc["items"]),
        "page": 1,
        "pages": 1,
    }


def render_surface(payload, surface, js, css):
    data = script_json(payload)
    if surface == "widget":
        return (f"<style>{compact_source(widget_css(css), 'css')}</style>\n"
                f"<div id=\"review-root\" data-surface=\"widget\"></div>\n"
                f"<script>window.__REVIEW__={data};\n{compact_source(js, 'js')}</script>\n")
    body = (f"<div id=\"review-root\" data-surface=\"{surface}\"></div>\n"
            f"<script>window.__REVIEW__={data};</script>\n<script>{js}</script>\n")
    if surface == "artifact":
        # The Artifact publisher wraps the file in its own doctype/head/body
        # skeleton, so this surface is page content only: title and style first.
        return f"<title>Briefing Review</title>\n<style>{css}</style>\n{body}"
    title = f"Briefing review &#8212; {payload['date']}"
    return ("<!doctype html>\n<html lang=\"en\">\n<head>\n"
            f"<title>{title}</title>\n<style>{css}</style>\n"
            "<meta charset=\"utf-8\">\n"
            "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n"
            "</head>\n<body>\n"
            f"{body}"
            "</body>\n</html>\n")


def section_runs(items):
    runs = []
    for item in items:
        if runs and runs[-1][-1]["section"] == item["section"]:
            runs[-1].append(item)
        else:
            runs.append([item])
    return runs


def paginate_widget(payload, js, css, max_bytes):
    """Split by section (consecutive runs, so every page covers a contiguous n range)."""
    def render(items, page=1, pages=1):
        used = " ".join(i.get("text", "") + " " + " ".join(i.get("detail", [])) for i in items)
        links = {k: v for k, v in payload["links"].items() if k in used}
        return render_surface(dict(payload, items=items, links=links, page=page, pages=pages),
                              "widget", js, css)

    def fits(items):
        return len(render(items).encode("utf-8")) + 32 <= max_bytes  # slack for page numbers

    whole = render(payload["items"])
    if len(whole.encode("utf-8")) <= max_bytes:
        return [whole]
    if not fits(payload["items"][:1]):
        raise ReviewError(f"--max-bytes {max_bytes} is too small for even one row")
    pages, cur = [], []
    for run in section_runs(payload["items"]):
        if fits(cur + run):
            cur += run
            continue
        if cur:
            pages.append(cur)
            cur = []
        for item in run:  # a section too big for one page is split by rows
            if fits(cur + [item]):
                cur.append(item)
            else:
                pages.append(cur)
                cur = [item]
    if cur:
        pages.append(cur)
    return [render(items, i, len(pages)) for i, items in enumerate(pages, 1)]


def default_out(vault, date, surface):
    name = f"{date}.html" if surface == "page" else f"{date}.{surface}.html"
    return outputs_dir(vault) / name


def paged_path(path, i):
    path = pathlib.Path(path)
    stem = path.name[:-5] if path.name.endswith(".html") else path.name
    return path.with_name(f"{stem}.{i}.html")


def build(vault, date, surface="page", site=None, max_bytes=DEFAULT_MAX_BYTES, redact=None):
    """Return a list of rendered documents (one, or several widget pages)."""
    if surface not in SURFACES:
        raise ReviewError(f"unknown surface {surface!r}", code=2)
    redact = redact or ("private" if surface == "artifact" else "none")
    if surface == "artifact" and redact == "none":
        raise ReviewError("--redact none is refused for the artifact surface", code=2)
    site = (site or "").rstrip("/")
    if site and not re.match(r"^https?://", site):
        raise ReviewError(f"--site must be an http(s) URL (got {site!r})", code=2)
    index = NoteIndex(vault)
    items_doc = load_items(vault, date, index)
    payload = build_payload(vault, date, items_doc, surface, site, redact, index)
    js, css = app_assets()
    if surface == "widget":
        return paginate_widget(payload, js, css, max_bytes)
    return [render_surface(payload, surface, js, css)]


# --------------------------------------------------------------------------- serve

LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}
ORIGIN_HOSTS = {"localhost", "127.0.0.1"}
ROUTE_PAGE = re.compile(r"^/review/([^/]+)/?$")
ROUTE_API = re.compile(r"^/api/review/([^/]+)/?$")


class ReviewHandler(BaseHTTPRequestHandler):
    server_version = "MemexReview/1"
    vault = None
    site = ""

    def log_message(self, fmt, *args):  # quiet unless asked
        if os.environ.get("MEMEX_REVIEW_LOG"):
            sys.stderr.write("serve: " + (fmt % args) + "\n")

    def _send(self, status, body, ctype="application/json; charset=utf-8", headers=None):
        data = body.encode("utf-8") if isinstance(body, str) else body
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def _json(self, status, obj):
        self._send(status, json.dumps(obj))

    def _host_ok(self):
        # DNS-rebinding guard: only answer requests addressed to a loopback name.
        host = (self.headers.get("Host") or "").strip()
        name = urllib.parse.urlsplit("//" + host).hostname or ""
        return name in LOOPBACK_HOSTS

    def do_GET(self):
        if not self._host_ok():
            return self._json(403, {"ok": False, "error": "forbidden host"})
        path = urllib.parse.urlsplit(self.path).path
        if path in ("/review", "/review/"):
            try:
                return self._send(302, "", headers={"Location": f"/review/{latest_date(self.vault)}"})
            except ReviewError as exc:
                return self._send(404, str(exc), "text/plain; charset=utf-8")
        m = ROUTE_PAGE.match(path)
        if m:
            date = m.group(1)
            if not DATE_RE.match(date):
                return self._send(400, "bad date", "text/plain; charset=utf-8")
            try:
                html = build(self.vault, date, "server", site=self.site)[0]
            except ReviewError as exc:
                return self._send(404 if exc.code == 1 else 400, str(exc), "text/plain; charset=utf-8")
            return self._send(200, html, "text/html; charset=utf-8")
        m = ROUTE_API.match(path)
        if m:
            date = m.group(1)
            if not DATE_RE.match(date):
                return self._json(400, {"ok": False, "error": "bad date"})
            path_ = answers_path(self.vault, date)
            if not path_.is_file():
                return self._json(404, {"ok": False, "error": "no answers"})
            return self._send(200, path_.read_bytes())
        return self._send(404, "not found", "text/plain; charset=utf-8")

    do_HEAD = do_GET

    def do_POST(self):
        if not self._host_ok():
            return self._json(403, {"ok": False, "error": "forbidden host"})
        parts = urllib.parse.urlsplit(self.path)
        m = ROUTE_API.match(parts.path)
        if not m:
            return self._json(404, {"ok": False, "error": "not found"})
        date = m.group(1)
        if not DATE_RE.match(date):
            return self._json(400, {"ok": False, "error": "bad date"})
        ctype = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        if ctype != "application/json":
            return self._json(400, {"ok": False, "error": "Content-Type must be application/json"})
        origin = self.headers.get("Origin")
        if origin is not None and (urllib.parse.urlsplit(origin).hostname or "") not in ORIGIN_HOSTS:
            return self._json(400, {"ok": False, "error": "cross-origin request refused"})
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = -1
        if length < 0 or length > MAX_POST_BYTES:
            return self._json(413 if length > 0 else 400, {"ok": False, "error": "body too large or missing length"})
        try:
            body = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            return self._json(400, {"ok": False, "error": f"bad JSON: {exc}"})
        draft = urllib.parse.parse_qs(parts.query).get("draft", ["0"])[0] in ("1", "true")
        try:
            with self.server.save_lock:
                path, kept = save_answers(self.vault, date, body, "server", draft=draft)
        except ReviewError as exc:
            return self._json(400, {"ok": False, "error": str(exc)})
        out = {"ok": True, "path": str(path)}
        if kept:
            out["kept_submitted"] = True
        return self._json(200, out)


def make_server(vault, host="127.0.0.1", port=0, site=""):
    if host not in LOOPBACK_HOSTS:
        raise ReviewError(f"refusing to bind non-loopback host {host!r}", code=2)
    handler = type("BoundReviewHandler", (ReviewHandler,), {"vault": vault, "site": site})
    server = ThreadingHTTPServer((host, port), handler)
    server.save_lock = threading.Lock()
    server.daemon_threads = True
    return server


# --------------------------------------------------------------------------- CLI

def _site(args):
    if getattr(args, "site", None):
        return args.site
    return os.environ.get("MEMEX_SITE") or DEFAULT_SITE


def cmd_items(vault, args):
    date = pick_date(vault, args.date)
    doc = load_items(vault, date)
    if args.write:
        path = items_path(vault, date)
        if path.exists():
            raise ReviewError(f"{path} already exists; not overwriting")
        atomic_write(path, dump_json(doc))
        print(path)
        return 0
    sys.stdout.write(dump_json(doc))
    return 0


def cmd_validate(vault, args):
    target = args.target
    if target and not DATE_RE.match(target):
        path, date = pathlib.Path(target), None
    else:
        date = pick_date(vault, target)
        path = items_path(vault, date)
    doc = read_json(path, "items file")
    problems = validate_items(doc, date)
    if problems:
        print(f"INVALID: {path}")
        for p in problems:
            print(f"  - {p}")
        return 1
    print(f"OK: {path} ({len(doc['items'])} items)")
    return 0


def cmd_build(vault, args):
    date = pick_date(vault, args.date)
    docs = build(vault, date, args.surface, _site(args), args.max_bytes, args.redact)
    if args.stdout:
        sep = "\n<!-- briefing-review: next widget page -->\n"
        sys.stdout.write(sep.join(docs))
        return 0
    base = pathlib.Path(args.out) if args.out else default_out(vault, date, args.surface)
    paths = [base] if len(docs) == 1 else [paged_path(base, i) for i in range(1, len(docs) + 1)]
    for path, doc in zip(paths, docs):
        atomic_write(path, doc)
        print(path)
    return 0


def cmd_serve(vault, args):
    server = make_server(vault, args.host, args.port, _site(args))
    host, port = server.server_address[:2]
    print(f"Briefing review on http://{'localhost' if host == '127.0.0.1' else host}:{port}/review "
          f"(vault {vault}); Ctrl+C to stop", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


def cmd_save(vault, args):
    text = sys.stdin.read()
    if not text.strip():
        raise ReviewError("nothing on stdin")
    part = None
    if args.from_export:
        export_date, rows, part = parse_export(text)
        date = check_date_arg(args.date) if args.date else export_date
        if args.date and export_date != args.date:
            raise ReviewError(f"export is for {export_date}, not {args.date}")
        items_doc = load_items(vault, date)
        doc = export_to_answers(rows, items_doc)
        surface = args.surface or "export"
    else:
        date = pick_date(vault, args.date)
        items_doc = load_items(vault, date)
        try:
            doc = json.loads(text)
        except json.JSONDecodeError as exc:
            raise ReviewError(f"stdin is not valid JSON: {exc}")
        surface = args.surface or (doc.get("surface") if isinstance(doc, dict) else None) or "cli"
    if surface not in SAVE_SURFACES:
        raise ReviewError(f"unknown surface {surface!r}", code=2)
    path, kept = save_answers(vault, date, doc, surface, draft=args.draft, part=part, items_doc=items_doc)
    if kept:
        print(f"kept submitted answers; draft not saved: {path}", file=sys.stderr)
    print(path)
    return 0


def cmd_plan(vault, args):
    date = pick_date(vault, args.date)
    plan = build_plan(vault, date, include_draft=args.include_draft)
    sys.stdout.write(dump_json(plan) if args.json else format_plan(plan))
    return 0


def cmd_mark(vault, args):
    if len(args.args) == 1:
        date, answer_id = latest_date(vault), args.args[0]
    elif len(args.args) == 2:
        date, answer_id = check_date_arg(args.args[0]), args.args[1]
    else:
        raise ReviewError("usage: mark [date] <id> --result ...", code=2)
    print(mark_answer(vault, date, answer_id, args.result, args.summary))
    return 0


def cmd_annotate(vault, args):
    date = pick_date(vault, args.date)
    path, changed = annotate(vault, date)
    print(path if changed else f"{path} (unchanged)")
    return 0


def cmd_carryover(vault, args):
    date = pick_date(vault, args.date)
    doc = carryover(vault, date)
    sys.stdout.write(dump_json(doc) if args.json else format_carryover(doc))
    return 0


def build_parser():
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--vault", default=argparse.SUPPRESS, help="vault root (default: parent of scripts/)")
    ap = argparse.ArgumentParser(prog="briefing_review.py", description="Briefing review CLI.")
    ap.add_argument("--vault", default=None, help="vault root (default: parent of scripts/ or $MEMEX_VAULT)")
    sub = ap.add_subparsers(dest="command", required=True)

    p = sub.add_parser("items", parents=[common], help="print normalized items JSON")
    p.add_argument("date", nargs="?")
    p.add_argument("--write", action="store_true")
    p.set_defaults(func=cmd_items)

    p = sub.add_parser("validate", parents=[common], help="validate an items.json")
    p.add_argument("target", nargs="?", help="date or path")
    p.set_defaults(func=cmd_validate)

    p = sub.add_parser("build", parents=[common], help="generate the review UI")
    p.add_argument("date", nargs="?")
    p.add_argument("--surface", default="page", choices=SURFACES)
    p.add_argument("--out")
    p.add_argument("--stdout", action="store_true")
    p.add_argument("--site")
    p.add_argument("--max-bytes", type=int, default=DEFAULT_MAX_BYTES)
    p.add_argument("--redact", choices=("private", "sensitive", "none"))
    p.set_defaults(func=cmd_build)

    p = sub.add_parser("serve", parents=[common], help="loopback HTTP server")
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--site")
    p.set_defaults(func=cmd_serve)

    p = sub.add_parser("save", parents=[common], help="save answers from stdin")
    p.add_argument("date", nargs="?")
    p.add_argument("--from-export", action="store_true")
    p.add_argument("--surface")
    p.add_argument("--draft", action="store_true")
    p.set_defaults(func=cmd_save)

    p = sub.add_parser("plan", parents=[common], help="print the apply plan")
    p.add_argument("date", nargs="?")
    p.add_argument("--json", action="store_true")
    p.add_argument("--include-draft", action="store_true")
    p.set_defaults(func=cmd_plan)

    p = sub.add_parser("mark", parents=[common], help="record one answer in the ledger")
    p.add_argument("args", nargs="+", metavar="[date] id")
    p.add_argument("--result", required=True, choices=RESULTS)
    p.add_argument("--summary", default="")
    p.set_defaults(func=cmd_mark)

    p = sub.add_parser("annotate", parents=[common], help="write the Review resolved block")
    p.add_argument("date", nargs="?")
    p.set_defaults(func=cmd_annotate)

    p = sub.add_parser("carryover", parents=[common], help="items the next briefing must carry")
    p.add_argument("date", nargs="?")
    p.add_argument("--json", action="store_true")
    p.set_defaults(func=cmd_carryover)
    return ap


def main(argv=None):
    args = build_parser().parse_args(argv)
    vault = pathlib.Path(args.vault).expanduser().resolve() if args.vault else default_vault()
    try:
        if not vault.is_dir():
            raise ReviewError(f"vault not found: {vault}")
        return args.func(vault, args)
    except ReviewError as exc:
        print(f"briefing_review: {exc}", file=sys.stderr)
        return exc.code


if __name__ == "__main__":
    sys.exit(main())
