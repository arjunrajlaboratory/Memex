// End-to-end test for the briefing review client (hardened/scripts/briefing_review_app.js)
// driven through every surface the generator emits. Run: node tests/briefing_review_e2e.mjs
//
// Builds a temp vault with a synthetic briefing (invented names only), then drives
// the page (file://), server, widget (inline + framed) and artifact surfaces in Chromium.
import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(REPO, "hardened", "scripts", "briefing_review.py");
const SHOTS = "/tmp/claude-0/-home-user-Memex/a8109344-0f9f-5442-b3f0-107a5b7f43d2/scratchpad";
const DATE = "2026-11-12"; // Thursday
const SITE = "http://localhost:4321";
const HEADER = `Briefing review — ${DATE} (apply with the apply-review skill)`;
const ROW_RE = /^- \[\d+\](?: \S+)? [A-Z_]+(?:\(.*?\))? — .+$/;

// ------------------------------------------------------------------ results

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${!ok && detail ? ` — ${detail}` : ""}`);
}
async function step(name, fn) {
  console.log(`\n# ${name}`);
  try {
    await fn();
  } catch (err) {
    check(`${name}: no exception`, false, err && err.stack ? err.stack.split("\n").slice(0, 4).join(" | ") : String(err));
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, timeout = 6000) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v || Date.now() > end) return v;
    await sleep(100);
  }
}

// ------------------------------------------------------------------ fixture

function fixtureItems() {
  const t = (title, section, text, extra = {}) => ({
    id: `task:Ops/Tasks/${title}`, section, kind: "task", target: `Ops/Tasks/${title}.md`,
    text: `[[${title}]] — ${text}`, sensitivity: "normal", ...extra,
  });
  const k = (kind, folder, title, section, text, extra = {}) => ({
    id: `${kind}:${folder}/${title}`, section, kind, target: `${folder}/${title}.md`,
    text: `[[${title}]] — ${text}`, sensitivity: "normal", ...extra,
  });
  const S0 = { section_title: "State confirmation needed" };
  const S3 = { section_title: "Tasks due or scheduled today" };
  return [
    t("Send revised budget to Dana", "0", "`status: in_progress` (due 2026-11-10).",
      { ...S0, label: "#1", detail: ["signal: you emailed Dana the draft 2026-11-09"], also_in: ["3"] }),
    t("Submit IRB amendment", "0", "`status: needs_review` (due 2026-11-05).", { ...S0, label: "#2" }),
    { id: "item:2026-11-12:0:1a2b3c4d", section: "0", ...S0, label: "#2a", kind: "item",
      text: "[[Consent form v3]] — still `drafting`", sensitivity: "normal" },
    t("Book flights for the retreat", "0", "`status: scheduled`, block passed yesterday.", { ...S0, label: "#3" }),
    t("Review Priya analysis notebook", "3", "effort S, **priority high**", S3),
    t("Fix plotting script", "3", "`matplotlib` legend overlaps the axis labels", S3),
    t("Order antibodies for panel B", "3", "due today, effort XS", { ...S3, group: "Lab logistics" }),
    t("Schedule microscope training", "3", "two slots offered by the core", {
      ...S3, group: "Lab logistics", carried_from: "2026-11-11",
      previous: { date: "2026-11-11", action: "defer", params: { date: "2026-11-16" }, note: "after the vendor call" },
    }),
    t("Revised quote from Helix Bio", "4", "waiting on Marco since 2026-11-03", { section_title: "Waiting on others" }),
    k("project", "Atlas/Projects", "Coral Reef Atlas", "5", "`next_review` overdue by 9 days", { section_title: "Projects at risk" }),
    k("project", "Atlas/Projects", "Grant renewal 2027", "5", "critical-path blocker: letters of support", { section_title: "Projects at risk" }),
    k("capture", "Inbox", "2026-11-11 voice memo", "6", "3 min, mentions the retreat agenda", { section_title: "New captures needing triage" }),
    k("capture", "Inbox", "Paper - Okafor 2026 single-cell atlas", "6", "PDF clipped yesterday", { section_title: "New captures needing triage" }),
    k("job", "Agents/Jobs", "20261110-001 - literature scan", "7", "`status: ready`", { section_title: "Agent opportunities" }),
    { id: "proposal:2026-11-12:7:9f8e7d6c", section: "7", section_title: "Agent opportunities", kind: "proposal",
      text: "Draft retreat logistics summary for the group channel", sensitivity: "normal" },
    k("tracker", "Atlas/Trackers", "Funding calls", "8", "due today", { section_title: "Trackers — Due today" }),
    k("tracker", "Atlas/Trackers", "Competitor preprints", "8", "fresh digest: 2 material changes",
      { section_title: "Trackers — Fresh digests (material change)" }),
    k("person", "Atlas/People", "Robin Park", "9", "last contact 41 days ago", { section_title: "People — Follow up today" }),
    k("person", "Atlas/People", "Marco Silva", "9", "you owe him feedback on the poster", { section_title: "People — I owe" }),
    k("person", "Atlas/People", "Aiko Tanaka", "9", "quarterly check-in due",
      { section_title: "People — Relationship maintenance", sensitivity: "private" }),
    k("followup", "Ops/Followups", "ask about sample shipment - 2026-11-01", "10", "surfaces today",
      { section_title: "Followups surfaced today" }),
    k("followup", "Ops/Followups", "check conference deadline - 2026-11-05", "10", "abstract portal closes 2026-11-20",
      { section_title: "Followups surfaced today" }),
    k("decision", "Atlas/Decisions", "Choose sequencing vendor", "11", "two quotes in; *price vs turnaround*",
      { section_title: "Decisions needed" }),
    k("decision", "Atlas/Decisions", "Adopt new ELN", "11", "trial ends Friday", { section_title: "Decisions needed" }),
    t("Draft reviewer response", "asks", "asked for Friday; reviewer 2 wants the extra control experiment and a " +
      "rewritten methods paragraph covering the imaging pipeline, normalisation and statistics in more detail than before",
      { section_title: "Principal asks" }),
  ];
}

function makeVault() {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "briefing-review-e2e-"));
  const items = fixtureItems();
  for (const it of items) {
    if (!it.target) continue;
    const p = path.join(vault, it.target);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, `---\ntype: note\nsensitivity: ${it.sensitivity}\n---\n# ${path.basename(p, ".md")}\n`);
  }
  const dir = path.join(vault, "Ops", "Briefings");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${DATE}.md`), `---\ntype: briefing\ndate: ${DATE}\n---\n# Daily briefing\n`);
  fs.writeFileSync(path.join(dir, `${DATE}.items.json`), JSON.stringify({
    schema: "memex.briefing-items/v1", date: DATE, generated_at: `${DATE}T07:30:00-05:00`, items,
  }, null, 2));
  return { vault, items };
}

function cli(vault, args, input) {
  const res = spawnSync("python3", [SCRIPT, "--vault", vault, ...args], { input, encoding: "utf8" });
  if (res.status !== 0) throw new Error(`briefing_review.py ${args.join(" ")} failed (${res.status}): ${res.stderr}`);
  return res.stdout.trim();
}

// ------------------------------------------------------------------ page helpers

const row = (n) => `#review-root .rv-row[data-n="${n}"]`;
async function activeRow(page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    const r = el && el.closest && el.closest(".rv-row");
    return r ? { n: r.getAttribute("data-n"), cls: el.className } : null;
  });
}
async function pressed(page, n) {
  return page.$$eval(`${row(n)} .rv-pill[aria-pressed="true"]`, (els) => els.map((e) => e.getAttribute("data-action")));
}
async function counter(page) {
  return page.$eval("#review-root .rv-progress b", (b) => b.textContent);
}

// The standard set of answers used on the page surface (and for the screenshots).
async function answerSome(page) {
  await page.click(`${row(1)} .rv-note`);
  await page.keyboard.press("Alt+1");
  await page.keyboard.type("ping Dana with the link first");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Alt+3"); // defer
  await page.keyboard.type("mon");
  await page.keyboard.press("Tab");
  await page.click(`${row(9)} .rv-note`);
  await page.keyboard.press("Alt+4"); // waiting
  await page.keyboard.type("Marco");
  await page.keyboard.press("Enter");
  await page.click(`${row(15)} .rv-pill[data-action="create_task"]`);
  await page.click(`${row(18)} .rv-pill[data-action="touched"]`);
  await page.click(`${row(20)} .rv-note`);
  await page.keyboard.type("discuss with Aiko first");
  await page.click(`${row(12)} .rv-pill[data-action="file"]`);
}

// ------------------------------------------------------------------ main

async function main() {
  const { vault, items } = makeVault();
  console.log(`vault: ${vault}`);
  const browser = await chromium.launch();
  let server = null;
  try {
    await step("page surface over file://", async () => {
      const file = cli(vault, ["build", DATE, "--surface", "page", "--site", SITE]);
      check("build prints the default page path", file.endsWith(path.join("outputs", "briefing-review", `${DATE}.html`)), file);
      const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 2 });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto(pathToFileURL(file).href);
      await page.waitForSelector(row(1));
      check("renders every item", (await page.$$("#review-root .rv-row")).length === items.length);
      check("counter starts at 0", (await counter(page)) === "0");
      check("submit label is 'Copy for Claude'", (await page.textContent("#review-root .rv-btn-primary")).trim() === "Copy for Claude");
      check("'Do it' is the first pill on every row", await page.$$eval("#review-root .rv-row", (rows) =>
        rows.every((r) => r.querySelector(".rv-pill").getAttribute("data-action") === "do")));
      const link = await page.$eval(`${row(1)} .rv-text a`, (a) => a.href);
      check("wikilinks link to the site with the slug rule", link === `${SITE}/Ops/Tasks/Send-revised-budget-to-Dana`, link);
      const link13 = await page.$eval(`${row(13)} .rv-text a`, (a) => a.getAttribute("href"));
      check("' - ' becomes '---' in slugs", link13.includes("Paper---Okafor-2026-single-cell-atlas"), link13);
      check("bold / code / italic rendered", (await page.$(`${row(5)} strong`)) && (await page.$(`${row(6)} code`)) && (await page.$(`${row(23)} em`)));
      check("also-in tag shown", (await page.textContent(`${row(1)} .rv-tag`)).includes("§3"));
      check("detail line shown", (await page.textContent(`${row(1)} .rv-detail`)).includes("signal: you emailed Dana"));
      check("group label rendered", (await page.$$eval("#review-root .rv-group", (g) => g.map((x) => x.textContent))).includes("Lab logistics"));

      // Tab moves between note fields only.
      await page.click(`${row(1)} .rv-note`);
      await page.keyboard.press("Tab");
      let a = await activeRow(page);
      check("Tab moves to the next row's note", a && a.n === "2" && a.cls.includes("rv-note"), JSON.stringify(a));
      await page.keyboard.press("Shift+Tab");
      a = await activeRow(page);
      check("Shift+Tab moves back", a && a.n === "1" && a.cls.includes("rv-note"), JSON.stringify(a));
      check("focused row shows pill digits", await page.$eval(`${row(1)} .rv-key`, (k) => getComputedStyle(k).display !== "none"));

      // Alt+1 / Alt+digit / Alt+0.
      await page.keyboard.press("Alt+1");
      check("Alt+1 picks 'Do it'", JSON.stringify(await pressed(page, 1)) === '["do"]');
      check("answered row has a coloured left border", await page.$eval(row(1), (r) => r.classList.contains("rv-answered") && getComputedStyle(r).borderLeftColor !== "rgba(0, 0, 0, 0)"));
      await page.keyboard.press("Alt+7");
      check("Alt+7 picks the 7th pill (keep)", JSON.stringify(await pressed(page, 1)) === '["keep"]');
      await page.keyboard.press("Alt+0");
      check("Alt+0 clears", (await pressed(page, 1)).length === 0);
      a = await activeRow(page);
      check("focus stays on the note", a && a.n === "1" && a.cls.includes("rv-note"));

      // Clicking a selected pill clears it.
      await page.click(`${row(4)} .rv-pill[data-action="done"]`);
      check("clicking a pill selects it", JSON.stringify(await pressed(page, 4)) === '["done"]');
      await page.click(`${row(4)} .rv-pill[data-action="done"]`);
      check("clicking the selected pill clears it", (await pressed(page, 4)).length === 0);

      // Defer reveals a date input; 'mon' resolves relative to the briefing date.
      await page.click(`${row(2)} .rv-note`);
      await page.keyboard.press("Alt+3");
      a = await activeRow(page);
      check("defer focuses the date input", a && a.n === "2" && a.cls.includes("rv-param-input"), JSON.stringify(a));
      check("date input visible", await page.isVisible(`${row(2)} .rv-param-input`));
      await page.keyboard.type("mon");
      await page.keyboard.press("Tab");
      a = await activeRow(page);
      check("Tab from the param input returns to the note", a && a.n === "2" && a.cls.includes("rv-note"), JSON.stringify(a));
      const resolved = await page.textContent(`${row(2)} .rv-resolved`);
      check("'mon' resolves to 2026-11-16", resolved.includes("2026-11-16"), resolved);
      check("param input hidden on rows without a param action", !(await page.isVisible(`${row(3)} .rv-param-input`)));

      // create_task prefills a title.
      await page.click(`${row(15)} .rv-pill[data-action="create_task"]`);
      const title = await page.inputValue(`${row(15)} .rv-param-input`);
      check("create_task prefills from the first words", title === "Draft retreat logistics summary for the group channel", title);
      await page.click(`${row(21)} .rv-pill[data-action="create_task"]`);
      const title2 = await page.inputValue(`${row(21)} .rv-param-input`);
      check("create_task prefills from the leading wikilink", title2 === "ask about sample shipment - 2026-11-01", title2);
      await page.click(`${row(21)} .rv-pill[data-action="create_task"]`);

      // Note-only row and the counter.
      await page.click(`${row(17)} .rv-note`);
      await page.keyboard.type("check after lunch\nand again tomorrow");
      check("textarea auto-grows", await page.$eval(`${row(17)} .rv-note`, (t) => t.offsetHeight > 40));
      await page.click(`${row(1)} .rv-note`);
      await page.keyboard.press("Alt+1");
      await page.keyboard.type("ping Dana with the link first");
      check("answered counter", (await counter(page)) === "4", await counter(page));

      // Yesterday chip re-applies the previous answer.
      check("yesterday chip shown", (await page.textContent(`${row(8)} .rv-chip`)).startsWith("yesterday: DEFER"));
      await page.click(`${row(8)} .rv-note`);
      await page.keyboard.press("Alt+r");
      check("Alt+R re-applies yesterday's answer", JSON.stringify(await pressed(page, 8)) === '["defer"]');
      await page.keyboard.press("Alt+0");

      // State survives reload.
      await page.reload();
      await page.waitForSelector(row(1));
      check("state survives reload (pills)", JSON.stringify(await pressed(page, 2)) === '["defer"]');
      check("state survives reload (note)", (await page.inputValue(`${row(1)} .rv-note`)) === "ping Dana with the link first");
      check("state survives reload (counter)", (await counter(page)) === "4");
      check("state survives reload (date shortcut)", (await page.inputValue(`${row(2)} .rv-param-input`)) === "mon");

      // Submit -> export panel; grammar; round trip through save --from-export.
      await page.click("#review-root .rv-btn-primary");
      await page.waitForSelector('#review-root .rv-banner[data-kind="ok"]');
      const exported = await page.inputValue("#review-root .rv-export textarea");
      const lines = exported.split("\n");
      check("export header", lines[0] === HEADER, lines[0]);
      const rowLines = lines.filter((l) => l.startsWith("- ["));
      check("export has one line per answered row", rowLines.length === 4, String(rowLines.length));
      check("export rows match the grammar", rowLines.every((l) => ROW_RE.test(l)), rowLines.find((l) => !ROW_RE.test(l)) || "");
      check("export DO row + note line", exported.includes("- [1] #1 DO — [[Send revised budget to Dana]] — status: in_progress (due 2026-11-10).\n    → ping Dana with the link first"));
      check("export DEFER resolved", exported.includes("- [2] #2 DEFER(2026-11-16) — [[Submit IRB amendment]]"));
      check("export CREATE_TASK with title", exported.includes("- [15] CREATE_TASK(Draft retreat logistics summary for the group channel) — "));
      check("export NOTE row joins lines with ' / '", exported.includes("- [17] NOTE — [[Competitor preprints]]") && exported.includes("→ check after lunch / and again tomorrow"));
      check("export section headings", exported.includes("§0 State confirmation needed") && exported.includes("§7 Agent opportunities"));
      check("export footer", exported.trimEnd().endsWith(`(${items.length - 4} rows left unanswered — leave as is.)`));
      check("submit button shows confirmation", (await page.textContent("#review-root .rv-btn-primary")).includes("Copied"));
      cli(vault, ["save", "--from-export"], exported);
      const saved = JSON.parse(fs.readFileSync(path.join(vault, "Inbox", "reviews", `${DATE}.json`), "utf8"));
      const got = Object.fromEntries(saved.answers.map((x) => [x.n, [x.action, JSON.stringify(x.params), x.note]]));
      check("round trip: save --from-export", saved.submitted === true && JSON.stringify(got) === JSON.stringify({
        1: ["do", "{}", "ping Dana with the link first"],
        2: ["defer", '{"date":"2026-11-16"}', ""],
        15: ["create_task", '{"title":"Draft retreat logistics summary for the group channel"}', ""],
        17: [null, "{}", "check after lunch / and again tomorrow"],
      }), JSON.stringify(got));
      const clientAnswers = await page.$eval("#review-root", (r) => r.reviewApp.answers(true));
      check("client answers object matches the contract shape", clientAnswers.schema === "memex.briefing-review/v1" &&
        clientAnswers.answers.length === 4 && clientAnswers.unanswered.length === items.length - 4 &&
        clientAnswers.answers[1].params.date === "2026-11-16");
      fs.rmSync(path.join(vault, "Inbox", "reviews", `${DATE}.json`));

      // No horizontal scroll at phone width.
      await page.setViewportSize({ width: 375, height: 800 });
      await sleep(100);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check("no horizontal scroll at 375px", overflow <= 0, String(overflow));
      const gutter = await page.$eval(row(1), (r) => r.getBoundingClientRect().left);
      check("16px side gutter at phone width", gutter >= 15 && gutter <= 18, String(gutter));
      check("single column under 820px", await page.$eval(row(1), (r) => getComputedStyle(r).gridTemplateColumns.split(" ").length === 1));
      await page.screenshot({ path: path.join(SHOTS, "review-phone.png"), fullPage: false });
      check("no page errors", errors.length === 0, errors.join(" | "));
      await context.close();
    });

    await step("screenshots (light + dark)", async () => {
      const file = path.join(vault, "outputs", "briefing-review", `${DATE}.html`);
      const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 2, colorScheme: "light" });
      const page = await context.newPage();
      await page.goto(pathToFileURL(file).href);
      await page.waitForSelector(row(1));
      await page.click("#review-root .rv-btn-quiet");
      await page.click("#review-root .rv-btn-quiet"); // confirm reset
      check("reset clears answers", (await counter(page)) === "0");
      await answerSome(page);
      await page.click(`${row(2)} .rv-note`);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: path.join(SHOTS, "review-light.png"), fullPage: true });
      await page.emulateMedia({ colorScheme: "dark" });
      const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      check("dark mode switches the body background", bg !== "rgb(246, 246, 243)", bg);
      await page.screenshot({ path: path.join(SHOTS, "review-dark.png"), fullPage: true });
      await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
      const forced = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      check("data-theme=light overrides a dark system theme", forced === "rgb(246, 246, 243)", forced);
      await context.close();
    });

    await step("server surface", async () => {
      server = spawn("python3", [SCRIPT, "--vault", vault, "serve", "--port", "0", "--site", SITE], { stdio: ["ignore", "pipe", "pipe"] });
      const port = await new Promise((resolve, reject) => {
        let buf = "";
        server.stdout.on("data", (d) => {
          buf += d;
          const m = /:(\d+)\/review/.exec(buf);
          if (m) resolve(+m[1]);
        });
        server.on("exit", (code) => reject(new Error(`serve exited ${code}`)));
        setTimeout(() => reject(new Error("serve did not start")), 10000);
      });
      const answersFile = path.join(vault, "Inbox", "reviews", `${DATE}.json`);
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await context.newPage();
      const resp = await page.goto(`http://127.0.0.1:${port}/review`);
      check("GET /review redirects to the latest date", page.url().endsWith(`/review/${DATE}`) && resp.ok(), page.url());
      await page.waitForSelector(row(1));
      check("server submit label", (await page.textContent("#review-root .rv-btn-primary")).trim() === "Submit");
      check("secondary Copy button", (await page.$$eval("#review-root .rv-btn", (b) => b.map((x) => x.textContent))).includes("Copy"));
      await page.click(`${row(5)} .rv-note`);
      await page.keyboard.press("Alt+2");
      await page.keyboard.type("closed on Tuesday");
      const draft = await until(() => {
        try {
          const d = JSON.parse(fs.readFileSync(answersFile, "utf8"));
          return d.answers.length === 1 && d.answers[0].note === "closed on Tuesday" ? d : null;
        } catch { return null; }
      });
      check("autosaves a draft", draft && draft.submitted === false && draft.surface === "server" && draft.answers[0].action === "done",
        JSON.stringify(draft));
      await page.click("#review-root .rv-btn-primary");
      await page.waitForSelector('#review-root .rv-banner[data-kind="ok"]', { timeout: 5000 });
      const sub = JSON.parse(fs.readFileSync(answersFile, "utf8"));
      check("Submit writes Inbox/reviews/<date>.json with submitted: true", sub.submitted === true && sub.answers[0].id === items[4].id
        && sub.unanswered.length === items.length - 1, JSON.stringify(sub).slice(0, 200));
      check("confirmation names the file", (await page.textContent('#review-root .rv-banner[data-kind="ok"]')).includes(`Inbox/reviews/${DATE}.json`));
      // A fresh browser restores from the server.
      const fresh = await browser.newContext();
      const p2 = await fresh.newPage();
      await p2.goto(`http://127.0.0.1:${port}/review/${DATE}`);
      await p2.waitForSelector(row(1));
      await until(async () => (await pressed(p2, 5)).length === 1, 4000);
      check("fresh browser restores answers from GET /api/review", JSON.stringify(await pressed(p2, 5)) === '["done"]');
      // Editing after submit never downgrades the submitted file to a draft.
      await p2.click(`${row(6)} .rv-pill[data-action="keep"]`);
      await sleep(1500);
      check("edits after submit keep the submitted file", JSON.parse(fs.readFileSync(answersFile, "utf8")).submitted === true);
      check("button invites resubmission", (await p2.textContent("#review-root .rv-btn-primary")).includes("again"));
      await fresh.close();
      await context.close();
      fs.rmSync(answersFile);
    });

    await step("widget surface (inline, sendPrompt)", async () => {
      const paged = cli(vault, ["build", DATE, "--surface", "widget", "--site", SITE]).split("\n");
      const sizes = paged.map((p) => fs.statSync(p).size);
      check(`default --max-bytes 60000 respected (${paged.length} page(s), ${sizes.join("/")} bytes)`, sizes.every((s) => s <= 60000));
      const file = cli(vault, ["build", DATE, "--surface", "widget", "--site", SITE, "--max-bytes", "400000",
        "--out", path.join(vault, "outputs", "briefing-review", "single.widget.html")]);
      const fragment = fs.readFileSync(file, "utf8");
      check("fragment has no document wrapper", fragment.startsWith("<style>") && !/<(html|head|body|!doctype)/i.test(fragment));
      const context = await browser.newContext({ viewport: { width: 900, height: 900 } });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.setContent(`<!doctype html><html><head><style>body{font-family:serif}</style></head><body>
        <p id="host">Host chat text</p>
        <script>window.__sent = []; window.sendPrompt = function (t) { window.__sent.push(t); };</script>
        ${fragment}</body></html>`);
      await page.waitForSelector(row(1));
      const hostStyle = await page.evaluate(() => ({
        bg: getComputedStyle(document.body).backgroundColor, font: getComputedStyle(document.getElementById("host")).fontFamily,
        margin: getComputedStyle(document.body).margin,
      }));
      check("widget CSS does not leak into the host", hostStyle.bg === "rgba(0, 0, 0, 0)" && hostStyle.font === "serif" && hostStyle.margin === "8px",
        JSON.stringify(hostStyle));
      check("widget submit label", (await page.textContent("#review-root .rv-btn-primary")).trim() === "Send to Claude");
      await page.click(`${row(1)} .rv-pill[data-action="done"]`);
      await page.click(`${row(10)} .rv-pill[data-action="bump"]`);
      await page.keyboard.type("+2w");
      await page.keyboard.press("Enter");
      await page.click("#review-root .rv-btn-primary");
      const sent = await page.evaluate(() => window.__sent);
      check("Submit calls sendPrompt with the export", sent.length === 1 && sent[0].startsWith(HEADER) &&
        sent[0].includes("- [1] #1 DONE — ") && sent[0].includes("- [10] BUMP(2026-11-26) — "), JSON.stringify(sent).slice(0, 300));
      check("post-submit confirmation", (await page.textContent('#review-root .rv-banner[data-kind="ok"]')).includes("Sent to Claude"));
      check("no page errors", errors.length === 0, errors.join(" | "));
      await context.close();

      // Framed without sendPrompt -> postMessage to the parent (Memex Desktop bridge).
      const framed = await browser.newContext({ viewport: { width: 1000, height: 900 } });
      const host = await framed.newPage();
      await host.setContent(`<!doctype html><html><body><iframe id="f" style="width:960px;height:860px;border:0"></iframe>
        <script>window.__msgs = []; addEventListener("message", (e) => window.__msgs.push(e.data));</script></body></html>`);
      await host.$eval("#f", (f, html) => { f.srcdoc = "<!doctype html><html><body>" + html + "</body></html>"; }, fragment);
      const frame = await (await host.$("#f")).contentFrame();
      await frame.waitForSelector(row(1));
      await frame.click(`${row(3)} .rv-pill[data-action="drop"]`);
      await frame.click("#review-root .rv-btn-primary");
      const msgs = await until(() => host.evaluate(() => window.__msgs.length ? window.__msgs : null), 3000);
      check("framed widget posts memex:sendPrompt", msgs && msgs.length === 1 && msgs[0].type === "memex:sendPrompt" &&
        msgs[0].text.startsWith(HEADER) && msgs[0].text.includes("- [3] #2a DROP — [[Consent form v3]]"), JSON.stringify(msgs).slice(0, 300));
      await framed.close();
    });

    await step("artifact surface (db runtime mock)", async () => {
      const file = cli(vault, ["build", DATE, "--surface", "artifact", "--site", SITE]);
      const html = fs.readFileSync(file, "utf8");
      check("artifact starts with <title>Briefing Review</title> and <style>", /^<title>Briefing Review<\/title>\s*<style>/.test(html) && !/<(html|head|body|!doctype)/i.test(html));
      check("artifact has no localhost links", !html.includes("localhost"));
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await context.addInitScript(() => {
        window.__writes = [];
        window.__failNext = false;
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        window.claude = {
          use: async (name) => {
            await wait(400);
            if (name !== "db") return null;
            return {
              doc: (p) => ({
                get: async () => ({ exists: false, data: () => null }),
                set: async (obj) => {
                  await wait(150);
                  if (window.__failNext) { window.__failNext = false; throw new Error("quota exceeded"); }
                  window.__writes.push({ path: p, obj: JSON.parse(JSON.stringify(obj)) });
                },
              }),
            };
          },
        };
      });
      const page = await context.newPage();
      await page.goto(pathToFileURL(file).href);
      await page.waitForSelector(row(1));
      check("renders before db resolves", (await page.textContent("#review-root .rv-status")).includes("Connecting"));
      await until(async () => (await page.textContent("#review-root .rv-status")) === "Connected", 3000);
      check("connects to db", (await page.textContent("#review-root .rv-status")) === "Connected");
      check("private item reduced to its title", (await page.textContent(`${row(20)} .rv-text`)) === "Aiko Tanaka");
      check("wikilinks render as plain text", (await page.$$("#review-root .rv-text a")).length === 0);
      await page.click(`${row(1)} .rv-note`);
      await page.keyboard.press("Alt+2");
      await page.keyboard.type("done yesterday", { delay: 20 });
      await until(() => page.evaluate(() => window.__writes.length > 0), 4000);
      await sleep(400);
      const writes = await page.evaluate(() => window.__writes);
      check("draft writes are debounced and coalesced", writes.length >= 1 && writes.length <= 2, String(writes.length));
      const last = writes[writes.length - 1];
      check("draft doc shape", last.path === `reviews/${DATE}` && last.obj.submitted === false && last.obj.surface === "artifact" &&
        last.obj.state[items[0].id].note === "done yesterday" && last.obj.answers[0].action === "done", JSON.stringify(last).slice(0, 300));
      await page.evaluate(() => { window.__failNext = true; });
      await page.click(`${row(2)} .rv-pill[data-action="keep"]`);
      await until(async () => (await page.$('#review-root .rv-banner[data-kind="error"]')) !== null, 4000);
      check("rejected set surfaces a visible error", (await page.textContent('#review-root .rv-banner[data-kind="error"]')).includes("quota exceeded"));
      await page.click("#review-root .rv-btn-primary");
      await page.waitForSelector('#review-root .rv-banner[data-kind="ok"]', { timeout: 5000 });
      const final = (await page.evaluate(() => window.__writes)).pop();
      check("Submit writes submitted: true to the same doc", final.obj.submitted === true && final.obj.answers.length === 2 &&
        typeof final.obj.submitted_at === "string" && final.obj.state[items[1].id].action === "keep", JSON.stringify(final).slice(0, 300));
      await context.close();

      const offline = await browser.newContext();
      const p2 = await offline.newPage();
      await p2.goto(pathToFileURL(file).href);
      await p2.waitForSelector(row(1));
      await until(async () => ((await p2.textContent("#review-root")) || "").includes("Not connected"), 3000);
      check("without the runtime: 'not connected' notice", (await p2.textContent("#review-root")).includes("Not connected"));
      await p2.click(`${row(1)} .rv-pill[data-action="do"]`);
      await p2.click("#review-root .rv-btn-primary");
      await p2.waitForSelector('#review-root .rv-banner[data-kind="ok"]');
      check("without the runtime: falls back to the export panel", (await p2.inputValue("#review-root .rv-export textarea")).startsWith(HEADER));
      await offline.close();
    });
  } finally {
    if (server) server.kill();
    await browser.close();
    fs.rmSync(vault, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${failed.length ? "FAIL" : "PASS"}: ${results.length - failed.length}/${results.length} checks passed`);
  for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` — ${f.detail}` : ""}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
