---
name: cv-build
description: Build a PDF of the LaTeX CV into outputs/cv/, choosing which variant (set of sections) to include. Use when the user wants to compile/produce/export the CV — signaled by "build my CV", "compile the CV", "make a PDF of my CV", "generate the short CV", "build the NIH CV variant", "/cv-build", "/cv-build short". Wraps scripts/build_cv.sh; surfaces the resulting PDF. Read-only against the .tex; writes only the gitignored outputs/cv/ artifact.
---

# cv-build

Conversational wrapper over `scripts/build_cv.sh`. Compiles a CV variant to
`outputs/cv/<variant>-<date>.pdf` and surfaces it.

## Steps

1. **Pick the variant.** If the user named one (`/cv-build short`), use it. Otherwise list the
   available drivers — `ls CV/variants/*.tex` — and ask which (default `full`).

2. **Build.** Run `scripts/build_cv.sh <variant>`. If it errors on a missing variant, offer to
   create a new `CV/variants/<name>.tex` driver (copy `full.tex`, then add/remove
   `\input{../<section>}` lines per the user's requested section set) and rebuild.

3. **Surface the PDF.** Use `SendUserFile` on `outputs/cv/<variant>-<date>.pdf` with a short
   caption. Report the path, and the Drive copy (see below).

## Drive publish

`build_cv.sh` also copies each build to **Google Drive → "Compiled CVs"** (via the Drive
Desktop mount `~/Library/CloudStorage/{{DRIVE_MOUNT}}/My Drive/Compiled CVs/`)
as `{{OWNER_NAME}} CV - <variant> - <date>.pdf`, so compiled CVs are easy to find and send. This is
an authorized Drive write (see CLAUDE.md "Authorized external writes"). To build local-only
(no Drive copy), run with `CV_NO_DRIVE=1`.

## Hard rules

- Never edit section `.tex` files. Creating/editing a *variant driver* (`CV/variants/*.tex`) is
  allowed — that's the include/exclude mechanism — but confirm the section set with the user first.
- `outputs/` is gitignored; do not commit build artifacts. The durable copy lives in Drive
  ("Compiled CVs"), not in git — the LaTeX in `CV/` is the version-controlled source of record.
- If no TeX toolchain is installed, say so and stop (see `scripts/build_cv.sh`).
