// Sync services (Dropbox, iCloud Drive, Syncthing) drop conflict copies and
// placeholder files into synced vaults. They are noise, not content: never
// list, index, wiki-link, or watch-refresh on them.
export function isSyncArtifact(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.includes(' (conflicted copy') ||       // Dropbox
    lower.includes("'s conflicted copy") ||           // Dropbox (owner-named)
    lower.includes(' (case conflict') ||              // Dropbox case conflicts
    lower.includes('.sync-conflict-') ||              // Syncthing
    lower.endsWith('.icloud');                        // iCloud placeholder
}
