import * as fs from 'fs';
import * as path from 'path';
import { pathType } from './vault';

function safeInboxDirectory(vault: string): string | null {
  if (pathType(vault, 'Inbox') !== 'directory') return null;
  return path.join(path.resolve(vault), 'Inbox');
}

function entryExists(target: string): boolean {
  try { fs.lstatSync(target); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function availableDestination(inbox: string, base: string): { full: string; name: string } {
  const ext = path.extname(base);
  const stem = base.slice(0, base.length - ext.length);
  for (let index = 0; ; index++) {
    const name = index === 0 ? base : `${stem}-${index}${ext}`;
    const full = path.join(inbox, name);
    if (!entryExists(full)) return { full, name };
  }
}

function copyRegularFileExclusive(source: string, destination: string): void {
  let sourceFd: number | null = null;
  let destinationFd: number | null = null;
  try {
    sourceFd = fs.openSync(source, fs.constants.O_RDONLY);
    const sourceStat = fs.fstatSync(sourceFd);
    if (!sourceStat.isFile()) throw new Error('Source is not a regular file');
    const noFollow = process.platform === 'win32' ? 0 : (fs.constants.O_NOFOLLOW || 0);
    destinationFd = fs.openSync(
      destination,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | noFollow,
      sourceStat.mode & 0o777,
    );
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let position = 0;
    while (position < sourceStat.size) {
      const wanted = Math.min(buffer.length, sourceStat.size - position);
      const bytesRead = fs.readSync(sourceFd, buffer, 0, wanted, position);
      if (bytesRead === 0) break;
      let written = 0;
      while (written < bytesRead) {
        written += fs.writeSync(destinationFd, buffer, written, bytesRead - written, position + written);
      }
      position += bytesRead;
    }
  } catch (error) {
    if (destinationFd != null) { try { fs.closeSync(destinationFd); } catch (_) {} destinationFd = null; }
    if (sourceFd != null) { try { fs.closeSync(sourceFd); } catch (_) {} sourceFd = null; }
    throw error;
  } finally {
    if (destinationFd != null) { try { fs.closeSync(destinationFd); } catch (_) {} }
    if (sourceFd != null) { try { fs.closeSync(sourceFd); } catch (_) {} }
  }
}

/** Copy selected paths into a real Inbox directory, or return null when Inbox is unsafe. */
export function copyPathsIntoInbox(vault: string, sources: string[]): string[] | null {
  const inbox = safeInboxDirectory(vault);
  if (!inbox) return null;
  const copied: string[] = [];
  for (const requestedSource of sources || []) {
    try {
      // Revalidate the intermediate directory before every write. Exclusive final
      // creation below also rejects existing files and dangling symlinks.
      if (safeInboxDirectory(vault) !== inbox) return null;
      const source = fs.realpathSync(requestedSource);
      const sourceStat = fs.statSync(source);
      const base = path.basename(requestedSource);
      if (!base || base === '.' || base === '..' || base === path.sep) continue;
      const destination = availableDestination(inbox, base);
      if (sourceStat.isDirectory()) {
        fs.cpSync(source, destination.full, {
          recursive: true,
          force: false,
          errorOnExist: true,
          verbatimSymlinks: true,
        });
      } else if (sourceStat.isFile()) {
        copyRegularFileExclusive(source, destination.full);
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
  const noFollow = process.platform === 'win32' ? 0 : (fs.constants.O_NOFOLLOW || 0);

  for (let index = 0; index < 10_000; index++) {
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
