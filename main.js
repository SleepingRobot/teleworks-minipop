const { app, BrowserWindow, ipcMain } = require('electron')
const isDev = require('electron-is-dev');
const keytar = require('keytar')
const isPrimaryInstance = app.requestSingleInstanceLock()
let mainWindow = null
let redtailUserKey = ''
let redtailUser = ''
let redtailLookupNumber = ''
let redtailAuthMessage = ''
let contactData = {}

if(isPrimaryInstance) {
  // If this is the primary instance and a secondary instance is opened
  // re-focus our primary window if it exists, and process the new CLI args
  app.on('second-instance', (event, argv, workingDirectory) => {
    if (mainWindow) {
      parseCommandLineArgs(argv)
      validateRedtailUserKey()
      mainWindow.show()
    }
  })
} else {
  // ... otherwise, if this is the secondary instance, self-terminate
  app.exit()
}

app.whenReady().then(() => {
  if (isDev) {
      console.log('Running in development');
  } else {
      console.log('Running in production');
  }

  initWindow()

  parseCommandLineArgs()

  // Ensure valid Redtail UserKey stored in OS User's keychain, prompt user if not
  // Once validated, appropriate window will render depending on CLI args (or lack thereof)
  //keytar.deletePassword('zac-screen-pop', 'redtail-userkey')
  validateRedtailUserKey()
})


// If passed an argument array from secondary instance, process arguments from it
// otherwise, if primary instance, process arguments from app.commandLine
function parseCommandLineArgs(argv = null){
  
  if(argv){
    redtailLookupNumber = getCommandLineValue(argv, 'redtail-phone')
  } else {
    redtailLookupNumber = app.commandLine.getSwitchValue('redtail-phone')
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
  redtailUser = ''
  redtailUserKey = ''
  getRedtailUserKey(input.apiKey, input.username, input.password)
  //event.sender.getOwnerBrowserWindow().close()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

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
            displayWindow()
          })
        } else if(response.statusCode == 401) {
          redtailAuthMessage = 'Stored Redtail authentication rejected by Redtail API as invalid (HTTP ERR 401). Please re-enter credentials to try again.'
          renderHTML(400, 300, 'auth.html')
        } else {
          redtailAuthMessage = 'Error validating stored Redtail authentication with Redtail API (HTTP ERR' + response.statusCode.toString() + '). Please re-enter credentials to try again.'
          renderHTML(400, 300, 'auth.html')
        }
      })
      request.end()
    } else {
      redtailAuthMessage = 'Redtail authentication required.'
      renderHTML(400, 300, 'auth.html')
    }
  })
}

function displayWindow() {
  if(!redtailUser || !redtailUserKey){
    // Redtail user must be validated before proceeding
    validateRedtailUserKey()
  } else if (redtailLookupNumber ) {
    // ... otherwise, if passed a Redtail phone number, query Redtail's API
    // for matching contact information, then display screen pop
    lookupRedtailContact(redtailLookupNumber, () => {renderHTML(300, 175, 'screenpop.html')})
  } else {
    // ... otherwise, if valid account but no valid parameter passed, display Info window
    renderInfoWindow()
  }
}

function parseNumber (n) {
  // Removes leading +1 if present and all non-digit characters
  return n.replace('+1','').replace(/\D/g,'')
}

function renderInfoWindow() {
  renderHTML(400, 400, 'info.html')
}

function initWindow() {
  mainWindow = new BrowserWindow({
    width: 0,
    height: 0,
    webPreferences: {
      allowRunningInsecureContent: false,
      contextIsolation: true,
      enableRemoteModule: false,
      nodeIntegration: false,
      sandbox: true,
      preload: `${__dirname}/preload.js`
    }
  })
  mainWindow.removeMenu()
}

function renderHTML(width, height, file) {
  mainWindow.setSize(width,height)
  mainWindow.loadFile(file)
  // Uncomment to force open Dev Tools after loading HTML file
  //mainWindow.webContents.openDevTools()
}

function lookupRedtailContact(cliNumber, callback) {
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
          keytar.setPassword('zac-screen-pop', 'redtail-userkey', encodedUserKey)
          // setPassword yields nothing, so we manually delay a couple seconds
          // to give the OS time to store the secret before any code attempts to
          // read it again
          setTimeout(displayWindow, 2000);
        }
      })
    } else {
      redtailAuthMessage = 'Provided Redtail credentials rejected by Redtail API (HTTP ERR ' + response.statusCode.toString() + '). Please re-enter credentials to try again.'
      renderHTML(400, 300, 'auth.html')
    }
  })
  request.end()
}