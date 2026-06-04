import { QuartzFilterPlugin } from "../types"

// RemovePrivateNotes — strips any note whose frontmatter has
// `sensitivity: private` or `sensitivity: sensitive` from the build.
//
// Per AGENTS.md, default sensitivity for interaction / commitment / ask /
// People-adjacent notes is `private`; some Briefings, Reviews, and Tasks are
// also marked private. None of these should ever publish to a hosted target.
//
// `normal` notes publish; anything else (private / sensitive / undefined-but-
// matched-explicitly via list) is dropped. The list is configurable so a
// hosting deploy can opt in to `sensitive` if needed (we never do today).

interface Options {
  blockedSensitivities: string[] // default: ["private", "sensitive"]
}

const defaultOptions: Options = {
  blockedSensitivities: ["private", "sensitive"],
}

export const RemovePrivateNotes: QuartzFilterPlugin<Partial<Options>> = (userOpts) => {
  const opts: Options = { ...defaultOptions, ...(userOpts ?? {}) }
  const blocked = new Set(opts.blockedSensitivities.map((s) => s.toLowerCase()))
  return {
    name: "RemovePrivateNotes",
    shouldPublish(_ctx, [_tree, vfile]) {
      const s = vfile.data?.frontmatter?.sensitivity
      if (typeof s !== "string") return true
      return !blocked.has(s.toLowerCase())
    },
  }
}
