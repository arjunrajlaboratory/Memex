"""Tests for hardened/scripts/briefing_review.py (the briefing review CLI).

Run: cd tools && python3 -m unittest test_briefing_review -v
"""
import copy
import json
import os
import pathlib
import re
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

REPO = pathlib.Path(__file__).resolve().parent.parent
SCRIPT = REPO / "hardened" / "scripts" / "briefing_review.py"
sys.path.insert(0, str(SCRIPT.parent))
import briefing_review as br  # noqa: E402

DATE = "2026-11-12"  # a Thursday
SITE = "http://localhost:4321"

BRIEFING_MD = """---
type: briefing
scope: daily
date: 2026-11-12
sensitivity: private
---
# Daily briefing — 2026-11-12

## 0. State confirmation needed

The vault thinks the following are still in progress. Were any of them already done?

1. [[Send revised budget to Dana]] — `status: in_progress` (due 2026-11-10).
   ↳ signal: you emailed Dana the draft 2026-11-09
2. [[Grant report draft]] — `status: active`, review overdue.
   - [[Figure panel C]] — block passed
   - [[Figure panel D]] — block passed

Reply with the numbers that are done (e.g. "yes to 1,3").

## 1. Top 3 outcomes for today
1. [[Send revised budget to Dana]]

## 2. Calendar / time map
- 09:00 standup

## 3. Tasks due or scheduled today
- [[Send revised budget to Dana]] — effort M, **priority high**
- [[Review lab notebook]] — effort S
- Lab logistics:
  - [[Order reagents]] — due 2026-11-12
  - [[Book microscope]] — *tentative*

## 4. Waiting on others
- (none)

## 6. New captures needing triage
- [[2026-11-11 voice memo]] — unprocessed
  - mentions the retreat

## 9. People
### Follow up today
- [[Robin Park]] — next_touch 2026-11-10
### I owe
- [[Robin Park]] — owe a reply on the poster
### Upcoming meetings
- [[Alex Chen]] 1:1 at 14:00
### Relationship maintenance
- Check in with the facilities team about the cold room

## 11. Decisions needed
- [[Choose sequencing vendor]] — two quotes in

## ⚑ Principal asks
- [[Draft reviewer response]] — asked for Friday

## 12. Starter prompts
- [[Send revised budget to Dana]] starter prompt

## 13. End-of-day review prompts
- Did the budget go out?
"""

NOTES = {
    "Ops/Tasks/Send revised budget to Dana.md": "normal",
    "Ops/Tasks/Review lab notebook.md": None,
    "Ops/Tasks/Order reagents.md": "sensitive",
    "Ops/Tasks/Book microscope.md": "normal",
    "Ops/Tasks/Draft reviewer response.md": "normal",
    "Atlas/Projects/Grant report draft.md": "private",
    "Atlas/People/Robin Park.md": "private",
    "Atlas/People/Alex Chen.md": "private",
    "Atlas/Decisions/Choose sequencing vendor.md": "normal",
    "Inbox/2026-11-11 voice memo.md": "normal",
}


def make_vault(td):
    vault = pathlib.Path(td)
    for rel, sens in NOTES.items():
        p = vault / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        fm = f"---\ntype: note\nsensitivity: {sens}\n---\n" if sens else "---\ntype: note\n---\n"
        p.write_text(fm + "# body\n", encoding="utf-8")
    (vault / "Ops" / "Briefings").mkdir(parents=True, exist_ok=True)
    (vault / "Ops" / "Briefings" / f"{DATE}.md").write_text(BRIEFING_MD, encoding="utf-8")
    return vault


def items_doc(items):
    return {"schema": br.ITEMS_SCHEMA, "date": DATE, "generated_at": "2026-11-12T07:30:00-05:00", "items": items}


def item(id_, kind="task", section="3", text=None, **extra):
    out = {"id": id_, "section": section, "kind": kind, "text": text or f"[[{id_.split('/')[-1]}]] — something"}
    out.update(extra)
    return out


GOOD_ITEMS = [
    item("task:Ops/Tasks/Alpha", section="0", label="#1", target="Ops/Tasks/Alpha.md", sensitivity="normal",
         detail=["signal: sent 2026-11-10"]),
    item("task:Ops/Tasks/Beta", target="Ops/Tasks/Beta.md", sensitivity="normal"),
    item("task:Ops/Tasks/Gamma", target="Ops/Tasks/Gamma.md", sensitivity="private"),
    item("person:Atlas/People/Robin Park", kind="person", section="9", section_title="People — I owe",
         target="Atlas/People/Robin Park.md", sensitivity="private"),
    item("project:Atlas/Projects/Atlas Rebuild", kind="project", section="5", target="Atlas/Projects/Atlas Rebuild.md"),
    item("capture:Inbox/memo", kind="capture", section="6", target="Inbox/memo.md", sensitivity="normal"),
    item("tracker:Atlas/Trackers/Funding calls", kind="tracker", section="8", sensitivity="normal"),
    item("followup:Ops/Followups/ask about samples - 2026-11-01", kind="followup", section="10", sensitivity="normal"),
    item("decision:Atlas/Decisions/Vendor", kind="decision", section="11", sensitivity="normal"),
    item("job:Agents/Jobs/20261110-001 - lit scan", kind="job", section="7", sensitivity="normal"),
    item("proposal:2026-11-12:7:abcdef12", kind="proposal", section="7", text="Write up the grant timeline — 3 deadlines", sensitivity="normal"),
    item("item:2026-11-12:asks:12345678", kind="item", section="asks", text="Secret plan detail", sensitivity="sensitive"),
]


class VaultCase(unittest.TestCase):
    def setUp(self):
        self._td = tempfile.TemporaryDirectory()
        self.vault = make_vault(self._td.name)

    def tearDown(self):
        self._td.cleanup()

    def run_cli(self, *args, stdin=None):
        env = dict(os.environ)
        env.pop("MEMEX_VAULT", None)
        env.pop("MEMEX_SITE", None)
        return subprocess.run([sys.executable, str(SCRIPT), "--vault", str(self.vault)] + list(args),
                              input=stdin, capture_output=True, text=True, env=env, timeout=60)

    def write_items(self, items=None):
        doc = items_doc(copy.deepcopy(items if items is not None else GOOD_ITEMS))
        br.items_path(self.vault, DATE).write_text(json.dumps(doc), encoding="utf-8")
        return doc

    def save(self, answers, *flags):
        doc = {"schema": br.ANSWERS_SCHEMA, "date": DATE, "answers": answers}
        res = self.run_cli("save", DATE, *flags, stdin=json.dumps(doc))
        self.assertEqual(res.returncode, 0, res.stderr)
        return json.loads(br.answers_path(self.vault, DATE).read_text())


class TestDates(unittest.TestCase):
    BASE = br.dt.date(2026, 11, 12)

    def test_shortcuts(self):
        cases = {
            "today": "2026-11-12", "tom": "2026-11-13", "tomorrow": "2026-11-13",
            "mon": "2026-11-16", "Monday": "2026-11-16", "thu": "2026-11-19", "fri": "2026-11-13",
            "+3d": "2026-11-15", "+2w": "2026-11-26", "eow": "2026-11-13", "eom": "2026-11-30",
            "11/20": "2026-11-20", "1/5": "2027-01-05", "nov 20": "2026-11-20", "20 Nov": "2026-11-20",
            "2026-12-01": "2026-12-01",
        }
        for raw, want in cases.items():
            with self.subTest(raw=raw):
                self.assertEqual(br.resolve_date(raw, self.BASE), want)

    def test_unparseable(self):
        for raw in ("", "someday", "2026-02-30", "13/40", "next tuesday-ish"):
            with self.subTest(raw=raw):
                self.assertIsNone(br.resolve_date(raw, self.BASE))


class TestValidate(VaultCase):
    def test_good(self):
        self.assertEqual(br.validate_items(items_doc(copy.deepcopy(GOOD_ITEMS)), DATE), [])
        self.write_items()
        res = self.run_cli("validate", DATE)
        self.assertEqual(res.returncode, 0, res.stdout + res.stderr)
        self.assertIn("OK", res.stdout)

    def test_each_failure(self):
        def bad(mutate):
            doc = items_doc(copy.deepcopy(GOOD_ITEMS))
            mutate(doc)
            return br.validate_items(doc, DATE)

        cases = {
            "schema": lambda d: d.update(schema="nope"),
            "date must be": lambda d: d.update(date="12 Nov"),
            "does not match": lambda d: d.update(date="2026-11-13"),
            "items must be a list": lambda d: d.update(items={}),
            "missing required string 'id'": lambda d: d["items"][0].pop("id"),
            "missing required string 'text'": lambda d: d["items"][0].update(text=""),
            "duplicate id": lambda d: d["items"][1].update(id=d["items"][0]["id"]),
            "section must be": lambda d: d["items"][0].update(section="12"),
            "unknown kind": lambda d: d["items"][0].update(kind="widget"),
            "unknown actions": lambda d: d["items"][0].update(actions=["do", "explode"]),
            "must start with": lambda d: d["items"][0].update(actions=["done", "do"]),
            "not valid for kind 'capture'": lambda d: d["items"][5].update(actions=["do", "cancel"]),
            "detail must be": lambda d: d["items"][0].update(detail="x"),
            "sensitivity must be": lambda d: d["items"][0].update(sensitivity="secret"),
            "n is display-only": lambda d: d["items"][0].update(n=1),
        }
        for needle, mutate in cases.items():
            with self.subTest(needle=needle):
                problems = bad(mutate)
                self.assertTrue(any(needle in p for p in problems), problems)

    def test_cli_failure_exit_and_message(self):
        doc = items_doc([{"id": "x", "section": "3", "kind": "nope", "text": "t"}])
        path = pathlib.Path(self._td.name) / "bad.items.json"
        path.write_text(json.dumps(doc))
        res = self.run_cli("validate", str(path))
        self.assertEqual(res.returncode, 1)
        self.assertIn("unknown kind", res.stdout)

    def test_malformed_json_and_missing(self):
        br.items_path(self.vault, DATE).write_text("{not json")
        res = self.run_cli("items", DATE)
        self.assertEqual(res.returncode, 1)
        self.assertIn("not valid JSON", res.stderr)
        res = self.run_cli("items", "2026-01-01")
        self.assertEqual(res.returncode, 1)
        self.assertIn("briefing not found", res.stderr)
        res = self.run_cli("items", "yesterday")
        self.assertEqual(res.returncode, 2)

    def test_invalid_items_file_refused_by_build(self):
        self.write_items([{"id": "a", "section": "3", "kind": "task"}])
        res = self.run_cli("build", DATE, "--site", SITE)
        self.assertEqual(res.returncode, 1)
        self.assertIn("missing required string 'text'", res.stderr)


class TestMarkdownFallback(VaultCase):
    def items(self):
        res = self.run_cli("items", DATE)
        self.assertEqual(res.returncode, 0, res.stderr)
        return json.loads(res.stdout)["items"]

    def test_rows_labels_groups_detail(self):
        items = self.items()
        by_text = {re.sub(r"\]\].*", "", i["text"]).lstrip("[").strip(): i for i in items}
        sections = {i["section"] for i in items}
        self.assertFalse(sections & {"1", "2", "12", "13"}, sections)
        self.assertNotIn("Alex Chen", by_text)  # ### Upcoming meetings is skipped
        self.assertEqual(len(items), 12, [i["text"] for i in items])

        budget = by_text["Send revised budget to Dana"]
        self.assertEqual((budget["section"], budget["label"], budget["kind"]), ("0", "#1", "task"))
        self.assertEqual(budget["detail"], ["signal: you emailed Dana the draft 2026-11-09"])
        self.assertEqual(budget["signal"], "you emailed Dana the draft 2026-11-09")
        self.assertEqual(budget["status"], "in_progress")
        self.assertEqual(budget["due"], "2026-11-10")
        self.assertEqual(budget["also_in"], ["3"])  # deduped from section 3
        self.assertEqual(budget["id"], "task:Ops/Tasks/Send revised budget to Dana")

        self.assertEqual(by_text["Grant report draft"]["label"], "#2")
        self.assertEqual(by_text["Grant report draft"]["kind"], "project")
        self.assertEqual(by_text["Figure panel C"]["label"], "#2a")
        self.assertEqual(by_text["Figure panel D"]["label"], "#2b")
        self.assertEqual(by_text["Figure panel C"]["kind"], "item")
        self.assertRegex(by_text["Figure panel C"]["id"], r"^item:2026-11-12:0:[0-9a-f]{8}$")

        self.assertEqual(by_text["Order reagents"]["group"], "Lab logistics")
        self.assertEqual(by_text["Book microscope"]["group"], "Lab logistics")
        self.assertEqual(by_text["Review lab notebook"]["group"], "")
        self.assertNotIn("Lab logistics", by_text)

        memo = by_text["2026-11-11 voice memo"]
        self.assertEqual((memo["kind"], memo["detail"]), ("capture", ["mentions the retreat"]))
        robin = [i for i in items if i["id"] == "person:Atlas/People/Robin Park"]
        self.assertEqual(len(robin), 1)
        self.assertEqual(robin[0]["section_title"], "People — Follow up today")
        self.assertEqual(by_text["Choose sequencing vendor"]["kind"], "decision")
        asks = by_text["Draft reviewer response"]
        self.assertEqual((asks["section"], asks["section_title"]), ("asks", "Principal asks"))
        plain = [i for i in items if i["text"].startswith("Check in")][0]
        self.assertEqual(plain["kind"], "item")
        self.assertEqual(plain["section_title"], "People — Relationship maintenance")

    def test_actions_and_sensitivity(self):
        items = {i["id"]: i for i in self.items()}
        self.assertEqual(items["task:Ops/Tasks/Send revised budget to Dana"]["actions"], br.KIND_ACTIONS["task"])
        self.assertEqual(items["task:Ops/Tasks/Send revised budget to Dana"]["sensitivity"], "normal")
        self.assertEqual(items["task:Ops/Tasks/Review lab notebook"]["sensitivity"], "private")  # unknown -> private
        self.assertEqual(items["task:Ops/Tasks/Order reagents"]["sensitivity"], "sensitive")
        for it in items.values():
            self.assertEqual(it["actions"][0], "do")
        self.assertEqual(br.validate_items({"schema": br.ITEMS_SCHEMA, "date": DATE,
                                            "items": [{k: v for k, v in i.items()} for i in items.values()]}), [])

    def test_ids_stable(self):
        first = [i["id"] for i in self.items()]
        second = [i["id"] for i in self.items()]
        self.assertEqual(first, second)
        self.assertEqual(len(set(first)), len(first))

    def test_write_never_overwrites_and_is_preferred(self):
        res = self.run_cli("items", DATE, "--write")
        self.assertEqual(res.returncode, 0, res.stderr)
        self.assertTrue(br.items_path(self.vault, DATE).is_file())
        self.assertEqual(self.run_cli("validate", DATE).returncode, 0)
        res = self.run_cli("items", DATE, "--write")
        self.assertEqual(res.returncode, 1)
        self.write_items()
        ids = [i["id"] for i in self.items()]
        self.assertEqual(ids, [i["id"] for i in GOOD_ITEMS])

    def test_latest_date_default(self):
        (self.vault / "Ops" / "Briefings" / "2026-11-10.md").write_text("## 3. Tasks\n- old\n")
        self.assertEqual(br.latest_date(self.vault), DATE)
        res = self.run_cli("items")
        self.assertEqual(json.loads(res.stdout)["date"], DATE)


class TestAnswers(VaultCase):
    def setUp(self):
        super().setUp()
        self.write_items()

    def test_export_round_trip(self):
        answers = [
            {"id": "task:Ops/Tasks/Alpha", "action": "defer", "params": {"date": "mon"}, "note": "ping first\nthen send"},
            {"id": "task:Ops/Tasks/Beta", "action": "waiting", "params": {"who": "Robin"}, "note": ""},
            {"id": "person:Atlas/People/Robin Park", "action": None, "params": {}, "note": "just a note"},
            {"id": "proposal:2026-11-12:7:abcdef12", "action": "create_task", "params": {"title": "Grant timeline (draft)"}, "note": ""},
            {"id": "tracker:Atlas/Trackers/Funding calls", "action": "defer", "params": {"date": "whenever"}, "note": ""},
            {"id": "capture:Inbox/memo", "action": "do", "params": {}, "note": ""},
        ]
        doc = br.load_items(self.vault, DATE)
        normalized, unanswered = br.normalize_answers({"answers": answers}, doc, DATE)
        self.assertEqual(normalized[0]["params"], {"date": "2026-11-16"})
        self.assertEqual(normalized[-1]["params"] if normalized[-1]["kind"] == "tracker" else
                         [a for a in normalized if a["kind"] == "tracker"][0]["params"], {"date_raw": "whenever"})
        text = br.format_export(DATE, doc, normalized)
        self.assertTrue(text.startswith(f"Briefing review — {DATE} · items {br.items_hash(doc)} "
                                        "(apply with the apply-review skill)\n\n"), text[:120])
        self.assertIn("- [1] #1 DEFER(2026-11-16) — [[Alpha]] — something\n    → ping first / then send", text)
        self.assertIn("- [4] NOTE — ", text)
        self.assertIn("CREATE_TASK(Grant timeline (draft))", text)
        self.assertIn(f"({len(unanswered)} rows left unanswered — leave as is.)", text)

        res = self.run_cli("save", "--from-export", stdin=text)
        self.assertEqual(res.returncode, 0, res.stderr)
        saved = json.loads(br.answers_path(self.vault, DATE).read_text())
        self.assertEqual(saved["surface"], "export")
        self.assertTrue(saved["submitted"])
        got = {a["id"]: (a["action"], a["params"], a["note"]) for a in saved["answers"]}
        want = {a["id"]: (a["action"], a["params"], " / ".join(a["note"].splitlines())) for a in normalized}
        self.assertEqual(got, want)
        self.assertEqual(sorted(saved["unanswered"]), sorted(unanswered))

    def test_export_truncation_keeps_wikilink(self):
        long = "[[A very long title that keeps going]] — " + "word " * 60
        out = br.truncate_export(br.plain_text(long))
        self.assertTrue(out.startswith("[[A very long title that keeps going]]"))
        self.assertLessEqual(len(out), 141)
        self.assertTrue(out.endswith("…"))

    def test_export_bad_rows(self):
        bad = f"Briefing review — {DATE} (apply with the apply-review skill)\n\n- [99] DONE — x\n"
        res = self.run_cli("save", "--from-export", stdin=bad)
        self.assertEqual(res.returncode, 1)
        self.assertIn("out of range", res.stderr)
        res = self.run_cli("save", "--from-export", stdin="hello")
        self.assertEqual(res.returncode, 1)

    def test_export_part_merges(self):
        doc = br.load_items(self.vault, DATE)
        self.save([{"id": "decision:Atlas/Decisions/Vendor", "action": "decide", "params": {}, "note": "vendor A"},
                   {"id": "task:Ops/Tasks/Alpha", "action": "keep", "params": {}, "note": ""}])
        part = (1, 3, 1, 4)
        ans, _ = br.normalize_answers({"answers": [{"id": "task:Ops/Tasks/Beta", "action": "done"}]}, doc, DATE)
        text = br.format_export(DATE, doc, ans, part=part)
        self.assertIn("Part 1 of 3 — rows 1-4.", text)
        res = self.run_cli("save", "--from-export", stdin=text)
        self.assertEqual(res.returncode, 0, res.stderr)
        saved = {a["id"]: a["action"] for a in json.loads(br.answers_path(self.vault, DATE).read_text())["answers"]}
        # Alpha (row 1) was in the part and unanswered there -> dropped; Vendor (row 9) kept.
        self.assertEqual(saved, {"task:Ops/Tasks/Beta": "done", "decision:Atlas/Decisions/Vendor": "decide"})

    def test_save_validation(self):
        cases = [
            ({"answers": [{"id": "nope", "action": "done"}]}, "unknown id"),
            ({"answers": [{"id": "person:Atlas/People/Robin Park", "action": "done"}]}, "not allowed"),
            ({"answers": [{"id": "task:Ops/Tasks/Beta", "action": "done"}, {"id": "task:Ops/Tasks/Beta", "action": "keep"}]}, "duplicate"),
            ({"date": "2026-11-11", "answers": []}, "not '2026-11-12'"),
            ({"schema": "other", "answers": []}, "schema"),
            ({"nothing": True}, "answers"),
        ]
        for doc, needle in cases:
            with self.subTest(needle=needle):
                res = self.run_cli("save", DATE, stdin=json.dumps(doc))
                self.assertEqual(res.returncode, 1)
                self.assertIn(needle, res.stderr)
        res = self.run_cli("save", DATE, stdin="{oops")
        self.assertEqual(res.returncode, 1)
        self.assertIn("not valid JSON", res.stderr)
        self.assertFalse(br.answers_path(self.vault, DATE).exists())

    def test_note_only_and_empty_rows(self):
        saved = self.save([{"id": "task:Ops/Tasks/Beta", "action": None, "note": "  hi  "},
                           {"id": "task:Ops/Tasks/Gamma", "action": None, "note": ""}])
        self.assertEqual([(a["id"], a["action"], a["note"]) for a in saved["answers"]],
                         [("task:Ops/Tasks/Beta", None, "hi")])
        self.assertIn("task:Ops/Tasks/Gamma", saved["unanswered"])
        self.assertEqual(saved["answers"][0]["n"], 2)
        self.assertEqual(saved["answers"][0]["target"], "Ops/Tasks/Beta.md")

    def test_draft_never_overwrites_submitted(self):
        draft = self.save([{"id": "task:Ops/Tasks/Beta", "action": "keep"}], "--draft")
        self.assertFalse(draft["submitted"])
        self.assertIsNone(draft["submitted_at"])
        sub = self.save([{"id": "task:Ops/Tasks/Beta", "action": "done"}])
        self.assertTrue(sub["submitted"])
        res = self.run_cli("save", DATE, "--draft", stdin=json.dumps({"answers": [{"id": "task:Ops/Tasks/Beta", "action": "cancel"}]}))
        self.assertEqual(res.returncode, 0)
        self.assertIn("kept submitted", res.stderr)
        again = json.loads(br.answers_path(self.vault, DATE).read_text())
        self.assertEqual(again["answers"][0]["action"], "done")
        self.assertTrue(again["submitted"])


class TestPlan(VaultCase):
    TABLE = [
        ("task", "done", "close-task"), ("task", "cancel", "close-task"),
        ("task", "defer", "frontmatter"), ("task", "waiting", "frontmatter"), ("task", "rescope", "frontmatter"),
        ("person", "touched", "frontmatter"), ("person", "push", "frontmatter"),
        ("project", "bump", "frontmatter"), ("project", "pause", "frontmatter"), ("project", "drop", "frontmatter"),
        ("followup", "done", "frontmatter"), ("followup", "defer", "frontmatter"), ("followup", "drop", "frontmatter"),
        ("tracker", "defer", "frontmatter"),
        ("proposal", "create_task", "create-task"), ("followup", "create_task", "create-task"),
        ("decision", "create_task", "create-task"), ("item", "create_task", "create-task"),
        ("person", "agenda", "agenda-section"),
        ("capture", "file", "triage-inbox"), ("capture", "ingest", "ingest-source"), ("capture", "dismiss", "dismiss"),
        ("tracker", "do", "run-trackers"), ("decision", "decide", "capture-decision"),
        ("task", "do", "agent"), ("person", "do", "agent"), ("capture", "do", "agent"), ("item", None, "agent"),
        ("task", "keep", "noop"), ("person", "keep", "noop"), ("proposal", "skip", "noop"), ("job", "skip", "noop"),
        ("job", "keep", "noop"),
    ]

    def test_routing_table(self):
        for kind, action, route in self.TABLE:
            with self.subTest(kind=kind, action=action):
                self.assertEqual(br.route_for(kind, action, self.vault), route)
        (self.vault / ".claude" / "skills" / "meeting-agenda").mkdir(parents=True)
        self.assertEqual(br.route_for("person", "agenda", self.vault), "meeting-agenda")

    def test_every_kind_action_routes(self):
        for kind, actions in br.KIND_ACTIONS.items():
            for action in actions + [None]:
                self.assertIsInstance(br.route_for(kind, action, self.vault), str)

    def test_ledger_idempotency(self):
        self.write_items()
        self.save([{"id": "task:Ops/Tasks/Alpha", "action": "done", "note": "also tell Dana"},
                   {"id": "task:Ops/Tasks/Beta", "action": "keep"},
                   {"id": "capture:Inbox/memo", "action": "file"}])
        plan = json.loads(self.run_cli("plan", DATE, "--json").stdout)
        self.assertEqual([e["route"] for e in plan["entries"]], ["close-task", "noop", "triage-inbox"])
        self.assertEqual(plan["entries"][0]["also"], ["agent"])
        self.assertEqual(plan["entries"][0]["sensitivity"], "normal")
        for e in plan["entries"]:
            res = self.run_cli("mark", DATE, e["id"], "--result", "applied", "--summary", "ok")
            self.assertEqual(res.returncode, 0, res.stderr)
        plan = json.loads(self.run_cli("plan", DATE, "--json").stdout)
        self.assertEqual(plan["entries"], [])
        self.assertEqual(plan["already_applied"], 3)
        ledger = json.loads(br.ledger_path(self.vault, DATE).read_text())
        self.assertEqual(ledger["schema"], br.LEDGER_SCHEMA)
        self.assertEqual(set(ledger["entries"]["task:Ops/Tasks/Beta"]),
                         {"fingerprint", "result", "summary", "at", "n", "action", "params", "note", "text"})
        # Changing one answer re-plans exactly that one.
        self.save([{"id": "task:Ops/Tasks/Alpha", "action": "done", "note": "also tell Dana"},
                   {"id": "task:Ops/Tasks/Beta", "action": "defer", "params": {"date": "fri"}},
                   {"id": "capture:Inbox/memo", "action": "file"}])
        plan = json.loads(self.run_cli("plan", DATE, "--json").stdout)
        self.assertEqual([(e["id"], e["route"], e["changed"]) for e in plan["entries"]],
                         [("task:Ops/Tasks/Beta", "frontmatter", True)])
        self.assertEqual(plan["entries"][0]["params"], {"date": "2026-11-13"})
        text = self.run_cli("plan", DATE).stdout
        self.assertIn("DEFER(2026-11-13) → frontmatter", text)

    def test_plan_draft_and_mark_errors(self):
        self.write_items()
        self.save([{"id": "task:Ops/Tasks/Beta", "action": "keep"}], "--draft")
        res = self.run_cli("plan", DATE)
        self.assertEqual(res.returncode, 1)
        self.assertIn("--include-draft", res.stderr)
        self.assertEqual(self.run_cli("plan", DATE, "--include-draft").returncode, 0)
        res = self.run_cli("mark", DATE, "task:nope", "--result", "applied")
        self.assertEqual(res.returncode, 1)
        res = self.run_cli("mark", DATE, "task:Ops/Tasks/Beta", "--result", "weird")
        self.assertEqual(res.returncode, 2)


class TestAnnotate(VaultCase):
    def test_idempotent_in_section_zero(self):
        self.save([{"id": "task:Ops/Tasks/Send revised budget to Dana", "action": "done"}])
        self.run_cli("mark", DATE, "task:Ops/Tasks/Send revised budget to Dana", "--result", "applied", "--summary", "closed")
        path = br.briefing_md_path(self.vault, DATE)
        self.assertEqual(self.run_cli("annotate", DATE).returncode, 0)
        once = path.read_text()
        self.assertEqual(self.run_cli("annotate", DATE).returncode, 0)
        self.assertEqual(path.read_text(), once)
        self.assertEqual(once.count(br.BLOCK_START), 1)
        sec0, sec1 = once.index("## 0."), once.index("## 1.")
        self.assertTrue(sec0 < once.index(br.BLOCK_START) < sec1)
        self.assertIn("DONE — [[Send revised budget to Dana]]", once)
        # The Markdown fallback ignores the managed block: same items before and after.
        before = br.parse_briefing_markdown(BRIEFING_MD, DATE)
        after = br.parse_briefing_markdown(once, DATE)
        self.assertEqual([(r["section"], r["label"], r["text"]) for r in after],
                         [(r["section"], r["label"], r["text"]) for r in before])
        self.assertIn("applied: closed", once)
        # Markdown parsing still works after annotation (block is not a row).
        self.assertEqual(len(json.loads(self.run_cli("items", DATE).stdout)["items"]), 12)

    def test_appends_section_without_zero(self):
        path = br.briefing_md_path(self.vault, DATE)
        path.write_text("## 3. Tasks due or scheduled today\n- [[Review lab notebook]]\n")
        self.save([{"id": "task:Ops/Tasks/Review lab notebook", "action": "keep"}])
        self.run_cli("mark", DATE, "task:Ops/Tasks/Review lab notebook", "--result", "skipped")
        self.run_cli("annotate", DATE)
        once = path.read_text()
        self.run_cli("annotate", DATE)
        self.assertEqual(path.read_text(), once)
        self.assertIn("## Review resolved\n\n" + br.BLOCK_START, once)

    def test_no_ledger_is_noop(self):
        before = br.briefing_md_path(self.vault, DATE).read_text()
        res = self.run_cli("annotate", DATE)
        self.assertEqual(res.returncode, 0)
        self.assertEqual(br.briefing_md_path(self.vault, DATE).read_text(), before)


class TestCarryover(VaultCase):
    def test_selection(self):
        self.write_items()
        self.save([
            {"id": "task:Ops/Tasks/Alpha", "action": "done"},
            {"id": "task:Ops/Tasks/Beta", "action": "keep", "note": "next week"},
            {"id": "task:Ops/Tasks/Gamma", "action": "defer", "params": {"date": "tom"}},
            {"id": "person:Atlas/People/Robin Park", "action": "push", "params": {"date": "+2w"}},
            {"id": "capture:Inbox/memo", "action": "dismiss"},
            {"id": "decision:Atlas/Decisions/Vendor", "action": None, "note": "ask the team"},
        ])
        res = self.run_cli("carryover", DATE, "--json")
        self.assertEqual(res.returncode, 0, res.stderr)
        doc = json.loads(res.stdout)
        reasons = {c["id"]: c["reason"] for c in doc["carry"]}
        self.assertEqual(reasons["task:Ops/Tasks/Beta"], "keep")
        self.assertEqual(reasons["task:Ops/Tasks/Gamma"], "defer_due")
        self.assertEqual(reasons["decision:Atlas/Decisions/Vendor"], "note_only")
        self.assertEqual(reasons["job:Agents/Jobs/20261110-001 - lit scan"], "unanswered")
        for gone in ("task:Ops/Tasks/Alpha", "person:Atlas/People/Robin Park", "capture:Inbox/memo"):
            self.assertNotIn(gone, reasons)
        beta = [c for c in doc["carry"] if c["id"] == "task:Ops/Tasks/Beta"][0]
        self.assertEqual(beta["carried_from"], DATE)
        self.assertEqual(beta["previous"], {"date": DATE, "action": "keep", "params": {}, "note": "next week"})
        self.assertEqual(len(doc["answers"]), 6)
        self.assertEqual(doc["next_date"], "2026-11-13")
        # Carried items validate as items for the next day's file.
        nxt = {"schema": br.ITEMS_SCHEMA, "date": "2026-11-13",
               "items": [{k: v for k, v in c.items() if k != "reason"} for c in doc["carry"]]}
        for c in nxt["items"]:
            if c["previous"] is None:
                del c["previous"]
        self.assertEqual(br.validate_items(nxt), [])


class TestCarryoverDeferrals(VaultCase):
    """A deferral past the next day is carried when it comes due, not lost."""

    def review(self, date, items, answers):
        doc = {"schema": br.ITEMS_SCHEMA, "date": date, "items": copy.deepcopy(items)}
        (self.vault / "Ops" / "Briefings" / f"{date}.md").write_text(f"# {date}\n", encoding="utf-8")
        br.items_path(self.vault, date).write_text(json.dumps(doc), encoding="utf-8")
        ans = {"schema": br.ANSWERS_SCHEMA, "date": date, "answers": answers}
        res = self.run_cli("save", date, stdin=json.dumps(ans))
        self.assertEqual(res.returncode, 0, res.stderr)

    def carried(self, date):
        res = self.run_cli("carryover", date, "--json")
        self.assertEqual(res.returncode, 0, res.stderr)
        return {c["id"]: c for c in json.loads(res.stdout)["carry"]}

    def test_target_less_deferral_comes_back_when_due(self):
        loose = item("proposal:2026-11-12:7:abcdef12", kind="proposal", section="7", text="Write up the timeline")
        defer = {"id": "followup:2026-11-12:10:11112222", "action": "defer", "params": {"date": "2026-11-16"}}
        fu = item(defer["id"], kind="followup", section="10", text="Ask about the samples")
        self.review("2026-11-12", [loose, fu], [defer, {"id": loose["id"], "action": "skip"}])
        other = item("task:Ops/Tasks/Beta", target="Ops/Tasks/Beta.md")
        for day in ("2026-11-13", "2026-11-14"):
            self.review(day, [other], [{"id": other["id"], "action": "done"}])
        # 11-13 carries into 11-14; 11-14 into 11-15: not due yet.
        self.assertNotIn(fu["id"], self.carried("2026-11-13"))
        self.assertNotIn(fu["id"], self.carried("2026-11-14"))
        self.review("2026-11-15", [other], [{"id": other["id"], "action": "done"}])
        got = self.carried("2026-11-15")  # into 11-16: due
        self.assertIn(fu["id"], got)
        self.assertEqual(got[fu["id"]]["carried_from"], "2026-11-12")
        self.assertEqual(got[fu["id"]]["reason"], "defer_due")
        self.assertEqual(got[fu["id"]]["previous"]["params"], {"date": "2026-11-16"})
        self.assertNotIn(loose["id"], got)
        # Once it reappears in a later items file it is never carried from the old review again.
        self.review("2026-11-16", [fu], [{"id": fu["id"], "action": "done"}])
        self.assertNotIn(fu["id"], self.carried("2026-11-16"))

    def test_to_covers_a_gap(self):
        # Friday's review, Monday's briefing: a deferral to Monday is due for Monday.
        fri, mon = "2026-11-13", "2026-11-16"
        fu = item("followup:2026-11-13:10:55556666", kind="followup", section="10", text="Chase the quote")
        self.review(fri, [fu], [{"id": fu["id"], "action": "defer", "params": {"date": mon}}])
        self.assertNotIn(fu["id"], self.carried(fri))
        res = self.run_cli("carryover", fri, "--to", mon, "--json")
        self.assertEqual(res.returncode, 0, res.stderr)
        doc = json.loads(res.stdout)
        self.assertEqual(doc["next_date"], mon)
        self.assertIn(fu["id"], {c["id"] for c in doc["carry"]})
        self.assertEqual(self.run_cli("carryover", fri, "--to", fri).returncode, 2)
        self.assertEqual(self.run_cli("carryover", fri, "--to", "monday").returncode, 2)

    def test_deferral_due_next_day_not_carried_twice(self):
        fu = item("followup:2026-11-12:10:33334444", kind="followup", section="10", text="Ping the core")
        self.review("2026-11-12", [fu], [{"id": fu["id"], "action": "defer", "params": {"date": "tom"}}])
        self.assertIn(fu["id"], self.carried("2026-11-12"))
        # The next briefing carried it, so the user answered it there; the old deferral stays settled.
        self.review("2026-11-13", [fu], [{"id": fu["id"], "action": "done"}])
        self.assertNotIn(fu["id"], self.carried("2026-11-13"))


class TestPlanCustomActions(VaultCase):
    def test_foreign_action_refused_before_plan(self):
        bad = copy.deepcopy(GOOD_ITEMS)
        bad[5]["actions"] = ["do", "cancel"]
        self.write_items(bad)
        res = self.run_cli("validate", DATE)
        self.assertEqual(res.returncode, 1)
        self.assertIn("not valid for kind 'capture'", res.stdout)
        # Every kind's own actions route without error.
        for kind, actions in br.KIND_ACTIONS.items():
            for action in actions:
                with self.subTest(kind=kind, action=action):
                    self.assertIsInstance(br.route_for(kind, action), str)


class TestBuild(VaultCase):
    def built(self, *args):
        res = self.run_cli("build", DATE, "--site", SITE, *args)
        self.assertEqual(res.returncode, 0, res.stderr)
        return [pathlib.Path(p) for p in res.stdout.split()]

    @staticmethod
    def payload(html):
        m = re.search(r"window\.__REVIEW__=(\{.*?\});?\s*(?:</script>|\n)", html, re.S)
        return json.loads(m.group(1))

    def test_page_default_and_safety(self):
        evil = copy.deepcopy(GOOD_ITEMS)
        evil[1]["text"] = "[[Beta]] </script><script>alert(1)</script>   & <b>"
        self.write_items(evil)
        [path] = self.built()
        self.assertEqual(path, br.outputs_dir(self.vault) / f"{DATE}.html")
        html = path.read_text()
        self.assertTrue(html.isascii())
        self.assertNotIn("<script>alert", html)
        self.assertEqual(html.lower().count("</script>"), 2)
        data = self.payload(html)
        self.assertEqual(data["items"][1]["text"], evil[1]["text"])
        self.assertEqual([i["n"] for i in data["items"]], list(range(1, len(evil) + 1)))
        self.assertEqual((data["surface"], data["site"], data["page"], data["pages"]), ("page", SITE, 1, 1))
        self.assertEqual(data["kinds"], br.KIND_ACTIONS)
        self.assertEqual(data["actions"]["do"]["label"], "Do it")
        self.assertIn('<div id="review-root"', html)

    def test_stdout_and_site_default_token(self):
        self.write_items()
        res = self.run_cli("build", DATE, "--surface", "server", "--stdout", "--site", SITE)
        self.assertEqual(res.returncode, 0, res.stderr)
        self.assertTrue(res.stdout.startswith("<!doctype html>"))
        self.assertEqual(self.payload(res.stdout)["surface"], "server")
        self.assertIn("{{QUARTZ_PORT}}", br.DEFAULT_SITE)

    def test_widget_paging(self):
        self.write_items()
        [single] = self.built("--surface", "widget")
        self.assertEqual(single.name, f"{DATE}.widget.html")
        frag = single.read_text()
        self.assertTrue(frag.startswith("<style>"))
        self.assertNotIn("<html", frag.lower())
        self.assertNotIn("<body", frag.lower())
        self.assertNotIn(":root", frag)
        whole = len(frag.encode())
        limit = whole - 1200
        paths = self.built("--surface", "widget", "--max-bytes", str(limit))
        self.assertGreater(len(paths), 1)
        self.assertEqual([p.name for p in paths], [f"{DATE}.widget.{i}.html" for i in range(1, len(paths) + 1)])
        seen = []
        for i, p in enumerate(paths, 1):
            text = p.read_text()
            self.assertLessEqual(len(text.encode()), limit)
            data = self.payload(text)
            self.assertEqual((data["page"], data["pages"]), (i, len(paths)))
            ns = [it["n"] for it in data["items"]]
            self.assertEqual(ns, list(range(ns[0], ns[-1] + 1)))  # contiguous
            seen += ns
        self.assertEqual(seen, list(range(1, len(GOOD_ITEMS) + 1)))
        res = self.run_cli("build", DATE, "--surface", "widget", "--max-bytes", "1000", "--site", SITE)
        self.assertEqual(res.returncode, 1)
        self.assertIn("too small for the widget's script and styles", res.stderr)

    def write_notes(self, notes):
        for rel, sens in notes.items():
            p = self.vault / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            fm = f"---\ntype: note\nsensitivity: {sens}\n---\n" if sens else "---\ntype: note\n---\n"
            p.write_text(fm + "# body\n", encoding="utf-8")

    ARTIFACT_NOTES = {"Ops/Tasks/Alpha.md": "normal", "Ops/Tasks/Beta.md": "normal",
                      "Ops/Tasks/Gamma.md": "private", "Inbox/memo.md": "normal"}

    def test_artifact_redaction(self):
        items = copy.deepcopy(GOOD_ITEMS)
        items[3]["group"] = "Collaborators"
        items[2]["previous"] = {"date": "2026-11-11", "action": "waiting", "params": {"who": "Dana Q"}, "note": "ask Dana"}
        items[2]["carried_from"] = "2026-11-11"
        self.write_items(items)
        self.write_notes(self.ARTIFACT_NOTES)
        alias = lambda i: br.artifact_alias(DATE, i)  # noqa: E731
        [path] = self.built("--surface", "artifact")
        html = path.read_text()
        self.assertTrue(html.startswith("<title>Briefing Review</title>\n<style>"))
        self.assertNotRegex(html.lower(), r"<!doctype|<html|<head|<body")
        data = self.payload(html)
        ids = {i["id"]: i for i in data["items"]}
        # Every id is an opaque alias; no note title or path reaches the payload through ids.
        self.assertTrue(all(re.fullmatch(r"a:[0-9a-f]{12}", i) for i in ids), list(ids))
        for leak in ("Ops/Tasks/Gamma", "Robin Park", "Gamma", "Atlas Rebuild", "Secret plan", "Collaborators", "Dana Q"):
            self.assertNotIn(leak, html)
        # Default --redact private: sensitive AND private items are withheld (Atlas Rebuild has
        # no sensitivity and no note -> private); normal items are kept whole.
        self.assertEqual(data["withheld"], 4)
        self.assertNotIn(alias("task:Ops/Tasks/Gamma"), ids)
        self.assertIn("something", ids[alias("task:Ops/Tasks/Beta")]["text"])
        self.assertEqual(data["site"], "")
        self.assertNotIn("localhost", html)
        self.assertIsNone(data["previous"])
        self.assertEqual(data["items_hash"], br.items_hash(br.load_items(self.vault, DATE)))
        # The alias map stays local, 0600, under outputs/ (gitignored).
        mpath = br.artifact_map_path(self.vault, DATE)
        self.assertEqual(mpath.parent, br.outputs_dir(self.vault))
        self.assertEqual(oct(mpath.stat().st_mode & 0o777), oct(0o600))
        self.assertEqual(json.loads(mpath.read_text())["aliases"][alias("task:Ops/Tasks/Gamma")], "task:Ops/Tasks/Gamma")

        # --redact titles: private rows are answerable, title only.
        [path] = self.built("--surface", "artifact", "--redact", "titles")
        data = self.payload(path.read_text())
        ids = {i["id"]: i for i in data["items"]}
        self.assertEqual(data["withheld"], 1)
        gamma = ids[alias("task:Ops/Tasks/Gamma")]
        self.assertEqual((gamma["text"], gamma["detail"], gamma["group"], gamma["private"]), ("[[Gamma]]", [], "", True))
        self.assertNotIn("target", gamma)
        self.assertEqual(gamma["previous"], {"date": "2026-11-11", "action": "waiting", "params": {}})
        robin = ids[alias("person:Atlas/People/Robin Park")]
        self.assertEqual((robin["section_title"], robin["group"]), ("People", ""))
        self.assertNotIn("Collaborators", path.read_text())
        self.assertNotIn("Dana", path.read_text())

        # --redact sensitive: private text kept, sensitive still dropped; none refused.
        [path] = self.built("--surface", "artifact", "--redact", "sensitive")
        data = self.payload(path.read_text())
        self.assertIn("something", {i["id"]: i for i in data["items"]}[alias("task:Ops/Tasks/Gamma")]["text"])
        self.assertEqual(data["withheld"], 1)
        res = self.run_cli("build", DATE, "--surface", "artifact", "--redact", "none", "--site", SITE)
        self.assertEqual(res.returncode, 2)

    def test_artifact_sensitivity_from_frontmatter_and_links(self):
        items = copy.deepcopy(GOOD_ITEMS)
        items[0]["text"] = "[[Alpha]] — ask [[Robin Park]] first"   # links a private note
        self.write_items(items)
        notes = dict(self.ARTIFACT_NOTES, **{"Ops/Tasks/Beta.md": "sensitive"})  # item says normal
        self.write_notes(notes)
        [path] = self.built("--surface", "artifact", "--redact", "sensitive")
        data = self.payload(path.read_text())
        ids = {i["id"] for i in data["items"]}
        self.assertNotIn(br.artifact_alias(DATE, "task:Ops/Tasks/Beta"), ids)  # frontmatter wins
        self.assertIn(br.artifact_alias(DATE, "task:Ops/Tasks/Alpha"), ids)    # private kept at this level
        [path] = self.built("--surface", "artifact")
        ids = {i["id"] for i in self.payload(path.read_text())["items"]}
        self.assertNotIn(br.artifact_alias(DATE, "task:Ops/Tasks/Alpha"), ids)  # linked private note
        self.assertIn(br.artifact_alias(DATE, "capture:Inbox/memo"), ids)

    def test_artifact_answers_map_aliases_back(self):
        self.write_items()
        self.write_notes(self.ARTIFACT_NOTES)
        self.built("--surface", "artifact")
        doc = {"schema": br.ANSWERS_SCHEMA, "date": DATE, "surface": "artifact", "submitted": True,
               "answers": [{"id": br.artifact_alias(DATE, "task:Ops/Tasks/Beta"), "action": "done"},
                           {"id": "capture:Inbox/memo", "action": "file"}],
               "state": {br.artifact_alias(DATE, "task:Ops/Tasks/Beta"): {"action": "done"}}}
        res = self.run_cli("save", DATE, "--surface", "artifact", stdin=json.dumps(doc))
        self.assertEqual(res.returncode, 0, res.stderr)
        saved = json.loads(br.answers_path(self.vault, DATE).read_text())
        self.assertEqual({a["id"]: a["action"] for a in saved["answers"]},
                         {"task:Ops/Tasks/Beta": "done", "capture:Inbox/memo": "file"})
        # Aliases are not accepted from other surfaces.
        res = self.run_cli("save", DATE, "--surface", "cli", "--allow-empty", stdin=json.dumps(doc))
        self.assertEqual(res.returncode, 1)
        self.assertIn("unknown id", res.stderr)

    def test_markdown_fallback_build_and_links(self):
        [path] = self.built()
        data = self.payload(path.read_text())
        self.assertEqual(data["links"]["Send revised budget to Dana"], "Ops/Tasks/Send revised budget to Dana")
        self.assertEqual(data["links"]["Figure panel C"], "Figure panel C")

    def test_previous_state_from_answers(self):
        self.write_items()
        self.save([{"id": "task:Ops/Tasks/Beta", "action": "waiting", "params": {"who": "Robin"}}])
        [path] = self.built()
        prev = self.payload(path.read_text())["previous"]
        self.assertTrue(prev["submitted"])
        self.assertEqual(prev["state"]["task:Ops/Tasks/Beta"]["params"], {"who": "Robin"})


class TestServer(VaultCase):
    def setUp(self):
        super().setUp()
        self.write_items()
        self.server = br.make_server(self.vault, "127.0.0.1", 0, SITE)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        super().tearDown()

    def req(self, path, method="GET", body=None, headers=None, follow=True):
        url = f"http://127.0.0.1:{self.port}{path}"
        data = body if body is None or isinstance(body, bytes) else json.dumps(body).encode()
        hdrs = {"Content-Type": "application/json"} if data is not None else {}
        hdrs.update(headers or {})
        request = urllib.request.Request(url, data=data, method=method, headers=hdrs)
        opener = urllib.request.build_opener() if follow else urllib.request.build_opener(NoRedirect)
        try:
            with opener.open(request, timeout=10) as res:
                return res.status, res.headers, res.read().decode()
        except urllib.error.HTTPError as exc:
            return exc.code, exc.headers, exc.read().decode()

    def test_routes(self):
        status, headers, _ = self.req("/review", follow=False)
        self.assertEqual((status, headers["Location"]), (302, f"/review/{DATE}"))
        status, _, _ = self.req("/review/", follow=False)
        self.assertEqual(status, 302)
        status, headers, html = self.req(f"/review/{DATE}")
        self.assertEqual(status, 200)
        self.assertIn("text/html", headers["Content-Type"])
        self.assertIn('"surface":"server"', html)
        self.assertEqual(self.req(f"/review/2026-01-01")[0], 404)
        self.assertEqual(self.req("/review/latest")[0], 400)
        self.assertEqual(self.req(f"/api/review/{DATE}")[0], 404)

        body = {"schema": br.ANSWERS_SCHEMA, "date": DATE, "surface": "server", "submitted": False,
                "answers": [{"id": "task:Ops/Tasks/Beta", "action": "keep", "params": {}, "note": ""}]}
        status, _, out = self.req(f"/api/review/{DATE}?draft=1", "POST", body, {"Origin": f"http://localhost:{self.port}"})
        self.assertEqual(status, 200, out)
        self.assertTrue(json.loads(out)["ok"])
        self.assertFalse(json.loads(br.answers_path(self.vault, DATE).read_text())["submitted"])
        body["answers"][0]["action"] = "done"
        status, _, out = self.req(f"/api/review/{DATE}", "POST", body)
        self.assertEqual(status, 200, out)
        self.assertEqual(json.loads(out)["path"], str(br.answers_path(self.vault, DATE)))
        status, _, out = self.req(f"/api/review/{DATE}")
        stored = json.loads(out)
        self.assertEqual((status, stored["submitted"], stored["surface"]), (200, True, "server"))
        status, _, out = self.req(f"/api/review/{DATE}?draft=1", "POST", body)
        self.assertTrue(json.loads(out).get("kept_submitted"))
        # An empty submit cannot replace a submitted file, unless it is a Reset (?clear=1).
        empty = dict(body, answers=[])
        status, _, out = self.req(f"/api/review/{DATE}", "POST", empty)
        self.assertEqual(status, 400, out)
        status, _, out = self.req(f"/api/review/{DATE}?draft=1&clear=1", "POST", empty)
        self.assertTrue(json.loads(out).get("kept_submitted"))  # clear never applies to drafts
        status, _, out = self.req(f"/api/review/{DATE}?clear=1", "POST", empty)
        self.assertEqual(status, 200, out)
        self.assertEqual(json.loads(br.answers_path(self.vault, DATE).read_text())["answers"], [])

    def test_post_guards(self):
        good = {"answers": []}
        cases = [
            ("/api/review/2026-1-1", good, {}, 400),
            ("/api/review/" + DATE, good, {"Origin": "https://evil.example"}, 400),
            ("/api/review/" + DATE, good, {"Origin": "null"}, 400),
            ("/api/review/" + DATE, b"{not json", {}, 400),
            ("/api/review/" + DATE, json.dumps(good).encode(), {"Content-Type": "text/plain"}, 400),
            ("/api/review/" + DATE, {"answers": [{"id": "nope", "action": "done"}]}, {}, 400),
        ]
        for path, body, headers, want in cases:
            with self.subTest(path=path, headers=headers):
                status, _, out = self.req(path, "POST", body, headers)
                self.assertEqual(status, want, out)
                self.assertFalse(json.loads(out)["ok"])
        self.assertFalse(br.answers_path(self.vault, DATE).exists())
        status, _, _ = self.req(f"/api/review/{DATE}", headers={"Host": "attacker.example"})
        self.assertEqual(status, 403)

    def test_refuses_non_loopback(self):
        with self.assertRaises(br.ReviewError):
            br.make_server(self.vault, "0.0.0.0", 0)
        res = self.run_cli("serve", "--host", "0.0.0.0", "--port", "0")
        self.assertEqual(res.returncode, 2)


class TestReviewFixes(VaultCase):
    """Regression tests for the briefing-review review findings (one block per finding)."""

    def setUp(self):
        super().setUp()
        self.write_items()

    def export_for(self, answers, items=None, part=None):
        doc = br.load_items(self.vault, DATE) if items is None else items
        normalized, _ = br.normalize_answers({"answers": answers}, doc, DATE)
        return br.format_export(DATE, doc, normalized, part=part)

    # 1 -- exports made against an older items.json
    def test_export_rows_verified_against_items(self):
        text = self.export_for([{"id": "task:Ops/Tasks/Beta", "action": "done"},
                                {"id": "capture:Inbox/memo", "action": "file"}])
        self.assertRegex(text.splitlines()[0], r"^Briefing review — 2026-11-12 · items [0-9a-f]{8} \(apply")
        # The briefing is regenerated: a new item is inserted at the top, shifting every row.
        shifted = [item("task:Ops/Tasks/Zeta", target="Ops/Tasks/Zeta.md", sensitivity="normal")] + copy.deepcopy(GOOD_ITEMS)
        self.write_items(shifted)
        res = self.run_cli("save", "--from-export", stdin=text)
        self.assertEqual(res.returncode, 0, res.stderr)
        self.assertIn("re-matched uniquely", res.stderr)
        saved = {a["id"]: a["action"] for a in json.loads(br.answers_path(self.vault, DATE).read_text())["answers"]}
        self.assertEqual(saved, {"task:Ops/Tasks/Beta": "done", "capture:Inbox/memo": "file"})

    def test_export_swapped_lookalikes_refuse(self):
        # Two tasks share a long text prefix; the regenerated briefing swaps them.
        prefix = "Send the revised quarterly budget spreadsheet to the facilities office before the"
        a = item("task:Ops/Tasks/QA", target="Ops/Tasks/QA.md", sensitivity="normal",
                 text=prefix + " Monday meeting")
        b = item("task:Ops/Tasks/QB", target="Ops/Tasks/QB.md", sensitivity="normal",
                 text=prefix + " Friday review")
        before = copy.deepcopy(GOOD_ITEMS) + [a, b]
        self.write_items(before)
        text = self.export_for([{"id": "task:Ops/Tasks/QA", "action": "done"}])
        self.write_items(copy.deepcopy(GOOD_ITEMS) + [b, a])
        res = self.run_cli("save", "--from-export", stdin=text)
        self.assertEqual(res.returncode, 1, res.stdout)
        self.assertIn("2 items match", res.stderr)
        self.assertFalse(br.answers_path(self.vault, DATE).exists())
        # Built from the very same items, the positional match is trusted as before.
        self.write_items(before)
        res = self.run_cli("save", "--from-export", stdin=text)
        self.assertEqual(res.returncode, 0, res.stderr)
        saved = {x["id"]: x["action"] for x in json.loads(br.answers_path(self.vault, DATE).read_text())["answers"]}
        self.assertEqual(saved.get("task:Ops/Tasks/QA"), "done")
        self.assertNotIn("task:Ops/Tasks/QB", saved)

    def test_redacted_builds_scope_saved_answers(self):
        for rel, sens in TestBuild.ARTIFACT_NOTES.items():
            f = self.vault / rel
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_text(f"---\ntype: note\nsensitivity: {sens}\n---\n# body\n", encoding="utf-8")
        self.save([{"id": "task:Ops/Tasks/Beta", "action": "done", "note": "beta-note-ok"},
                   {"id": "task:Ops/Tasks/Gamma", "action": "defer", "params": {"date": "fri"},
                    "note": "gamma-private-note"},
                   {"id": "item:2026-11-12:asks:12345678", "action": "drop", "note": "secret-sensitive-note"}])
        [html] = br.build(self.vault, DATE, "page", SITE, redact="private")
        self.assertNotIn("gamma-private-note", html)
        self.assertNotIn("secret-sensitive-note", html)
        self.assertNotIn("task:Ops/Tasks/Gamma", TestBuild.payload(html)["previous"]["state"])
        self.assertIn("beta-note-ok", html)
        [html] = br.build(self.vault, DATE, "page", SITE, redact="titles")
        state = TestBuild.payload(html)["previous"]["state"]
        self.assertNotIn("gamma-private-note", html)
        self.assertNotIn("secret-sensitive-note", html)
        self.assertEqual(state["task:Ops/Tasks/Gamma"]["action"], "defer")
        self.assertEqual(state["task:Ops/Tasks/Gamma"]["note"], "")
        self.assertIn("date", state["task:Ops/Tasks/Gamma"]["params"])
        # Unredacted local builds keep every saved answer.
        [html] = br.build(self.vault, DATE, "page", SITE)
        self.assertIn("gamma-private-note", html)

    def test_widget_pages_embed_only_their_answers(self):
        # Twelve long notes: together they exceed the budget, so embedding every page's
        # answers on each page would make even an empty page too big to split into.
        self.save([{"id": it["id"], "action": None, "note": "n" * 15000} for it in GOOD_ITEMS])
        limit = 150000
        docs = br.build(self.vault, DATE, "widget", SITE, limit)
        self.assertGreater(len(docs), 1)
        for doc in docs:
            self.assertLessEqual(len(doc.encode()), limit)
            data = TestBuild.payload(doc)
            page_ids = {it["id"] for it in data["items"]}
            self.assertTrue(set(data["previous"]["state"]) <= page_ids)

    def test_export_unmatched_rows_write_nothing(self):
        text = self.export_for([{"id": "task:Ops/Tasks/Beta", "action": "done"}])
        others = copy.deepcopy(GOOD_ITEMS)
        others[1] = item("task:Ops/Tasks/Omega", target="Ops/Tasks/Omega.md", sensitivity="normal")
        self.write_items(others)   # Beta is gone; row [2] is now Omega
        res = self.run_cli("save", "--from-export", stdin=text)
        self.assertEqual(res.returncode, 1)
        self.assertIn("row [2]", res.stderr)
        self.assertIn("nothing was saved", res.stderr)
        self.assertIn("items changed since the review page was built", res.stderr)
        self.assertFalse(br.answers_path(self.vault, DATE).exists())
        # Ambiguous re-match (two items with the same label + text) also refuses.
        dup = copy.deepcopy(GOOD_ITEMS)
        dup.insert(0, item("task:Ops/Tasks/Beta2", text="[[Beta]] — something", sensitivity="normal"))
        self.write_items(dup)
        res = self.run_cli("save", "--from-export", stdin=text)
        self.assertEqual(res.returncode, 1)
        self.assertIn("2 items match", res.stderr)

    def test_export_old_header_still_parses(self):
        text = self.export_for([{"id": "task:Ops/Tasks/Beta", "action": "done"}])
        old = re.sub(r" · items [0-9a-f]{8}", "", text)
        self.assertTrue(old.startswith(f"Briefing review — {DATE} (apply"))
        res = self.run_cli("save", "--from-export", stdin=old)
        self.assertEqual(res.returncode, 0, res.stderr)

    def test_json_items_hash_mismatch_warns(self):
        res = self.run_cli("save", DATE, stdin=json.dumps({"items_hash": "00000000", "answers": [
            {"id": "task:Ops/Tasks/Beta", "action": "done"}]}))
        self.assertEqual(res.returncode, 0, res.stderr)
        self.assertIn("warning: answers were made against items 00000000", res.stderr)
        saved = json.loads(br.answers_path(self.vault, DATE).read_text())
        self.assertEqual(saved["items_hash"], br.items_hash(br.load_items(self.vault, DATE)))
        res = self.run_cli("save", DATE, stdin=json.dumps({"items_hash": saved["items_hash"], "answers": [
            {"id": "task:Ops/Tasks/Beta", "action": "done"}]}))
        self.assertNotIn("warning", res.stderr)

    # 2 -- mark records the planned answer, not a re-submitted one
    def test_mark_fingerprint_survives_resubmit(self):
        self.save([{"id": "task:Ops/Tasks/Beta", "action": "defer", "params": {"date": "fri"}}])
        plan = json.loads(self.run_cli("plan", DATE, "--json").stdout)
        fp = plan["entries"][0]["fingerprint"]
        # The user re-submits a different answer between plan and mark.
        self.save([{"id": "task:Ops/Tasks/Beta", "action": "cancel", "note": "no longer needed"}])
        res = self.run_cli("mark", DATE, "task:Ops/Tasks/Beta", "--result", "applied",
                           "--summary", "due -> 2026-11-13", "--fingerprint", fp)
        self.assertEqual(res.returncode, 0, res.stderr)
        self.assertIn("changed since it was planned", res.stderr)
        entry = json.loads(br.ledger_path(self.vault, DATE).read_text())["entries"]["task:Ops/Tasks/Beta"]
        self.assertEqual((entry["fingerprint"], entry["action"], entry["params"]), (fp, "defer", {"date": "2026-11-13"}))
        plan = json.loads(self.run_cli("plan", DATE, "--json").stdout)
        self.assertEqual([(e["id"], e["action"], e["changed"]) for e in plan["entries"]],
                         [("task:Ops/Tasks/Beta", "cancel", True)])
        # annotate describes what was applied (DEFER), not the file's current CANCEL.
        self.run_cli("annotate", DATE)
        md = br.briefing_md_path(self.vault, DATE).read_text()
        self.assertIn("- [2] DEFER(2026-11-13) — [[Beta]] — something — applied: due -> 2026-11-13", md)
        self.assertNotIn("CANCEL", md)

    def test_mark_without_fingerprint_warns(self):
        self.save([{"id": "task:Ops/Tasks/Beta", "action": "keep"}])
        res = self.run_cli("mark", DATE, "task:Ops/Tasks/Beta", "--result", "skipped")
        self.assertEqual(res.returncode, 0, res.stderr)
        self.assertIn("warning: mark without --fingerprint", res.stderr)
        res = self.run_cli("mark", DATE, "task:Ops/Tasks/Beta", "--result", "skipped", "--fingerprint", "xyz")
        self.assertEqual(res.returncode, 2)

    # 3 -- the read-check-write in save is locked across processes
    def test_save_waits_for_the_reviews_lock(self):
        if br.fcntl is None:
            self.skipTest("no fcntl on this platform")
        self.save([{"id": "task:Ops/Tasks/Beta", "action": "done"}])
        body = json.dumps({"answers": [{"id": "task:Ops/Tasks/Beta", "action": "keep"}]})
        env = dict(os.environ)
        env.pop("MEMEX_VAULT", None)
        with br.reviews_lock(self.vault):
            proc = subprocess.Popen([sys.executable, str(SCRIPT), "--vault", str(self.vault), "save", DATE],
                                    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                    text=True, env=env)
            proc.stdin.write(body)
            proc.stdin.close()
            with self.assertRaises(subprocess.TimeoutExpired):
                proc.wait(timeout=1.0)   # blocked on the lock we hold
            self.assertEqual(json.loads(br.answers_path(self.vault, DATE).read_text())["answers"][0]["action"], "done")
        self.assertEqual(proc.wait(timeout=30), 0, proc.stderr.read())
        self.assertEqual(json.loads(br.answers_path(self.vault, DATE).read_text())["answers"][0]["action"], "keep")

    def test_concurrent_drafts_never_replace_a_submit(self):
        env = dict(os.environ)
        env.pop("MEMEX_VAULT", None)
        cmd = [sys.executable, str(SCRIPT), "--vault", str(self.vault), "save", DATE]
        draft = json.dumps({"answers": [{"id": "task:Ops/Tasks/Beta", "action": "keep"}]})
        submit = json.dumps({"answers": [{"id": "task:Ops/Tasks/Beta", "action": "done"}]})
        procs = [subprocess.Popen(cmd + (["--draft"] if i % 2 else []), stdin=subprocess.PIPE,
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, text=True, env=env)
                 for i in range(8)]
        for i, p in enumerate(procs):
            p.stdin.write(draft if i % 2 else submit)
            p.stdin.close()
        for p in procs:
            self.assertEqual(p.wait(timeout=60), 0)
        saved = json.loads(br.answers_path(self.vault, DATE).read_text())
        self.assertTrue(saved["submitted"])
        self.assertEqual(saved["answers"][0]["action"], "done")

    # 4 -- carryover only for a submitted review with an items file
    def test_carryover_needs_a_submitted_review(self):
        res = self.run_cli("carryover", DATE, "--json")
        self.assertEqual(res.returncode, 1)
        self.assertIn("no review answers", res.stderr)
        self.assertEqual(res.stdout, "")
        self.save([{"id": "task:Ops/Tasks/Beta", "action": "keep"}], "--draft")
        res = self.run_cli("carryover", DATE, "--json")
        self.assertEqual(res.returncode, 1)
        self.assertIn("never submitted", res.stderr)
        res = self.run_cli("carryover", DATE, "--json", "--include-draft")
        self.assertEqual(res.returncode, 0, res.stderr)
        self.assertFalse(json.loads(res.stdout)["submitted"])
        # No items file: never the Markdown fallback (it would carry the whole briefing).
        self.save([{"id": "task:Ops/Tasks/Beta", "action": "keep"}])
        br.items_path(self.vault, DATE).unlink()
        res = self.run_cli("carryover", DATE, "--json")
        self.assertEqual(res.returncode, 1)
        self.assertIn("items file not found", res.stderr)

    # 6 -- pagination, Part lines, empty exports
    def test_widget_pages_are_never_empty(self):
        items = copy.deepcopy(GOOD_ITEMS)
        items[4]["detail"] = ["x" * 9000]  # one row far bigger than the others
        self.write_items(items)
        whole = len(br.build(self.vault, DATE, "widget", SITE, 10**7)[0].encode())
        shell = whole - 9000
        res = self.run_cli("build", DATE, "--surface", "widget", "--site", SITE, "--max-bytes", str(shell + 3000))
        self.assertEqual(res.returncode, 0, res.stderr)
        self.assertIn("row 5 alone exceeds", res.stderr)
        paths = [pathlib.Path(p) for p in res.stdout.split()]
        ns = []
        for p in paths:
            data = TestBuild.payload(p.read_text())
            self.assertTrue(data["items"], p.name)
            self.assertEqual(data["rows"], [data["items"][0]["n"], data["items"][-1]["n"]])
            ns += [i["n"] for i in data["items"]]
        self.assertEqual(ns, list(range(1, len(items) + 1)))
        self.assertEqual(br.DEFAULT_MAX_BYTES, 200000)

    def test_part_line_always_present_and_empty_exports_refused(self):
        doc = br.load_items(self.vault, DATE)
        text = br.format_export(DATE, doc, [], part=(2, 3, 5, 8))
        self.assertIn("Part 2 of 3 — rows 5-8.", text)
        self.save([{"id": "task:Ops/Tasks/Beta", "action": "done"}])
        empty = re.sub(r"Part .*\n", "", text)
        for stdin, flags in ((empty, ["--from-export"]), (text, ["--from-export"]),
                             (json.dumps({"answers": []}), [DATE])):
            with self.subTest(flags=flags):
                res = self.run_cli("save", *flags, stdin=stdin)
                self.assertEqual(res.returncode, 1)
                self.assertIn("--allow-empty", res.stderr)
        self.assertEqual(json.loads(br.answers_path(self.vault, DATE).read_text())["answers"][0]["action"], "done")
        res = self.run_cli("save", DATE, "--allow-empty", stdin=json.dumps({"answers": []}))
        self.assertEqual(res.returncode, 0, res.stderr)
        self.assertEqual(json.loads(br.answers_path(self.vault, DATE).read_text())["answers"], [])

    def test_compact_source_strips_comments_and_whitespace(self):
        js, css = br.app_assets()
        cjs, ccss = br.compact_source(js, "js"), br.compact_source(br.widget_css(css), "css")
        self.assertNotIn("Briefing review client: one implementation", cjs)  # leading block comment
        self.assertNotIn("/*", ccss)
        self.assertNotIn("\n", ccss)
        self.assertLess(len(cjs), len(js) * 0.9)
        self.assertLess(len(ccss), len(css) * 0.9)

    # 9 -- answer field types
    def test_answer_field_types_validated(self):
        cases = [
            ({"id": ["x"], "action": "done"}, "id must be"),
            ({"id": {"a": 1}, "action": "done"}, "id must be"),
            ({"id": "task:Ops/Tasks/Beta", "action": 3}, "action must be"),
            ({"id": "task:Ops/Tasks/Beta", "action": "done", "note": ["x"]}, "note must be"),
            ({"id": "task:Ops/Tasks/Beta", "action": "defer", "params": {"date": {"x": 1}}}, "params.date"),
            ({"id": "task:Ops/Tasks/Beta", "action": "defer", "params": ["mon"]}, "params must be"),
            ({"id": "task:Ops/Tasks/Beta", "action": "done", "note": "x" * (br.MAX_NOTE_CHARS + 1)}, "longer than"),
            ({"id": "x" * (br.MAX_ID_CHARS + 1), "action": "done"}, "id must be"),
        ]
        for ans, needle in cases:
            with self.subTest(needle=needle, ans=str(ans)[:60]):
                res = self.run_cli("save", DATE, stdin=json.dumps({"answers": [ans]}))
                self.assertEqual(res.returncode, 1)
                self.assertIn(needle, res.stderr)
                self.assertNotIn("Traceback", res.stderr)

    # 10 -- emphasised group labels in the Markdown fallback
    def test_emphasised_group_labels(self):
        br.items_path(self.vault, DATE).unlink()
        md = br.briefing_md_path(self.vault, DATE)
        md.write_text(BRIEFING_MD.replace("- Lab logistics:", "- **Lab logistics:**")
                      .replace("- [[2026-11-11 voice memo]] — unprocessed\n  - mentions the retreat",
                               "- *Grant:*\n  - [[2026-11-11 voice memo]] — unprocessed"))
        items = json.loads(self.run_cli("items", DATE).stdout)["items"]
        texts = [i["text"] for i in items]
        self.assertFalse(any("Lab logistics" in t or "Grant:" in t for t in texts), texts)
        groups = {i["text"].split("]]")[0].lstrip("["): i["group"] for i in items}
        self.assertEqual(groups["Order reagents"], "Lab logistics")
        self.assertEqual(groups["2026-11-11 voice memo"], "Grant")

    # 11 -- one id function for the skill and the fallback parser
    def test_id_command_matches_fallback_ids(self):
        br.items_path(self.vault, DATE).unlink()
        items = json.loads(self.run_cli("items", DATE).stdout)["items"]
        targetless = [i for i in items if not i.get("target")]
        self.assertTrue(targetless)
        for it in targetless + [i for i in items if i.get("target")][:2]:
            args = ["id", "--kind", it["kind"], "--section", it["section"], "--date", DATE, "--text", it["text"]]
            if it.get("target"):
                args += ["--target", it["target"]]
            res = self.run_cli(*args)
            self.assertEqual(res.returncode, 0, res.stderr)
            self.assertEqual(res.stdout.strip(), it["id"])
        self.assertEqual(self.run_cli("id", "--kind", "widget", "--section", "3", "--text", "x").returncode, 2)
        self.assertEqual(self.run_cli("id", "--kind", "item", "--section", "3").returncode, 2)
        # Default date = latest briefing.
        res = self.run_cli("id", "--kind", "item", "--section", "3", "--text", "Plain line")
        self.assertTrue(res.stdout.startswith(f"item:{DATE}:3:"), res.stdout)

    # 13 -- file modes
    def test_file_modes(self):
        md = br.briefing_md_path(self.vault, DATE)
        os.chmod(md, 0o600)
        self.save([{"id": "task:Ops/Tasks/Beta", "action": "keep"}])
        self.run_cli("mark", DATE, "task:Ops/Tasks/Beta", "--result", "skipped")
        self.assertEqual(self.run_cli("annotate", DATE).returncode, 0)
        mode = lambda p: p.stat().st_mode & 0o777  # noqa: E731
        self.assertEqual(oct(mode(md)), oct(0o600))
        self.assertEqual(oct(mode(br.answers_path(self.vault, DATE))), oct(0o600))
        self.assertEqual(oct(mode(br.ledger_path(self.vault, DATE))), oct(0o600))
        # An existing file keeps a looser mode the user chose.
        os.chmod(br.answers_path(self.vault, DATE), 0o640)
        self.save([{"id": "task:Ops/Tasks/Beta", "action": "done"}])
        self.assertEqual(oct(mode(br.answers_path(self.vault, DATE))), oct(0o640))


class TestServerFixes(VaultCase):
    def setUp(self):
        super().setUp()
        self.write_items()

    def start(self, host):
        server = br.make_server(self.vault, host, 0, SITE)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        return server.server_address[1]

    # 9 -- clean 400s, no dropped connection, no vault paths
    def test_bad_answer_types_are_clean_400s(self):
        port = self.start("127.0.0.1")
        for body in ({"answers": [{"id": ["x"], "action": "done"}]}, {"answers": [{"id": {"a": 1}}]},
                     {"answers": "nope"}, ["not", "an", "object"]):
            with self.subTest(body=body):
                req = urllib.request.Request(f"http://127.0.0.1:{port}/api/review/{DATE}", method="POST",
                                             data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
                with self.assertRaises(urllib.error.HTTPError) as cm:
                    urllib.request.urlopen(req, timeout=10)
                out = json.loads(cm.exception.read().decode())
                self.assertEqual(cm.exception.code, 400)
                self.assertFalse(out["ok"])
                self.assertNotIn("Traceback", out["error"])
                self.assertNotIn(str(self.vault), out["error"])

    def test_error_text_has_no_vault_paths(self):
        self.assertEqual(br.public_error(f"bad {self.vault}/Inbox/reviews/x.json", self.vault),
                         "bad Inbox/reviews/x.json")
        self.assertLessEqual(len(br.public_error("x" * 5000, self.vault)), br.MAX_ERROR_CHARS + 1)

    # 12 -- IPv6 loopback
    def test_ipv6_loopback(self):
        try:
            port = self.start("::1")
        except br.ReviewError as exc:
            self.assertEqual(exc.code, 2 if "IPv6" in str(exc) else 1)
            res = self.run_cli("serve", "--host", "::1", "--port", "0")
            self.assertIn(res.returncode, (1, 2))
            self.assertNotIn("Traceback", res.stderr)
            self.assertIn("::1", res.stderr)
            self.skipTest(f"IPv6 loopback unavailable here: {exc}")
        with urllib.request.urlopen(f"http://[::1]:{port}/review/{DATE}", timeout=10) as res:
            self.assertEqual(res.status, 200)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class TestScriptHygiene(unittest.TestCase):
    def test_executable_and_ascii(self):
        self.assertTrue(os.access(SCRIPT, os.X_OK))
        for name in ("briefing_review.py", "briefing_review_app.js", "briefing_review_app.css"):
            self.assertTrue((SCRIPT.parent / name).read_text().isascii(), name)
        js = (SCRIPT.parent / "briefing_review_app.js").read_text()
        self.assertNotIn("</script", js.lower())
        self.assertNotRegex(js, r"\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML|document\.write")

    def test_vault_env_override(self):
        with tempfile.TemporaryDirectory() as td:
            make_vault(td)
            env = dict(os.environ, MEMEX_VAULT=td)
            res = subprocess.run([sys.executable, str(SCRIPT), "items"], capture_output=True, text=True, env=env, timeout=60)
            self.assertEqual(res.returncode, 0, res.stderr)
            self.assertEqual(json.loads(res.stdout)["date"], DATE)


if __name__ == "__main__":
    unittest.main()
