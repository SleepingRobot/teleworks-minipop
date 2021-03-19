const { ipcRenderer, contextBridge } = require('electron')

contextBridge.exposeInMainWorld(
  'electron',
  {
    send: (channel, data) => {
      const validChannels = ['auth-submission', 'settings-submission', 'crm-logout', 'crm-login', 'toggle-displayfield', 'toggle-history', 'toggle-settings', 'hide-app'];
      if (validChannels.includes(channel)) {
          ipcRenderer.send(channel, data);
      }
    },
    receive: (channel, func) => {
      const validChannels = ['screenpop-data', 'auth-data', 'history-data', 'settings-data', 'image-paths'];
      if (validChannels.includes(channel)) {
          ipcRenderer.on(channel, (event, ...args) => func(...args));
      }
    }
  }
)