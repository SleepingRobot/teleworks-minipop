const { app, BrowserWindow } = require('electron')

function createWindow () {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: true
    }
  })
  win.loadFile('index.html')

  const isDev = require('electron-is-dev');
  if (isDev) {
      console.log('Running in development');
  } else {
      console.log('Running in production');
  }

  const keytar = require('keytar')
  //keytar.setPassword('zac-screen-pop', 'redtail-userkey', 'secret');
  const secret = keytar.getPassword('zac-screen-pop', 'redtail-userkey')
  secret.then((result) => {
    console.log("secret: "+ result); // result will be 'secret'
  });
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {  
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})