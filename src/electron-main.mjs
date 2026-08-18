// dsh-installer — Electron main process (M2).
// Assembles the dsh profile, spawns the dsh web runtime via executable-as-node
// (ELECTRON_RUN_AS_NODE), and loads the ready loopback URL into a native
// BrowserWindow. Mirrors the loadURL wiring of
// third-party/deepseek-harness-desktop/electron-app.mjs on a minimal scale.

import { app, BrowserWindow } from 'electron'
// electron-updater is a CommonJS module; import its default and destructure
// the named export (ESM named-import of a CJS module fails at runtime).
import electronUpdater from 'electron-updater'
const { autoUpdater } = electronUpdater

import { assembleDesktopProfile } from './assemble-profile.mjs'
import { DshRuntimeController } from './runtime-controller.mjs'
import { cliArgs, cliPath, dshHome, managedBundles, packageRoots, profileName } from './config.mjs'

let mainWindow
let controller

function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 720,
    minHeight: 540,
    show: false,
    backgroundColor: '#040814',
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  })
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => { mainWindow = undefined })
  return mainWindow
}

async function startRuntime() {
  await assembleDesktopProfile({ dshHome, packageRoots, managedBundles, profileName })
  controller = new DshRuntimeController({
    cliPath,
    cliArgs,
    cwd: process.cwd(),
    dshHome,
    profile: profileName,
    autoRestart: true,
  })
  controller.on('status', (status) => {
    if (mainWindow && !mainWindow.isDestroyed() && status.state === 'ready' && status.url) {
      void mainWindow.loadURL(status.url).catch((error) => {
        console.error('[renderer]', error?.message ?? error)
      })
    }
  })
  void controller.start().catch((error) => {
    console.error('[runtime]', error?.message ?? error)
    app.quit()
  })
}

app.whenReady().then(async () => {
  createWindow()
  await startRuntime()
  // Auto-update only in the packaged app; skipped in `electron .` local dev.
  if (app.isPackaged) {
    try {
      await autoUpdater.checkForUpdatesAndNotify()
    } catch (error) {
      console.error('[updater]', error?.message ?? error)
    }
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

const shutdown = async () => {
  await controller?.stop()
  app.exit(0)
}
app.on('before-quit', shutdown)
