const { contextBridge, ipcRenderer } = require('electron')

const config = JSON.parse(process.argv.find((arg) => arg.startsWith('{')) || '{}');

contextBridge.exposeInMainWorld('appConfig', {
  get: (key) => config[key],
  getAll: () => config,
});

contextBridge.exposeInMainWorld('electron', {
  getConfig: () => config,
  hideWindow: () => ipcRenderer.send('hide-window'),
  directoryChooser: () => ipcRenderer.send('directory-chooser'),
  createChatWindow: (query) => ipcRenderer.send('create-chat-window', query),
  logInfo: (txt) => ipcRenderer.send('logInfo', txt),
  showNotification: (data) => ipcRenderer.send('notify', data),
  createWingToWingWindow: (query) => ipcRenderer.send('create-wing-to-wing-window', query),
  openInChrome: (url) => ipcRenderer.send('open-in-chrome', url),
  fetchMetadata: (url) => ipcRenderer.invoke('fetch-metadata', url),
  reloadApp: () => ipcRenderer.send('reload-app'),
  on: (channel, callback) => {
    if (channel === 'fatal-error') {
      ipcRenderer.on(channel, callback);
    }
  },
  off: (channel, callback) => {
    if (channel === 'fatal-error') {
      ipcRenderer.removeListener(channel, callback);
    }
  }
})