const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getAlarms: () => ipcRenderer.invoke('get-alarms'),
  saveAlarms: (alarms) => ipcRenderer.invoke('save-alarms', alarms),
});
