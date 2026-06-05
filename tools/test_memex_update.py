import pathlib
import tempfile
import unittest

from memex_bake import BakeResult, sha256_file
from memex_update import classify_update, fill_new_answers, unresolved_plan_entries


LAYOUT = {
    "framework": {
        "prose": [".claude/skills/**", "_workflows/**"],
        "code": ["scripts/**"],
    },
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

            write(staged / "_config/overrides.md", "# Overrides\n")

            manifest_files = {}
            for rel in [
                ".claude/skills/untouched/SKILL.md",
                ".claude/skills/edited/SKILL.md",
                ".claude/skills/removed/SKILL.md",
                "_workflows/old-name.md",
            ]:
                kind = "prose"
                manifest_files[rel] = {
                    "sha256": sha256_file(baseline / rel),
                    "class": "framework",
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

            self.assertEqual(by_path[".claude/skills/untouched/SKILL.md"]["disposition"], "replace-untouched")
            self.assertEqual(by_path[".claude/skills/edited/SKILL.md"]["disposition"], "edited")
            self.assertEqual(by_path[".claude/skills/new/SKILL.md"]["disposition"], "new")
            self.assertEqual(by_path[".claude/skills/collision/SKILL.md"]["disposition"], "collision")
            self.assertEqual(by_path[".claude/skills/removed/SKILL.md"]["disposition"], "removed-upstream")
            self.assertIn("rename-candidate", dispositions)
            self.assertEqual(by_path["_config/overrides.md"]["disposition"], "seed-if-absent")
            self.assertEqual(len(unresolved), 3)

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
            self.assertEqual(entry["disposition"], "rename-collision")
            self.assertEqual(entry["path"], "_workflows/old-name.md")
            self.assertEqual(entry["new_path"], "_workflows/new-name.md")
            self.assertIsNotNone(entry["collision_path"])


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


class TestPlanResolution(unittest.TestCase):
    def test_unresolved_plan_entries_ignore_resolved_items(self):
        plan = {
            "entries": [
                {"disposition": "edited", "path": "a.md"},
                {"disposition": "collision", "path": "b.md", "resolved": True},
                {"disposition": "new", "path": "c.md"},
            ]
        }
        self.assertEqual(
            unresolved_plan_entries(plan),
            [{"disposition": "edited", "path": "a.md"}],
        )


if __name__ == "__main__":
    unittest.main()
