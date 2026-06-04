import test, { describe } from "node:test"
import assert from "node:assert"
import { RemovePrivateNotes } from "./sensitivity"

// shouldPublish takes (ctx, [tree, vfile]). Neither ctx nor tree are read by
// this filter — only vfile.data.frontmatter.sensitivity is consulted — so we
// can pass empty stubs.
function shouldPublish(
  filter: ReturnType<typeof RemovePrivateNotes>,
  sensitivity?: unknown,
): boolean {
  const vfile = { data: { frontmatter: sensitivity === undefined ? {} : { sensitivity } } }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return filter.shouldPublish({} as any, [{} as any, vfile as any])
}

describe("RemovePrivateNotes (defaults)", () => {
  const filter = RemovePrivateNotes()

  test("blocks sensitivity: private", () => {
    assert.strictEqual(shouldPublish(filter, "private"), false)
  })

  test("blocks sensitivity: sensitive", () => {
    assert.strictEqual(shouldPublish(filter, "sensitive"), false)
  })

  test("passes sensitivity: normal", () => {
    assert.strictEqual(shouldPublish(filter, "normal"), true)
  })

  test("passes notes with no sensitivity field", () => {
    // Policy choice: notes lacking a sensitivity field publish. This is the
    // current behavior (see sensitivity.ts: `if (typeof s !== 'string') return
    // true`). If we ever want to require explicit sensitivity, the lint pass
    // should catch missing fields BEFORE the build, not the filter — but if
    // that policy changes, this test should fail and be re-stated.
    assert.strictEqual(shouldPublish(filter), true)
  })

  test("passes notes with non-string sensitivity (e.g. null, number)", () => {
    // Defensive — frontmatter parsers can produce non-string values for
    // malformed YAML. Today we permit; the lint pass should flag.
    assert.strictEqual(shouldPublish(filter, null), true)
    assert.strictEqual(shouldPublish(filter, 42), true)
  })

  test("is case-insensitive on the value", () => {
    // YAML allows quoted strings; the filter lowercases for comparison.
    assert.strictEqual(shouldPublish(filter, "Private"), false)
    assert.strictEqual(shouldPublish(filter, "PRIVATE"), false)
    assert.strictEqual(shouldPublish(filter, "Sensitive"), false)
  })

  test("does NOT block on unrelated sensitivity values", () => {
    assert.strictEqual(shouldPublish(filter, "public"), true)
    assert.strictEqual(shouldPublish(filter, "internal"), true)
  })
})

describe("RemovePrivateNotes (custom blockedSensitivities)", () => {
  test("custom list lets sensitivity: sensitive publish if user opts in", () => {
    const filter = RemovePrivateNotes({ blockedSensitivities: ["private"] })
    assert.strictEqual(shouldPublish(filter, "private"), false)
    assert.strictEqual(shouldPublish(filter, "sensitive"), true)
    assert.strictEqual(shouldPublish(filter, "normal"), true)
  })

  test("can extend the blocked list (e.g. add 'internal')", () => {
    const filter = RemovePrivateNotes({
      blockedSensitivities: ["private", "sensitive", "internal"],
    })
    assert.strictEqual(shouldPublish(filter, "internal"), false)
    assert.strictEqual(shouldPublish(filter, "private"), false)
    assert.strictEqual(shouldPublish(filter, "normal"), true)
  })

  test("empty blocked list publishes everything", () => {
    const filter = RemovePrivateNotes({ blockedSensitivities: [] })
    assert.strictEqual(shouldPublish(filter, "private"), true)
    assert.strictEqual(shouldPublish(filter, "sensitive"), true)
  })

  test("filter name is RemovePrivateNotes", () => {
    const filter = RemovePrivateNotes()
    assert.strictEqual(filter.name, "RemovePrivateNotes")
  })
})
