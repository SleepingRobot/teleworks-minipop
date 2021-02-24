const { app, BrowserWindow, ipcMain } = require('electron')
const isDev = require('electron-is-dev');
const keytar = require('keytar')
const gotTheLock = app.requestSingleInstanceLock()
let screenPopWindow = null
let contactData = {}

app.whenReady().then(() => {
  if (isDev) {
      console.log('Running in development');
  } else {
      console.log('Running in production');
  }

  const cliNumber = app.commandLine.getSwitchValue("number")
  const parsedNumber = parseNumber(cliNumber)

  //keytar.setPassword('zac-screen-pop', 'redtail-userkey', 'secret');
  const secret = keytar.getPassword('zac-screen-pop', 'redtail-userkey')
  secret.then((s) => {
    lookupRedtailContact(s, cliNumber, parsedNumber)
  });
})

function parseNumber (n) {
  if (n.startsWith("+1")){
    n = n.substring(2)
  }
  return n.replace(/\D/g,'')
}

function lookupRedtailContact(userkey, cliNumber, parsedNumber) {
  // Prepare HTTP request to Redtail CRM API
  const { net } = require('electron')
  const request = net.request({
    method: 'GET',
    protocol: 'https:',
    hostname: 'smf.crm3.redtailtechnology.com',
    port: 443,
    path: '/api/public/v1/contacts/search?phone_number=' + parsedNumber 
  })
  request.setHeader("Authorization", userkey)
  request.setHeader("include", "addresses,phones,emails,urls")
  request.setHeader("Content-Type", "application/json")

  // Process HTTP response from Redtail CRM API
  request.on('response', (response) => {
    //console.log(`STATUS: ${response.statusCode}`)
    response.on('data', (d) => {
      const resp = JSON.parse(d)
      if (resp?.contacts?.length > 0) {
        resp.contacts[0].cli_number = cliNumber
        contactData = resp.contacts[0]
        renderScreenPop()
      }
    })
  })
  request.end()
}

function renderScreenPop() {
  const win = new BrowserWindow({
    width: 300,
    height: 200,
    webPreferences: {
      allowRunningInsecureContent: false,
      contextIsolation: true,
      enableRemoteModule: false,
      nodeIntegration: false,
      sandbox: true,
      preload: `${__dirname}/preload.js`
    }
  })
  win.removeMenu()
  win.loadFile('index.html')
  //win.webContents.openDevTools()
}

ipcMain.on('contact-data-request', (event) => {
  event.sender.send('contact-data-reply', contactData);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})