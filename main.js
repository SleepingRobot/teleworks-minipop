const { app, BrowserWindow, ipcMain } = require('electron')
const isDev = require('electron-is-dev');
const keytar = require('keytar')
let redtailUsername = ''
let redtailPassword = ''
let redtailApiKey = ''
const gotTheLock = app.requestSingleInstanceLock()
let screenPopWindow = null
let contactData = {}

app.whenReady().then(() => {
  if (isDev) {
      console.log('Running in development');
  } else {
      console.log('Running in production');
  }

  // Check for supported CLI arguments
  const redtailUsernameCli = app.commandLine.getSwitchValue("redtail-username")
  const redtailPasswordCli = app.commandLine.getSwitchValue("redtail-password")
  const redtailApiKeyCli = app.commandLine.getSwitchValue("redtail-apikey")
  const redtailLookupNumberCli = app.commandLine.getSwitchValue("redtail-phone")

  // If passed Redtail credential values, update in OS credential manager and
  // refresh Redtail UserKey
  if(redtailUsernameCli)
    keytar.setPassword('zac-screen-pop', 'redtail-username', redtailUsernameCli);
  if(redtailPasswordCli)
    keytar.setPassword('zac-screen-pop', 'redtail-password', redtailPasswordCli);
  if(redtailApiKeyCli)
    keytar.setPassword('zac-screen-pop', 'redtail-apikey', redtailApiKeyCli);
  if(redtailUsernameCli || redtailPasswordCli || redtailApiKeyCli)
    updateRedtailUserKey()

  // If passed a Redtail phone number, parse it and
  // query Redtail's API for matching contact to display in screen pop
  if (redtailLookupNumberCli) {
    const parsedNumber = parseNumber(redtailLookupNumberCli)
    await keytar.getPassword('zac-screen-pop', 'redtail-userkey').then((key) =>{
      lookupRedtailContact(key, redtailLookupNumberCli, parsedNumber)
    })
  }
})

function parseNumber (n) {
  if (n.startsWith("+1")){
    n = n.substring(2)
  }
  return n.replace(/\D/g,'')
}

function updateRedtailUserKey() {
  keytar.deletePassword('zac-screen-pop', 'redtail-userkey')

  await keytar.getPassword('zac-screen-pop', 'redtail-username').then((v) => {
    redtailUsername = v
  })
  await keytar.getPassword('zac-screen-pop', 'redtail-password').then((v) => {
    redtailPassword = v
  })
  await keytar.getPassword('zac-screen-pop', 'redtail-apikey').then((v) => {
    redtailApiKey = v
  })

  // If username, password, or API Key are missing, prompt user for input and
  // recursively call this function to ensure new inputs are valid
  if(!redtailUsername || !redtailPassword || !redtailApiKey) {
    promptForRedtailCreds(redtailUsername, redtailPassword, redtailApiKey)
    updateRedtailUserKey()
  } else {
    // Otherwise, encode values as Redtail Basic auth and use to acquire UserKey
    const unencodedAuth = redtailApiKey + ":" + redtailUsername + ":" + redtailPassword
    const redtailBasicAuth = new Buffer(unencodedAuth).toString('base64')
    const resp = getRedtailUserKey(redtailBasicAuth)
    if(resp && !resp.startsWith('ERROR: ')) {
      keytar.setPassword('zac-screen-pop', 'redtail-userkey', resp);
    } else if(resp.startsWith('ERROR: ')) {
      // TODO: display provided error and re-prompt user for input
    } else {
      // TODO: display generic error and re-prompt user for input
    }

  }
}

function getRedtailUserKey(basicAuth) {
  // Prepare HTTP request to Redtail CRM API
  const { net } = require('electron')
  const request = net.request({
    method: 'GET',
    protocol: 'https:',
    hostname: 'smf.crm3.redtailtechnology.com',
    port: 443,
    path: '/api/public/v1/authentication'
  })
  request.setHeader('Authorization', 'Basic ' + basicAuth)
  request.setHeader('Content-Type', "application/json")

  // Process HTTP response from Redtail CRM API
  request.on('response', (response) => {
    //console.log(`STATUS: ${response.statusCode}`)
    response.on('data', (d) => {
      const resp = JSON.parse(d)
      if (resp?.UserKey) {
        return resp.UserKey
      } else {
        // TODO: improve returned error message / status
        return `ERROR: ${response.statusCode}`
      }
    })
  })
  request.end()
}

function promptForRedtailCreds(username, password, apiKey){
  // TODO: implement user input modal
  console.log("PROMPTING USER")
}

function lookupRedtailContact(userKey, cliNumber, parsedNumber) {
  // Prepare HTTP request to Redtail CRM API
  const { net } = require('electron')
  const request = net.request({
    method: 'GET',
    protocol: 'https:',
    hostname: 'smf.crm3.redtailtechnology.com',
    port: 443,
    path: '/api/public/v1/contacts/search?phone_number=' + parsedNumber 
  })
  request.setHeader('Authorization', 'Userkeyauth ' + userKey)
  request.setHeader('include', 'addresses,phones,emails,urls')
  request.setHeader('Content-Type', 'application/json')

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