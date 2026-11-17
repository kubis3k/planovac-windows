// Plánovač pro Windows – okno týmového kalendáře + ikona u hodin, zkratka, upozornění
const { app, BrowserWindow, Tray, Menu, globalShortcut, Notification, shell, nativeImage } = require('electron')
const path = require('path')
const fs = require('fs')

const URL_APP = 'https://kalendar.globaalelevate.com/'
const ORIGIN = new URL(URL_APP).origin
const SB_URL = 'https://entoydpwnednpmwxrumo.supabase.co'
const SB_KEY = 'sb_publishable_bb5EVOwpmTsYwPaSAeANdA_XWorauMW' // veřejný klíč, data chrání RLS
const HOTKEY = 'Control+Alt+Space'
const TZ = 'Europe/Prague'

let win = null
let tray = null
let quitting = false

const dataFile = (n) => path.join(app.getPath('userData'), n)
function readJSON(n, def) {
  try { return JSON.parse(fs.readFileSync(dataFile(n), 'utf8')) } catch { return def }
}
function writeJSON(n, v) {
  try { fs.writeFileSync(dataFile(n), JSON.stringify(v)) } catch {}
}

// ---------- jediná instance ----------
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow())
}

app.setAppUserModelId('com.globaalelevate.planovac') // nutné pro notifikace ve Windows

function iconPath(n) { return path.join(__dirname, n) }

function showWindow() {
  if (!win) return createWindow(true)
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function createWindow(show) {
  win = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 380,
    minHeight: 500,
    show: false,
    title: 'Plánovač',
    icon: iconPath('icon.png'),
    autoHideMenuBar: true,
    backgroundColor: '#17171c',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  win.webContents.setUserAgent(win.webContents.getUserAgent() + ' PlanovacDesktop/' + app.getVersion())
  win.loadURL(URL_APP)

  win.once('ready-to-show', () => { if (show) win.show() })

  // web push v desktopové appce nefunguje – upozornění řeší appka sama, kartu skryjeme
  win.webContents.on('did-finish-load', () => {
    win.webContents.insertCSS('#push, #mac { display: none !important; }')
  })

  // odkazy mimo kalendář (a přihlašovací e-maily) otevřít v prohlížeči
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(ORIGIN)) shell.openExternal(url)
    return { action: url.startsWith(ORIGIN) ? 'allow' : 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(ORIGIN)) { e.preventDefault(); shell.openExternal(url) }
  })

  // zavření okna = schovat do lišty u hodin
  win.on('close', (e) => {
    if (quitting) return
    e.preventDefault()
    win.hide()
    const s = readJSON('settings.json', {})
    if (!s.trayHintShown && tray) {
      tray.displayBalloon?.({ title: 'Plánovač běží dál', content: 'Najdeš ho u hodin vpravo dole. Ukončíš ho pravým tlačítkem na ikoně.', iconType: 'info' })
      writeJSON('settings.json', { ...s, trayHintShown: true })
    }
  })
  return win
}

// ---------- rychlé přidání ----------
function quickAdd() {
  showWindow()
  const js = `(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '+ Úkol');
    if (b) { b.click(); return true } return false
  })()`
  const run = () => win.webContents.executeJavaScript(js).catch(() => {})
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', () => setTimeout(run, 800))
  else setTimeout(run, 150)
}

// ---------- spouštění po startu ----------
function loginEnabled() { return app.getLoginItemSettings().openAtLogin }
function setLogin(on) { app.setLoginItemSettings({ openAtLogin: on, args: ['--hidden'] }) }

function buildTray() {
  tray = new Tray(nativeImage.createFromPath(iconPath('tray.png')).resize({ width: 32, height: 32, quality: 'best' }))
  tray.setToolTip('Plánovač')
  const menu = () => Menu.buildFromTemplate([
    { label: 'Otevřít Plánovač', click: showWindow },
    { label: 'Nový úkol    Ctrl+Alt+Mezerník', click: quickAdd },
    { type: 'separator' },
    { label: 'Spouštět po startu Windows', type: 'checkbox', checked: loginEnabled(), click: (i) => setLogin(i.checked) },
    { label: 'Obnovit', click: () => win && win.webContents.reload() },
    { type: 'separator' },
    { label: 'Ukončit', click: () => { quitting = true; app.quit() } },
  ])
  tray.setContextMenu(menu())
  tray.on('right-click', () => tray.setContextMenu(menu()))
  tray.on('click', showWindow)
}

// ---------- upozornění na úkoly (stejná pravidla jako push na webu) ----------
function pragueOffsetMin(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(date)
  const g = (t) => +parts.find((p) => p.type === t).value
  const asUTC = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'))
  return Math.round((asUTC - Math.floor(date.getTime() / 60000) * 60000) / 60000)
}
function fireAt(it) {
  if (!it.date || it.remind_minutes == null) return null
  const d = new Date(it.date)
  const rm = it.remind_minutes * 60000
  if (it.has_time) return new Date(d.getTime() - rm)
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d).split('-').map(Number)
  const nineUTC = Date.UTC(p[0], p[1] - 1, p[2], 9, 0) // celodenní = od 9:00
  return new Date(nineUTC - pragueOffsetMin(new Date(nineUTC)) * 60000 - rm)
}
function whenText(it) {
  const d = new Date(it.date)
  const day = d.toLocaleDateString('cs-CZ', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'numeric' })
  return it.has_time ? day + ' ' + d.toLocaleTimeString('cs-CZ', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }) : day
}

async function session() {
  if (!win) return null
  return win.webContents.executeJavaScript(`(() => {
    const k = Object.keys(localStorage).find(k => k.endsWith('-auth-token'));
    if (!k) return null;
    try { const s = JSON.parse(localStorage[k]); return { token: s.access_token, uid: s.user && s.user.id } } catch { return null }
  })()`).catch(() => null)
}

async function checkReminders() {
  const s = await session()
  if (!s || !s.token || !s.uid) return
  const now = new Date()
  const from = new Date(now.getTime() - 2 * 86400000).toISOString()
  const to = new Date(now.getTime() + 2 * 86400000).toISOString()
  const q = `${SB_URL}/rest/v1/items?select=id,title,notes,date,has_time,remind_minutes,assignee_id,created_by` +
    `&deleted_at=is.null&done=eq.false&remind_minutes=not.is.null` +
    `&date=gte.${encodeURIComponent(from)}&date=lte.${encodeURIComponent(to)}&limit=2000`
  let items
  try {
    const r = await fetch(q, { headers: { apikey: SB_KEY, Authorization: 'Bearer ' + s.token } })
    if (!r.ok) return
    items = await r.json()
  } catch { return }

  const fired = readJSON('fired.json', {})
  const cutoff = now.getTime() - 15 * 60000
  let changed = false
  for (const it of items) {
    const mine = it.assignee_id ? it.assignee_id === s.uid : (!it.created_by || it.created_by === s.uid)
    if (!mine) continue
    const at = fireAt(it)
    if (!at || at > now || at.getTime() <= cutoff) continue
    const key = it.id + '|' + at.getTime()
    if (fired[key]) continue
    fired[key] = now.getTime()
    changed = true
    const n = new Notification({ title: it.title, body: [whenText(it), it.notes || ''].filter(Boolean).join(' · ').slice(0, 240), icon: iconPath('icon.png') })
    n.on('click', showWindow)
    n.show()
  }
  // staré záznamy pryč (> 3 dny)
  for (const k of Object.keys(fired)) if (fired[k] < now.getTime() - 3 * 86400000) { delete fired[k]; changed = true }
  if (changed) writeJSON('fired.json', fired)
}

// ---------- start ----------
app.whenReady().then(() => {
  const hidden = process.argv.includes('--hidden')
  const settings = readJSON('settings.json', {})
  if (!settings.firstRunDone) {
    setLogin(true) // po instalaci rovnou spouštět po startu (vypne se v menu u hodin)
    writeJSON('settings.json', { ...settings, firstRunDone: true })
  }
  createWindow(!hidden)
  buildTray()
  globalShortcut.register(HOTKEY, quickAdd)
  setTimeout(checkReminders, 15000)
  setInterval(checkReminders, 60000)
})

app.on('before-quit', () => { quitting = true })
app.on('will-quit', () => globalShortcut.unregisterAll())
app.on('window-all-closed', (e) => e.preventDefault())
