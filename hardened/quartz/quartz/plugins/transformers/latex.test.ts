import test, { describe } from "node:test"
import assert from "node:assert"
import { readFileSync } from "node:fs"
import { unified } from "unified"
import remarkParse from "remark-parse"
import { QuartzTransformerPluginInstance } from "../types"
import { Latex } from "./latex"

function parseWith(transformer: QuartzTransformerPluginInstance, markdown: string) {
  const markdownPlugins = transformer.markdownPlugins?.({} as never) ?? []
  return unified().use(remarkParse).use(markdownPlugins).parse(markdown)
}

function nodeTypes(node: unknown, result: string[] = []): string[] {
  if (typeof node !== "object" || node === null) {
    return result
  }

  const candidate = node as { type?: unknown; children?: unknown[] }
  if (typeof candidate.type === "string") {
    result.push(candidate.type)
  }
  for (const child of candidate.children ?? []) {
    nodeTypes(child, result)
  }
  return result
}

function textValues(node: unknown, result: string[] = []): string[] {
  if (typeof node !== "object" || node === null) {
    return result
  }

  const candidate = node as { type?: unknown; value?: unknown; children?: unknown[] }
  if (candidate.type === "text" && typeof candidate.value === "string") {
    result.push(candidate.value)
  }
  for (const child of candidate.children ?? []) {
    textValues(child, result)
  }
  return result
}

describe("Latex markdown parsing", () => {
  test("preserves remark-math's single-dollar default when no option is supplied", () => {
    const tree = parseWith(Latex(), "Costs $1.59 vs $1.93 per pair.")

    assert.ok(nodeTypes(tree).includes("inlineMath"))
  })

  test("passes singleDollarTextMath through to remark-math", () => {
    const markdown = "Costs $1.59 vs $1.93 per pair."
    const transformer = Latex({
      renderEngine: "katex",
      remarkMathOptions: { singleDollarTextMath: false },
    })
    const tree = parseWith(transformer, markdown)

    assert.ok(!nodeTypes(tree).includes("inlineMath"))
    assert.deepStrictEqual(textValues(tree), [markdown])
  })
})

describe("shipped Memex Latex configuration", () => {
  test("disables single-dollar math in quartz.config.ts", () => {
    const source = readFileSync(new URL("../../../quartz.config.ts", import.meta.url), "utf8")

    assert.match(
      source,
      /Plugin\.Latex\(\{[\s\S]*?remarkMathOptions:\s*\{\s*singleDollarTextMath:\s*false\s*\}[\s\S]*?\}\)/,
    )
  })

  test("retains display math when single-dollar math is disabled", () => {
    const transformer = Latex({
      renderEngine: "katex",
      remarkMathOptions: { singleDollarTextMath: false },
    })
    const tree = parseWith(transformer, "$$\nx^2\n$$")

    assert.ok(nodeTypes(tree).includes("math"))
  })
})
