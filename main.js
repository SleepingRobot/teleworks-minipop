const { app, BrowserWindow, ipcMain } = require('electron')
const isDev = require('electron-is-dev');
const keytar = require('keytar')
const isPrimaryInstance = app.requestSingleInstanceLock()
let screenpopWindow = null
let historyWindow = null
let settingsWindow = null
let authWindow = null
let contactData = []
let redtailSettings = {
  auth: {
    valid: false,
    user: '',
    userKey: ''
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
  initWindows()
  parseCommandLineArgs()
})


function initWindows() {
  screenpopWindow = new BrowserWindow({
    width: 400,
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
  screenpopWindow.removeMenu()
  screenpopWindow.loadFile('screenpop.html')
  //screenpopWindow.webContents.openDevTools()
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
    // TODO: present redtail auth modal (passing cliNumber, so it can be passed back)
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

// Add new contact data to stack, update ScreenPop and CallHistory windows
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
      historyWindow.webContents.send('history-data', c)
    })
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

// function renderHTML(width, height, file) {
//   screenpopWindow.setSize(width,height)
//   screenpopWindow.loadFile(file)
//   // Uncomment to force open Dev Tools after loading HTML file
//   //mainWindow.webContents.openDevTools()
// }



// function getRedtailUserKey(apiKey, username, password) {
//   const unencodedAuth = apiKey + ":" + username + ":" + password
//   const basicAuth = Buffer.from(unencodedAuth).toString('base64')

//   // Prepare HTTP request to Redtail CRM API
//   const { net } = require('electron')
//   const request = net.request({
//     method: 'GET',
//     protocol: 'https:',
//     hostname: 'smf.crm3.redtailtechnology.com',
//     port: 443,
//     path: '/api/public/v1/authentication'
//   })
//   request.setHeader('Authorization', 'Basic ' + basicAuth)
//   request.setHeader('Content-Type', "application/json")

//   // Process HTTP response from Redtail CRM API
//   request.on('response', (response) => {
//     if (response.statusCode == 200) {
//       response.on('data', (d) => {
//         const userKey = JSON.parse(d).authenticated_user?.user_key
//         if (userKey) {
//           const unencodedKey = apiKey + ":" + userKey
//           const encodedUserKey = Buffer.from(unencodedKey).toString('base64')
//           // If response indicates success, store UserKey in OS User's keychain
//           keytar.setPassword('zac-screen-pop', 'redtail-userkey', encodedUserKey)
//           // setPassword yields nothing, so we manually delay a couple seconds
//           // to give the OS time to store the secret before any code attempts to
//           // read it again
//           setTimeout(displayWindow, 2000);
//         }
//       })
//     } else {
//       redtailAuthMessage = 'Provided Redtail credentials rejected by Redtail API (HTTP ERR ' + response.statusCode.toString() + '). Please re-enter credentials to try again.'
//       renderHTML(400, 300, 'auth.html')
//     }
//   })
//   request.end()
// }