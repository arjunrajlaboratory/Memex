// Memex addition (not upstream Quartz): briefing-review routes for `site:serve`.
//
// Contract: docs/superpowers/specs/2026-11-12-briefing-review-design.md, "Server routes".
// The serve-mode HTTP server in handlers.js calls handleReviewRoute() after it
// has stripped argv.baseDir and before its static-file handling. The routes only
// exist in serve mode; nothing here is emitted into a (public) static build.
//
//   GET  /review, /review/      -> 302 /review/<latest Ops/Briefings/YYYY-MM-DD.md>
//   GET  /review/<date>         -> `briefing_review.py build <date> --surface server --stdout`
//   GET  /api/review/<date>     -> <vault>/Inbox/reviews/<date>.json, or 404
//   POST /api/review/<date>     -> body piped to `briefing_review.py save <date> --surface server [--draft]`
//
// All work is delegated to <vault>/scripts/briefing_review.py via execFile/spawn
// with an argument array (never a shell). The only request-derived value that
// reaches a path or an argument is the date, after it matched DATE_RE.

import { spawn } from "child_process"
import fs from "fs"
import path from "path"
import { styleText } from "util"

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const BRIEFING_RE = /^(\d{4}-\d{2}-\d{2})\.md$/
const MAX_BODY_BYTES = 2 * 1024 * 1024
const TIMEOUT_MS = 20_000
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1"])

function defaultLog(status, label) {
  const color = status >= 200 && status < 300 ? "green" : status < 400 ? "yellow" : "red"
  console.log(styleText(color, `[${status}]`) + styleText("gray", ` ${label}`))
}

function hostnameOf(value, withScheme) {
  try {
    return new URL(withScheme ? value : `http://${value}`).hostname
  } catch {
    return null
  }
}

/** Newest Ops/Briefings/YYYY-MM-DD.md date, or null. */
export function latestBriefingDate(vaultDir) {
  let names
  try {
    names = fs.readdirSync(path.join(vaultDir, "Ops", "Briefings"))
  } catch {
    return null
  }
  const dates = names
    .map((n) => BRIEFING_RE.exec(n)?.[1])
    .filter(Boolean)
    .sort()
  return dates.length ? dates[dates.length - 1] : null
}

/**
 * Handle a briefing-review request. Returns true when the request was handled
 * (a response was sent), false when it is not a review route.
 *
 * @param {import("http").IncomingMessage} req  req.url already has baseDir stripped
 * @param {import("http").ServerResponse} res
 * @param {{vaultDir: string, baseDir?: string, python?: string, log?: false | ((status: number, label: string) => void), timeoutMs?: number}} opts
 */
export async function handleReviewRoute(req, res, opts) {
  try {
    return await route(req, res, opts)
  } catch (e) {
    // Never let a review-route bug take down the dev server.
    console.error(styleText("red", `[500] ${req.url} (review route error: ${e?.message ?? e})`))
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" })
      res.end("internal error\n")
    } else res.destroy()
    return true
  }
}

async function route(req, res, opts) {
  const url = new URL(req.url ?? "/", "http://localhost")
  const pathname = url.pathname

  let kind = null
  let date = null
  let m
  if (pathname === "/review" || pathname === "/review/") {
    kind = "redirect"
  } else if ((m = /^\/review\/([^/]+)\/?$/.exec(pathname)) && DATE_RE.test(m[1])) {
    // Non-date segments under /review/ fall through to Quartz so a vault page
    // that happens to live there is not shadowed.
    kind = "page"
    date = m[1]
  } else if ((m = /^\/api\/review\/([^/]+)\/?$/.exec(pathname))) {
    kind = "api"
    date = m[1]
  } else {
    return false
  }

  const vaultDir = path.resolve(opts.vaultDir)
  const baseDir = opts.baseDir ?? ""
  const python = opts.python || process.env.MEMEX_PYTHON || "python3"
  const timeout = opts.timeoutMs ?? TIMEOUT_MS
  const log = opts.log === false ? () => {} : opts.log ?? defaultLog
  const script = path.join(vaultDir, "scripts", "briefing_review.py")
  const label = `${baseDir}${req.url}`

  const send = (status, type, body, extra = {}) => {
    res.writeHead(status, {
      "Content-Type": type,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extra,
    })
    res.end(body)
    log(status, label)
  }
  const text = (status, msg, extra) =>
    send(status, "text/plain; charset=utf-8", msg.endsWith("\n") ? msg : msg + "\n", extra)
  const json = (status, obj, extra) =>
    send(status, "application/json; charset=utf-8", JSON.stringify(obj), extra)

  // DNS-rebinding guard: the server binds 127.0.0.1, but a hostile page whose
  // domain re-resolves to 127.0.0.1 would arrive with its own Host header.
  const hostHeader = req.headers.host
  if (hostHeader && !LOOPBACK_HOSTS.has(hostnameOf(hostHeader, false))) {
    if (kind === "api") json(403, { ok: false, error: "forbidden host" })
    else text(403, "forbidden host")
    return true
  }

  // --- GET /review, /review/ -------------------------------------------------
  if (kind === "redirect") {
    if (req.method !== "GET" && req.method !== "HEAD") {
      text(405, "method not allowed", { Allow: "GET, HEAD" })
      return true
    }
    const latest = latestBriefingDate(vaultDir)
    if (!latest) {
      text(404, "No daily briefing found (Ops/Briefings/YYYY-MM-DD.md).")
      return true
    }
    const location = `${baseDir}/review/${latest}`
    res.writeHead(302, { Location: location, "Cache-Control": "no-store" })
    res.end()
    log(302, `${label} -> ${location}`)
    return true
  }

  // --- GET /review/<date> ----------------------------------------------------
  if (kind === "page") {
    if (req.method !== "GET" && req.method !== "HEAD") {
      text(405, "method not allowed", { Allow: "GET, HEAD" })
      return true
    }
    if (!fs.existsSync(script)) {
      text(500, `briefing review script not found: ${script}`)
      return true
    }
    const args = [script, "--vault", vaultDir, "build", date, "--surface", "server", "--stdout"]
    const result = await run(python, args, { cwd: vaultDir, timeout })
    if (result.spawnError) {
      text(500, `could not run ${python}: ${result.spawnError.message}`)
    } else if (result.code === 0) {
      send(200, "text/html; charset=utf-8", req.method === "HEAD" ? undefined : result.stdout)
    } else {
      const msg =
        result.stderr.trim() || `briefing_review.py build exited ${result.code ?? result.signal}`
      text(result.code === 1 ? 404 : 500, msg)
    }
    return true
  }

  // --- /api/review/<date> ----------------------------------------------------
  if (!DATE_RE.test(date)) {
    json(400, { ok: false, error: "invalid date (expected YYYY-MM-DD)" })
    return true
  }

  if (req.method === "GET" || req.method === "HEAD") {
    const file = path.join(vaultDir, "Inbox", "reviews", `${date}.json`)
    let body
    try {
      body = await fs.promises.readFile(file)
    } catch {
      json(404, { ok: false, error: "not found" })
      return true
    }
    send(200, "application/json; charset=utf-8", req.method === "HEAD" ? undefined : body)
    return true
  }

  if (req.method !== "POST") {
    json(405, { ok: false, error: "method not allowed" }, { Allow: "GET, HEAD, POST" })
    return true
  }

  // CSRF guard: a present Origin must be loopback ("null" is rejected too).
  const origin = req.headers.origin
  if (origin !== undefined && !LOOPBACK_HOSTS.has(hostnameOf(origin, true))) {
    req.resume()
    json(403, { ok: false, error: "forbidden origin" }, { Connection: "close" })
    return true
  }

  const mediaType = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase()
  if (mediaType !== "application/json") {
    req.resume()
    json(415, { ok: false, error: "Content-Type must be application/json" }, { Connection: "close" })
    return true
  }

  const declared = Number(req.headers["content-length"])
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    req.resume()
    json(413, { ok: false, error: "body exceeds 2 MB" }, { Connection: "close" })
    return true
  }

  const body = await readBody(req, MAX_BODY_BYTES)
  if (body === null) {
    json(413, { ok: false, error: "body exceeds 2 MB" }, { Connection: "close" })
    return true
  }

  if (!fs.existsSync(script)) {
    json(500, { ok: false, error: `briefing review script not found: ${script}` })
    return true
  }
  const draft = ["1", "true"].includes(url.searchParams.get("draft") ?? "")
  const args = [script, "--vault", vaultDir, "save", date, "--surface", "server"]
  if (draft) args.push("--draft")
  const result = await run(python, args, { cwd: vaultDir, timeout, input: body })
  if (result.spawnError) {
    json(500, { ok: false, error: `could not run ${python}: ${result.spawnError.message}` })
  } else if (result.code === 0) {
    json(200, { ok: true, path: result.stdout.trim() })
  } else if (result.code === null) {
    json(500, { ok: false, error: result.stderr.trim() })
  } else {
    json(400, {
      ok: false,
      error: result.stderr.trim() || `briefing_review.py save exited ${result.code ?? result.signal}`,
    })
  }
  return true
}

/** Read the request body; resolves null (and drains the rest) once it exceeds max bytes. */
function readBody(req, max) {
  return new Promise((resolve) => {
    const chunks = []
    let size = 0
    let over = false
    req.on("data", (chunk) => {
      if (over) return
      size += chunk.length
      if (size > max) {
        over = true
        chunks.length = 0
        return
      }
      chunks.push(chunk)
    })
    req.on("end", () => resolve(over ? null : Buffer.concat(chunks)))
    req.on("error", () => resolve(null))
  })
}

/** Run a command (argument array, no shell); never rejects. */
function run(cmd, args, { cwd, timeout, input }) {
  return new Promise((resolve) => {
    let settled = false
    let timer = null
    let timedOut = false
    const finish = (r) => {
      if (timer) clearTimeout(timer)
      if (!settled) {
        settled = true
        resolve(r)
      }
    }
    const out = []
    const err = []
    let child
    try {
      child = spawn(cmd, args, { cwd, stdio: ["pipe", "pipe", "pipe"] })
    } catch (e) {
      finish({ spawnError: e, code: null, signal: null, stdout: "", stderr: "" })
      return
    }
    // Own timer rather than spawn's `timeout` option, which is never cleared
    // when the interpreter fails to spawn and would pin the event loop.
    timer = setTimeout(() => {
      timedOut = true
      child.kill("SIGKILL")
    }, timeout)
    child.stdout.on("data", (c) => out.push(c))
    child.stderr.on("data", (c) => err.push(c))
    child.on("error", (e) => {
      // ENOENT/EACCES on the interpreter: no 'close' is guaranteed to follow.
      if (child.pid === undefined) {
        finish({ spawnError: e, code: null, signal: null, stdout: "", stderr: "" })
      }
    })
    child.stdin.on("error", () => {}) // EPIPE when the script exits without reading stdin
    child.stdin.end(input ?? undefined)
    child.on("close", (code, signal) => {
      finish({
        code,
        signal,
        spawnError: null,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr:
          Buffer.concat(err).toString("utf8") +
          (timedOut ? `\n(timed out after ${timeout} ms)` : signal ? `\n(killed by ${signal})` : ""),
      })
    })
  })
}
