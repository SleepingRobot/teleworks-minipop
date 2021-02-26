const { app, BrowserWindow, ipcMain } = require('electron')
const isDev = require('electron-is-dev');
const keytar = require('keytar')
let redtailUserKey = ''
let redtailUser = ''
let redtailLookupNumber = ''
let redtailAuthMessage = ''
const gotTheLock = app.requestSingleInstanceLock()
let win = null
let contactData = {}

app.whenReady().then(() => {
  if (isDev) {
      console.log('Running in development');
  } else {
      console.log('Running in production');
  }

  // If Redtail lookup number passed via CLI, store this value
  redtailLookupNumber = app.commandLine.getSwitchValue("redtail-phone")

  // Ensure valid Redtail UserKey stored in OS User's keychain, prompt user if not
  // Once validated, appropriate window will render depending on CLI args (or lack thereof)
  //keytar.deletePassword('zac-screen-pop', 'redtail-userkey')
  validateRedtailUserKey()
})

ipcMain.on('info-request', (event) => {
  event.sender.send('info-reply', redtailUser)
})

ipcMain.on('screenpop-request', (event) => {
  event.sender.send('screenpop-reply', contactData);
  contactData = ''
})

ipcMain.on('redtail-auth-message-request', (event) => {
  event.sender.send('redtail-auth-message-reply', redtailAuthMessage);
  redtailAuthMessage = ''
})

ipcMain.on('redtail-auth-submission', (event, input) => {
  event.sender.getOwnerBrowserWindow().close()
  getRedtailUserKey(input.apiKey, input.username, input.password)
})

// app.on('window-all-closed', () => {
//   if (process.platform !== 'darwin') {
//     app.quit()
//   }
// })

function validateRedtailUserKey() {
  keytar.getPassword('zac-screen-pop', 'redtail-userkey').then((key) =>{
    // If key exists in OS User's keychain, test it against Redtail CRM API
    if (key) {
      // Prepare HTTP request to Redtail CRM API
      const { net } = require('electron')
      const request = net.request({
        method: 'GET',
        protocol: 'https:',
        hostname: 'api2.redtailtechnology.com',
        port: 443,
        path: '/crm/v1/rest/authentication'
      })
      request.setHeader('Authorization', 'Userkeyauth ' + key)
      request.setHeader('Content-Type', 'application/json')

      // Process HTTP response from Redtail CRM API
      request.on('response', (response) => {
        if (response.statusCode == 200) {
          // If valid, save user information, then render window
          redtailUserKey = key
          response.on('data', (d) => {
            const resp = JSON.parse(d)
            const name = resp?.Name || '<Missing Name>'
            const id = resp?.UserID || '<Missing ID>'
            redtailUser = name + '(ID:' + id + ')'
            renderWindow()
          })
        } else if(response.statusCode == 401) {
          redtailAuthMessage = 'Stored Redtail authentication rejected by Redtail API as invalid (HTTP ERR 401). Please re-enter credentials to try again.'
          renderAuthInput()
        } else {
          redtailAuthMessage = 'Error validating stored Redtail authentication with Redtail API (HTTP ERR' + response.statusCode.toString() + '). Please re-enter credentials to try again.'
          renderAuthInput()
        }
      })
      request.end()
    } else {
      redtailAuthMessage = 'Redtail authentication required.'
      renderAuthInput()
    }
  })
}

async function renderWindow() {
  if(!redtailUser || !redtailUserKey){
    // Redtail user must be validated before proceeding
    validateRedtailUserKey()
  } else if (redtailLookupNumber ) {
    // ... otherwise, if passed a Redtail phone number, query Redtail's API
    // for matching contact information, then display screen pop
    lookupRedtailContact(redtailLookupNumber, renderScreenPop)
  } else {
    // ... otherwise, if valid account but no valid parameter passed, display Info window
    renderInfoWindow()
  }
}

function parseNumber (n) {
  if (n.startsWith("+1")){
    n = n.substring(2)
  }
  return n.replace(/\D/g,'')
}

function renderInfoWindow() {
  // TODO: render info window
  console.log("RENDER INFO WINDOW")
}

function renderScreenPop() {
  win = new BrowserWindow({
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
  win.loadFile('screenpop.html')
  //win.webContents.openDevTools()
}

function renderAuthInput(message){
  win = new BrowserWindow({
    width: 400,
    height: 300,
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
  win.loadFile('auth.html')
  //win.webContents.openDevTools()
}

async function lookupRedtailContact(cliNumber, callback) {
  // Parse number to format compatible with Redtail API
  const parsedNumber = parseNumber(redtailLookupNumber)

  // Prepare HTTP request to Redtail CRM API
  const { net } = require('electron')
  const request = net.request({
    method: 'GET',
    protocol: 'https:',
    hostname: 'smf.crm3.redtailtechnology.com',
    port: 443,
    path: '/api/public/v1/contacts/search?phone_number=' + parsedNumber 
  })
  request.setHeader('Authorization', 'Userkeyauth ' + redtailUserKey)
  request.setHeader('include', 'addresses,phones,emails,urls')
  request.setHeader('Content-Type', 'application/json')

  // Process HTTP response from Redtail CRM API
  request.on('response', (response) => {
    response.on('data', (d) => {
      const resp = JSON.parse(d)      
      if (resp?.contacts?.length > 0) {
        resp.contacts[0].cli_number = cliNumber
        contactData = resp.contacts[0]
        callback()
      }
    })
  })
  request.end()
}

function getRedtailUserKey(apiKey, username, password) {
  const unencodedAuth = apiKey + ":" + username + ":" + password
  const basicAuth = Buffer.from(unencodedAuth).toString('base64')

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
    if (response.statusCode == 200) {
      response.on('data', (d) => {
        const userKey = JSON.parse(d).authenticated_user?.user_key
        if (userKey) {
          const unencodedKey = apiKey + ":" + userKey
          const encodedUserKey = Buffer.from(unencodedKey).toString('base64')
          // If response indicates success, store UserKey in OS User's keychain
          keytar.setPassword('zac-screen-pop', 'redtail-userkey', encodedUserKey).then(
            validateRedtailUserKey()
          )
        }
      })
    }
  })
  request.end()
  
}