// Memex addition: tests for review-routes.js. Dependency-free:
//   node --test quartz/cli/review-routes.test.mjs
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import http from "node:http"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { handleReviewRoute } from "./review-routes.js"

// Stub CLI: echoes its argv so tests can assert on what was passed.
//   build ... --stdout  -> HTML containing the argv; date 1999-01-01 -> exit 1
//   save ...            -> writes stdin to Inbox/reviews/<date>.json, prints path;
//                          body {"bad":true} -> stderr + exit 1
const STUB = String.raw`
import json, os, sys
argv = sys.argv[1:]
vault = argv[argv.index("--vault") + 1]
cmd = argv[2]
date = argv[3]
if cmd == "build":
    if date == "1999-01-01":
        sys.stderr.write("no briefing for 1999-01-01\n"); sys.exit(1)
    if date == "2001-01-01":
        import time; time.sleep(5)
    if date == "2000-01-01":
        sys.stderr.write("boom\n"); sys.exit(3)
    print("<!doctype html><p>review " + json.dumps(argv) + "</p>")
elif cmd == "save":
    body = sys.stdin.read()
    data = json.loads(body)
    if data.get("bad"):
        sys.stderr.write("answers invalid: bad\n"); sys.exit(1)
    data["_argv"] = argv
    d = os.path.join(vault, "Inbox", "reviews")
    os.makedirs(d, exist_ok=True)
    p = os.path.join(d, date + ".json")
    with open(p, "w") as f:
        json.dump(data, f)
    print(p)
else:
    sys.exit(2)
`

let vault
let server
let base
const BASE_DIR = "/site"

before(async () => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), "review-routes-"))
  fs.mkdirSync(path.join(vault, "scripts"))
  fs.writeFileSync(path.join(vault, "scripts", "briefing_review.py"), STUB)
  const briefings = path.join(vault, "Ops", "Briefings")
  fs.mkdirSync(briefings, { recursive: true })
  for (const f of ["2026-11-10.md", "2026-11-12.md", "2026-11-11.md", "2026-11-13.items.json", "notes.md"]) {
    fs.writeFileSync(path.join(briefings, f), "x")
  }

  server = http.createServer(async (req, res) => {
    // Mirror handlers.js: strip baseDir before routing.
    if (!req.url.startsWith(BASE_DIR)) {
      res.writeHead(404).end()
      return
    }
    req.url = req.url.slice(BASE_DIR.length)
    const handled = await handleReviewRoute(req, res, { vaultDir: vault, baseDir: BASE_DIR, log: false })
    if (!handled) res.writeHead(418).end("not handled")
  })
  await new Promise((r) => server.listen(0, "127.0.0.1", r))
  base = `http://127.0.0.1:${server.address().port}${BASE_DIR}`
})

after(() => {
  server.closeAllConnections()
  server.close()
  fs.rmSync(vault, { recursive: true, force: true })
})

const post = (p, body, headers = {}) =>
  fetch(base + p, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  })

test("GET /review and /review/ redirect to the latest briefing (baseDir kept)", async () => {
  for (const p of ["/review", "/review/"]) {
    const r = await fetch(base + p, { redirect: "manual" })
    assert.equal(r.status, 302)
    assert.equal(r.headers.get("location"), `${BASE_DIR}/review/2026-11-12`)
  }
})

test("GET /review/ is 404 when there is no briefing", async () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "review-empty-"))
  const res = { status: 0, headers: {}, body: "" }
  const fake = {
    writeHead(s, h) {
      res.status = s
      res.headers = h
    },
    end(b) {
      res.body = String(b ?? "")
    },
  }
  const handled = await handleReviewRoute({ url: "/review", method: "GET", headers: {} }, fake, {
    vaultDir: empty,
    log: false,
  })
  assert.equal(handled, true)
  assert.equal(res.status, 404)
  assert.match(res.headers["Content-Type"], /text\/plain/)
  fs.rmSync(empty, { recursive: true, force: true })
})

test("GET /review/<date> renders the server surface via the script", async () => {
  const r = await fetch(base + "/review/2026-11-12")
  assert.equal(r.status, 200)
  assert.equal(r.headers.get("content-type"), "text/html; charset=utf-8")
  assert.equal(r.headers.get("cache-control"), "no-store")
  const html = await r.text()
  const argv = JSON.parse(html.match(/review (\[.*\])</)[1])
  assert.deepEqual(argv, [
    "--vault",
    vault,
    "build",
    "2026-11-12",
    "--surface",
    "server",
    "--stdout",
  ])
})

test("GET /review/<date> maps exit 1 to 404 and other failures to 500", async () => {
  let r = await fetch(base + "/review/1999-01-01")
  assert.equal(r.status, 404)
  assert.match(await r.text(), /no briefing for 1999-01-01/)
  r = await fetch(base + "/review/2000-01-01")
  assert.equal(r.status, 500)
  assert.match(await r.text(), /boom/)
})

test("GET/POST /api/review/<date> round trip", async () => {
  let r = await fetch(base + "/api/review/2026-11-12")
  assert.equal(r.status, 404)
  assert.deepEqual(await r.json(), { ok: false, error: "not found" })

  r = await post("/api/review/2026-11-12", { answers: [{ id: "a", action: "do" }] })
  assert.equal(r.status, 200)
  const out = await r.json()
  assert.equal(out.ok, true)
  assert.equal(out.path, path.join(vault, "Inbox", "reviews", "2026-11-12.json"))

  r = await fetch(base + "/api/review/2026-11-12")
  assert.equal(r.status, 200)
  assert.match(r.headers.get("content-type"), /application\/json/)
  const stored = await r.json()
  assert.deepEqual(stored.answers, [{ id: "a", action: "do" }])
  assert.deepEqual(stored._argv.slice(2), ["save", "2026-11-12", "--surface", "server"])
})

test("POST ?draft=1 passes --draft", async () => {
  const r = await post("/api/review/2026-11-12?draft=1", { answers: [] }, {
    Origin: "http://localhost:8080",
    "Content-Type": "application/json; charset=utf-8",
  })
  assert.equal(r.status, 200)
  const stored = JSON.parse(fs.readFileSync(path.join(vault, "Inbox", "reviews", "2026-11-12.json"), "utf8"))
  assert.deepEqual(stored._argv.slice(2), ["save", "2026-11-12", "--surface", "server", "--draft"])
})

test("POST: script validation failure is 400 with stderr", async () => {
  const r = await post("/api/review/2026-11-12", { bad: true })
  assert.equal(r.status, 400)
  assert.deepEqual(await r.json(), { ok: false, error: "answers invalid: bad" })
})

test("bad date on the API is 400", async () => {
  for (const d of ["2026-1-12", "..%2F..%2Fetc", "latest"]) {
    let r = await fetch(base + "/api/review/" + d)
    assert.equal(r.status, 400, d)
    r = await post("/api/review/" + d, {})
    assert.equal(r.status, 400, d)
  }
})

test("POST with a foreign Origin is 403", async () => {
  for (const origin of ["https://evil.example", "null", "http://localhost.evil.example"]) {
    const r = await post("/api/review/2026-11-12", {}, { Origin: origin })
    assert.equal(r.status, 403, origin)
  }
  const r = await post("/api/review/2026-11-12", { answers: [] }, { Origin: "http://127.0.0.1:8080" })
  assert.equal(r.status, 200)
})

test("foreign Host header is 403 (DNS-rebinding guard)", async () => {
  const status = await new Promise((resolve, reject) => {
    const u = new URL(base + "/api/review/2026-11-12")
    http
      .get({ host: "127.0.0.1", port: u.port, path: u.pathname, headers: { Host: "evil.example" } }, (r) => {
        r.resume()
        resolve(r.statusCode)
      })
      .on("error", reject)
  })
  assert.equal(status, 403)
})

test("POST with a non-JSON content type is 415", async () => {
  for (const ct of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data"]) {
    const r = await post("/api/review/2026-11-12", "{}", { "Content-Type": ct })
    assert.equal(r.status, 415, ct)
  }
})

test("POST body over 2 MB is 413", async () => {
  const big = JSON.stringify({ pad: "x".repeat(2 * 1024 * 1024 + 10) })
  const r = await post("/api/review/2026-11-12", big)
  assert.equal(r.status, 413)
  // chunked (no Content-Length) is counted while streaming
  const r2 = await fetch(base + "/api/review/2026-11-12", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode(big))
        c.close()
      },
    }),
    duplex: "half",
  })
  assert.equal(r2.status, 413)
})

test("other methods are 405", async () => {
  const r = await fetch(base + "/api/review/2026-11-12", { method: "DELETE" })
  assert.equal(r.status, 405)
})

test("non-review URLs are not handled", async () => {
  for (const p of ["/", "/index", "/reviews", "/review/some-note", "/review/a/b", "/api/other", "/Ops/Briefings/2026-11-12"]) {
    const r = await fetch(base + p, { redirect: "manual" })
    assert.equal(r.status, 418, p)
  }
})

test("missing interpreter is a 500, not a crash", async () => {
  const res = { status: 0, body: "" }
  const fake = {
    writeHead(s) {
      res.status = s
    },
    end(b) {
      res.body = String(b ?? "")
    },
  }
  await handleReviewRoute({ url: "/review/2026-11-12", method: "GET", headers: {} }, fake, {
    vaultDir: vault,
    python: "/nonexistent/python3",
    log: false,
  })
  assert.equal(res.status, 500)
  assert.match(res.body, /could not run/)
})

test("a hung script is killed after the timeout (500)", async () => {
  const res = { status: 0, body: "" }
  const fake = {
    writeHead(s) {
      res.status = s
    },
    end(b) {
      res.body = String(b ?? "")
    },
  }
  const t0 = Date.now()
  await handleReviewRoute({ url: "/review/2001-01-01", method: "GET", headers: {} }, fake, {
    vaultDir: vault,
    timeoutMs: 300,
    log: false,
  })
  assert.ok(Date.now() - t0 < 3000)
  assert.equal(res.status, 500)
  assert.match(res.body, /timed out after 300 ms/)
})
