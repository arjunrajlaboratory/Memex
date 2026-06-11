import os
import pathlib
import stat
import tempfile
import unittest
from memex_bake import bake_file
from memex_init import (
    bake, parse_account_list, parse_streams, normalize_git_mode, sources_config_yaml, DEFAULT_STREAMS,
)

class TestBake(unittest.TestCase):
    def test_replaces_known_tokens(self):
        text = "email {{OWNER_PRIMARY_EMAIL}} name {{OWNER_NAME}}"
        out = bake(text, {"OWNER_PRIMARY_EMAIL": "a@b.com", "OWNER_NAME": "Jane Roe"})
        self.assertEqual(out, "email a@b.com name Jane Roe")

    def test_blank_answer_removes_token(self):
        self.assertEqual(bake("x {{OWNER_FORWARDING_EMAIL}} y", {"OWNER_FORWARDING_EMAIL": ""}), "x  y")

    def test_unknown_token_passes_through(self):
        # Templater note-creation tokens (e.g. {{YYYYMMDD}}) must survive init.
        self.assertEqual(bake("hi {{MYSTERY}}", {"OWNER_NAME": "x"}), "hi {{MYSTERY}}")

    def test_value_with_braces_not_re_expanded(self):
        # an answer value containing a token is NOT re-processed (single pass)
        self.assertEqual(bake("{{A}}", {"A": "{{B}}", "B": "z"}), "{{B}}")


class TestBakeFile(unittest.TestCase):
    def test_text_file_preserves_source_mode(self):
        with tempfile.TemporaryDirectory() as td:
            root = pathlib.Path(td)
            src = root / "hook.sh"
            dst = root / "out" / "hook.sh"
            src.write_text("#!/usr/bin/env bash\necho {{TOKEN}}\n")
            os.chmod(src, 0o755)

            bake_file(src, dst, {"TOKEN": "ok"})

            self.assertEqual(dst.read_text(), "#!/usr/bin/env bash\necho ok\n")
            self.assertEqual(stat.S_IMODE(dst.stat().st_mode), 0o755)


class TestBakeSections(unittest.TestCase):
    """Optional-token PROSE: {{?TOKEN}}…{{/TOKEN}} keeps its span only when the
    answer is non-blank; {{^TOKEN}}…{{/TOKEN}} only when blank. This lets a blank
    optional answer drop the surrounding clause, not just the token (which would
    leave empty `` pairs / dangling words baked into the new vault)."""

    def test_positive_section_dropped_when_blank(self):
        tmpl = "`{{OWNER_PRIMARY_EMAIL}}` is primary{{?OWNER_FORWARDING_EMAIL}}; `{{OWNER_FORWARDING_EMAIL}}` forwards in{{/OWNER_FORWARDING_EMAIL}}."
        out = bake(tmpl, {"OWNER_PRIMARY_EMAIL": "a@b.com", "OWNER_FORWARDING_EMAIL": ""})
        self.assertEqual(out, "`a@b.com` is primary.")

    def test_positive_section_kept_and_baked_when_set(self):
        tmpl = "`{{OWNER_PRIMARY_EMAIL}}` is primary{{?OWNER_FORWARDING_EMAIL}}; `{{OWNER_FORWARDING_EMAIL}}` forwards in{{/OWNER_FORWARDING_EMAIL}}."
        out = bake(tmpl, {"OWNER_PRIMARY_EMAIL": "a@b.com", "OWNER_FORWARDING_EMAIL": "a@b.edu"})
        self.assertEqual(out, "`a@b.com` is primary; `a@b.edu` forwards in.")

    def test_negative_section_kept_when_blank(self):
        # the {{^TOKEN}} alternative — kept only when the token IS blank
        self.assertEqual(bake("{{^OWNER_FORWARDING_EMAIL}}complete{{/OWNER_FORWARDING_EMAIL}}",
                              {"OWNER_FORWARDING_EMAIL": ""}), "complete")

    def test_negative_section_dropped_when_set(self):
        self.assertEqual(bake("{{^OWNER_FORWARDING_EMAIL}}complete{{/OWNER_FORWARDING_EMAIL}}",
                              {"OWNER_FORWARDING_EMAIL": "a@b.edu"}), "")

    def test_paired_hedge_picks_one_branch(self):
        # the adjacent ?/^ pattern used for the "near-complete" / "complete" hedge
        tmpl = "**{{?OWNER_FORWARDING_EMAIL}}near-complete{{/OWNER_FORWARDING_EMAIL}}{{^OWNER_FORWARDING_EMAIL}}complete{{/OWNER_FORWARDING_EMAIL}}**"
        self.assertEqual(bake(tmpl, {"OWNER_FORWARDING_EMAIL": ""}), "**complete**")
        self.assertEqual(bake(tmpl, {"OWNER_FORWARDING_EMAIL": "a@b.edu"}), "**near-complete**")

    def test_sending_accounts_section_drops_when_blank(self):
        tmpl = "{{?OWNER_SENDING_ACCOUNTS}}Other accounts: `{{OWNER_SENDING_ACCOUNTS}}`.{{/OWNER_SENDING_ACCOUNTS}}"
        self.assertEqual(bake(tmpl, {"OWNER_SENDING_ACCOUNTS": ""}), "")
        self.assertEqual(
            bake(tmpl, {"OWNER_SENDING_ACCOUNTS": "a@b.edu,c@d.org"}),
            "Other accounts: `a@b.edu,c@d.org`.",
        )

    def test_whitespace_only_answer_counts_as_blank(self):
        self.assertEqual(bake("{{?X}}keep{{/X}}", {"X": "   "}), "")
        self.assertEqual(bake("{{^X}}keep{{/X}}", {"X": "   "}), "keep")

    def test_unknown_token_section_passes_through(self):
        # a section whose token is absent from answers survives intact, same rule
        # as bake()'s unknown-token pass-through (don't drop note-creation prose)
        self.assertEqual(bake("a{{?MYSTERY}}body{{/MYSTERY}}z", {"OWNER_NAME": "x"}),
                         "a{{?MYSTERY}}body{{/MYSTERY}}z")

    def test_section_body_can_span_newlines(self):
        tmpl = "{{^X}}line one\nline two{{/X}}"
        self.assertEqual(bake(tmpl, {"X": ""}), "line one\nline two")
        self.assertEqual(bake(tmpl, {"X": "v"}), "")

    def test_multiple_independent_sections(self):
        tmpl = "{{?X}}X{{/X}}-{{?Y}}Y{{/Y}}"
        self.assertEqual(bake(tmpl, {"X": "1", "Y": ""}), "X-")
        self.assertEqual(bake(tmpl, {"X": "", "Y": "1"}), "-Y")

class TestParseStreams(unittest.TestCase):
    def test_none_means_not_answered_falls_back_to_default(self):
        # key absent in answers.json -> use the default
        self.assertEqual(parse_streams(None), DEFAULT_STREAMS)

    def test_explicit_empty_stays_empty(self):
        # answered-but-empty (interview opt-out, or "STREAMS": "") -> no streams
        self.assertEqual(parse_streams(""), [])
        self.assertEqual(parse_streams([]), [])

    def test_comma_string(self):
        self.assertEqual(parse_streams("email,calendar"), ["email", "calendar"])

    def test_list_with_whitespace_and_case(self):
        self.assertEqual(parse_streams([" Email ", "SLACK"]), ["email", "slack"])

    def test_drops_unknown_and_dedupes_preserving_order(self):
        self.assertEqual(parse_streams("calendar,bogus,email,email"),
                         ["calendar", "email"])

    def test_present_but_all_unknown_yields_empty(self):
        # a provided value is taken literally; unknown names drop to empty
        self.assertEqual(parse_streams("notion,linear"), [])

class TestParseAccountList(unittest.TestCase):
    def test_comma_string_dedupes(self):
        self.assertEqual(parse_account_list("a@b.com, c@d.org, a@b.com"), ["a@b.com", "c@d.org"])

    def test_blank_means_empty(self):
        self.assertEqual(parse_account_list(""), [])
        self.assertEqual(parse_account_list(None), [])

class TestGitMode(unittest.TestCase):
    def test_defaults_and_valid(self):
        self.assertEqual(normalize_git_mode(None), "local")
        self.assertEqual(normalize_git_mode(""), "local")
        self.assertEqual(normalize_git_mode("REMOTE"), "remote")
        self.assertEqual(normalize_git_mode(" none "), "none")

    def test_invalid_falls_back_to_local(self):
        self.assertEqual(normalize_git_mode("svn"), "local")

class TestSourcesConfigYaml(unittest.TestCase):
    def test_enabled_flags_reflect_streams(self):
        out = sources_config_yaml(
            ["email", "slack"],
            "local",
            "2026-06-04",
            connected_email="jane@example.com",
            forwarding_email="",
            other_sending_accounts="jane@lab.example.edu,jane@hospital.example.org",
        )
        self.assertIn("email: { enabled: true, mcp: claude_ai_Gmail }", out)
        self.assertIn("slack: { enabled: true, mcp: claude_ai_Slack }", out)
        self.assertIn("calendar: { enabled: false,", out)
        self.assertIn("git_mode: local", out)
        self.assertIn("updated: 2026-06-04", out)
        self.assertIn('gmail_connected: "jane@example.com"', out)
        self.assertIn('forwarding_in: ""', out)
        self.assertIn('other_sending_accounts: ["jane@lab.example.edu", "jane@hospital.example.org"]', out)
        self.assertIn("Treat missing sent-mail evidence for them as inconclusive", out)

    def test_calendar_carries_minimal_mode_when_enabled(self):
        out = sources_config_yaml(["calendar"], "remote", "2026-06-04")
        self.assertIn("mode: minimal", out)
        self.assertIn("calendar: { enabled: true,", out)
        self.assertIn("git_mode: remote", out)

if __name__ == "__main__":
    unittest.main()
