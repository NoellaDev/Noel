const { contextBridge, ipcRenderer } = require('electron')

let windowId = null;

// Listen for window ID from main process
ipcRenderer.on('set-window-id', (_, id) => {
  windowId = id;
});

contextBridge.exposeInMainWorld('electron', {
  hideWindow: () => ipcRenderer.send('hide-window'),
  createChatWindow: (query) => ipcRenderer.send('create-chat-window', query),
  resizeWindow: (width, height) => ipcRenderer.send('resize-window', { windowId, width, height }),
  getWindowId: () => windowId,
})
