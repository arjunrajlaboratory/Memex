// Memex Dashboards — a Quartz emitter plugin.
//
// Iterates every parsed typed note (Task / Project / Person / Source / Tracker
// / Followup / Concept / Organization / Decision / Area / Implementation) and
// emits one dashboard HTML page per type plus a small index page. Each
// dashboard renders inside Quartz's standard page chrome (left sidebar with
// title/search/darkmode/explorer, footer) via renderPage(), so dashboards and
// note pages share the same look-and-feel.
//
// The dashboard body itself is rendered by the MemexDashboard Quartz
// component (quartz/components/MemexDashboard.tsx). This emitter constructs
// one synthetic fileData per dashboard, stashes the dashboard payload on it
// under `memexDashboard`, and lets the component render the table + the
// component's bundled JS handle the live filtering.
//
// To add a dashboard: append a DashboardConfig to DASHBOARDS below. To change
// which columns or facets show: edit the relevant entry there.

import { QuartzEmitterPlugin } from "../types"
import { write } from "./helpers"
import { FullSlug, FilePath } from "../../util/path"
import { BuildCtx } from "../../util/ctx"
import { ProcessedContent } from "../vfile"
import { renderPage } from "../../components/renderPage"
import { sharedPageComponents, defaultContentPageLayout } from "../../../quartz.layout"
import { Root as HtmlRoot } from "hast"
import MemexDashboard from "../../components/MemexDashboard"
import HeaderConstructor from "../../components/Header"
import BodyConstructor from "../../components/Body"
import { pageResources } from "../../components/renderPage"
import { FullPageLayout } from "../../cfg"
import { h } from "preact"

// ----------------------------------------------------------------------------
// Configuration

type Column = { key: string; label: string; kind?: "link" | "status" | "date" | "list" }
type Facet = { key: string; label: string }
type StatusGroup = { name: string; default?: boolean; include?: string[] }

interface DashboardConfig {
  slug: string // URL slug (without .html)
  title: string
  subtitle: string
  cardSubtitle: string
  typeField: string // matches frontmatter `type:` value
  columns: Column[]
  facets: Facet[]
  statusGroups: StatusGroup[]
  // Optional. When set, the dashboard table is sorted by this column on
  // first render. dir: 1 = ascending (earliest dates first), -1 = descending.
  // If unset, defaults to ascending sort on the first column.
  defaultSort?: { key: string; dir?: 1 | -1 }
}

const DASHBOARDS: DashboardConfig[] = [
  {
    slug: "dashboards/tasks",
    title: "Tasks",
    subtitle: "Todos · sortable · filterable · status tabs hide closed work by default.",
    cardSubtitle: "Todos · next-actions · WIP",
    typeField: "task",
    columns: [
      { key: "_basename", label: "Task", kind: "link" },
      { key: "priority", label: "Pri" },
      { key: "project", label: "Project" },
      { key: "due", label: "Due", kind: "date" },
      { key: "owner", label: "Owner" },
      { key: "effort", label: "Effort" },
    ],
    facets: [
      { key: "priority", label: "Priority" },
      { key: "project", label: "Project" },
      { key: "area", label: "Area" },
      { key: "owner", label: "Owner" },
    ],
    statusGroups: [
      { name: "Active", default: true, include: ["next", "in_progress", "scheduled", "needs_review"] },
      { name: "Backlog", include: ["inbox", "backlog", "waiting"] },
      { name: "Done", include: ["done", "canceled"] },
      { name: "All" },
    ],
    // Sort by due date ascending — overdue items rise to the top, undated
    // items sink to the bottom (the empty-value handling in sortRows turns
    // missing values into U+FFFF when sortDir=1, so they sort last).
    defaultSort: { key: "due", dir: 1 },
  },
  {
    slug: "dashboards/projects",
    title: "Projects",
    subtitle: "Status pulse — area, phase, next review.",
    cardSubtitle: "Status pulse",
    typeField: "project",
    columns: [
      { key: "_basename", label: "Project", kind: "link" },
      { key: "area", label: "Area" },
      { key: "phase", label: "Phase" },
      { key: "next_review", label: "Next review", kind: "date" },
    ],
    facets: [
      { key: "area", label: "Area" },
      { key: "phase", label: "Phase" },
    ],
    statusGroups: [
      { name: "Active", default: true, include: ["active"] },
      { name: "Paused", include: ["paused", "waiting"] },
      { name: "Closed", include: ["done", "archived", "dropped"] },
      { name: "All" },
    ],
  },
  {
    slug: "dashboards/people",
    title: "People",
    subtitle: "Personal CRM. Tabs separate active from dormant.",
    cardSubtitle: "Personal CRM",
    typeField: "person",
    columns: [
      { key: "_basename", label: "Name", kind: "link" },
      { key: "role", label: "Role" },
      { key: "organization", label: "Org", kind: "list" },
      { key: "last_contact", label: "Last contact", kind: "date" },
      { key: "next_touch", label: "Next touch", kind: "date" },
      { key: "relationship_strength", label: "Strength" },
    ],
    facets: [
      { key: "contact_cadence", label: "Cadence" },
      { key: "relationship_strength", label: "Strength" },
      { key: "relationship_category", label: "Category" },
      { key: "organization", label: "Org" },
    ],
    statusGroups: [
      { name: "Active", default: true, include: ["active"] },
      { name: "Dormant", include: ["dormant"] },
      { name: "Other", include: ["estranged", "deceased", "archived"] },
      { name: "All" },
    ],
  },
  {
    slug: "dashboards/sources",
    title: "Sources",
    subtitle: "External inputs (articles, papers, transcripts) by ingest stage.",
    cardSubtitle: "External inputs",
    typeField: "source",
    columns: [
      { key: "_basename", label: "Source", kind: "link" },
      { key: "source_kind", label: "Kind" },
      { key: "reliability", label: "Reliability" },
      { key: "captured", label: "Captured", kind: "date" },
    ],
    facets: [
      { key: "source_kind", label: "Kind" },
      { key: "reliability", label: "Reliability" },
    ],
    statusGroups: [
      { name: "Open", default: true, include: ["new", "unprocessed", "processing"] },
      { name: "Needs review", include: ["needs_review"] },
      { name: "Processed", include: ["processed"] },
      { name: "All" },
    ],
  },
  {
    slug: "dashboards/trackers",
    title: "Trackers",
    subtitle: "Living-topic watchers. Next-check dates ≤ today are overdue.",
    cardSubtitle: "Living-topic watchers",
    typeField: "tracker",
    columns: [
      { key: "_basename", label: "Tracker", kind: "link" },
      { key: "subject", label: "Subject" },
      { key: "cadence", label: "Cadence" },
      { key: "next_check", label: "Next check", kind: "date" },
    ],
    facets: [
      { key: "cadence", label: "Cadence" },
      { key: "search_strategy", label: "Strategy" },
    ],
    statusGroups: [
      { name: "Active", default: true, include: ["active"] },
      { name: "Paused", include: ["paused", "broken"] },
      { name: "Archived", include: ["archived"] },
      { name: "All" },
    ],
  },
  {
    slug: "dashboards/followups",
    title: "Followups",
    subtitle: "Time-delayed nudges. Pending items with surface_on ≤ today are overdue.",
    cardSubtitle: "Time-delayed nudges",
    typeField: "followup",
    columns: [
      { key: "_basename", label: "Followup", kind: "link" },
      { key: "surface_on", label: "Surface on", kind: "date" },
      { key: "about", label: "About" },
      { key: "suggested_action", label: "Suggested action" },
    ],
    facets: [{ key: "about", label: "About" }],
    statusGroups: [
      { name: "Pending", default: true, include: ["pending"] },
      { name: "Surfaced", include: ["surfaced"] },
      { name: "Closed", include: ["acted_on", "dismissed"] },
      { name: "All" },
    ],
  },
  {
    slug: "dashboards/concepts",
    title: "Concepts",
    subtitle: "Knowledge pages. Maturity tracks how sharp the page is.",
    cardSubtitle: "Concept index",
    typeField: "concept",
    columns: [
      { key: "_basename", label: "Concept", kind: "link" },
      { key: "maturity", label: "Maturity" },
    ],
    facets: [{ key: "maturity", label: "Maturity" }],
    statusGroups: [
      { name: "Active", default: true, include: ["active"] },
      { name: "Dormant", include: ["dormant"] },
      { name: "Archived", include: ["archived"] },
      { name: "All" },
    ],
  },
  {
    slug: "dashboards/organizations",
    title: "Organizations",
    subtitle: "Companies, labs, schools, agencies — and how they connect to you.",
    cardSubtitle: "Companies & labs",
    typeField: "organization",
    columns: [
      { key: "_basename", label: "Org", kind: "link" },
      { key: "relationship_type", label: "Type", kind: "list" },
      { key: "location", label: "Location" },
    ],
    facets: [{ key: "relationship_type", label: "Type" }],
    statusGroups: [
      { name: "Active", default: true, include: ["active"] },
      { name: "Inactive", include: ["dormant", "defunct", "archived"] },
      { name: "All" },
    ],
  },
  {
    slug: "dashboards/decisions",
    title: "Decisions",
    subtitle: "Decisions of record. Revisit_on flags periodic re-evaluation.",
    cardSubtitle: "Why-it-is-how-it-is",
    typeField: "decision",
    columns: [
      { key: "_basename", label: "Decision", kind: "link" },
      { key: "date", label: "Date", kind: "date" },
      { key: "decision", label: "Decision" },
      { key: "revisit_on", label: "Revisit", kind: "date" },
    ],
    facets: [
      { key: "project", label: "Project" },
      { key: "area", label: "Area" },
    ],
    statusGroups: [
      { name: "Live", default: true, include: ["accepted", "proposed"] },
      { name: "Superseded", include: ["superseded"] },
      { name: "Rejected", include: ["rejected"] },
      { name: "All" },
    ],
  },
  {
    slug: "dashboards/areas",
    title: "Areas",
    subtitle: "Ongoing domains. No finish line; review cadence is the operating frequency.",
    cardSubtitle: "Life/work domains",
    typeField: "area",
    columns: [
      { key: "_basename", label: "Area", kind: "link" },
      { key: "review_cadence", label: "Cadence" },
      { key: "next_review", label: "Next review", kind: "date" },
    ],
    facets: [{ key: "review_cadence", label: "Cadence" }],
    statusGroups: [
      { name: "Active", default: true, include: ["active"] },
      { name: "Inactive", include: ["dormant", "archived"] },
      { name: "All" },
    ],
  },
  {
    slug: "dashboards/ideas",
    title: "Ideas",
    subtitle: "Pre-commitment seeds. Promote to Task/Project once fleshed out, or drop with a reason.",
    cardSubtitle: "Seeds & possibilities",
    typeField: "idea",
    columns: [
      { key: "_basename", label: "Idea", kind: "link" },
      { key: "priority", label: "Pri" },
      { key: "project", label: "Project" },
      { key: "area", label: "Area" },
      { key: "effort_estimate", label: "Effort" },
    ],
    facets: [
      { key: "priority", label: "Priority" },
      { key: "effort_estimate", label: "Effort" },
      { key: "project", label: "Project" },
      { key: "area", label: "Area" },
      { key: "tags", label: "Tags" },
    ],
    statusGroups: [
      { name: "Open", default: true, include: ["raw", "exploring", "researching"] },
      { name: "Promoted", include: ["promoted"] },
      { name: "Dropped", include: ["dropped", "archived"] },
      { name: "All" },
    ],
  },
  {
    slug: "dashboards/implementations",
    title: "Implementations",
    subtitle: "How-it-works writeups. Last_validated flags doc staleness.",
    cardSubtitle: "How-it-works docs",
    typeField: "implementation",
    columns: [
      { key: "_basename", label: "Implementation", kind: "link" },
      { key: "project", label: "Project" },
      { key: "last_validated", label: "Last validated", kind: "date" },
    ],
    facets: [{ key: "project", label: "Project" }],
    statusGroups: [
      { name: "Active", default: true, include: ["active", "draft"] },
      { name: "Archived", include: ["archived"] },
      { name: "All" },
    ],
  },
  {
    slug: "dashboards/letters",
    title: "Letters",
    subtitle: "Recommendations / nominations / cover letters. Bytes live in Drive; this is the index.",
    cardSubtitle: "Recs · nominations · refs",
    typeField: "letter",
    columns: [
      { key: "_basename", label: "Letter", kind: "link" },
      { key: "recipient", label: "Recipient" },
      { key: "program", label: "Program" },
      { key: "target_category", label: "Category" },
      { key: "due", label: "Due", kind: "date" },
      { key: "cycle_year", label: "Cycle" },
    ],
    facets: [
      { key: "target_category", label: "Category" },
      { key: "program", label: "Program" },
      { key: "cycle_year", label: "Cycle" },
      { key: "recipient", label: "Recipient" },
    ],
    statusGroups: [
      { name: "Active", default: true, include: ["drafting"] },
      { name: "Submitted", include: ["submitted", "acknowledged"] },
      { name: "Archived", include: ["archived"] },
      { name: "All" },
    ],
    // Drafting letters with the soonest deadline are the most urgent.
    defaultSort: { key: "due", dir: 1 },
  },
]

// ----------------------------------------------------------------------------
// Helpers

function stripWikilink(s: unknown): unknown {
  if (typeof s !== "string") return s
  const m = s.match(/^\[\[(.+?)\]\]$/)
  return m ? m[1] : s
}

function normalize(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripWikilink)
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return stripWikilink(v)
}

function basenameFromSlug(slug: string): string {
  const parts = slug.split("/")
  return parts[parts.length - 1]
}

function pathToRoot(slug: string): string {
  const depth = slug.split("/").length - 1
  return depth === 0 ? "./" : "../".repeat(depth)
}

// ----------------------------------------------------------------------------
// Emit one dashboard via Quartz's renderPage (full chrome) plus an index.

async function emitDashboard(
  ctx: BuildCtx,
  cfg: DashboardConfig,
  rows: Array<Record<string, unknown>>,
  slugByBasename: Record<string, string>,
  allFiles: any[],
  resources: any,
): Promise<string> {
  const slug = cfg.slug as FullSlug
  const today = new Date().toISOString().slice(0, 10)

  // Normalize row values (strip [[…]], turn Date → ISO string)
  const cleanedRows = rows.map((r) => {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(r)) {
      if (k.startsWith("__")) continue
      out[k] = normalize(v)
    }
    if (out.status === undefined) out.status = ""
    return out
  })

  // Synthetic fileData. Quartz needs slug + filePath + frontmatter (title at
  // minimum) + dates. We attach the dashboard payload on `memexDashboard` —
  // the MemexDashboard component reads it from there.
  const fileData: any = {
    slug,
    filePath: (slug + ".md") as any,
    relativePath: (slug + ".md") as any,
    frontmatter: { title: cfg.title, tags: [] },
    aliases: [],
    description: cfg.subtitle,
    text: cfg.title,
    dates: { created: new Date(), modified: new Date(), published: new Date() },
    links: [],
    memexDashboard: {
      config: {
        title: cfg.title,
        subtitle: cfg.subtitle,
        columns: cfg.columns,
        facets: cfg.facets,
        statusGroups: cfg.statusGroups,
        defaultSort: cfg.defaultSort,
      },
      rows: cleanedRows,
      slugByBasename,
      root: pathToRoot(slug),
      today,
    },
  }

  // Empty hast root — the MemexDashboard component fills the body via JSX.
  const tree: HtmlRoot = { type: "root", children: [] }

  const externalResources = pageResources(pathToRoot(slug) as any, resources)
  const componentData = {
    ctx,
    fileData,
    externalResources,
    cfg: ctx.cfg.configuration,
    children: [],
    tree,
    allFiles,
  } as any

  // Page layout: keep Quartz's normal left/right/footer chrome but swap the
  // body for MemexDashboard. Skip breadcrumbs (no parent hierarchy makes sense).
  // NOTE: components are *constructors* — invoke to get the actual component.
  const layout: FullPageLayout = {
    ...sharedPageComponents,
    ...defaultContentPageLayout,
    pageBody: MemexDashboard(),
    beforeBody: [], // hide breadcrumbs / article title / content meta on dashboards
  } as any

  const content = renderPage(ctx.cfg.configuration, slug, componentData, layout, externalResources)
  return await write({ ctx, slug, ext: ".html", content })
}

async function emitDashboardIndex(
  ctx: BuildCtx,
  counts: Record<string, number>,
  allFiles: any[],
  resources: any,
): Promise<string> {
  const slug = "dashboards/index" as FullSlug

  // Render the cards inline as a hast tree so it goes through Content().
  // Easier: pre-render to an HTML string and use a hast "raw" node.
  const staleCount = counts["__stale__"] || 0
  const staleCard = `<a class="memex-card memex-card-stale" href="../${STALE_LENS_CONFIG.slug}">
      <h3>${STALE_LENS_CONFIG.title}</h3>
      <div class="card-count">${staleCount}</div>
      <div class="card-sub">${STALE_LENS_CONFIG.cardSubtitle}</div>
    </a>`
  const cards = staleCard + "\n" + DASHBOARDS.map((d) => {
    const count = counts[d.typeField] || 0
    return `<a class="memex-card" href="../${d.slug}">
      <h3>${d.title}</h3>
      <div class="card-count">${count}</div>
      <div class="card-sub">${d.cardSubtitle}</div>
    </a>`
  }).join("\n")

  const html = `
<style>
.memex-index-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 1rem; margin-top: 1rem; }
.memex-card { display: block; padding: 1.1rem; background: var(--light); border: 1px solid var(--lightgray); border-radius: 8px; text-decoration: none; color: inherit; transition: transform 0.1s, box-shadow 0.1s; }
.memex-card:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.05); border-color: var(--secondary); }
.memex-card h3 { font-size: 1rem; margin: 0 0 0.4rem 0; color: var(--secondary); font-weight: 600; }
.memex-card .card-count { font-size: 1.6rem; font-weight: 600; line-height: 1; }
.memex-card .card-sub { color: var(--gray); font-size: 0.8rem; margin-top: 0.4rem; }
.memex-card-stale { border-color: #d05a3a; }
.memex-card-stale h3 { color: #d05a3a; }
.memex-card-stale:hover { border-color: #d05a3a; box-shadow: 0 4px 12px rgba(208,90,58,0.15); }
</style>
<h1>Dashboards</h1>
<p>Filterable views of the vault. Each card opens its dashboard.</p>
<div class="memex-index-grid">${cards}</div>
<p style="margin-top: 2rem; color: var(--gray); font-size: 0.85rem;">In each dashboard: <code>/</code> focus search · <code>Esc</code> clear filters · click column headers to sort · click chips to filter · click cell values to open the note · ↗ to jump to that item's dashboard.</p>
`

  const fileData: any = {
    slug,
    filePath: (slug + ".md") as any,
    relativePath: (slug + ".md") as any,
    frontmatter: { title: "Dashboards", tags: [] },
    aliases: [],
    description: "All Memex dashboards",
    text: "Dashboards",
    dates: { created: new Date(), modified: new Date(), published: new Date() },
    links: [],
  }
  const tree: HtmlRoot = {
    type: "root",
    children: [{ type: "raw", value: html } as any],
  }
  const externalResources = pageResources(pathToRoot(slug) as any, resources)
  const componentData = {
    ctx,
    fileData,
    externalResources,
    cfg: ctx.cfg.configuration,
    children: [],
    tree,
    allFiles,
  } as any
  // Inline pageBody that emits the prebuilt HTML directly. Quartz's normal
  // Content() pipes the hast tree through `hast-util-to-jsx-runtime`, which
  // doesn't process "raw" nodes — so the dashboards-index cards were rendering
  // as an empty <article>. Use dangerouslySetInnerHTML via preact's h() so the
  // raw HTML lands intact (the file is .ts and can't use JSX syntax directly).
  const RawHtmlBody: any = () =>
    h("article", { class: "popover-hint", dangerouslySetInnerHTML: { __html: html } })
  const layout: FullPageLayout = {
    ...sharedPageComponents,
    ...defaultContentPageLayout,
    pageBody: RawHtmlBody,
    beforeBody: [],
  } as any
  const content = renderPage(ctx.cfg.configuration, slug, componentData, layout, externalResources)
  return await write({ ctx, slug, ext: ".html", content })
}

// ----------------------------------------------------------------------------
// Stale-lens: a cross-type triage dashboard.
//
// Pulls rows from multiple typed pools and surfaces those needing attention:
//   - Tasks: status active AND due < today
//   - Followups: status pending AND surface_on < today
//   - Trackers: status active AND next_check < today
//   - People: status active AND last_contact + contact_cadence × 1.5 < today
//   - Sources: status unprocessed AND captured < today - 7d
// Each row gets a synthetic `_reason` column and a `_kind` field for filtering.

function daysAgo(dateStr: string | undefined | null, todayMs: number): number | null {
  if (!dateStr || typeof dateStr !== "string") return null
  const t = Date.parse(dateStr)
  if (Number.isNaN(t)) return null
  return Math.floor((todayMs - t) / 86_400_000)
}

const CADENCE_DAYS: Record<string, number> = {
  weekly: 7,
  biweekly: 14,
  monthly: 30,
  quarterly: 90,
  yearly: 365,
  adhoc: 365, // treat as yearly for stale-lens purposes
}

function buildStaleRows(
  byType: Record<string, Array<Record<string, unknown>>>,
  today: string,
): Array<Record<string, unknown>> {
  const todayMs = Date.parse(today + "T00:00:00Z")
  const out: Array<Record<string, unknown>> = []

  const activeTaskStatuses = new Set(["next", "in_progress", "scheduled", "waiting", "needs_review"])
  for (const r of byType["task"] || []) {
    const status = String(r.status || "")
    if (!activeTaskStatuses.has(status)) continue
    const d = daysAgo(r.due as string, todayMs)
    if (d === null || d < 0) continue
    out.push({
      _basename: r._basename, _slug: r._slug,
      _kind: "Task",
      _reason: `Task overdue by ${d}d`,
      _ref_date: r.due,
      _days_late: d,
      status, priority: r.priority, project: r.project, owner: r.owner,
    })
  }

  for (const r of byType["followup"] || []) {
    const status = String(r.status || "")
    if (status !== "pending") continue
    const d = daysAgo(r.surface_on as string, todayMs)
    if (d === null || d < 0) continue
    out.push({
      _basename: r._basename, _slug: r._slug,
      _kind: "Followup",
      _reason: `Followup overdue by ${d}d`,
      _ref_date: r.surface_on,
      _days_late: d,
      status, project: r.about, owner: "",
    })
  }

  for (const r of byType["tracker"] || []) {
    const status = String(r.status || "")
    if (status !== "active") continue
    const d = daysAgo(r.next_check as string, todayMs)
    if (d === null || d < 0) continue
    out.push({
      _basename: r._basename, _slug: r._slug,
      _kind: "Tracker",
      _reason: `Tracker next_check overdue by ${d}d`,
      _ref_date: r.next_check,
      _days_late: d,
      status, project: "", owner: "",
    })
  }

  for (const r of byType["person"] || []) {
    const status = String(r.status || "")
    if (status !== "active") continue
    const cadence = String(r.contact_cadence || "")
    const lc = r.last_contact as string
    const cadDays = CADENCE_DAYS[cadence]
    if (!cadDays || !lc) continue
    const daysSince = daysAgo(lc, todayMs)
    if (daysSince === null) continue
    const limit = Math.round(cadDays * 1.5)
    const overBy = daysSince - limit
    if (overBy < 0) continue
    out.push({
      _basename: r._basename, _slug: r._slug,
      _kind: "Person",
      _reason: `${daysSince}d since last contact (cadence ${cadence} × 1.5 = ${limit}d)`,
      _ref_date: lc,
      _days_late: overBy,
      status, project: "", owner: "",
    })
  }

  for (const r of byType["source"] || []) {
    const status = String(r.status || "")
    if (status !== "unprocessed" && status !== "new") continue
    const d = daysAgo(r.captured as string, todayMs)
    if (d === null || d <= 7) continue
    out.push({
      _basename: r._basename, _slug: r._slug,
      _kind: "Source",
      _reason: `Source unprocessed ${d}d (>7d)`,
      _ref_date: r.captured,
      _days_late: d - 7,
      status, project: "", owner: "",
    })
  }

  out.sort((a, b) => Number(b._days_late || 0) - Number(a._days_late || 0))
  return out
}

const STALE_LENS_CONFIG: DashboardConfig = {
  slug: "dashboards/stale", // slug kept as /stale to avoid breaking existing links; display name is "Needs attention"
  title: "Needs attention",
  subtitle: "Cross-type triage: overdue Tasks, surfaced Followups, stale Trackers, drifted People, unprocessed Sources.",
  cardSubtitle: "Cross-type triage",
  typeField: "__stale__", // synthetic; not matched against frontmatter
  columns: [
    { key: "_basename", label: "Note", kind: "link" },
    { key: "_kind", label: "Kind" },
    { key: "_reason", label: "Why it surfaced" },
    { key: "_ref_date", label: "Ref date", kind: "date" },
    { key: "_days_late", label: "Days late" },
    { key: "status", label: "Status", kind: "status" },
  ],
  facets: [
    { key: "_kind", label: "Kind" },
    { key: "status", label: "Status" },
  ],
  statusGroups: [
    { name: "All", default: true },
  ],
}

async function buildAllDashboards(
  ctx: BuildCtx,
  content: ProcessedContent[],
  resources: any,
): Promise<string[]> {
  const byType: Record<string, Array<Record<string, unknown>>> = {}
  const slugByBasename: Record<string, string> = {}

  for (const [, file] of content) {
    const fm = (file as any).data?.frontmatter
    if (!fm || typeof fm !== "object") continue
    const t = (fm as { type?: unknown }).type
    if (!t || typeof t !== "string") continue
    const slug: string = (file as any).data.slug
    if (!slug) continue
    const stem: string | undefined = (file as any).stem
    const basename = stem ?? basenameFromSlug(slug)
    slugByBasename[basename] = slug
    const row: Record<string, unknown> = { ...fm, _basename: basename, _slug: slug }
    ;(byType[t] ||= []).push(row)
  }

  const allFiles = content.map((c) => (c[1] as any).data)

  const written: string[] = []
  for (const cfg of DASHBOARDS) {
    const rows = byType[cfg.typeField] || []
    rows.sort((a, b) => String(a._basename).localeCompare(String(b._basename)))
    const p = await emitDashboard(ctx, cfg, rows, slugByBasename, allFiles, resources)
    written.push(p)
  }

  // Needs attention (slug: /stale) — cross-type triage. Emitted with the same plumbing.
  const today = new Date().toISOString().slice(0, 10)
  const staleRows = buildStaleRows(byType, today)
  const staleP = await emitDashboard(ctx, STALE_LENS_CONFIG, staleRows, slugByBasename, allFiles, resources)
  written.push(staleP)

  const counts: Record<string, number> = {}
  for (const cfg of DASHBOARDS) counts[cfg.typeField] = (byType[cfg.typeField] || []).length
  counts["__stale__"] = staleRows.length
  const idxPath = await emitDashboardIndex(ctx, counts, allFiles, resources)
  written.push(idxPath)

  return written
}

// ----------------------------------------------------------------------------
// Plugin

export const MemexDashboards: QuartzEmitterPlugin = () => ({
  name: "MemexDashboards",

  // Tell Quartz which components this emitter uses so their CSS/JS get bundled
  // into the global resources. Without this, MemexDashboard.css and its
  // afterDOMLoaded script wouldn't be included.
  getQuartzComponents() {
    const layoutComponents = [
      ...sharedPageComponents.header,
      ...sharedPageComponents.afterBody,
      sharedPageComponents.head,
      sharedPageComponents.footer,
      ...defaultContentPageLayout.left,
      ...defaultContentPageLayout.right,
      MemexDashboard(),
      HeaderConstructor(),
      BodyConstructor(),
    ]
    return layoutComponents as any
  },

  async emit(ctx, content, resources) {
    const paths = await buildAllDashboards(ctx, content, resources)
    return paths as FilePath[]
  },

  async *partialEmit(ctx, content, resources) {
    const paths = await buildAllDashboards(ctx, content, resources)
    for (const p of paths) yield p as FilePath
  },
})
