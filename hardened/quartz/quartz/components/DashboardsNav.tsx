import { pathToRoot } from "../util/path"
import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { classNames } from "../util/lang"

// A row of dashboard buttons — one per dashboard — for one-hop switching, shown
// in two slots:
//   - left sidebar above Explorer (folder tree): the row WRAPS into a compact block
//   - header strip on every page: the row stays one line and scrolls horizontally
// The current dashboard is highlighted; a trailing "All ↗" button links to the
// cards overview at /dashboards/index. (Replaced the old hover popup, which was
// undiscoverable — now every dashboard is a visible button.)
//
// The dashboard list below must be kept in sync with DASHBOARDS in
// quartz/plugins/emitters/memexDashboards.ts plus the synthetic stale-lens
// entry. If you add a dashboard, add a line here too.

type Entry = { slug: string; title: string; stale?: boolean }

// Order reflects usage frequency: the most-used dashboards first, the rest after.
// Keep in sync with DASHBOARDS in quartz/plugins/emitters/memexDashboards.ts.
const DASHBOARDS_FOR_NAV: Entry[] = [
  { slug: "dashboards/tasks", title: "Tasks" },
  { slug: "dashboards/ideas", title: "Ideas" },
  { slug: "dashboards/projects", title: "Projects" },
  { slug: "dashboards/areas", title: "Areas" },
  { slug: "dashboards/concepts", title: "Concepts" },
  { slug: "dashboards/people", title: "People" },
  // less-used, any order:
  { slug: "dashboards/organizations", title: "Organizations" },
  { slug: "dashboards/sources", title: "Sources" },
  { slug: "dashboards/trackers", title: "Trackers" },
  { slug: "dashboards/followups", title: "Followups" },
  { slug: "dashboards/decisions", title: "Decisions" },
  { slug: "dashboards/implementations", title: "Implementations" },
  { slug: "dashboards/stale", title: "Needs attention", stale: true },
]

const DashboardsNav: QuartzComponent = ({ fileData, displayClass }: QuartzComponentProps) => {
  const baseDir = pathToRoot(fileData.slug!)
  // pathToRoot returns "." for the root slug and "../" segments otherwise — no
  // trailing slash either way. Join with "/" so we always get a valid URL.
  const indexHref = `${baseDir}/dashboards/index`
  const currentSlug = fileData.slug ?? ""

  return (
    <nav
      class={classNames(displayClass, "dashboards-nav")}
      aria-label="Dashboards"
    >
      <div class="dashboards-nav-row">
        {DASHBOARDS_FOR_NAV.map((d) => {
          const isCurrent = currentSlug === d.slug
          const cls =
            "dashboards-nav-btn" +
            (d.stale ? " is-stale" : "") +
            (isCurrent ? " is-current" : "")
          return (
            <a
              class={cls}
              href={`${baseDir}/${d.slug}`}
              aria-current={isCurrent ? "page" : undefined}
            >
              {d.title}
            </a>
          )
        })}
        <a class="dashboards-nav-btn is-all" href={indexHref}>
          All ↗
        </a>
      </div>
    </nav>
  )
}

DashboardsNav.css = `
.dashboards-nav {
  margin: 0.4rem 0 0.8rem 0;
  min-width: 0;
}
.dashboards-nav-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.3rem;
}
.dashboards-nav-btn {
  display: inline-flex;
  align-items: center;
  padding: 0.25rem 0.55rem;
  font-size: 0.78rem;
  line-height: 1.2;
  text-decoration: none;
  background: color-mix(in oklab, var(--light) 50%, var(--lightgray) 50%);
  color: var(--dark);
  border: 1px solid var(--lightgray);
  border-radius: 6px;
  font-family: var(--bodyFont);
  font-weight: 500;
  white-space: nowrap;
  transition: border-color 0.1s, background 0.1s, color 0.1s;
}
.dashboards-nav-btn:hover {
  border-color: var(--secondary);
  background: var(--light);
  color: var(--secondary);
}
.dashboards-nav-btn.is-current {
  background: var(--secondary);
  border-color: var(--secondary);
  color: var(--light);
  font-weight: 600;
}
.dashboards-nav-btn.is-current:hover {
  color: var(--light);
}
.dashboards-nav-btn.is-stale {
  color: #d05a3a;
  border-color: color-mix(in oklab, #d05a3a 35%, var(--lightgray) 65%);
}
.dashboards-nav-btn.is-stale:hover {
  border-color: #d05a3a;
  background: rgba(208, 90, 58, 0.08);
  color: #d05a3a;
}
.dashboards-nav-btn.is-stale.is-current {
  background: #d05a3a;
  border-color: #d05a3a;
  color: var(--light);
}
.dashboards-nav-btn.is-all {
  color: var(--gray);
  font-weight: 500;
}
.dashboards-nav-btn.is-all:hover {
  color: var(--secondary);
}

/* Header slot: let the buttons wrap onto multiple rows (no horizontal scrollbar).
   With 14 buttons this lands on ~2 rows at typical widths. */
header > .dashboards-nav {
  margin: 0;
}
header > .dashboards-nav .dashboards-nav-row {
  flex-wrap: wrap;
}
`

export default (() => DashboardsNav) satisfies QuartzComponentConstructor
