'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

const listeners = new Map();
function on(channel, cb) {
  const wrapped = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, wrapped);
  listeners.set(cb, [channel, wrapped]);
  return () => {
    const entry = listeners.get(cb);
    if (entry) ipcRenderer.removeListener(entry[0], entry[1]);
  };
}

contextBridge.exposeInMainWorld('memex', {
  // vault lifecycle
  pickDirectory: () => invoke('vault:pick'),
  pickFiles: () => invoke('files:pick'),
  detectVault: (p) => invoke('vault:detect', p),
  createVault: (opts) => invoke('vault:create', opts),
  openVault: (p) => invoke('vault:open', p),
  recentVaults: () => invoke('vault:recent'),
  currentVault: () => invoke('vault:current'),

  // data panels
  data: (kind) => invoke('data:get', kind),
  appConfig: () => invoke('data:appConfig'),
  tabContent: (p) => invoke('tab:content', p),
  tabQuery: (def) => invoke('tab:query', def),
  readNote: (rel) => invoke('note:read', rel),
  registerArtifact: (html) => invoke('artifact:register', html),

  // agent chat
  sendMessage: (text) => invoke('agent:send', text),
  interrupt: () => invoke('agent:interrupt'),
  runPrompt: (text) => invoke('agent:send', text),

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
});
