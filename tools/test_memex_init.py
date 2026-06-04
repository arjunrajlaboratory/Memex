import unittest
from memex_init import (
    bake, parse_streams, normalize_git_mode, sources_config_yaml, DEFAULT_STREAMS,
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
        out = sources_config_yaml(["email", "slack"], "local", "2026-06-04")
        self.assertIn("email: { enabled: true, mcp: claude_ai_Gmail }", out)
        self.assertIn("slack: { enabled: true, mcp: claude_ai_Slack }", out)
        self.assertIn("calendar: { enabled: false,", out)
        self.assertIn("git_mode: local", out)
        self.assertIn("updated: 2026-06-04", out)

    def test_calendar_carries_minimal_mode_when_enabled(self):
        out = sources_config_yaml(["calendar"], "remote", "2026-06-04")
        self.assertIn("mode: minimal", out)
        self.assertIn("calendar: { enabled: true,", out)
        self.assertIn("git_mode: remote", out)

if __name__ == "__main__":
    unittest.main()
