import * as fs from 'fs';
import * as path from 'path';
import { pathType } from './vault';

export interface DesktopTabsDocument { [key: string]: unknown; }

interface NavigationDocument {
  hidden?: unknown;
  folders?: unknown;
}

const MAX_PREFERENCE_ITEMS = 100;

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean);
}

export function parseDesktopTabsDocument(raw: string): DesktopTabsDocument {
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('desktop-tabs.json must contain a JSON object');
  return parsed as DesktopTabsDocument;
}

export function tabPreferencesFromDocument(
  document: DesktopTabsDocument,
  allowedTabIds: Iterable<string>,
  availableFolders: Iterable<string>,
): TabPreferenceUpdate {
  const navigation = document.navigation && typeof document.navigation === 'object' && !Array.isArray(document.navigation)
    ? document.navigation as NavigationDocument
    : {};
  const allowedList = Array.from(allowedTabIds, String);
  const allowed = new Set(allowedList);
  const available = new Set(Array.from(availableFolders, String));
  let hiddenTabs = Array.from(new Set(stringList(navigation.hidden).filter((id) => allowed.has(id)))).slice(0, MAX_PREFERENCE_ITEMS);
  const folders = Array.from(new Set(stringList(navigation.folders).filter((folder) => available.has(folder)))).slice(0, MAX_PREFERENCE_ITEMS);
  // Hand-edited config should not strand the panel with no way back to a view.
  // The UI also enforces this, but the file remains intentionally editable.
  if (!folders.length && allowedList.length && allowedList.every((id) => hiddenTabs.includes(id))) {
    hiddenTabs = hiddenTabs.filter((id) => id !== allowedList[0]);
  }
  return {
    hiddenTabs,
    folders,
  };
}

export function withTabPreferences(
  document: DesktopTabsDocument,
  input: TabPreferenceUpdate,
  allowedTabIds: Iterable<string>,
  availableFolders: Iterable<string>,
): DesktopTabsDocument {
  const normalized = tabPreferencesFromDocument(
    { navigation: { hidden: input?.hiddenTabs, folders: input?.folders } },
    allowedTabIds,
    availableFolders,
  );
  const existingNavigation = document.navigation && typeof document.navigation === 'object' && !Array.isArray(document.navigation)
    ? document.navigation as NavigationDocument
    : {};
  return {
    ...document,
    navigation: {
      ...existingNavigation,
      hidden: normalized.hiddenTabs,
      folders: normalized.folders,
    },
  };
}

/** Atomically replace only the known desktop-tabs file inside a validated vault config directory. */
export function writeDesktopTabsDocument(vault: string, document: DesktopTabsDocument): boolean {
  const configType = pathType(vault, '_config');
  const configDir = path.join(vault, '_config');
  let createdConfigDirectory = false;
  if (configType && configType !== 'directory') throw new Error('The vault _config path is not a directory');
  if (!configType) {
    if (fs.existsSync(configDir)) throw new Error('The vault _config directory is unsafe');
    fs.mkdirSync(configDir, { recursive: false });
    createdConfigDirectory = true;
  }
  const target = path.join(configDir, 'desktop-tabs.json');
  if (fs.existsSync(target) && pathType(vault, '_config/desktop-tabs.json') !== 'file') {
    throw new Error('desktop-tabs.json is unsafe');
  }
  const temporary = path.join(configDir, `.desktop-tabs-${process.pid}-${Date.now()}.tmp`);
  try {
    fs.writeFileSync(temporary, JSON.stringify(document, null, 2) + '\n', { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, target);
  } finally {
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch (_) {}
  }
  return createdConfigDirectory;
}
