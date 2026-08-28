import { contextBridge, ipcRenderer, webUtils } from 'electron';

const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args);

function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const wrapped = (_e: Electron.IpcRendererEvent, payload: unknown) => cb(payload as T);
  ipcRenderer.on(channel, wrapped);
  return () => { ipcRenderer.removeListener(channel, wrapped); };
}

// The MemexApi interface in src/shared/types.d.ts is the single source of truth for
// these signatures — the renderer compiles against it, and this annotation makes a
// drifting method a compile error here.
const api: MemexApi = {
  // vault lifecycle
  pickDirectory: () => invoke('vault:pick'),
  pickFiles: () => invoke('files:pick'),
  detectVault: (p) => invoke('vault:detect', p),
  createVault: (opts) => invoke('vault:create', opts),
  openVault: (p) => invoke('vault:open', p),
  recentVaults: () => invoke('vault:recent'),
  currentVault: () => invoke('vault:current'),
  resetToolApprovals: () => invoke('permissions:reset'),
  appVersion: () => invoke('app:version'),
  checkForUpdates: () => invoke('update:check'),
  installUpdate: () => invoke('update:install'),
  checkVaultUpdate: () => invoke('vault:updateCheck'),
  legalState: () => invoke('legal:state'),
  legalAccept: () => invoke('legal:accept'),
  legalQuit: () => invoke('app:quit'),

  // data panels
  data: (kind: DataKind) => invoke('data:get', kind),
  appConfig: () => invoke('data:appConfig'),
  updateTabPreferences: (preferences) => invoke('tabs:updatePreferences', preferences),
  search: (q) => invoke('vault:search', q),
  tabContent: (p) => invoke('tab:content', p),
  tabQuery: (def) => invoke('tab:query', def),
  readNote: (rel) => invoke('note:read', rel),
  registerArtifact: (html) => invoke('artifact:register', html),

  // agent chat
  sendMessage: (text) => invoke('agent:send', text),
  interrupt: () => invoke('agent:interrupt'),
  agentModels: () => invoke('agent:models'),
  setAgentModel: (model) => invoke('agent:setModel', model),

  // inbox / outbox
  addInboxNote: (text) => invoke('inbox:addNote', text),
  dropIntoInbox: (paths) => invoke('inbox:drop', paths),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  openExternal: (target) => invoke('shell:open', target),
  revealPath: (rel) => invoke('shell:reveal', rel),

  // events from main
  onAgentEvent: (cb) => on('agent:event', cb),
  onFsChanged: (cb) => on('fs:changed', cb),
  onSetupProgress: (cb) => on('setup:progress', cb),
  onIconDrop: (cb) => on('inbox:iconDrop', cb),
  onUpdateStatus: (cb) => on('update:status', cb),
};

contextBridge.exposeInMainWorld('memex', api);
