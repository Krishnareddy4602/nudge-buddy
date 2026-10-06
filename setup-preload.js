const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('setup', {
  load: () => ipcRenderer.invoke('settings:load'),
  save: settings => ipcRenderer.invoke('settings:save', settings),
  cancel: () => ipcRenderer.send('settings:cancel'),
  quit: () => ipcRenderer.send('app:quit'),
});
