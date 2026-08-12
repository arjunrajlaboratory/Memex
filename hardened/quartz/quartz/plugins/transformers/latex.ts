import remarkMath from "remark-math"
import type { Options as RemarkMathOptions } from "remark-math"
import rehypeKatex from "rehype-katex"
import rehypeMathjax from "rehype-mathjax/svg"
//@ts-ignore
import rehypeTypst from "@myriaddreamin/rehype-typst"
import { QuartzTransformerPlugin } from "../types"
import { KatexOptions } from "katex"
import { Options as MathjaxOptions } from "rehype-mathjax/svg"
//@ts-ignore
import { Options as TypstOptions } from "@myriaddreamin/rehype-typst"

interface Options {
  renderEngine: "katex" | "mathjax" | "typst"
  customMacros: MacroType
  katexOptions: Omit<KatexOptions, "macros" | "output">
  mathJaxOptions: Omit<MathjaxOptions, "macros">
  typstOptions: TypstOptions
  /**
   * Passed straight through to remark-math.
   *
   * Set `singleDollarTextMath: false` if the content writes plain dollar
   * amounts. remark-math treats `$…$` as inline math by default, so any two
   * unescaped `$` on a page pair up and silently swallow everything between
   * them — "costs $1.59 vs $1.93 per record" renders as one math span and the
   * prose disappears. Fenced `$$…$$` display math is unaffected either way.
   */
  remarkMathOptions: RemarkMathOptions
}

// mathjax macros
export type Args = boolean | number | string | null
interface MacroType {
  [key: string]: string | Args[]
}

export const Latex: QuartzTransformerPlugin<Partial<Options>> = (opts) => {
  const engine = opts?.renderEngine ?? "katex"
  const macros = opts?.customMacros ?? {}
  return {
    name: "Latex",
    markdownPlugins() {
      return [[remarkMath, opts?.remarkMathOptions ?? {}]]
    },
    htmlPlugins() {
      switch (engine) {
        case "katex": {
          return [[rehypeKatex, { output: "html", macros, ...(opts?.katexOptions ?? {}) }]]
        }
        case "typst": {
          return [[rehypeTypst, opts?.typstOptions ?? {}]]
        }
        default:
        case "mathjax": {
          return [
            [
              rehypeMathjax,
              {
                ...(opts?.mathJaxOptions ?? {}),
                tex: {
                  ...(opts?.mathJaxOptions?.tex ?? {}),
                  macros,
                },
              },
            ],
          ]
        }
      }
    },
    externalResources() {
      switch (engine) {
        case "katex":
          return {
            css: [{ content: "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css" }],
            js: [
              {
                // fix copy behaviour: https://github.com/KaTeX/KaTeX/blob/main/contrib/copy-tex/README.md
                src: "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/copy-tex.min.js",
                loadTime: "afterDOMReady",
                contentType: "external",
              },
            ],
          }
      }
    },
  }
}
