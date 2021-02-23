const { app, BrowserWindow } = require('electron')
const isDev = require('electron-is-dev');
const keytar = require('keytar')
const gotTheLock = app.requestSingleInstanceLock()
let screenPopWindow = null

app.whenReady().then(() => {
  if (isDev) {
      console.log('Running in development');
  } else {
      console.log('Running in production');
  }

  const cliNumber = app.commandLine.getSwitchValue("number")
  const parsedNumber = parseNumber(cliNumber)
  
  console.log("cli number: " + cliNumber)
  console.log("parsed number: " + parsedNumber)

  
  //keytar.setPassword('zac-screen-pop', 'redtail-userkey', 'secret');
  const secret = keytar.getPassword('zac-screen-pop', 'redtail-userkey')
  secret.then((s) => {
    //LookupRedtailContact(s, '+1-555-456-7890')
    //LookupRedtailContact(s, '5554567890')
    console.log("secret: " + s)
    app.quit()
  });
})

function parseNumber (n) {
  if (n.startsWith("+1")){
    n = n.substring(2)
  }
  return n.replace(/\D/g,'')
}

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
}

function LookupRedtailContact(userkey, phoneNumber) {
  // Prepare HTTP request to Redtail CRM API
  const { net } = require('electron')
  const request = net.request({
    method: 'GET',
    protocol: 'https:',
    hostname: 'smf.crm3.redtailtechnology.com',
    port: 443,
    path: '/api/public/v1/contacts/search?phone_number=' + phoneNumber 
  })
  request.setHeader("Authorization", userkey)
  request.setHeader("include", "addresses,phones,emails,urls")
  request.setHeader("Content-Type", "application/json")

  // Process HTTP response from Redtail CRM API
  request.on('response', (response) => {
    //console.log(`STATUS: ${response.statusCode}`)
    //console.log(`HEADERS: ${JSON.stringify(response.headers)}`)
    response.on('data', (chunk) => {
      console.log(`BODY: ${chunk}`)
    })
    response.on('end', () => {
      console.log('No more data in response.')
    })
  })
  request.end()
}

// app.on('window-all-closed', () => {
//   if (process.platform !== 'darwin') {
//     app.quit()
//   }
// })

// app.on('activate', () => {  
//   if (BrowserWindow.getAllWindows().length === 0) {
//     createWindow()
//   }
// })