import unittest
from memex_init import bake

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

if __name__ == "__main__":
    unittest.main()
