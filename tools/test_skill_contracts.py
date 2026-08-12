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


def numbered_list_step(document: str, number: int, indent: str = "") -> str:
    """Return one plain numbered-list step, preserving its continuation lines."""
    prefix = re.escape(indent)
    match = re.search(
        rf"(?ms)^{prefix}{number}\. .*?(?=^{prefix}{number + 1}\. |\Z)",
        document,
    )
    if match is None:
        raise AssertionError(f"list step {number} not found")
    return match.group(0)


def markdown_section(document: str, heading: str, next_heading=None) -> str:
    """Return a Markdown section by exact heading text."""
    end = rf"(?=^{re.escape(next_heading)}$)" if next_heading else r"\Z"
    match = re.search(rf"(?ms)^{re.escape(heading)}$.*?{end}", document)
    if match is None:
        raise AssertionError(f"section {heading!r} not found")
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
        write_step = numbered_step(self.skill, 8)
        self.assertRegex(write_step, r"(?i)every\s+enabled (?:source|stream)")
        self.assertRegex(write_step, r"(?i)coverage gap")
        self.assertRegex(write_step, r"(?i)unscanned|un-scanned")

    def test_no_silent_caps_rule_applies_to_future_provider_scans(self):
        hard_rules = self.skill.split("## Output shape", 1)[0]
        self.assertRegex(hard_rules, r"(?i)no silent (?:caps|truncation)")
        self.assertIn("Notion", hard_rules)
        self.assertIn("Jira", hard_rules)

    def test_jira_scan_resolves_identity_and_site_before_searching(self):
        jira_step = numbered_step(self.skill, 5)
        identity_pos = jira_step.index("atlassianUserInfo")
        site_pos = jira_step.index("getAccessibleAtlassianResources")
        search_pos = jira_step.index("searchJiraIssuesUsingJql")
        self.assertLess(identity_pos, search_pos)
        self.assertLess(site_pos, search_pos)
        self.assertIn("cloudId", jira_step)

    def test_jira_scan_is_bounded_paginated_and_changelog_aware(self):
        jira_step = numbered_step(self.skill, 5)
        self.assertRegex(jira_step, r"(?is)updated >=.+updated <")
        jql = re.search(r"(?s)```text\n(.*?)\n\s*```", jira_step)
        self.assertIsNotNone(jql)
        self.assertNotRegex(
            jql.group(1),
            r"(?i)assignee|reporter|watcher|participant|mention|currentUser",
        )
        self.assertRegex(jira_step, r"(?is)do not pre-filter discovery.{0,220}unrelated issue")
        self.assertRegex(jira_step, r"(?i)calendar-day\s+slices")
        self.assertIn("nextPageToken", jira_step)
        self.assertRegex(jira_step, r"(?is)first result page.{0,40}never complete")
        self.assertRegex(jira_step, r"(?i)for every issue in the global map")
        self.assertRegex(jira_step, r"(?i)comments and changelog|changelog/history")
        self.assertRegex(jira_step, r"(?i)author account id|actor account id")
        self.assertRegex(
            jira_step,
            r"(?is)(?:comments or changelog/history).{0,260}(?:exhaustion|coverage gap)",
        )

    def test_jira_scan_captures_mentions_from_editable_fields(self):
        jira_step = numbered_step(self.skill, 5)
        self.assertRegex(
            jira_step,
            r"(?is)(?:description|editable text/rich-text fields?).{0,300}mention",
        )
        self.assertRegex(
            jira_step,
            r"(?is)changelog/history.{0,500}field changes?.{0,300}mention",
        )
        self.assertRegex(jira_step, r"(?is)mention.{0,180}stable account id")
        self.assertRegex(
            jira_step,
            r"(?is)created in the window.{0,220}creator\.accountId.{0,220}intervening field rewrite",
        )
        self.assertRegex(
            jira_step,
            r"(?is)(?:field bodies|field values).{0,260}coverage gap",
        )
        completeness = numbered_step(self.skill, 8)
        self.assertRegex(completeness, r"(?i)mention-bearing field changes")

    def test_jira_scan_is_read_only_and_writes_standard_digest(self):
        jira_step = numbered_step(self.skill, 5)
        self.assertIn("Inbox/comms/<date>/jira.md", jira_step)
        self.assertIn("↳ thread:", jira_step)
        for tool in (
            "createJiraIssue",
            "editJiraIssue",
            "transitionJiraIssue",
            "addCommentToJiraIssue",
        ):
            self.assertRegex(jira_step, rf"(?is)never call.{{0,180}}{tool}")

    def test_notion_scan_resolves_identity_before_searching(self):
        notion_step = numbered_step(self.skill, 6)
        identity_pos = notion_step.index("notion-get-users")
        search_pos = notion_step.index("notion-search")
        self.assertLess(identity_pos, search_pos)
        self.assertRegex(notion_step, r"(?i)stable Notion user id|actor-classification")
        self.assertRegex(notion_step, r"(?is)do not guess.{0,160}partial")

    def test_notion_scan_exhausts_pages_and_comment_threads(self):
        notion_step = numbered_step(self.skill, 6)
        self.assertRegex(notion_step, r"(?i)calendar-day slices")
        self.assertRegex(notion_step, r"(?i)next_cursor|has_more")
        self.assertRegex(
            notion_step,
            r"(?is)never.{0,30}first result page.{0,40}complete coverage|"
            r"first result page.{0,40}(?:not|never).{0,30}complete",
        )
        self.assertIn("notion-fetch", notion_step)
        self.assertIn("notion-get-comments", notion_step)
        self.assertRegex(notion_step, r"(?is)paginate comments.{0,40}exhaustion")
        self.assertRegex(
            notion_step,
            r"(?is)comment-only activity independently.{0,320}last_edited_time",
        )
        self.assertRegex(
            notion_step,
            r"(?is)otherwise write `notion\.md` as partial.{0,300}coverage\s+gap",
        )
        self.assertRegex(
            notion_step,
            r"(?is)comment-only activity.{0,180}undiscoverable for the full window",
        )

    def test_notion_scan_classifies_actors_privately_and_read_only(self):
        notion_step = numbered_step(self.skill, 6)
        self.assertIn("Inbox/comms/<date>/notion.md", notion_step)
        self.assertIn("↳ thread:", notion_step)
        self.assertRegex(notion_step, r"(?is)open-loop signals:.*unresolved comment")
        self.assertRegex(notion_step, r"(?i)owner's own reply or resolution")
        self.assertRegex(notion_step, r"(?i)summarize one level up")
        self.assertRegex(notion_step, r"(?i)never paste page or comment bodies")
        write_guard = notion_step.split("Never call", 1)[1]
        for tool in (
            "notion-create-*",
            "notion-update-*",
            "notion-move-pages",
            "notion-duplicate-page",
            "notion-create-comment",
        ):
            self.assertIn(tool, write_guard)


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

    def test_reconcile_rechecks_jira_field_mentions(self):
        self.assertRegex(
            self.reconcile,
            r"(?is)Jira items.{0,700}(?:description|editable text/rich-text field).{0,260}mention",
        )
        self.assertRegex(
            self.reconcile,
            r"(?is)Jira items.{0,700}changelog/history.{0,300}(?:field-change|field change)",
        )
        self.assertRegex(
            self.reconcile,
            r"(?is)creation-time field-mention.{0,180}creator\.accountId.{0,180}intervening field rewrite",
        )

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


class TestInstalledCaptureContracts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        contracts = ROOT / "hardened/contract"
        cls.claude = (contracts / "CLAUDE.base.md").read_text()
        cls.agents = (contracts / "AGENTS.base.md").read_text()
        cls.claude_sources = markdown_section(
            cls.claude,
            "## Source streams + git mode (`_config/sources.md`)",
            "## Out of scope (v0.1)",
        )

    def test_both_installed_contracts_name_every_capture_stream(self):
        for name, contract in {"CLAUDE.md": self.claude, "AGENTS.md": self.agents}.items():
            with self.subTest(contract=name):
                for stream in ("email", "Slack", "Notion", "Jira"):
                    self.assertIn(stream, contract)
                self.assertRegex(contract, r"(?is)daily briefing.{0,700}Notion.{0,200}Jira")

    def test_installed_contracts_include_jira_field_mentions(self):
        for name, contract in {"CLAUDE.md": self.claude, "AGENTS.md": self.agents}.items():
            with self.subTest(contract=name):
                self.assertRegex(contract, r"(?is)Jira.{0,120}(?:field )?mentions")

    def test_claude_sources_contract_has_rows_defaults_and_upgrade_guidance(self):
        for row in ("email:", "slack:", "calendar:", "notion:", "jira:"):
            self.assertIn(row, self.claude_sources)
        self.assertRegex(self.claude_sources, r"(?i)notion:\s+\{ enabled: false")
        self.assertRegex(self.claude_sources, r"(?i)jira:\s+\{ enabled: false")
        self.assertRegex(
            self.claude_sources,
            r"(?is)memex-update.{0,100}appends missing Notion/Jira rows as disabled",
        )
        self.assertRegex(
            self.claude_sources,
            r"(?is)preserves every existing row.{0,80}user prose",
        )

    def test_installed_contracts_keep_notion_and_jira_read_only(self):
        for name, contract in {"CLAUDE.md": self.claude, "AGENTS.md": self.agents}.items():
            with self.subTest(contract=name):
                self.assertRegex(contract, r"(?is)(?:never|not do).{0,120}(?:edit|comment).{0,30}Notion")
                self.assertRegex(contract, r"(?is)(?:never|not do).{0,180}(?:create|edit|transition).{0,80}Jira")


class TestTrackerHistoryContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        core = ROOT / "packs/core"
        pi = ROOT / "packs/pi"
        skill = (core / "skills/run-trackers/SKILL.md").read_text()
        workflow = (core / "workflows/run-tracker.md").read_text()
        prompt = (core / "prompts/run-trackers.md").read_text()
        tracker_schema = (core / "schemas/tracker.md").read_text()
        cv_skill = (pi / "skills/cv-scan/SKILL.md").read_text()
        backport = (ROOT / "docs/BACKPORT.md").read_text()
        skill_history = re.search(
            r"(?ms)^### 2\.7 .*?(?=^### 2\.8 )",
            skill,
        )
        if skill_history is None:
            raise AssertionError("run-trackers history step not found")

        cls.run_surfaces = {
            "skill": skill_history.group(0),
            "workflow": numbered_list_step(workflow, 9),
            "prompt": numbered_list_step(prompt, 7),
            "schema": numbered_list_step(tracker_schema, 4, indent="  "),
            "cv-scan": numbered_list_step(cv_skill, 11),
        }
        cls.tracker_backport = markdown_section(
            backport, "# Backport checklist — 2026-08-11 tracker history contract"
        )
        cls.cv_output_contract = cv_skill.split("## Steps", 1)[0]
        cls.cv_digest_step = numbered_list_step(cv_skill, 10)

    def test_every_run_surface_requires_a_history_entry(self):
        for name, artifact in self.run_surfaces.items():
            with self.subTest(surface=name):
                self.assertIn("# History", artifact)
                self.assertRegex(artifact, r"(?i)(?:one bullet|one line) per run")
                self.assertRegex(artifact, r"(?i)(?:including|even)[^\n]*material.{0,12}false")
                self.assertRegex(artifact, r"(?is)# History.{0,120}digest")

    def test_history_is_distinct_from_latest_digest_state(self):
        for name, artifact in self.run_surfaces.items():
            with self.subTest(surface=name):
                self.assertRegex(
                    artifact,
                    r"(?is)last_digest.{0,160}state.{0,160}# History.{0,160}provenance",
                )

    def test_specialized_runner_allows_digest_and_history_outputs(self):
        self.assertIn("Tracker Digest", self.cv_output_contract)
        self.assertIn("# History", self.cv_output_contract)

    def test_specialized_runner_creates_the_canonical_digest(self):
        self.assertIn("_schemas/tracker_digest.md", self.cv_digest_step)
        self.assertRegex(self.cv_digest_step, r"(?i)including[^\n]*material.{0,12}false")

    def test_backport_lists_every_derive_managed_tracker_surface(self):
        expected = {
            "packs/core/skills/run-trackers/SKILL.md",
            "packs/core/workflows/run-tracker.md",
            "packs/core/prompts/run-trackers.md",
            "packs/core/schemas/tracker.md",
            "packs/pi/skills/cv-scan/SKILL.md",
        }
        for path in expected:
            with self.subTest(path=path):
                self.assertIn(f"`{path}`", self.tracker_backport)


if __name__ == "__main__":
    unittest.main()
