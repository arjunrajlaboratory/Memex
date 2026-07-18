import { contextBridge, ipcRenderer, webUtils } from 'electron';

const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args);

type Payload = unknown;
type Unsubscribe = () => void;

const listeners = new Map<(payload: never) => void, [string, (e: Electron.IpcRendererEvent, payload: Payload) => void]>();
function on<T>(channel: string, cb: (payload: T) => void): Unsubscribe {
  const wrapped = (_e: Electron.IpcRendererEvent, payload: Payload) => cb(payload as T);
  ipcRenderer.on(channel, wrapped);
  listeners.set(cb, [channel, wrapped]);
  return () => {
    const entry = listeners.get(cb);
    if (entry) ipcRenderer.removeListener(entry[0], entry[1]);
  };
}

// Keep this object in sync with the MemexApi interface in src/shared/types.d.ts —
// that interface is what the renderer compiles against.
const api: MemexApi = {
  // vault lifecycle
  pickDirectory: () => invoke('vault:pick') as Promise<string | null>,
  pickFiles: () => invoke('files:pick') as Promise<string[]>,
  detectVault: (p) => invoke('vault:detect', p) as Promise<{ path: string; isVault: boolean }>,
  createVault: (opts) => invoke('vault:create', opts) as Promise<CreateVaultResult>,
  openVault: (p) => invoke('vault:open', p) as Promise<OpenVaultResult>,
  recentVaults: () => invoke('vault:recent') as Promise<{ recent: string[]; last: string | null }>,
  currentVault: () => invoke('vault:current') as Promise<VaultSummary | null>,

  // data panels
  data: ((kind: DataKind) => invoke('data:get', kind)) as MemexApi['data'],
  appConfig: () => invoke('data:appConfig') as Promise<AppConfig | null>,
  tabContent: (p) => invoke('tab:content', p) as Promise<TabContentResult>,
  tabQuery: (def) => invoke('tab:query', def) as Promise<TabQueryResult>,
  readNote: (rel) => invoke('note:read', rel) as Promise<VaultFile | null>,
  registerArtifact: (html) => invoke('artifact:register', html) as Promise<string>,

  // agent chat
  sendMessage: (text) => invoke('agent:send', text) as Promise<SendResult>,
  interrupt: () => invoke('agent:interrupt') as Promise<{ ok: boolean }>,
  runPrompt: (text) => invoke('agent:send', text) as Promise<SendResult>,

  // inbox / outbox
  addInboxNote: (text) => invoke('inbox:addNote', text) as Promise<{ ok: boolean; rel?: string }>,
  dropIntoInbox: (paths) => invoke('inbox:drop', paths) as Promise<DropResult>,
  getPathForFile: (file) => webUtils.getPathForFile(file),
  openExternal: (target) => invoke('shell:open', target) as Promise<void>,
  revealPath: (rel) => invoke('shell:reveal', rel) as Promise<void>,

  // events from main
  onAgentEvent: (cb) => on('agent:event', cb),
  onFsChanged: (cb) => on('fs:changed', cb),
  onSetupProgress: (cb) => on('setup:progress', cb),
};

contextBridge.exposeInMainWorld('memex', api);
