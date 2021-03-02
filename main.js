const { app, BrowserWindow, ipcMain, Menu, Tray } = require('electron')
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
    valid: false,
    name: '',
    id: '',
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
app.whenReady().then(() => {
  if (isDev) {
      console.log('Running in development');
  } else {
      console.log('Running in production');
  }
  initTrayIcon()
  initWindows()
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
  // If missing valid Redtail auth, display credential input modal
  if(!redtailSettings.auth.valid) {
    openAuthModal('Redtail', cliNumber, 'Enter Redtail credentials to lookup contact.')
    return
  }

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

  if(screenpopWindow){
    screenpopWindow.webContents.on('did-finish-load', ()=>{
      screenpopWindow.webContents.send('screenpop-data', c)
    })
  }

  if(historyWindow) {
    historyWindow.webContents.on('did-finish-load', ()=>{
      historyWindow.webContents.send('history-data', contactData)
    })
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

ipcMain.on('auth-submission', (event, authData) => {
  // When auth input is submitted, close auth window and re-display screenpop
  screenpopWindow.show()
  if(!openWindows.includes('screenpop')) openWindows.push('screenpop')
  authWindow.hide()
  openWindows = openWindows.filter(e => e !== 'auth')

  // Then clear old auth settings, and validate new auth credentials
  if (authData?.crm === 'Redtail') {
    redtailSettings.auth.valid = false
    redtailSettings.auth.name = ''
    redtailSettings.auth.id = ''
    keytar.deletePassword(keytarService, 'redtail-userkey').then(()=>{
      authenticateRedtail(authData)
    })
  }
})

function authenticateRedtail(authData) {
  const unencodedAuth = authData?.apiKey + ":" + authData?.username + ":" + authData?.password
  const basicAuth = Buffer.from(unencodedAuth).toString('base64')

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
  request.setHeader('Authorization', 'Basic ' + basicAuth)
  request.setHeader('Content-Type', 'application/json')


  // Process HTTP response from Redtail CRM API
  request.on('response', (response) => {
    if (response?.statusCode == 200) {
      response.on('data', (d) => {
        const resp = JSON.parse(d)
        const userKey = JSON.parse(d).authenticated_user?.user_key
        if (resp?.APIKey && resp?.UserKey) {
          // If response indicates success, update Redtail auth settings
          redtailSettings.auth.valid = true
          redtailSettings.auth.name = resp?.Name
          redtailSettings.auth.id = resp?.UserID
          // then store UserKey in OS User's keychain
          const unencodedKey = resp?.APIKey + ":" + resp?.UserKey
          const encodedUserKey = Buffer.from(unencodedKey).toString('base64')
          keytar.setPassword(keytarService, 'redtail-userkey', encodedUserKey)
          // finally, if we were authenticating to fulfill a CLI number lookup, we can now re-attempt the lookup
          if(authData?.cliNumber){
            // Note: keytar.setPassword yields nothing, so we manually delay a couple seconds to give the OS time to store the secret first
            setTimeout(() => {lookupRedtailContact(authData.cliNumber)}, 2000)  
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

// function validateRedtailUserKey() {
//   keytar.getPassword('zac-screen-pop', 'redtail-userkey').then((key) =>{
//     // If key exists in OS User's keychain, test it against Redtail CRM API
//     if (key) {
//       // Prepare HTTP request to Redtail CRM API
//       const { net } = require('electron')
//       const request = net.request({
//         method: 'GET',
//         protocol: 'https:',
//         hostname: 'api2.redtailtechnology.com',
//         port: 443,
//         path: '/crm/v1/rest/authentication'
//       })
//       request.setHeader('Authorization', 'Userkeyauth ' + key)
//       request.setHeader('Content-Type', 'application/json')

//       // Process HTTP response from Redtail CRM API
//       request.on('response', (response) => {
//         if (response.statusCode == 200) {
//           // If valid, save user information, then render window

//         } else if(response.statusCode == 401) {
//           redtailAuthMessage = 'Stored Redtail authentication rejected by Redtail API as invalid (HTTP ERR 401). Please re-enter credentials to try again.'
//           renderHTML(400, 300, 'auth.html')
//         } else {
//           redtailAuthMessage = 'Error validating stored Redtail authentication with Redtail API (HTTP ERR' + response.statusCode.toString() + '). Please re-enter credentials to try again.'
//           renderHTML(400, 300, 'auth.html')
//         }
//       })
//       request.end()
//     } else {
//       redtailAuthMessage = 'Redtail authentication required.'
//       renderHTML(400, 300, 'auth.html')
//     }
//   })
// }

// function displayWindow() {
//   if(!redtailUser || !redtailUserKey){
//     // Redtail user must be validated before proceeding
//     validateRedtailUserKey()
//   } else if (redtailLookupNumber ) {
//     // ... otherwise, if passed a Redtail phone number, query Redtail's API
//     // for matching contact information, then display screen pop
//     lookupRedtailContact(redtailLookupNumber, () => {renderHTML(300, 175, 'screenpop.html')})
//   } else {
//     // ... otherwise, if valid account but no valid parameter passed, display Info window
//     renderInfoWindow()
//   }
// }

