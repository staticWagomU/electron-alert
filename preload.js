const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onShowText: (callback) => {
    ipcRenderer.on('show-text', (_, text) => callback(text));
  },
  dismiss: () => ipcRenderer.send('overlay-dismiss'),
});
