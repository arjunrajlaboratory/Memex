import json
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

    def test_jira_query_bounds_cover_timezone_and_precision_edges(self):
        jira_step = numbered_step(self.skill, 5)
        self.assertRegex(jira_step, r"(?is)Jira site(?:'s)? timezone.{0,300}(?:convert|query bounds)")
        self.assertRegex(
            jira_step,
            r"(?is)(?:timezone.{0,260}(?:unavailable|unknown)|precision.{0,260}(?:coarse|unknown))"
            r".{0,320}(?:widen|padding).{0,120}(?:two|2) (?:calendar )?days",
        )
        self.assertRegex(jira_step, r"(?is)(?:discard|filter).{0,160}exact slice")

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

    def test_jira_close_is_suppressed_after_a_later_reopen(self):
        jira_step = numbered_step(self.skill, 5)
        self.assertRegex(
            jira_step,
            r"(?is)(?:chronological|timestamp order).{0,260}(?:current status|current state)",
        )
        self.assertRegex(
            jira_step,
            r"(?is)(?:close candidate|terminal transition).{0,320}later transition"
            r".{0,260}(?:non-terminal|actionable|reopen).{0,220}(?:discard|suppress|supersed)",
        )
        self.assertRegex(
            jira_step,
            r"(?is)(?:current status|current state).{0,180}(?:terminal|Done/Resolved)",
        )

    def test_jira_open_state_candidates_must_still_be_current(self):
        jira_step = numbered_step(self.skill, 5)
        self.assertRegex(
            jira_step,
            r"(?is)assignment.{0,260}current assignee.{0,260}(?:later|subsequent)"
            r".{0,180}(?:away|different|reassign).{0,180}(?:discard|suppress|supersed)",
        )
        self.assertRegex(
            jira_step,
            r"(?is)actionable transition.{0,300}current\s+status.{0,260}later transition"
            r".{0,180}(?:discard|suppress|supersed)",
        )

    def test_jira_stateful_signal_matrix_covers_cross_field_outcomes(self):
        jira_step = numbered_step(self.skill, 5)
        self.assertRegex(jira_step, r"(?i)stateful-signal invariant")
        self.assertRegex(jira_step, r"(?is)fold.{0,160}through read time")
        expected_rows = (
            r"Assignment to owner\s*\|\s*Owner\s*\|\s*Actionable/non-terminal\s*\|\s*Open",
            r"Assignment to owner\s*\|\s*Owner\s*\|\s*Terminal\s*\|\s*Superseded",
            r"Assignment to owner\s*\|\s*Other or unassigned\s*\|\s*Any\s*\|\s*Superseded",
            r"Actionable transition for owner\s*\|[^\n]*\|\s*Actionable/non-terminal\s*\|\s*Open",
            r"Actionable transition for owner\s*\|[^\n]*\|\s*Terminal\s*\|\s*Superseded",
            r"Owner terminal transition\s*\|[^\n]*\|\s*Terminal, no later reversal\s*\|\s*Close",
            r"Owner terminal transition\s*\|[^\n]*\|\s*Actionable/reopened\s*\|\s*Superseded",
            r"Reopen then owner reclose\s*\|[^\n]*\|\s*Terminal\s*\|\s*Only the later owner close",
        )
        for row in expected_rows:
            self.assertRegex(jira_step, rf"(?i){row}")

    def test_jira_requests_are_suppressed_after_a_later_owner_reply(self):
        hard_rules = self.skill.split("## Output shape", 1)[0]
        self.assertRegex(hard_rules, r"(?i)communication-loop invariant")
        self.assertRegex(
            hard_rules,
            r"(?is)(?:thread|discussion).{0,220}through read\s+time.{0,420}"
            r"later substantive owner (?:response|reply).{0,220}supersed",
        )
        jira_step = numbered_step(self.skill, 5)
        self.assertRegex(
            jira_step,
            r"(?is)(?:comment|field-mention) request.{0,260}exhaustive comment"
            r".{0,260}later substantive owner (?:comment|reply).{0,220}supersed",
        )
        self.assertRegex(
            jira_step,
            r"(?is)after (?:the )?(?:capture )?window.{0,220}suppress"
            r".{0,180}(?:not|never).{0,120}emit",
        )

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
        self.assertRegex(notion_step, r"(?i)never paste page or\s+comment bodies")
        write_guard = notion_step.split("Never call", 1)[1]
        for tool in (
            "notion-create-*",
            "notion-update-*",
            "notion-move-pages",
            "notion-duplicate-page",
            "notion-create-comment",
        ):
            self.assertIn(tool, write_guard)

    def test_notion_missing_edit_or_resolution_history_is_partial(self):
        notion_step = numbered_step(self.skill, 6)
        self.assertRegex(
            notion_step,
            r"(?is)(?:page-edit|page edit) history.{0,240}(?:actors|actor ids?)"
            r".{0,160}timestamps.{0,420}coverage gap",
        )
        self.assertRegex(
            notion_step,
            r"(?is)resolution.{0,180}(?:actor|resolver).{0,180}timestamp"
            r".{0,260}coverage gap",
        )
        completeness = numbered_step(self.skill, 8)
        self.assertRegex(completeness, r"(?is)Notion.{0,500}(?:edit history|edit actors)")
        self.assertRegex(completeness, r"(?is)Notion.{0,600}(?:resolution provenance|resolver)")

    def test_notion_resolution_is_suppressed_after_a_reopen(self):
        notion_step = numbered_step(self.skill, 6)
        self.assertRegex(
            notion_step,
            r"(?is)resolution.{0,360}(?:currently|current state).{0,120}resolved",
        )
        self.assertRegex(
            notion_step,
            r"(?is)(?:reopen|later reversal).{0,220}(?:discard|suppress|supersed)",
        )


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
            r"(?is)Jira items.{0,1500}(?:description|editable text/rich-text field).{0,260}mention",
        )
        self.assertRegex(
            self.reconcile,
            r"(?is)Jira items.{0,1500}changelog/history.{0,300}(?:field-change|field change)",
        )
        self.assertRegex(
            self.reconcile,
            r"(?is)creation-time field-mention.{0,180}creator\.accountId.{0,180}intervening field rewrite",
        )

    def test_reconcile_rechecks_stateful_close_candidates(self):
        self.assertRegex(
            self.reconcile,
            r"(?is)Jira items.{0,1800}(?:current status|current state).{0,260}terminal"
            r".{0,320}(?:later transition|reopen)",
        )
        self.assertRegex(
            self.reconcile,
            r"(?is)Notion items.{0,1000}(?:currently|current state).{0,160}resolved"
            r".{0,320}(?:reopen|later reversal)",
        )

    def test_reconcile_rechecks_jira_open_state_candidates(self):
        self.assertRegex(
            self.reconcile,
            r"(?is)Jira items.{0,2000}assignment.{0,220}current\s+assignee"
            r".{0,260}(?:reassign|later\s+assignee change|moved away)",
        )
        self.assertRegex(
            self.reconcile,
            r"(?is)Jira items.{0,2400}actionable transition.{0,260}current\s+status"
            r".{0,260}later\s+transition",
        )

    def test_reconcile_applies_one_jira_stateful_signal_invariant(self):
        self.assertRegex(self.reconcile, r"(?i)Jira stateful-signal invariant")
        self.assertRegex(
            self.reconcile,
            r"(?is)fold.{0,180}through (?:the )?live read time.{0,600}"
            r"current assignee.{0,180}actionable/non-terminal",
        )
        self.assertRegex(
            self.reconcile,
            r"(?is)latest unsuperseded.{0,220}terminal.{0,180}owner",
        )
        self.assertRegex(
            self.reconcile,
            r"(?is)(?:contradicts|fails).{0,180}superseded.{0,220}do not propose",
        )

    def test_reconcile_rechecks_later_replies_before_proposing_open_work(self):
        self.assertRegex(self.reconcile, r"(?i)live communication-loop invariant")
        self.assertRegex(
            self.reconcile,
            r"(?is)(?:thread|discussion).{0,220}through (?:the )?live\s+read\s+time"
            r".{0,420}later substantive owner (?:response|reply).{0,220}superseded",
        )
        self.assertRegex(
            self.reconcile,
            r"(?is)For a Jira (?:comment request or field-mention request)"
            r".{0,360}later substantive owner (?:comment|reply).{0,260}do not\s+propose",
        )

    def test_reconcile_requires_notion_edit_and_resolution_provenance(self):
        self.assertRegex(
            self.reconcile,
            r"(?is)Notion items.{0,850}(?:page-edit|page edit) history.{0,220}actor"
            r".{0,160}timestamp",
        )
        self.assertRegex(
            self.reconcile,
            r"(?is)Notion items.{0,900}resolution.{0,180}(?:resolver|actor).{0,180}timestamp",
        )
        self.assertRegex(
            self.reconcile,
            r"(?is)Notion items.{0,1100}(?:history|provenance).{0,260}couldn't confirm",
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
        digest_schema = (core / "schemas/tracker_digest.md").read_text()
        digest_template = (core / "templates/tracker_digest.md").read_text()
        daily_skill = (core / "skills/daily-briefing/SKILL.md").read_text()
        daily_workflow = (core / "workflows/daily-briefing.md").read_text()
        daily_prompt = (core / "prompts/daily-briefing.md").read_text()
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
        cls.same_day_guards = {
            "skill": markdown_section(
                skill,
                "## Step 1 — Determine the run set",
                "## Step 2 — For each selected tracker, follow the recipe",
            ),
            "workflow": numbered_list_step(workflow, 1),
            "prompt": prompt.split("Determine which trackers to run:", 1)[1].split(
                "For each selected tracker", 1
            )[0],
            "cv-scan": numbered_list_step(cv_skill, 3),
        }
        cls.same_day_contracts = {
            "tracker schema": markdown_section(
                tracker_schema, "## Rules", "## Examples of good tracker subjects"
            ),
            "digest schema": markdown_section(digest_schema, "## Rules"),
        }
        cls.plan_recovery_surfaces = {
            **cls.same_day_guards,
            **cls.same_day_contracts,
        }
        cls.selection_surfaces = {
            "skill": cls.same_day_guards["skill"],
            "prompt": cls.same_day_guards["prompt"],
        }
        cls.source_output_surfaces = {
            "skill": markdown_section(
                skill,
                "### 2.5 Apply or propose `update_targets`",
                "### 2.6 Update the tracker frontmatter",
            ),
            "workflow": numbered_list_step(workflow, 7),
            "prompt": numbered_list_step(prompt, 5),
            "tracker schema": numbered_list_step(tracker_schema, 2, indent="  "),
            "digest schema": markdown_section(digest_schema, "## Rules"),
        }
        cls.direct_progress_surfaces = {
            "skill": cls.source_output_surfaces["skill"],
            "workflow": numbered_list_step(workflow, 7),
            "prompt": numbered_list_step(prompt, 5),
            "tracker schema": numbered_list_step(tracker_schema, 2, indent="  "),
            "digest schema": cls.source_output_surfaces["digest schema"],
            "cv-scan": numbered_list_step(cv_skill, 10),
        }
        cls.log_surfaces = {
            "skill": markdown_section(
                skill,
                "### 2.8 Per-tracker log line",
                "### 2.9 Finalize the digest",
            ),
            "workflow": numbered_list_step(workflow, 10),
            "prompt": numbered_list_step(prompt, 8),
            "cv-scan": numbered_list_step(cv_skill, 12),
        }
        cls.transaction_surfaces = {
            "skill": (
                skill,
                "### 2.4 Create or resume the partial digest",
                "### 2.5 Apply or propose `update_targets`",
                "### 2.8 Per-tracker log line",
                "### 2.9 Finalize the digest",
            ),
            "workflow": (
                workflow,
                "6. Before any side effect",
                "7. Process the direct-output prefix",
                "10. Append to `log.md`",
                "11. Verify the immutable planning snapshot",
            ),
            "prompt": (
                prompt,
                "4. Before any Source-note",
                "5. Apply or propose updates",
                "8. Append to log.md",
                "9. Verify the immutable planning snapshot",
            ),
            "tracker schema": (
                tracker_schema,
                "1. Before any other write",
                "2. Processes planned",
                "5. Appends the planned line",
                "6. After verifying `verified_outputs`",
            ),
            "cv-scan": (
                cv_skill,
                "9. **Create or resume the partial tracker digest.**",
                "10. **Append to the staging queue idempotently.**",
                "12. **Log.**",
                "13. **Finalize the digest.**",
            ),
        }
        cls.planning_surfaces = {
            "skill": markdown_section(
                skill,
                "### 2.4 Create or resume the partial digest",
                "### 2.5 Apply or propose `update_targets`",
            ),
            "workflow": numbered_list_step(workflow, 6),
            "prompt": numbered_list_step(prompt, 4),
            "tracker schema": numbered_list_step(tracker_schema, 1, indent="  "),
            "digest schema": markdown_section(digest_schema, "## Rules"),
            "cv-scan": numbered_list_step(cv_skill, 9),
        }
        cls.transaction_documents = {
            name: surface[0] for name, surface in cls.transaction_surfaces.items()
        }
        cls.digest_schema = digest_schema
        cls.digest_template = digest_template
        cls.briefing_digest_consumers = {
            "skill": numbered_list_step(daily_skill, 8),
            "workflow": markdown_section(
                daily_workflow, "## Inputs to read", "## Prompt template"
            ),
            "prompt": numbered_list_step(daily_prompt, 8),
        }
        cls.broken_run_surfaces = {
            "skill": markdown_section(
                skill, "## Step 5 — Broken-source guard", "## Step 6 — Wrap-up"
            ),
            "workflow": workflow,
            "prompt": prompt,
            "tracker schema": cls.same_day_contracts["tracker schema"],
            "digest schema": cls.same_day_contracts["digest schema"],
        }
        cls.cv_window_surfaces = {
            "recovery": numbered_list_step(cv_skill, 3),
            "plan": numbered_list_step(cv_skill, 9),
            "apply": numbered_list_step(cv_skill, 10),
            "finalize": numbered_list_step(cv_skill, 13),
        }
        cls.tracker_backport = markdown_section(
            backport,
            "# Backport checklist — 2026-08-11 tracker history contract",
            "# Backport checklist — 2026-08-11 tracker same-day run contract",
        )
        cls.same_day_backport = markdown_section(
            backport,
            "# Backport checklist — 2026-08-11 tracker same-day run contract",
        )
        cls.cv_output_contract = cv_skill.split("## Steps", 1)[0]
        cls.cv_digest_step = numbered_list_step(cv_skill, 9)

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

    def test_propose_only_history_names_the_required_review_task(self):
        history_step = self.run_surfaces["skill"]
        affirmative_task_creation = (
            r"(?is)auto_update_wiki.{0,80}\bfalse\b[)`]*\s*"
            r"(?:[,;:—-]\s*)?"
            r"(?:(?:create|write) a needs-review Task|"
            r"name the needs-review Task (?:that was )?created)"
        )
        self.assertRegex(history_step, affirmative_task_creation)

        contradictory_guidance = (
            "auto_update_wiki: false — do not create a needs-review Task",
            "auto_update_wiki: false — must not create a needs-review Task",
            "auto_update_wiki: false — no need to create a needs-review Task",
        )
        for guidance in contradictory_guidance:
            with self.subTest(guidance=guidance):
                self.assertNotRegex(guidance, affirmative_task_creation)

    def test_specialized_runner_allows_digest_and_history_outputs(self):
        self.assertIn("Tracker Digest", self.cv_output_contract)
        self.assertIn("# History", self.cv_output_contract)

    def test_specialized_runner_creates_the_canonical_digest(self):
        self.assertIn("_schemas/tracker_digest.md", self.cv_digest_step)
        self.assertRegex(self.cv_digest_step, r"(?i)including[^\n]*material.{0,12}false")

    def test_every_entry_point_blocks_completed_runs_and_resumes_incomplete_runs(self):
        for name, guard in self.same_day_guards.items():
            with self.subTest(surface=name):
                self.assertRegex(guard, r"(?is)today.{0,120}digest|digest.{0,120}today")
                self.assertIn("status: complete", guard)
                self.assertIn("last_digest", guard)
                self.assertIn("# History", guard)
                self.assertIn("log.md", guard)
                self.assertRegex(guard, r"(?i)agent:tracker")
                self.assertRegex(guard, r"(?is)planned.{0,80}output")
                self.assertRegex(guard, r"(?i)fresh")
                self.assertRegex(guard, r"(?i)(?:stop|skip|do not run)")
                self.assertRegex(guard, r"(?i)resume")
                self.assertRegex(guard, r"(?i)partial|failed|missing")
                self.assertRegex(guard, r"(?is)(?:explicit|force).{0,120}(?:not|never)")
                self.assertRegex(
                    guard,
                    r"(?is)(?:do\s+not|never).{0,80}overwrite.{0,80}(?:complete|completed)",
                )

    def test_recovery_detection_precedes_normal_eligibility_filtering(self):
        for name, selection in self.selection_surfaces.items():
            with self.subTest(surface=name):
                inspection = re.search(r"(?i)(?:inspect|resolve)[^\n]*digest", selection)
                eligibility = re.search(r"status: active", selection)
                self.assertIsNotNone(inspection)
                self.assertIsNotNone(eligibility)
                self.assertLess(inspection.start(), eligibility.start())
                self.assertRegex(
                    selection,
                    r"(?is)(?:before|prior to).{0,100}(?:status|eligibility).{0,40}(?:filter|filtering)",
                )
                self.assertRegex(
                    selection,
                    r"(?is)(?:advanced|already advanced).{0,100}next_check|"
                    r"next_check.{0,100}(?:advanced|already advanced)",
                )

    def test_recovery_reuses_complete_plans_and_fails_closed_without_them(self):
        for name, recovery in self.plan_recovery_surfaces.items():
            with self.subTest(surface=name):
                self.assertRegex(recovery, r"(?i)authoritative")
                self.assertIn("plan_status: complete", recovery)
                self.assertIn("plan_status: building", recovery)
                self.assertRegex(
                    recovery,
                    r"(?is)(?:do\s+not|skip).{0,100}(?:rerun|re-run|rescan|Steps 4–8)",
                )
                self.assertRegex(
                    recovery,
                    r"(?is)plan_status: building.{0,180}no\s+(?:downstream\s+)?(?:write|output|artifact)",
                )
                self.assertRegex(
                    recovery,
                    r"(?is)(?:plan_status.{0,80}missing|plan_status: building)"
                    r".{0,220}(?:write|output|reference).{0,180}manual",
                )
                self.assertRegex(
                    recovery,
                    r"(?is)(?:partial.{0,40}(?:or|\|).{0,40}failed|partial.{0,80}failed)"
                    r".{0,180}plan_status: complete",
                )
                self.assertRegex(
                    recovery,
                    r"(?is)(?:final.{0,80}status.{0,80}(?:missing|transition)|"
                    r"status.{0,40}complete.{0,80}(?:transition.{0,40}missing|write.{0,40}missing))",
                )
                self.assertRegex(
                    recovery,
                    r"(?is)(?:partial.{0,40}(?:or|\|).{0,40}failed|partial.{0,80}failed)"
                    r".{0,180}plan_status: building.{0,220}(?:empty.{0,120}progress mirror|"
                    r"progress mirror.{0,120}empty)",
                )
                self.assertRegex(
                    recovery,
                    r"(?is)incomplete\s+digest.{0,80}(?:no|without).{0,40}plan_status"
                    r".{0,600}manual",
                )

    def test_auto_placeholder_is_not_downstream_recovery_evidence(self):
        for name, recovery in self.plan_recovery_surfaces.items():
            with self.subTest(surface=name):
                self.assertIn("agent:auto", recovery)
                self.assertRegex(
                    recovery,
                    r"(?is)placeholder",
                )
                self.assertRegex(
                    recovery,
                    r"(?is)not downstream",
                )
                self.assertRegex(
                    recovery,
                    r"(?is)do(?:es)?\s+not\s+count",
                )
                self.assertRegex(
                    recovery,
                    r"(?is)non-placeholder.{0,100}still counts",
                )

    def test_legacy_completion_and_post_completion_drift_are_non_mutating(self):
        for name, recovery in self.plan_recovery_surfaces.items():
            with self.subTest(surface=name):
                self.assertRegex(recovery, r"(?i)legacy")
                self.assertIn("status: complete", recovery)
                self.assertRegex(recovery, r"(?is)(?:no.{0,12}plan_status|plan_status.{0,40}absent)")
                self.assertRegex(
                    recovery,
                    r"(?is)legacy.{0,300}skip.{0,80}(?:without|no) mutat",
                )
                self.assertRegex(recovery, r"(?i)drifted[- ]complete")
                self.assertRegex(
                    recovery,
                    r"(?is)(?:do\s+not|never).{0,80}(?:reapply|repair)",
                )
                self.assertRegex(
                    recovery,
                    r"(?is)drifted[- ]complete.{0,320}manual integrity|manual integrity.{0,320}drifted[- ]complete",
                )

    def test_every_runner_creates_partial_digest_before_side_effects_and_finalizes_last(
        self,
    ):
        for name, (
            document,
            partial,
            side_effect,
            log,
            finalize,
        ) in self.transaction_surfaces.items():
            with self.subTest(surface=name):
                positions = [
                    document.index(marker)
                    for marker in (partial, side_effect, log, finalize)
                ]
                self.assertEqual(sorted(positions), positions)
                partial_step = document[positions[0] : positions[1]]
                final_step = document[positions[3] :]
                self.assertIn("status: partial", partial_step)
                self.assertIn("plan_status: building", partial_step)
                self.assertIn("plan_status: complete", partial_step)
                self.assertLess(
                    partial_step.index("plan_status: building"),
                    partial_step.index("plan_status: complete"),
                )
                self.assertRegex(partial_step, r"(?i)before (?:any|creating|changing)")
                self.assertIn("status: complete", final_step)
                self.assertRegex(final_step, r"(?i)final write")
                self.assertRegex(final_step, r"(?i)log(?:\.md| line)")

    def test_every_runner_freezes_an_ordered_output_plan_before_side_effects(self):
        for name, plan in self.planning_surfaces.items():
            with self.subTest(surface=name):
                self.assertIn("planned_outputs", plan)
                self.assertIn("verified_outputs", plan)
                self.assertRegex(
                    plan,
                    r"(?is)(?:empty.{0,120}progress mirror|progress mirror.{0,120}empty)",
                )
                self.assertRegex(
                    plan,
                    r"(?is)(?:# What I changed.{0,120}empty|empty.{0,120}# What I changed)",
                )
                self.assertRegex(plan, r"(?i)descriptor")
                self.assertRegex(
                    plan,
                    r"(?is)planned_outputs.{0,320}(?:tracker.{0,100}History.{0,100}log|History.{0,100}log)",
                )

    def test_every_runner_uses_verified_outputs_as_an_ordered_prefix(self):
        for name, document in self.transaction_documents.items():
            with self.subTest(surface=name):
                self.assertRegex(
                    document,
                    r"(?is)planned_outputs.{0,500}immutable|immutable.{0,500}planned_outputs",
                )
                self.assertRegex(document, r"(?is)verified_outputs.{0,80}ordered prefix")
                self.assertRegex(
                    document,
                    r"(?is)(?:append|appends).{0,120}identical descriptor.{0,120}verified_outputs|"
                    r"verified_outputs.{0,120}(?:append|appends).{0,120}identical descriptor",
                )
                self.assertRegex(
                    document,
                    r"(?is)verified_outputs.{0,100}(?:exactly equals|exactly equal).{0,100}planned_outputs",
                )

    def test_direct_output_verification_marker_is_written_after_progress_mirrors(self):
        for name, direct_step in self.direct_progress_surfaces.items():
            with self.subTest(surface=name):
                self.assertRegex(
                    direct_step,
                    r"(?is)update.{0,180}(?:# What I changed|progress)"
                    r".{0,180}then.{0,100}append.{0,180}verified_outputs",
                )

    def test_recovery_verifies_outputs_and_reuses_pre_run_bookkeeping(self):
        for name, (document, *_markers) in self.transaction_surfaces.items():
            with self.subTest(surface=name):
                self.assertRegex(
                    document,
                    r"(?is)verify.{0,160}(?:instead of|rather than).{0,80}(?:repeat|duplicat)",
                )
                self.assertRegex(
                    document,
                    r"(?is)(?:pre[_ -]run.{0,160}miss_count|miss_count.{0,160}pre[_ -]run)",
                )
                self.assertRegex(
                    document,
                    r"(?is)miss_count.{0,320}(?:never.{0,60}increment|reuse.{0,80}instead)",
                )

    def test_incomplete_source_ingests_fail_closed_at_the_child_boundary(self):
        for name, source_contract in self.source_output_surfaces.items():
            with self.subTest(surface=name):
                self.assertRegex(
                    source_contract,
                    r"(?is)(?:Source[ -]note|primary note).{0,40}existence alone.{0,40}not\s+completion",
                )
                self.assertRegex(
                    source_contract,
                    r"(?i)canonical raw",
                )
                self.assertRegex(
                    source_contract,
                    r"(?is)(?:already.{0,80}completed plan|completed plan.{0,80}already|while.{0,40}plan_status: building)",
                )
                self.assertRegex(
                    source_contract,
                    r"(?is)never.{0,60}extend.{0,40}plan",
                )
                self.assertRegex(
                    source_contract,
                    r"(?is)(?:Source[\s-]+note.{0,40}fully populated|fully populated Source[\s-]+note)",
                )
                self.assertIn("agent:librarian", source_contract)
                self.assertIn("log.md", source_contract)
                self.assertRegex(
                    source_contract,
                    r"(?is)(?:do\s+not|never).{0,60}consume.{0,60}raw",
                )
                self.assertRegex(
                    source_contract,
                    r"(?is)(?:do\s+not|never).{0,100}(?:auto-resume|resume automatically)",
                )
                self.assertRegex(
                    source_contract,
                    r"(?is)(?:leave|remain).{0,80}(?:tracker |this )?digest.{0,40}(?:partial|failed)",
                )
                self.assertRegex(
                    source_contract,
                    r"(?is)surface.{0,80}manual.{0,60}(?:source-ingest|child-workflow) recovery",
                )

    def test_broken_searches_write_ahead_without_advancing_cadence_or_misses(self):
        for name, broken_contract in self.broken_run_surfaces.items():
            with self.subTest(surface=name):
                self.assertRegex(broken_contract, r"(?i)status:\s*broken")
                self.assertRegex(
                    broken_contract,
                    r"(?is)(?:partial digest.{0,100}first|after.{0,100}partial digest)",
                )
                self.assertRegex(
                    broken_contract,
                    r"(?is)preserv(?:e|ing).{0,100}next_check.{0,100}miss_count",
                )
                self.assertRegex(
                    broken_contract,
                    r"(?is)planned_next_check.{0,100}(?:equal|pre[_ -]run).{0,160}planned_miss_count"
                    r"|planned_miss_count.{0,100}(?:equal|pre[_ -]run).{0,160}planned_next_check",
                )
                self.assertRegex(
                    broken_contract,
                    r"(?is)broken.{0,240}(?:precedence|do not apply).{0,120}needs_review",
                )

    def test_cv_scan_plans_applies_and_verifies_last_scan_window(self):
        for name, surface in self.cv_window_surfaces.items():
            with self.subTest(surface=name):
                if name == "recovery":
                    self.assertRegex(surface, r"(?i)safe-to-re-plan.{0,160}scan window")
                    continue
                self.assertIn("Last scan window:", surface)
                self.assertRegex(surface, r"(?i)(?:exact|planned|verify)")

    def test_every_tracker_log_format_contains_the_required_digest_link(self):
        for name, log_step in self.log_surfaces.items():
            with self.subTest(surface=name):
                self.assertRegex(log_step, r"(?i)agent:tracker")
                self.assertRegex(
                    log_step,
                    r"\[\[(?:Tracker Digest - [^\]\n]+ - <today>|<digest note>)\]\]",
                )

    def test_digest_schema_and_template_start_partial(self):
        self.assertRegex(self.digest_schema, r"(?m)^status: partial\s+#")
        self.assertRegex(self.digest_template, r"(?m)^status: partial$")
        self.assertRegex(self.digest_schema, r"(?m)^plan_status: building\s+#")
        self.assertRegex(self.digest_template, r"(?m)^plan_status: building$")
        for field in (
            "pre_run_miss_count",
            "pre_run_next_check",
            "planned_miss_count",
            "planned_next_check",
            "planned_outputs",
            "verified_outputs",
        ):
            with self.subTest(field=field):
                self.assertRegex(self.digest_schema, rf"(?m)^{field}:")
                self.assertRegex(self.digest_template, rf"(?m)^{field}:")

    def test_briefing_consumers_surface_only_completed_material_digests(self):
        for name, consumer in self.briefing_digest_consumers.items():
            with self.subTest(surface=name):
                self.assertIn("material: true", consumer)
                self.assertIn("status: complete", consumer)
                self.assertRegex(consumer, r"(?i)(?:exclude|never surface).{0,80}partial")
                self.assertRegex(consumer, r"(?i)(?:exclude|never surface).{0,100}failed")

    def test_schemas_define_one_resumable_digest_per_day(self):
        for name, contract in self.same_day_contracts.items():
            with self.subTest(surface=name):
                self.assertRegex(contract, r"(?i)at most one[^\n]*run[^\n]*(?:day|date)")
                self.assertRegex(contract, r"(?i)resume")
                self.assertRegex(contract, r"(?i)partial|failed|missing")
                self.assertIn("log.md", contract)
                self.assertRegex(
                    contract,
                    r"(?is)(?:do\s+not|never).{0,80}overwrite.{0,80}(?:complete|completed)",
                )

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

    def test_same_day_backport_lists_every_derive_managed_surface(self):
        expected = {
            "packs/core/skills/run-trackers/SKILL.md",
            "packs/core/workflows/run-tracker.md",
            "packs/core/prompts/run-trackers.md",
            "packs/core/schemas/tracker.md",
            "packs/core/schemas/tracker_digest.md",
            "packs/core/templates/tracker_digest.md",
            "packs/pi/skills/cv-scan/SKILL.md",
            "packs/core/skills/daily-briefing/SKILL.md",
            "packs/core/workflows/daily-briefing.md",
            "packs/core/prompts/daily-briefing.md",
        }
        for path in expected:
            with self.subTest(path=path):
                self.assertIn(f"`{path}`", self.same_day_backport)


class TestBriefingReviewContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        core = ROOT / "packs/core"
        cls.briefing = (core / "skills/daily-briefing/SKILL.md").read_text()
        cls.briefing_workflow = (core / "workflows/daily-briefing.md").read_text()
        cls.briefing_prompt = (core / "prompts/daily-briefing.md").read_text()
        cls.briefing_schema = (core / "schemas/briefing.md").read_text()
        cls.apply = (core / "skills/apply-review/SKILL.md").read_text()
        cls.triage = (core / "skills/triage-inbox/SKILL.md").read_text()
        cls.hook = (ROOT / "hardened/hooks/session-start-context.sh").read_text()
        cls.packs = json.loads((ROOT / "packs.json").read_text())
        cls.backport = (ROOT / "docs/BACKPORT.md").read_text()

    def test_briefing_emits_and_validates_items_json(self):
        for name, artifact in {
            "skill": self.briefing,
            "workflow": self.briefing_workflow,
            "prompt": self.briefing_prompt,
            "schema": self.briefing_schema,
        }.items():
            with self.subTest(artifact=name):
                self.assertIn(".items.json", artifact)
                self.assertIn("memex.briefing-items/v1", artifact)
                self.assertRegex(artifact, r"briefing_review\.py\s+validate")
        step = markdown_section(
            self.briefing,
            "## Step 3b — Write the review items (`Ops/Briefings/<date>.items.json`)",
            "## Step 4 — Log",
        )
        self.assertRegex(step, r"(?is)regenerat.{0,80}overwrites.{0,60}items file")
        self.assertRegex(step, r"(?is)fix.{0,200}re-run until it passes")
        self.assertRegex(step, r"(?is)sensitivity.{0,200}target note.{0,200}never lower")
        self.assertRegex(step, r"(?is)also_in")
        # Items cover §0 and §§3–11, never the calendar, starter or end-of-day prompts.
        self.assertRegex(step, r"(?is)§ 0 and §§ 3–11")
        self.assertRegex(step, r"(?is)Not § 1.{0,60}§ 2.{0,80}§ 12.{0,80}§ 13")

    def test_briefing_carries_over_the_previous_review(self):
        for name, artifact in {
            "skill": self.briefing,
            "workflow": self.briefing_workflow,
            "prompt": self.briefing_prompt,
        }.items():
            with self.subTest(artifact=name):
                self.assertRegex(artifact, r"briefing_review\.py carryover <previous briefing date> --to \S+ --json")
                self.assertRegex(artifact, r"(?is)skip (?:this step )?silently")
                self.assertRegex(artifact, r"(?is)(?:not|never) drop.{0,60}because nothing new happened")
                self.assertRegex(artifact, r"(?is)(?:not|never) carry.{0,40}answers? (?:was|were) applied|"
                                           r"answers were applied are not carried")
        carry = markdown_section(
            self.briefing,
            "## Step 2a — Carry over the previous review",
            "## Step 2b — Build § 0 \"State confirmation needed\"",
        )
        self.assertIn("carried_from", carry)
        self.assertIn("previous", carry)
        # Exit 1 (no items file / no submitted answers) means skip; the id is reused verbatim.
        self.assertRegex(carry, r"(?is)exits 1, skip this step silently")
        self.assertRegex(carry, r"(?is)never falls back to parsing the Markdown")
        self.assertRegex(carry, r"(?is)only an unsubmitted draft")
        self.assertRegex(carry, r"(?is)`id` from the carryover output verbatim")

    def test_briefing_uses_the_id_command_for_targetless_items(self):
        step = markdown_section(
            self.briefing,
            "## Step 3b — Write the review items (`Ops/Briefings/<date>.items.json`)",
            "## Step 4 — Log",
        )
        self.assertIn("briefing_review.py id --kind <kind> --section <section> --date <date> --text", step)
        self.assertNotIn("hashlib", step)
        self.assertRegex(step, r"(?is)Target-less ids embed the date, so they are per-day")
        for artifact in (self.briefing_workflow, self.briefing_prompt, self.briefing_schema):
            self.assertRegex(artifact, r"briefing_review\.py\s+id")

    def test_apply_review_never_guesses_unmatched_export_rows(self):
        self.assertRegex(self.apply, r"(?is)exits 1, lists those rows, and writes nothing.{0,40}\*\*do not guess\*\*")
        self.assertRegex(self.apply, r"(?is)ask them to reopen the review")
        self.assertRegex(self.apply, r"(?is)--allow-empty")

    def test_briefing_opens_the_review_on_the_configured_surface(self):
        step = markdown_section(
            self.briefing, "## Step 5b — Open the review", "## Step 6 — Report back"
        )
        self.assertIn("review_surface", step)
        self.assertRegex(step, r"(?is)absent.{0,80}`auto`")
        self.assertIn("show_widget", step)
        self.assertIn("http://localhost:{{QUARTZ_PORT}}/review/<date>", step)
        self.assertIn("outputs/briefing-review/<date>.html", step)
        self.assertRegex(step, r"--surface widget")
        self.assertRegex(step, r"(?is)in the printed order, one widget per file")
        # The artifact surface is opt-in, private, redacted, and read back fully first.
        self.assertRegex(step, r"--surface artifact")
        self.assertRegex(step, r"(?is)\*\*private\*\* artifact.{0,40}capabilities: \{db: \{\}, user: \{\}\}")
        self.assertRegex(step, r"(?is)Read the generated file in full before publishing")
        # Default redaction withholds private items too; loosening needs the user's say-so.
        self.assertRegex(step, r"(?is)default `--redact private`, private items are withheld.{0,80}local-only")
        self.assertRegex(step, r"(?is)Looser levels need the user's explicit say-so")
        self.assertIn("--redact titles", step)
        self.assertRegex(step, r"(?is)withheld as local-only")
        self.assertRegex(step, r"(?is)--max-bytes.{0,40}default 200000")
        self.assertIn("reviews/<date>", step)

    def test_briefing_hands_answers_to_apply_review_and_keeps_chat_fallback(self):
        report = markdown_section(
            self.briefing, "## Step 6 — Report back", "## What this skill does NOT do"
        )
        self.assertIn("Briefing review — <date>", report)
        self.assertIn("Inbox/reviews/<date>.json", report)
        self.assertIn("[[apply-review]]", report)
        self.assertRegex(report, r"(?is)fallback.{0,120}yes to 1,3")
        self.assertRegex(report, r"(?is)Task closes → route through \[\[close-task\]\]")

    def test_apply_review_converges_every_arrival_path_on_save(self):
        self.assertRegex(self.apply, r"(?m)^name: apply-review$")
        description = re.search(r"(?m)^description: (.*)$", self.apply).group(1)
        for phrase in (
            "apply my briefing review",
            "here are my review answers",
            "Briefing review — <date>",
            "/apply-review",
        ):
            self.assertIn(phrase, description)
        self.assertIn("briefing_review.py save --from-export", self.apply)
        self.assertIn("--surface artifact", self.apply)
        self.assertRegex(self.apply, r"(?is)submitted: false.{0,200}not applied|"
                                     r"Drafts are not answers")
        self.assertRegex(self.apply, r"briefing_review\.py plan <date> --json")
        self.assertRegex(self.apply, r"briefing_review\.py annotate <date>")

    def test_apply_review_keeps_outbound_messages_as_drafts(self):
        hard_rules = markdown_section(
            self.apply, "## Hard rules (non-negotiable)", "## What this skill does NOT do"
        )
        self.assertRegex(hard_rules, r"(?is)Outbound messages are always drafts, never sent")
        self.assertRegex(self.apply, r"(?is)never send, post, or schedule")

    def test_apply_review_never_self_closes_on_do(self):
        hard_rules = markdown_section(
            self.apply, "## Hard rules (non-negotiable)", "## What this skill does NOT do"
        )
        self.assertRegex(hard_rules, r"(?is)`do` answer never self-closes.{0,80}needs_review")
        self.assertRegex(self.apply, r"(?is)A `do` never sets `done`")

    def test_apply_review_routes_closes_through_close_task(self):
        self.assertRegex(self.apply, r"(?m)^\| task `done` \| \[\[close-task\]\]")
        self.assertRegex(self.apply, r"(?m)^\| task `cancel` \| \[\[close-task\]\]")
        self.assertRegex(self.apply, r"(?is)`done` and `cancel` answers are the user's explicit confirmation")
        self.assertRegex(self.apply, r"(?is)never hand-edit `status: done`")

    def test_apply_review_records_every_answer_in_the_ledger(self):
        mark = markdown_section(
            self.apply,
            "## Step 4 — Mark each answer in the ledger",
            "## Step 5 — Annotate and log",
        )
        self.assertRegex(mark, r"briefing_review\.py mark <date> \"<id>\" --fingerprint <[^>]+> --result")
        self.assertRegex(mark, r"(?is)Always pass `--fingerprint`")
        self.assertIn("failed", mark)
        self.assertRegex(mark, r"(?is)continue with the next answer")
        self.assertRegex(mark, r"(?is)Re-running is safe.{0,300}fingerprint")
        self.assertRegex(self.apply, r"(?is)Unanswered rows are left alone")
        self.assertRegex(self.apply, r"(?is)`sensitive` items never go to an external service")

    def test_apply_review_orders_bookkeeping_before_long_work(self):
        order = markdown_section(
            self.apply, "## Step 2 — Order the work", "## Step 3 — Apply each answer by its route"
        )
        closes = order.index("Closes and status edits")
        creations = order.index("Creations")
        work = order.index("\"Do it\" work")
        self.assertLess(closes, creations)
        self.assertLess(creations, work)

    def test_apply_review_has_meeting_agenda_fallback(self):
        self.assertRegex(self.apply, r"(?is)meeting-agenda.{0,200}not part of every install.{0,80}otherwise")

    def test_triage_and_session_hook_exclude_reviews_slot(self):
        self.assertIn("`reviews/`", self.triage)
        self.assertRegex(self.triage, r"(?is)system slots.{0,300}`reviews/`")
        find_line = next(
            line for line in self.hook.splitlines() if "inbox_count=" in line
        )
        self.assertIn("! -name 'reviews'", find_line)
        self.assertIn("! -name 'comms'", find_line)

    def test_apply_review_is_registered(self):
        self.assertIn("apply-review", self.packs["core"]["skills"])
        self.assertTrue((ROOT / "packs/core/skills/apply-review/SKILL.md").is_file())

    def test_backport_lists_briefing_review_surfaces(self):
        section = markdown_section(
            self.backport, "# Backport checklist — 2026-11-12 briefing review"
        )
        for path in (
            "packs/core/skills/daily-briefing/SKILL.md",
            "packs/core/skills/apply-review/SKILL.md",
            "packs/core/skills/triage-inbox/SKILL.md",
            "packs/core/workflows/daily-briefing.md",
            "packs/core/prompts/daily-briefing.md",
            "packs/core/schemas/briefing.md",
            "hardened/hooks/session-start-context.sh",
            "hardened/quartz/quartz/cli/handlers.js",
        ):
            with self.subTest(path=path):
                self.assertIn(f"`{path}`", section)


if __name__ == "__main__":
    unittest.main()
