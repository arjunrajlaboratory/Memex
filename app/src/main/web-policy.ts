import { isSafeExternalUrl } from './security';

export type ExternalNavigationSource = 'explicit' | 'automatic';
export type ExternalNavigationDecision = 'open' | 'deny';

/** Only the preload's explicit shell:open IPC is allowed to leave the app. */
export function externalNavigationPolicy(source: ExternalNavigationSource, raw: string): ExternalNavigationDecision {
  return source === 'explicit' && isSafeExternalUrl(raw) ? 'open' : 'deny';
}

type GuardedSession = Pick<Electron.Session,
  'setPermissionCheckHandler' | 'setPermissionRequestHandler' | 'setDevicePermissionHandler'>;

/** Remote web tabs and scripted artifacts get no ambient Chromium permissions. */
export function installDenyByDefaultPermissions(target: GuardedSession): void {
  target.setPermissionCheckHandler(() => false);
  target.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  target.setDevicePermissionHandler(() => false);
}
