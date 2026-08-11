import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def numbered_step(skill: str, number: int) -> str:
    """Return one numbered skill step without coupling tests to line numbers."""
    match = re.search(
        rf"(?ms)^{number}\. \*\*.*?(?=^{number + 1}\. \*\*|\Z)", skill
    )
    if match is None:
        raise AssertionError(f"step {number} not found")
    return match.group(0)


def frontmatter_keys(document: str) -> set[str]:
    """Return field names from the first YAML frontmatter example or document."""
    match = re.search(r"(?ms)^---\n(.*?)^---$", document)
    if match is None:
        raise AssertionError("YAML frontmatter not found")
    return set(re.findall(r"(?m)^([a-z][a-z0-9_]*):", match.group(1)))


class TestCaptureCommsCoverageContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.skill = (
            ROOT / "packs/core/skills/capture-comms/SKILL.md"
        ).read_text()

    def test_digest_has_explicit_coverage_section(self):
        output_contract = self.skill.split("## Steps", 1)[0]
        self.assertIn("## Coverage", output_contract)
        self.assertRegex(output_contract, r"(?i)complete|coverage gap")

    def test_mail_scan_covers_every_page_or_daily_slice(self):
        mail_step = numbered_step(self.skill, 3)
        self.assertRegex(mail_step, r"(?i)calendar[- ]day|per[- ]day|daily slices?")
        self.assertRegex(mail_step, r"(?i)paginate|pagination|cursor")
        self.assertRegex(mail_step, r"(?i)first page.*(?:not|never).*complete|never.*first page")

    def test_mail_threads_are_deduplicated_across_the_whole_scan(self):
        mail_step = numbered_step(self.skill, 3)
        self.assertRegex(
            mail_step,
            r"(?is)threadId.{0,240}all (?:calendar-day )?slices.{0,240}query variants",
        )
        self.assertRegex(mail_step, r"(?is)read.{0,100}classif(?:y|ied).{0,100}once")
        self.assertRegex(mail_step, r"(?is)preserv(?:e|ing).{0,120}(?:direction|provenance)")

    def test_incomplete_provider_scan_must_record_the_gap(self):
        write_step = numbered_step(self.skill, 6)
        self.assertRegex(write_step, r"(?i)every\s+enabled (?:source|stream)")
        self.assertRegex(write_step, r"(?i)coverage gap")
        self.assertRegex(write_step, r"(?i)unscanned|un-scanned")

    def test_no_silent_caps_rule_applies_to_future_provider_scans(self):
        hard_rules = self.skill.split("## Output shape", 1)[0]
        self.assertRegex(hard_rules, r"(?i)no silent (?:caps|truncation)")
        self.assertIn("Notion", hard_rules)
        self.assertIn("Jira", hard_rules)


class TestCommsCoverageConsumers(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        core = ROOT / "packs/core"
        cls.reconcile = (core / "skills/reconcile-from-comms/SKILL.md").read_text()
        cls.briefing = (core / "skills/daily-briefing/SKILL.md").read_text()
        cls.briefing_schema = (core / "schemas/briefing.md").read_text()
        cls.briefing_template = (core / "templates/briefing.md").read_text()
        cls.briefing_prompt = (core / "prompts/daily-briefing.md").read_text()
        cls.briefing_workflow = (core / "workflows/daily-briefing.md").read_text()

    def test_reconcile_treats_partial_capture_as_inconclusive(self):
        self.assertIn("## Coverage", self.reconcile)
        self.assertRegex(
            self.reconcile,
            r"(?is)coverage gap.*(?:not|never).*negative evidence",
        )
        briefing_mode = self.reconcile.split("## When invoked by daily-briefing", 1)[1]
        self.assertRegex(briefing_mode, r"(?i)coverage gaps?.*briefing")

    def test_briefing_persists_and_surfaces_partial_coverage(self):
        for artifact in (
            self.briefing,
            self.briefing_schema,
            self.briefing_prompt,
        ):
            self.assertIn("comms_coverage:", artifact)

        self.assertRegex(
            self.briefing,
            r"(?is)coverage gap.*## 0\. State confirmation needed",
        )
        self.assertRegex(
            self.briefing,
            r"(?is)chat report-back.*coverage (?:gap|is partial)",
        )
        self.assertRegex(
            self.briefing_workflow,
            r"(?is)## Coverage.*partial.*inconclusive",
        )

    def test_installed_briefing_template_matches_schema_frontmatter(self):
        schema_fields = frontmatter_keys(self.briefing_schema)
        template_fields = frontmatter_keys(self.briefing_template)
        self.assertEqual(set(), schema_fields - template_fields)

    def test_disabled_source_digests_are_ignored_everywhere(self):
        consumers = {
            "capture handoff": (
                ROOT / "packs/core/skills/capture-comms/SKILL.md"
            ).read_text(),
            "reconcile": self.reconcile,
            "briefing": self.briefing,
            "briefing prompt": self.briefing_prompt,
            "briefing workflow": self.briefing_workflow,
        }
        disabled_filter = r"(?is)(?:ignore|exclude)[^.\n]{0,240}(?:disabled|not enabled)"
        for name, artifact in consumers.items():
            with self.subTest(consumer=name):
                self.assertRegex(artifact, disabled_filter)

        # Filtering applies to the whole stale digest, not coverage alone: old
        # action items from a disabled source must not reconcile either.
        self.assertRegex(
            self.reconcile,
            r"(?is)disabled.{0,300}## Coverage.{0,160}## Action items|"
            r"## Coverage.{0,160}## Action items.{0,300}disabled",
        )

    def test_calendar_only_runs_skip_comms_coverage(self):
        artifacts = {
            "briefing": self.briefing,
            "schema": self.briefing_schema,
            "prompt": self.briefing_prompt,
            "workflow": self.briefing_workflow,
        }
        skipped_without_capture = (
            r"(?is)(?:no|zero) (?:enabled )?capture streams?.{0,240}"
            r"comms_coverage.{0,80}skipped"
        )
        includes_actual_capture = (
            r"(?is)includes_comms.{0,180}(?:at least one|any) capture stream"
        )
        for name, artifact in artifacts.items():
            with self.subTest(artifact=name):
                self.assertRegex(artifact, skipped_without_capture)
                self.assertRegex(artifact, includes_actual_capture)

        self.assertRegex(
            self.reconcile,
            r"(?is)no (?:enabled )?capture streams?.{0,240}"
            r"(?:skip|do not require).{0,160}(?:digest|folder).{0,240}calendar",
        )


if __name__ == "__main__":
    unittest.main()
