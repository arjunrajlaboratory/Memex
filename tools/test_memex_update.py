import pathlib
import tempfile
import unittest
from unittest import mock

from memex_bake import BakeResult, sha256_file
from memex_update import (
    Disposition,
    apply_safe_operations,
    classify_update,
    detect_renames,
    fill_new_answers,
    migrate_sources_config_text,
    missing_required_tokens,
    plan_update_paths,
    strip_work_heavy,
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


class TestSourcesConfigMigration(unittest.TestCase):
    OLD_CONFIG = """---
type: config
scope: sources
streams:
  email: { enabled: true, mcp: custom_Mail }
  slack: { enabled: false, mcp: custom_Slack }
  calendar: { enabled: true, mcp: custom_Calendar, mode: minimal }
custom_setting: keep-me
---

# User-edited sources prose
"""
    STAGED_CONFIG = """---
type: config
scope: sources
streams:
  email: { enabled: true, mcp: claude_ai_Gmail }
  slack: { enabled: true, mcp: claude_ai_Slack }
  calendar: { enabled: false, mcp: claude_ai_Google_Calendar, mode: minimal }
  notion: { enabled: true, mcp: claude_ai_Notion }
  jira: { enabled: false, mcp: claude_ai_Atlassian }
---
"""

    def test_adds_only_missing_streams_as_disabled_and_is_idempotent(self):
        migrated, added = migrate_sources_config_text(self.OLD_CONFIG, self.STAGED_CONFIG)
        self.assertEqual(added, ["notion", "jira"])
        self.assertIn("  email: { enabled: true, mcp: custom_Mail }", migrated)
        self.assertIn("  calendar: { enabled: true, mcp: custom_Calendar, mode: minimal }", migrated)
        self.assertIn("  notion: { enabled: false, mcp: claude_ai_Notion }", migrated)
        self.assertIn("  jira: { enabled: false, mcp: claude_ai_Atlassian }", migrated)
        self.assertLess(migrated.index("  jira:"), migrated.index("custom_setting:"))
        self.assertTrue(migrated.endswith("# User-edited sources prose\n"))

        second_pass, second_added = migrate_sources_config_text(migrated, self.STAGED_CONFIG)
        self.assertEqual(second_pass, migrated)
        self.assertEqual(second_added, [])

    def test_declines_nonstandard_seed_instead_of_guessing(self):
        configs = {
            "no frontmatter": "# Sources\n\nUser-owned prose without frontmatter.\n",
            "sequence": "---\nstreams:\n  - email\n  - slack\n---\n",
            "block mapping": (
                "---\nstreams:\n  email:\n    enabled: true\n    mcp: custom_Mail\n---\n"
            ),
            "malformed inline mapping": (
                "---\nstreams:\n  email: { enabled: true } trailing text\n---\n"
            ),
            "duplicate comma": (
                "---\nstreams:\n  email: { enabled: true,, mcp: mail }\n---\n"
            ),
            "unmatched flow bracket": (
                "---\nstreams:\n  email: { enabled: [true, mcp: mail }\n---\n"
            ),
            "unterminated double quote": (
                '---\nstreams:\n  email: { enabled: true, mcp: "mail }\n---\n'
            ),
            "unterminated single quote": (
                "---\nstreams:\n  email: { enabled: true, mcp: 'mail }\n---\n"
            ),
            "duplicate inner key": (
                "---\nstreams:\n  email: { enabled: true, enabled: false }\n---\n"
            ),
            "inconsistent indentation": (
                "---\nstreams:\n  email: { enabled: true, mcp: custom_Mail }\n"
                "   slack: { enabled: true, mcp: custom_Slack }\n---\n"
            ),
            "duplicate key": (
                "---\nstreams:\n  email: { enabled: true, mcp: first }\n"
                "  email: { enabled: false, mcp: second }\n---\n"
            ),
            "duplicate top-level streams mapping": (
                "---\nstreams:\n  email: { enabled: true, mcp: custom_Mail }\n"
                "streams:\n  slack: { enabled: true, mcp: custom_Slack }\n---\n"
            ),
            "tab indentation": (
                "---\nstreams:\n\temail: { enabled: true, mcp: custom_Mail }\n---\n"
            ),
        }
        for name, current in configs.items():
            with self.subTest(shape=name):
                self.assertEqual(
                    migrate_sources_config_text(current, self.STAGED_CONFIG),
                    (current, []),
                )

    def test_accepts_valid_quoted_inline_scalars(self):
        current = (
            "---\nstreams:\n"
            '  email: { enabled: true, mcp: "custom, Mail" }\n'
            "  slack: { enabled: false, mcp: 'team''s Slack' }\n"
            "---\n"
        )
        migrated, added = migrate_sources_config_text(current, self.STAGED_CONFIG)
        self.assertEqual(added, ["notion", "jira"])
        self.assertIn('mcp: "custom, Mail"', migrated)
        self.assertIn("mcp: 'team''s Slack'", migrated)

    def test_preserves_a_consistent_nondefault_mapping_indent(self):
        current = (
            "---\nstreams:\n"
            "    email: { enabled: true, mcp: custom_Mail }\n"
            "    slack: { enabled: false, mcp: custom_Slack }\n"
            "---\n"
        )
        migrated, added = migrate_sources_config_text(current, self.STAGED_CONFIG)
        self.assertEqual(added, ["notion", "jira"])
        self.assertIn("\n    notion: { enabled: false", migrated)
        self.assertIn("\n    jira: { enabled: false", migrated)
        self.assertNotIn("\n  notion:", migrated)

    def test_classification_and_apply_preserve_original_in_undo(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            baseline = root / "baseline"
            vault = root / "vault"
            staged = root / "staged"
            work = root / "work"
            rel = "_config/sources.md"
            write(vault / rel, self.OLD_CONFIG)
            (vault / rel).chmod(0o640)
            write(staged / rel, self.STAGED_CONFIG)
            source_map = BakeResult()
            source_map.record(rel, None)
            layout = {
                "framework": {"prose": [], "code": []},
                "hybrid": [],
                "seed": [rel],
                "data": [],
            }

            entries, unresolved, _meta = classify_update(
                manifest={"files": {}},
                layout=layout,
                baseline_dir=baseline,
                vault_dir=vault,
                staged_dir=staged,
                source_map=source_map,
                work_dir=work,
            )

            self.assertEqual(unresolved, [])
            self.assertEqual(len(entries), 1)
            entry = entries[0]
            self.assertEqual(entry["disposition"], Disposition.SEED_PRESENT)
            self.assertEqual(entry["resolution"], "auto-migrated")
            self.assertEqual(entry["added_streams"], ["notion", "jira"])

            apply_safe_operations(
                entries,
                vault_dir=vault,
                staged_dir=staged,
                work_dir=work,
                prune_removed=False,
            )
            self.assertTrue(entry["applied"])
            self.assertEqual((work / "undo" / rel).read_text(), self.OLD_CONFIG)
            installed = (vault / rel).read_text()
            self.assertIn("notion: { enabled: false", installed)
            self.assertIn("jira: { enabled: false", installed)
            self.assertEqual((vault / rel).stat().st_mode & 0o777, 0o640)

    def test_classification_never_follows_a_sources_config_symlink(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            outside = root / "outside.md"
            vault = root / "vault"
            staged = root / "staged"
            rel = "_config/sources.md"
            write(outside, self.OLD_CONFIG)
            (vault / rel).parent.mkdir(parents=True)
            (vault / rel).symlink_to(outside)
            write(staged / rel, self.STAGED_CONFIG)
            source_map = BakeResult()
            source_map.record(rel, None)
            layout = {
                "framework": {"prose": [], "code": []},
                "hybrid": [],
                "seed": [rel],
                "data": [],
            }

            entries, unresolved, _meta = classify_update(
                manifest={"files": {}},
                layout=layout,
                baseline_dir=root / "baseline",
                vault_dir=vault,
                staged_dir=staged,
                source_map=source_map,
                work_dir=root / "work",
            )

            self.assertEqual(unresolved, [])
            self.assertEqual(entries[0]["disposition"], Disposition.SEED_PRESENT)
            self.assertNotIn("resolution", entries[0])
            self.assertEqual(outside.read_text(), self.OLD_CONFIG)


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

    def test_declines_undecodable_bytes(self):
        # A clean merge whose result contains invalid UTF-8 must decline
        # (return None) rather than crash or corrupt content on decode.
        import tempfile, pathlib
        from memex_update import three_way_merge
        with tempfile.TemporaryDirectory() as tmp:
            d = pathlib.Path(tmp)
            (d / "base").write_bytes(b"a\nb\nc\n")
            (d / "current").write_bytes(b"a\nb\nc\n")
            (d / "staged").write_bytes(b"a\nb\nc\n\xff\xfe latin-1 garbage\n")
            self.assertIsNone(three_way_merge(d / "current", d / "base", d / "staged"))


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

    def test_plan_paths_include_auto_migrated_seed_before_applied_is_persisted(self):
        plan = {
            "entries": [
                {
                    "disposition": Disposition.SEED_PRESENT,
                    "path": "_config/sources.md",
                    "resolution": "auto-migrated",
                    "applied": False,
                }
            ]
        }
        self.assertIn("_config/sources.md", plan_update_paths(plan))

    def test_completed_work_cleanup_removes_migrated_tree_but_keeps_undo(self):
        with tempfile.TemporaryDirectory() as tmp:
            work = pathlib.Path(tmp)
            for name in ("staged", "versions", "merged", "migrated", "undo"):
                write(work / name / "sentinel", name)

            strip_work_heavy(work)

            for name in ("staged", "versions", "merged", "migrated"):
                self.assertFalse((work / name).exists(), name)
            self.assertTrue((work / "undo" / "sentinel").exists())


if __name__ == "__main__":
    unittest.main()
