import * as fs from 'fs';
import * as path from 'path';
import { pathType } from './vault';

const fsp = fs.promises;
export const MAX_INBOX_NOTE_BYTES = 1_000_000;
const INBOX_COLLISION_LIMIT = 10_000;

function safeInboxDirectory(vault: string): string | null {
  if (pathType(vault, 'Inbox') !== 'directory') return null;
  return path.join(path.resolve(vault), 'Inbox');
}

async function entryExists(target: string): Promise<boolean> {
  try { await fsp.lstat(target); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function availableDestination(inbox: string, base: string): Promise<{ full: string; name: string }> {
  const ext = path.extname(base);
  const stem = base.slice(0, base.length - ext.length);
  for (let index = 0; index < INBOX_COLLISION_LIMIT; index++) {
    const name = index === 0 ? base : `${stem}-${index}${ext}`;
    const full = path.join(inbox, name);
    if (!await entryExists(full)) return { full, name };
  }
  throw new Error('Inbox filename collision limit reached');
}

async function copyRegularFileExclusive(source: string, destination: string): Promise<void> {
  let sourceFile: fs.promises.FileHandle | null = null;
  let destinationFile: fs.promises.FileHandle | null = null;
  try {
    const sourceNoFollow = process.platform === 'win32' ? 0 : (fs.constants.O_NOFOLLOW || 0);
    sourceFile = await fsp.open(source, fs.constants.O_RDONLY | sourceNoFollow);
    const sourceStat = await sourceFile.stat();
    if (!sourceStat.isFile()) throw new Error('Source is not a regular file');
    const noFollow = process.platform === 'win32' ? 0 : (fs.constants.O_NOFOLLOW || 0);
    destinationFile = await fsp.open(
      destination,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | noFollow,
      sourceStat.mode & 0o777,
    );
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let position = 0;
    while (position < sourceStat.size) {
      const wanted = Math.min(buffer.length, sourceStat.size - position);
      const { bytesRead } = await sourceFile.read(buffer, 0, wanted, position);
      if (bytesRead === 0) throw new Error('Source changed while it was being copied');
      let written = 0;
      while (written < bytesRead) {
        const result = await destinationFile.write(buffer, written, bytesRead - written, position + written);
        if (result.bytesWritten === 0) throw new Error('Destination stopped accepting data');
        written += result.bytesWritten;
      }
      position += bytesRead;
    }
  } catch (error) {
    if (destinationFile) { try { await destinationFile.close(); } catch (_) {} destinationFile = null; }
    if (sourceFile) { try { await sourceFile.close(); } catch (_) {} sourceFile = null; }
    // The exclusive destination belongs to this copy attempt, so a failed read
    // or write must not leave a truncated file that looks successfully captured.
    try { await fsp.unlink(destination); } catch (_) {}
    throw error;
  } finally {
    if (destinationFile) { try { await destinationFile.close(); } catch (_) {} }
    if (sourceFile) { try { await sourceFile.close(); } catch (_) {} }
  }
}

async function copyDirectoryExclusive(source: string, destination: string, mode: number): Promise<void> {
  await fsp.mkdir(destination, { mode: mode & 0o777 });
  try {
    const directory = await fsp.opendir(source);
    try {
      for await (const entry of directory) {
        const sourceEntry = path.join(source, entry.name);
        const destinationEntry = path.join(destination, entry.name);
        let stat: fs.Stats;
        try { stat = await fsp.lstat(sourceEntry); } catch (_) { continue; }
        // A captured directory must not plant a link that points the agent or
        // another vault tool back outside the vault.
        if (stat.isSymbolicLink()) continue;
        if (stat.isDirectory()) await copyDirectoryExclusive(sourceEntry, destinationEntry, stat.mode);
        else if (stat.isFile()) await copyRegularFileExclusive(sourceEntry, destinationEntry);
      }
    } finally {
      try { await directory.close(); } catch (_) {}
    }
  } catch (error) {
    try { await fsp.rm(destination, { recursive: true, force: true }); } catch (_) {}
    throw error;
  }
}

/** Copy selected paths into a real Inbox directory, or return null when Inbox is unsafe. */
export async function copyPathsIntoInbox(vault: string, sources: string[]): Promise<string[] | null> {
  const inbox = safeInboxDirectory(vault);
  if (!inbox) return null;
  const copied: string[] = [];
  for (const requestedSource of sources || []) {
    try {
      // Revalidate the intermediate directory before every write. Exclusive final
      // creation below also rejects existing files and dangling symlinks.
      if (safeInboxDirectory(vault) !== inbox) return null;
      const source = await fsp.realpath(requestedSource);
      const sourceStat = await fsp.stat(source);
      const base = path.basename(requestedSource);
      if (!base || base === '.' || base === '..' || base === path.sep) continue;
      const destination = await availableDestination(inbox, base);
      if (sourceStat.isDirectory()) {
        await copyDirectoryExclusive(source, destination.full, sourceStat.mode);
      } else if (sourceStat.isFile()) {
        await copyRegularFileExclusive(source, destination.full);
      } else {
        continue;
      }
      copied.push(destination.name);
    } catch (_) { /* one unreadable source should not reject the rest of the drop */ }
  }
  return copied;
}

/** Create a quick note without overwriting or following a destination symlink. */
export function writeInboxNote(vault: string, text: string, now = new Date()): string | null {
  const inbox = safeInboxDirectory(vault);
  if (!inbox) return null;
  const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const body = text.endsWith('\n') ? text : text + '\n';
  if (Buffer.byteLength(body, 'utf8') > MAX_INBOX_NOTE_BYTES) return null;
  const noFollow = process.platform === 'win32' ? 0 : (fs.constants.O_NOFOLLOW || 0);

  for (let index = 0; index < INBOX_COLLISION_LIMIT; index++) {
    if (safeInboxDirectory(vault) !== inbox) return null;
    const name = `note-${stamp}${index === 0 ? '' : `-${index}`}.md`;
    const full = path.join(inbox, name);
    let fd: number | null = null;
    try {
      fd = fs.openSync(
        full,
        fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | noFollow,
        0o600,
      );
      fs.writeFileSync(fd, body, 'utf8');
      return path.join('Inbox', name);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (fd != null) { try { fs.closeSync(fd); } catch (_) {} fd = null; }
      if (code === 'EEXIST' || code === 'ELOOP') continue;
      return null;
    } finally {
      if (fd != null) { try { fs.closeSync(fd); } catch (_) {} }
    }
  }
  return null;
}
