#!/usr/bin/env bash
# Build a CV variant PDF into outputs/cv/ and (by default) copy it to the
# Google Drive Desktop mount ("Compiled CVs"). Wrapped by the /cv-build skill.
#
# Usage: scripts/build_cv.sh [variant]     (default: full)
# Env:   CV_NO_DRIVE=1   skip the Drive copy
#
# Variants are CV/variants/<name>.tex driver files that \input{../<section>}
# the shared section files; never edit the section .tex files from here.
set -euo pipefail

VAULT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
variant="${1:-full}"
driver="$VAULT_ROOT/CV/variants/${variant}.tex"

if [ ! -f "$driver" ]; then
  echo "build_cv: no such variant: $driver" >&2
  echo "available variants:" >&2
  ls "$VAULT_ROOT/CV/variants/"*.tex >&2 2>/dev/null || echo "  (none)" >&2
  exit 1
fi
if ! command -v latexmk >/dev/null 2>&1; then
  echo "build_cv: latexmk not found - install a TeX distribution (e.g. MacTeX / TeX Live)" >&2
  exit 1
fi

date_tag="$(date +%Y-%m-%d)"
out_dir="$VAULT_ROOT/outputs/cv"
build_dir="$(mktemp -d)"
trap 'rm -rf "$build_dir"' EXIT
mkdir -p "$out_dir"

# TEXINPUTS lets the variant driver find ../res.sty and the section files from
# the variants/ working directory regardless of latexmk's output redirection.
( cd "$VAULT_ROOT/CV/variants" \
  && TEXINPUTS="..:${TEXINPUTS:-}" latexmk -pdf -interaction=nonstopmode -halt-on-error \
       -output-directory="$build_dir" "$driver" ) \
  > "$build_dir/build.log" 2>&1 || { tail -40 "$build_dir/build.log" >&2; exit 1; }

pdf="$build_dir/${variant}.pdf"
[ -f "$pdf" ] || { echo "build_cv: build produced no PDF (see latexmk output)" >&2; exit 1; }
dest="$out_dir/${variant}-${date_tag}.pdf"
cp "$pdf" "$dest"
echo "built: $dest"

if [ "${CV_NO_DRIVE:-0}" != "1" ]; then
  drive_dir="$HOME/Library/CloudStorage/{{DRIVE_MOUNT}}/My Drive/Compiled CVs"
  if [ -d "$drive_dir" ]; then
    cp "$dest" "$drive_dir/{{OWNER_NAME}} CV - ${variant} - ${date_tag}.pdf"
    echo "drive copy: ${drive_dir}/{{OWNER_NAME}} CV - ${variant} - ${date_tag}.pdf"
  else
    echo "build_cv: Drive mount not found (${drive_dir}); skipped Drive copy (CV_NO_DRIVE=1 silences this)" >&2
  fi
fi
