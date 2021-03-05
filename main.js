const { app, BrowserWindow, ipcMain, Menu, Tray } = require('electron')
const fs = require('fs');
const crypto = require('crypto');
const path = require ('path');
const isDev = require('electron-is-dev');
const keytar = require('keytar')
const isPrimaryInstance = app.requestSingleInstanceLock()
const keytarService = 'teleworks-screenpop'
let tray = null
let screenpopWindow = null
let historyWindow = null
let settingsWindow = null
let authWindow = null
let openWindows = ['screenpop']
let contactData = []
let redtailSettings = {
  auth: {
    name: '',
    id: '',
    key: '',
  }
}

if(isPrimaryInstance) {
  // If this is the primary instance and a secondary instance is opened
  // re-focus our primary window if it exists, and process the new CLI args
  app.on('second-instance', (event, argv, workingDirectory) => {
    if (screenpopWindow) {
      parseCommandLineArgs(argv)
      screenpopWindow.show()
    }
  })
} else {
  // ... otherwise, if this is the secondary instance, self-terminate
  app.exit()
}

// When ready, render ScreenPop window and process any CLI args
app.whenReady().then(async () => {
  if (isDev) {
      console.log('Running in development');
  } else {
      console.log('Running in production');
  }
  
  initTrayIcon()
  initWindows()
  //await clearAuth('Redtail')
  await checkKeychainForAuth()
  loadContactData()
  parseCommandLineArgs()
})

function initTrayIcon() {
  tray = new Tray(`${__dirname}/build/icon.png`)
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show', type: 'normal', click() { restoreAppFromTray() } },
    { label: 'Exit', type: 'normal', click() { app.exit() } }
  ])
  tray.setToolTip('Teleworks Screenpop')
  tray.setContextMenu(contextMenu)
}

function initWindows() {
  const windowOptions = {
    webPreferences: {
      allowRunningInsecureContent: false,
      contextIsolation: true,
      enableRemoteModule: false,
      nodeIntegration: false,
      sandbox: true,
      preload: `${__dirname}/preload.js`
    }
  }
  const closeToTray = (e) => {
    e.preventDefault()
    closeAppToTray()
  }
  screenpopWindow = new BrowserWindow({...windowOptions, width:400, height:200})
  screenpopWindow.removeMenu()
  screenpopWindow.loadFile('screenpop.html')
  screenpopWindow.on('close', closeToTray)
  //screenpopWindow.webContents.openDevTools()
  historyWindow = new BrowserWindow({...windowOptions, width:400, height:1200, show:false, parent:screenpopWindow})
  historyWindow.removeMenu()
  historyWindow.loadFile('history.html')
  historyWindow.hide()
  //historyWindow.webContents.openDevTools()
  settingsWindow = new BrowserWindow({...windowOptions, width:800, height:800, show:false, parent:screenpopWindow})
  settingsWindow.removeMenu()
  settingsWindow.loadFile('settings.html')
  settingsWindow.hide()
  //settingsWindow.webContents.openDevTools()
  authWindow = new BrowserWindow({...windowOptions, width:400, height:250, show:false, parent:screenpopWindow, frame:true})
  authWindow.removeMenu()
  authWindow.loadFile('auth.html')
  authWindow.on('close', closeToTray)
  //authWindow.webContents.openDevTools()
}

function closeAppToTray() {
  screenpopWindow.hide()
  authWindow.hide()
  historyWindow.hide()
  settingsWindow.hide()
}

function restoreAppFromTray() {
  if(openWindows.includes('screenpop')) screenpopWindow.show()
  if(openWindows.includes('auth')) authWindow.show()
  if(openWindows.includes('history')) historyWindow.show()
  if(openWindows.includes('settings')) settingsWindow.show()
}

// Return existing Key and IV if present in OS User's keychain, otherwise generate, store, and return new ones
async function getEncryptionSecrets() {
  k = await keytar.getPassword(keytarService, 'encryption-key')
  i = await keytar.getPassword(keytarService, 'encryption-iv')
  if(k && i) {
    k = Buffer.from(k, 'hex')
    i = Buffer.from(i, 'hex')
    return {key: k, iv: i}
  } else {
    let newKey = crypto.randomBytes(32)
    let newIv = crypto.randomBytes(16)
    keytar.setPassword(keytarService, 'encryption-key', newKey.toString('hex'))
    keytar.setPassword(keytarService, 'encryption-iv', newIv.toString('hex'))
    return {key: newKey, iv: newIv}
  }
}

// Reads contactData from encrypted file on disk, if present
// TODO: Add better error handling
async function loadContactData() {
  const historyFile = path.resolve('./screenpop.history')
  const secrets = await getEncryptionSecrets()
  const decipher = crypto.createDecipheriv('aes-256-cbc', secrets?.key, secrets?.iv)
  fs.readFile(historyFile, (err, input) => {
    if (err) {
      console.log("Error reading contactData from disk: ")
      console.log(err)
    } else {
      const output = Buffer.concat([cipher.update(input), cipher()])
      if(output){
        contactData = output
        console.log("contact data from disk:")
        console.log(output)
      }
    }
  })
}

// Saves contactData to encrypted file on disk
// TODO: Add better error handling
function saveContactData() {
  const historyFile = path.resolve('./screenpop.history')
  const secrets = getEncryptionSecrets()
  const cipher = crypto.createCipheriv('aes-256-cbc', secrets?.key, secrets?.iv)
  const output = Buffer.concat([cipher.update(contactData), cipher.final()])
  fs.writeFile(historyFile, output, (err) => {
    if (err) {
      console.log("Error writing contactData to disk: ")
      console.log(err)
    }
  });
}


// If passed an argument array from secondary instance, process arguments from it
// otherwise, if primary instance, process arguments from app.commandLine
function parseCommandLineArgs(argv = null){

  let redtailLookupNumber = ''
  
  if(argv){
    redtailLookupNumber = getCommandLineValue(argv, 'redtail-phone')
  } else {
    redtailLookupNumber = app.commandLine.getSwitchValue('redtail-phone')
  }

  // If passed a redtail number, look it up
  if(redtailLookupNumber) {
    lookupRedtailContact(redtailLookupNumber)
  }
  
}

function getCommandLineValue(argv, name) {
  let arg = argv.find(a => a.toLowerCase().startsWith('--' + name + '='))
  if(arg) {
    return arg.split('=')[1]
  } else {
    return ''
  }
}

function lookupRedtailContact(cliNumber) {
  // If missing Redtail auth key, display credential input modal
  if(!redtailSettings.auth.key) {
    openAuthModal('Redtail', cliNumber, 'Enter Redtail credentials to lookup contact.')
    return
  }

  // Parse number to format compatible with Redtail API
  const parsedNumber = parseNumber(cliNumber)

  // Prepare HTTP request to Redtail CRM API
  const { net } = require('electron')
  const request = net.request({
    method: 'GET',
    protocol: 'https:',
    hostname: 'smf.crm3.redtailtechnology.com',
    port: 443,
    path: '/api/public/v1/contacts/search?phone_number=' + parsedNumber 
  })
  request.setHeader('Authorization', 'Userkeyauth ' + redtailSettings.auth.key)
  request.setHeader('include', 'addresses,phones,emails,urls')
  request.setHeader('Content-Type', 'application/json')

  // Process HTTP response from Redtail CRM API
  // TODO: add error handling
  request.on('response', (response) => {
    response.on('data', (d) => {
      const resp = JSON.parse(d)
      // TODO: handle multiple matches. i.e., contactData[c:[{},{}], c:[{}], c:[{},{},{}], etc]
      if (resp?.contacts?.length > 0) {
        resp.contacts[0].cli_number = cliNumber
        resp.contacts[0].call_received = Date.now()
        pushContactData(resp.contacts[0])
      }
    })
  })
  request.end()
}

// Strips '+1' and all non-digit characters from number, if present
function parseNumber (n) {
  return n.replace('+1','').replace(/\D/g,'')
}

// Add new contact lookup results to stack, update ScreenPop and CallHistory windows
function pushContactData(c) {
  contactData.push(c)
  // TODO: securely write new contactData array to encrypted file

  if(screenpopWindow && !screenpopWindow.webContents.isLoading()){
    screenpopWindow.webContents.send('screenpop-data', c)
  }

  if(historyWindow && !historyWindow.webContents.isLoading()) {
    historyWindow.webContents.send('history-data', contactData)
  }
}

function openAuthModal(crm, cliNumber, message = null) {
  if (!message) {
    message = `Enter ${crm} Account Credentials.`
  }
  
  const authData = {crm: crm, cliNumber: cliNumber, message: message }

  if (authWindow) {
    authWindow.webContents.on('did-finish-load', ()=>{
      authWindow.webContents.send('auth-data', authData)
    })
    authWindow.once('ready-to-show', () => {
      authWindow.show()
      if(!openWindows.includes('auth')) openWindows.push('auth')
      screenpopWindow.hide()
      openWindows = openWindows.filter(e => e !== 'screenpop')
    })
  }
}

ipcMain.on('auth-submission', async (event, authData) => {
  // When auth input is submitted, close auth window and re-display screenpop
  screenpopWindow.show()
  if(!openWindows.includes('screenpop')) openWindows.push('screenpop')
  authWindow.hide()
  openWindows = openWindows.filter(e => e !== 'auth')

  // Then clear old auth settings...
  await clearAuth(authData.crm)

  // ...and validate new auth credentials
  if (authData?.crm === 'Redtail') {
    authenticateRedtail(authData)
  }
})

async function clearAuth(crm) {
  if (crm === 'Redtail') {
    redtailSettings.auth.name = ''
    redtailSettings.auth.id = ''
    redtailSettings.auth.key = ''
    await keytar.deletePassword(keytarService, 'redtail-username')
    await keytar.deletePassword(keytarService, 'redtail-userid')
    await keytar.deletePassword(keytarService, 'redtail-userkey')
  }
}

// Since Redtail authentication endpoint only returns a user's name value when using Userkeyauth and not Basic auth...
// if this function successfully auths via Basic it will then recursively re-call itself with returned
// UserKey so that we can properly capture the user's name
function authenticateRedtail(authData, UserkeyToken = '') {

  // Prepare Basic auth header value if we were not passed a UserKey
  let basicToken = ''
  if(!UserkeyToken){
    const unencodedAuth = authData?.apiKey + ":" + authData?.username + ":" + authData?.password
    basicToken = Buffer.from(unencodedAuth).toString('base64')
  }

  // Prepare HTTP request to Redtail CRM API
  // TODO: Update this to Redtail TWAPI API if they ever start returning full user details...
  const { net } = require('electron')
  const request = net.request({
    method: 'GET',
    protocol: 'https:',
    hostname: 'api2.redtailtechnology.com',
    port: 443,
    path: '/crm/v1/rest/authentication'
  })
  request.setHeader('Content-Type', 'application/json')
  // Set appropriate auth header depending on whether we are using Basic or UserKey
  if(!UserkeyToken) {
    request.setHeader('Authorization', 'Basic ' + basicToken)
  } else {
    request.setHeader('Authorization', 'Userkeyauth ' + UserkeyToken)
  }
  


  // Process HTTP response from Redtail CRM API
  request.on('response', (response) => {
    if (response?.statusCode == 200) {
      response.on('data', (d) => {
        const resp = JSON.parse(d)
        if (resp?.APIKey && resp?.UserKey) {
          // If response indicates success, encode returned API UserKey
          const unencodedKey = resp?.APIKey + ":" + resp?.UserKey
          const encodedUserKey = Buffer.from(unencodedKey).toString('base64')

          // If we authenticated with Basic auth, returned name value will be null
          // so recursively re-call this function using returned UserKey
          if(!UserkeyToken) {
            authenticateRedtail(authData, encodedUserKey)
          } else {
            // otherwise, update auth settings in memory and store in OS User's keychain
            if (resp?.Name) {
              redtailSettings.auth.name = resp.Name
              keytar.setPassword(keytarService, 'redtail-username', resp.Name)
            }
            if (resp?.UserID) {
              redtailSettings.auth.id = resp.UserID.toString()
              keytar.setPassword(keytarService, 'redtail-userid', resp.UserID.toString())
            }
            if (encodedUserKey) {
              redtailSettings.auth.key = encodedUserKey
              keytar.setPassword(keytarService, 'redtail-userkey', encodedUserKey)
            }
            // finally, if we were authenticating to fulfill a CLI number lookup, we can now re-attempt the lookup
            if(authData?.cliNumber){
              // Note: keytar.setPassword yields nothing, so we manually delay a couple seconds
              //       to give the OS time to store the secret first just in case
              setTimeout(() => {lookupRedtailContact(authData.cliNumber)}, 2000)  
            }
          }
        }
      })
    } else if(response?.statusCode >= 400 && response?.statusCode < 500) {
      openAuthModal('Redtail', resp?.cliNumber, `Stored Redtail authentication rejected by Redtail API as invalid (HTTP ERR ${response.statusCode.toString()}). Please re-enter credentials to try again.`)
    } else {
      openAuthModal('Redtail', resp?.cliNumber, `Error validating with Redtail API (HTTP ERR ${response.statusCode.toString()}). Please re-enter credentials to try again.`)
    }
  })
  request.end()
}

// TODO: change this to minimize to task bar on screenpopWindow close
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// If any CRM auth settings have been stored in OS User's Keychain, load them into memory
async function checkKeychainForAuth() {
  redtailSettings.auth.name = await keytar.getPassword(keytarService, 'redtail-username')
  redtailSettings.auth.id = await keytar.getPassword(keytarService, 'redtail-userid')
  redtailSettings.auth.key = await keytar.getPassword(keytarService, 'redtail-userkey')
}

