import { QuartzConfig } from "./quartz/cfg"
import * as Plugin from "./quartz/plugins"

/**
 * Quartz 4 Configuration
 *
 * See https://quartz.jzhao.xyz/configuration for more information.
 */
const config: QuartzConfig = {
  configuration: {
    pageTitle: "Memex",
    pageTitleSuffix: "",
    enableSPA: true,
    enablePopovers: true,
    analytics: null,
    locale: "en-US",
    baseUrl: "localhost:{{QUARTZ_PORT}}",
    ignorePatterns: [
      // Quartz / build artifacts
      "quartz",
      "node_modules",
      ".git",
      ".venv",
      // Vault internals — never published
      ".obsidian",
      ".claude",
      ".memex",
      // _config/sources.md carries the owner's email addresses and has no
      // sensitivity: field, so the privacy filter would publish it.
      "_config",
      "_config/**",
      "Inbox",
      "Inbox/**",
      "_archive",
      "_archive/**",
      "_dashboards",
      "_dashboards/**",
      "_templates",
      "_schemas",
      "_schemas/**",
      "_workflows",
      "_workflows/**",
      "Raw",
      "Raw/**",
      // Agent jobs/runs/approvals are operational, not knowledge
      "Agents/Jobs",
      "Agents/Runs",
      "Agents/Approvals",
      // Drafts, generated artifacts, and tooling — not published
      "Drafts",
      "Drafts/**",
      "outputs",
      "outputs/**",
      "scripts",
      "todo",
      // LaTeX CV source — version-controlled but not published as wiki pages
      "CV",
      "CV/**",
      // log.md is the append-only mutation record. It often references private
      // entities (emails, internal conversation threads) by name in the log
      // line itself, even when the referenced note is sensitivity: private and
      // would be stripped. Cleanest to not publish the log at all — it's
      // operational, not knowledge.
      "log.md",
      // DEPLOY.md is operational documentation for the maintainer. No reason
      // to expose the privacy-handling recipe to a public audience.
      "DEPLOY.md",
      // Meta-docs aimed at LLM agents, not human readers. AGENTS.md duplicates
      // the "Agents" folder name in the Explorer; CLAUDE.md is Claude-Code-
      // specific instructions. IMPLEMENTATION_PLAN.md is a build artifact from
      // the bootstrap phase, not browseable knowledge.
      "AGENTS.md",
      "CLAUDE.md",
      "IMPLEMENTATION_PLAN.md",
      // Bases / Obsidian view files don't render meaningfully as markdown
      "Ops/Views",
    ],
    defaultDateType: "modified",
    theme: {
      fontOrigin: "googleFonts",
      cdnCaching: true,
      typography: {
        header: "Schibsted Grotesk",
        body: "Source Sans Pro",
        code: "IBM Plex Mono",
      },
      colors: {
        lightMode: {
          light: "#faf8f8",
          lightgray: "#e5e5e5",
          gray: "#b8b8b8",
          darkgray: "#4e4e4e",
          dark: "#2b2b2b",
          secondary: "#284b63",
          tertiary: "#84a59d",
          highlight: "rgba(143, 159, 169, 0.15)",
          textHighlight: "#fff23688",
        },
        darkMode: {
          light: "#161618",
          lightgray: "#393639",
          gray: "#646464",
          darkgray: "#d4d4d4",
          dark: "#ebebec",
          secondary: "#7b97aa",
          tertiary: "#84a59d",
          highlight: "rgba(143, 159, 169, 0.15)",
          textHighlight: "#b3aa0288",
        },
      },
    },
  },
  plugins: {
    transformers: [
      Plugin.FrontMatter(),
      Plugin.CreatedModifiedDate({
        priority: ["frontmatter", "git", "filesystem"],
      }),
      Plugin.SyntaxHighlighting({
        theme: {
          light: "github-light",
          dark: "github-dark",
        },
        keepBackground: false,
      }),
      Plugin.ObsidianFlavoredMarkdown({ enableInHtmlEmbed: false }),
      Plugin.GitHubFlavoredMarkdown(),
      Plugin.TableOfContents(),
      Plugin.CrawlLinks({ markdownLinkResolution: "shortest" }),
      Plugin.Description(),
      Plugin.Latex({ renderEngine: "katex" }),
    ],
    // Filters:
    //  - RemoveDrafts: strips `draft: true` notes.
    //  - RemovePrivateNotes: strips `sensitivity: private | sensitive` notes.
    //    Defaults to ON for safety; the local-dev npm script
    //    (`npm run site:serve`) sets QUARTZ_INCLUDE_PRIVATE=true so private
    //    notes still show locally. A deploy that does not set that env var
    //    will not publish private notes — the right default for a hosted site.
    filters: [
      Plugin.RemoveDrafts(),
      ...(process.env.QUARTZ_INCLUDE_PRIVATE === "true" ? [] : [Plugin.RemovePrivateNotes()]),
    ],
    emitters: [
      Plugin.AliasRedirects(),
      Plugin.ComponentResources(),
      Plugin.ContentPage(),
      Plugin.FolderPage(),
      Plugin.TagPage(),
      Plugin.ContentIndex({
        enableSiteMap: true,
        enableRSS: true,
      }),
      Plugin.Assets(),
      Plugin.Static(),
      Plugin.Favicon(),
      Plugin.NotFoundPage(),
      // CustomOgImages disabled to keep rebuilds fast during dev; re-enable
      // for production deploy if you want per-page OG cards on share.
      // Plugin.CustomOgImages(),
      Plugin.MemexDashboards(),
    ],
  },
}

export default config
