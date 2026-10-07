const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('deskBuddy', {
  on: (channel, fn) => {
    const allowed = ['tick', 'reminder', 'hide-card', 'welcome', 'show-stats', 'cheer', 'greet', 'bye', 'say', 'enter', 'leave'];
    if (allowed.includes(channel)) ipcRenderer.on(channel, (_e, data) => fn(data));
  },
  respond: (id, action) => ipcRenderer.send('reminder-response', { id, action }),
  log: id => ipcRenderer.send('log', id),
  pause: minutes => ipcRenderer.send('pause', minutes),
  setIgnore: ignore => ipcRenderer.send('set-ignore', ignore),
  statsClosed: () => ipcRenderer.send('stats-closed'),
  cardShown: () => ipcRenderer.send('card-shown'),
  walkedOff: () => ipcRenderer.send('walked-off'),
  setTasks: items => ipcRenderer.send('tasks:set', items),
  touch: () => ipcRenderer.send('card-touch'),
  focusMe: () => ipcRenderer.send('focus-me'),
});
