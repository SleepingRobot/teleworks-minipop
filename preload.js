const { ipcRenderer, contextBridge } = require('electron')

contextBridge.exposeInMainWorld(
  'electron',
  {
    send: (channel, data) => {
      const validChannels = ['info-request', 'screenpop-request', 'redtail-auth-message-request', 'redtail-auth-submission'];
      if (validChannels.includes(channel)) {
          ipcRenderer.send(channel, data);
      }
    },
    receive: (channel, func) => {
      const validChannels = ['info-reply', 'screenpop-reply', 'redtail-auth-message-reply'];
      if (validChannels.includes(channel)) {
          ipcRenderer.on(channel, (event, ...args) => func(...args));
      }
    }
  }
)