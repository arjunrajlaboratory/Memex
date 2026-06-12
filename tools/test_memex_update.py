import pathlib
import tempfile
import unittest
from unittest import mock

from memex_bake import BakeResult, sha256_file
from memex_update import (
    Disposition,
    classify_update,
    detect_renames,
    fill_new_answers,
    missing_required_tokens,
    plan_update_paths,
    unresolved_plan_entries,
)


LAYOUT = {
    "framework": {
        "prose": [".claude/skills/**", "_workflows/**"],
        "code": ["scripts/**"],
    },
    "hybrid": [".gitignore"],
    "seed": ["_config/overrides.md"],
    "data": ["Atlas/**"],
}


def write(path: pathlib.Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)


class TestUpdateClassification(unittest.TestCase):
    def test_classifies_safe_and_unresolved_dispositions(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            baseline = root / "baseline"
            vault = root / "vault"
            staged = root / "staged"
            work = root / "work"

            write(baseline / ".claude/skills/untouched/SKILL.md", "old\n")
            write(vault / ".claude/skills/untouched/SKILL.md", "old\n")
            write(staged / ".claude/skills/untouched/SKILL.md", "new\n")

            write(baseline / ".claude/skills/edited/SKILL.md", "base\n")
            write(vault / ".claude/skills/edited/SKILL.md", "base\nlocal edit\n")
            write(staged / ".claude/skills/edited/SKILL.md", "engine edit\n")

            write(staged / ".claude/skills/new/SKILL.md", "new skill\n")

            write(vault / ".claude/skills/collision/SKILL.md", "mine\n")
            write(staged / ".claude/skills/collision/SKILL.md", "engine\n")

            write(baseline / ".claude/skills/removed/SKILL.md", "remove me\n")
            write(vault / ".claude/skills/removed/SKILL.md", "remove me\n")

            write(baseline / "_workflows/old-name.md", "step one\nstep two\n")
            write(vault / "_workflows/old-name.md", "step one\nstep two\n")
            write(staged / "_workflows/new-name.md", "step one\nstep two\n")

            write(baseline / ".gitignore", "Inbox/*\n.memex/baseline/\n")
            write(vault / ".gitignore", "Inbox/*\n.memex/baseline/\n")
            write(staged / ".gitignore", "Inbox/*\n.memex/baseline/\n")

            write(staged / "_config/overrides.md", "# Overrides\n")

            manifest_files = {}
            for rel in [
                ".claude/skills/untouched/SKILL.md",
                ".claude/skills/edited/SKILL.md",
                ".claude/skills/removed/SKILL.md",
                "_workflows/old-name.md",
                ".gitignore",
            ]:
                kind = "prose"
                cls = "hybrid" if rel == ".gitignore" else "framework"
                kind = "code" if rel == ".gitignore" else kind
                manifest_files[rel] = {
                    "sha256": sha256_file(baseline / rel),
                    "class": cls,
                    "kind": kind,
                    "pack": "core",
                }
            manifest = {"files": manifest_files}

            source_map = BakeResult()
            for rel in [
                ".claude/skills/untouched/SKILL.md",
                ".claude/skills/edited/SKILL.md",
                ".claude/skills/new/SKILL.md",
                ".claude/skills/collision/SKILL.md",
                "_workflows/new-name.md",
                ".gitignore",
                "_config/overrides.md",
            ]:
                source_map.record(rel, "core")

            entries, unresolved, _meta = classify_update(
                manifest=manifest,
                layout=LAYOUT,
                baseline_dir=baseline,
                vault_dir=vault,
                staged_dir=staged,
                source_map=source_map,
                work_dir=work,
            )

            by_path = {entry["path"]: entry for entry in entries if "path" in entry}
            dispositions = [entry["disposition"] for entry in entries]

            self.assertEqual(by_path[".claude/skills/untouched/SKILL.md"]["disposition"], Disposition.REPLACE_UNTOUCHED)
            self.assertEqual(by_path[".claude/skills/edited/SKILL.md"]["disposition"], Disposition.EDITED)
            self.assertEqual(by_path[".claude/skills/new/SKILL.md"]["disposition"], Disposition.NEW)
            self.assertEqual(by_path[".claude/skills/collision/SKILL.md"]["disposition"], Disposition.COLLISION)
            self.assertEqual(by_path[".claude/skills/removed/SKILL.md"]["disposition"], Disposition.REMOVED_UPSTREAM)
            self.assertIn(Disposition.RENAME_CANDIDATE, dispositions)
            self.assertEqual(by_path[".gitignore"]["class"], "hybrid")
            self.assertEqual(by_path[".gitignore"]["disposition"], Disposition.UNCHANGED)
            self.assertEqual(by_path["_config/overrides.md"]["disposition"], Disposition.SEED_IF_ABSENT)
            # The identical-content rename (similarity 1.0, no local edit) is
            # auto-resolved; edited + collision remain unresolved.
            rename = next(e for e in entries if e["disposition"] == Disposition.RENAME_CANDIDATE)
            self.assertTrue(rename["resolved"])
            self.assertEqual(rename["resolution"], "auto-rename")
            self.assertEqual(len(unresolved), 2)
            self.assertEqual(
                {e["disposition"] for e in unresolved},
                {Disposition.EDITED, Disposition.COLLISION},
            )

    def test_rename_candidate_with_existing_destination_is_collision(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            baseline = root / "baseline"
            vault = root / "vault"
            staged = root / "staged"
            work = root / "work"

            write(baseline / "_workflows/old-name.md", "same content\n")
            write(vault / "_workflows/old-name.md", "same content\n")
            write(vault / "_workflows/new-name.md", "user destination\n")
            write(staged / "_workflows/new-name.md", "same content\n")

            manifest = {
                "files": {
                    "_workflows/old-name.md": {
                        "sha256": sha256_file(baseline / "_workflows/old-name.md"),
                        "class": "framework",
                        "kind": "prose",
                        "pack": "core",
                    }
                }
            }
            source_map = BakeResult()
            source_map.record("_workflows/new-name.md", "core")

            entries, unresolved, _meta = classify_update(
                manifest=manifest,
                layout=LAYOUT,
                baseline_dir=baseline,
                vault_dir=vault,
                staged_dir=staged,
                source_map=source_map,
                work_dir=work,
            )

            self.assertEqual(len(unresolved), 1)
            entry = unresolved[0]
            self.assertEqual(entry["disposition"], Disposition.RENAME_COLLISION)
            self.assertEqual(entry["path"], "_workflows/old-name.md")
            self.assertEqual(entry["new_path"], "_workflows/new-name.md")
            self.assertIsNotNone(entry["collision_path"])

    def test_user_deleted_still_shipped_file_is_distinct_unresolved(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            baseline = root / "baseline"
            vault = root / "vault"
            staged = root / "staged"
            work = root / "work"

            rel = ".claude/skills/deleted/SKILL.md"
            write(baseline / rel, "old\n")
            write(staged / rel, "new\n")

            manifest = {
                "files": {
                    rel: {
                        "sha256": sha256_file(baseline / rel),
                        "class": "framework",
                        "kind": "prose",
                        "pack": "core",
                    }
                }
            }
            source_map = BakeResult()
            source_map.record(rel, "core")

            entries, unresolved, _meta = classify_update(
                manifest=manifest,
                layout=LAYOUT,
                baseline_dir=baseline,
                vault_dir=vault,
                staged_dir=staged,
                source_map=source_map,
                work_dir=work,
            )

            self.assertEqual(len(unresolved), 1)
            self.assertEqual(entries[0]["disposition"], Disposition.DELETED_LOCAL)
            self.assertIsNone(entries[0]["current_path"])
            self.assertIsNotNone(entries[0]["baseline_path"])
            self.assertIsNotNone(entries[0]["staged_path"])


class TestDetectRenames(unittest.TestCase):
    def test_score_sorted_greedy_lets_best_global_pairs_win(self):
        # a.md matches new1.md at ~0.92 and new2.md at ~0.90; b.md matches
        # new1.md at ~0.99. Alphabetical greedy would let a.md claim new1.md
        # first; score-sorted greedy must give new1.md to b.md (best global
        # pair) and pair a.md with new2.md.
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            baseline = root / "baseline"
            staged = root / "staged"

            common = "0123456789\n" * 12  # short enough to dodge autojunk
            write(baseline / "a.md", common + "z" * 20)
            write(baseline / "b.md", common + "vv")
            write(staged / "new1.md", common + "qq")
            write(staged / "new2.md", common + "wwwwwwww")

            meta = {"class": "framework", "kind": "prose", "pack": "core"}
            candidates = detect_renames(
                removed_paths={"a.md", "b.md"},
                new_paths={"new1.md", "new2.md"},
                old_meta={"a.md": dict(meta), "b.md": dict(meta)},
                new_meta={"new1.md": dict(meta), "new2.md": dict(meta)},
                baseline_dir=baseline,
                staged_dir=staged,
            )

            pairing = {item["old_path"]: item["new_path"] for item in candidates}
            self.assertEqual(pairing, {"b.md": "new1.md", "a.md": "new2.md"})
            scores = {item["old_path"]: item["similarity"] for item in candidates}
            self.assertGreater(scores["b.md"], scores["a.md"])
            # Best pair is emitted first (score-sorted).
            self.assertEqual(candidates[0]["old_path"], "b.md")


class TestThreeWayMerge(unittest.TestCase):
    def test_clean_and_conflicting(self):
        import tempfile, pathlib
        from memex_update import three_way_merge
        with tempfile.TemporaryDirectory() as tmp:
            d = pathlib.Path(tmp)
            (d / "base").write_text("a\nb\nc\n")
            (d / "current").write_text("a\nb LOCAL\nc\n")
            (d / "staged").write_text("a\nb\nc\nENGINE\n")
            merged = three_way_merge(d / "current", d / "base", d / "staged")
            self.assertIn("b LOCAL", merged)
            self.assertIn("ENGINE", merged)
            (d / "staged2").write_text("a\nb ENGINE\nc\n")
            self.assertIsNone(three_way_merge(d / "current", d / "base", d / "staged2"))


class TestNewTokenDetection(unittest.TestCase):
    def test_noninteractive_new_tokens_use_existing_defaults(self):
        placeholders = {
            "placeholders": [
                {"token": "OWNER_NAME", "prompt": "Name", "example": "Jane"},
                {"token": "QUARTZ_PORT", "prompt": "Port", "example": "8181"},
                {"token": "NEW_OPTIONAL", "prompt": "New", "example": "example"},
            ]
        }
        answers, added = fill_new_answers(
            placeholders,
            {"OWNER_NAME": "A"},
            interactive=False,
        )
        self.assertEqual(added, ["QUARTZ_PORT", "NEW_OPTIONAL"])
        self.assertEqual(answers["QUARTZ_PORT"], "8181")
        self.assertEqual(answers["NEW_OPTIONAL"], "")

    def test_interactive_blank_new_optional_token_is_allowed(self):
        placeholders = {
            "placeholders": [
                {"token": "OWNER_SENDING_ACCOUNTS", "prompt": "Other sending accounts (or blank)", "example": "a@b.com"},
            ]
        }
        with mock.patch("builtins.input", return_value=""):
            answers, added = fill_new_answers(placeholders, {}, interactive=True)
        self.assertEqual(added, ["OWNER_SENDING_ACCOUNTS"])
        self.assertEqual(answers["OWNER_SENDING_ACCOUNTS"], "")

    def test_interactive_blank_new_required_non_port_token_refuses(self):
        placeholders = {
            "placeholders": [
                {"token": "NEW_REQUIRED", "prompt": "Required", "example": "example"},
            ]
        }
        with mock.patch("builtins.input", return_value=""):
            with self.assertRaisesRegex(RuntimeError, "NEW_REQUIRED"):
                fill_new_answers(placeholders, {}, interactive=True)

    def test_missing_required_tokens_skips_optional_blanks(self):
        placeholders = {
            "placeholders": [
                {"token": "OWNER_SENDING_ACCOUNTS", "prompt": "Other sending accounts (or blank)", "example": "a@b.com"},
                {"token": "NEW_REQUIRED", "prompt": "Required", "example": "example"},
                {"token": "QUARTZ_PORT", "prompt": "Port", "example": "8181"},
            ]
        }
        self.assertEqual(
            missing_required_tokens(placeholders, ["OWNER_SENDING_ACCOUNTS", "NEW_REQUIRED", "QUARTZ_PORT"]),
            ["NEW_REQUIRED"],
        )


class TestSafeRelPath(unittest.TestCase):
    def test_rejects_absolute_and_parent_and_drive(self):
        from memex_update import assert_safe_rel_path
        for bad in ("/etc/passwd", "../escape.md", "a/../../b", "~root/x", "C:/x"):
            with self.assertRaises(RuntimeError):
                assert_safe_rel_path(bad, "test")
        assert_safe_rel_path("Atlas/People/X.md", "test")  # no raise


class TestValidatePlanPaths(unittest.TestCase):
    def test_non_dict_entries_raise(self):
        from memex_update import validate_plan_paths
        for bad in (["not-a-dict"], [None], [["path"]], [{"path": "ok.md"}, 7]):
            with self.assertRaises(RuntimeError):
                validate_plan_paths({"entries": bad})
        validate_plan_paths({"entries": [{"path": "Atlas/X.md"}]})  # no raise


class TestParseSetValues(unittest.TestCase):
    def test_malformed_item_raises(self):
        from memex_update import parse_set_values
        with self.assertRaises(RuntimeError):
            parse_set_values(["OWNER_TIMEZONE"])
        self.assertEqual(parse_set_values(["A=b=c"]), {"A": "b=c"})


class TestPlanResolution(unittest.TestCase):
    def test_unresolved_plan_entries_ignore_resolved_items(self):
        plan = {
            "entries": [
                {"disposition": Disposition.EDITED, "path": "a.md"},
                {"disposition": Disposition.COLLISION, "path": "b.md", "resolved": True},
                {"disposition": Disposition.NEW, "path": "c.md"},
            ]
        }
        self.assertEqual(
            unresolved_plan_entries(plan),
            [{"disposition": Disposition.EDITED, "path": "a.md"}],
        )

    def test_plan_paths_include_resolution_auxiliary_paths(self):
        plan = {
            "entries": [
                {
                    "disposition": Disposition.REMOVED_UPSTREAM_EDITED,
                    "path": ".claude/skills/old/SKILL.md",
                    "resolved": True,
                    "extra_paths": ["_archive/.claude/skills/old/SKILL.md"],
                },
                {
                    "disposition": Disposition.COLLISION,
                    "path": "scripts/tool.py",
                    "resolved": True,
                    "aside_path": "scripts/tool.local.py",
                },
            ]
        }
        paths = plan_update_paths(plan)
        self.assertIn("_archive/.claude/skills/old/SKILL.md", paths)
        self.assertIn("scripts/tool.local.py", paths)
        self.assertIn(".claude/skills/old/SKILL.md", paths)
        self.assertIn("scripts/tool.py", paths)


if __name__ == "__main__":
    unittest.main()
