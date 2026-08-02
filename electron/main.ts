import { app, BrowserWindow, shell, ipcMain } from 'electron'
import { createServer } from 'http'
import { existsSync, mkdirSync, appendFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const isDev = !app.isPackaged

let mainWindow: BrowserWindow | null = null
let server: ReturnType<typeof createServer> | null = null

function log(message: string) {
  try {
    const logPath = join(app.getPath('userData'), 'app.log')
    const time = new Date().toISOString()
    appendFileSync(logPath, `[${time}] ${message}\n`)
  } catch (e) {
    console.error(message)
  }
}

async function startBackendServer(): Promise<number> {
  const resourcesPath = isDev
    ? join(__dirname, '..')
    : process.resourcesPath

  log(`Resources path: ${resourcesPath}`)

  const nodeModulesPath = join(resourcesPath, 'node_modules')
  if (existsSync(nodeModulesPath)) {
    process.env.NODE_PATH = nodeModulesPath
    ;(process as any).modulePaths = [nodeModulesPath]
    log(`Node modules path set: ${nodeModulesPath}`)
  } else {
    log(`WARNING: node_modules not found at ${nodeModulesPath}`)
  }

  const require = createRequire(import.meta.url)

  const dataPath = join(app.getPath('userData'), 'data')
  const imagesPath = join(app.getPath('userData'), 'images')
  const uploadsPath = join(app.getPath('userData'), 'uploads')
  const tempVideosPath = join(app.getPath('userData'), 'temp_videos')

  ;[dataPath, imagesPath, uploadsPath, tempVideosPath].forEach(p => {
    if (!existsSync(p)) mkdirSync(p, { recursive: true })
  })

  process.env.ELECTRON_USER_DATA = app.getPath('userData')
  process.env.ELECTRON = 'true'

  try {
    log('Loading express...')
    const express = require('express')
    log('Loading cors...')
    const cors = require('cors')
    log('Loading dotenv...')
    const dotenv = require('dotenv')
    log('Core modules loaded successfully')

    dotenv.config({ path: join(resourcesPath, '.env') })

    const serverApp = express()
    const port = 3001

    serverApp.use(cors())
    serverApp.use(express.json({ limit: '50mb' }))

    const distPath = join(resourcesPath, 'api', 'dist')
    log(`API dist path: ${distPath}, exists: ${existsSync(distPath)}`)

    serverApp.use('/images', express.static(imagesPath))
    serverApp.use('/uploads', express.static(uploadsPath))

    serverApp.get('/api/health', (_req: any, res: any) => {
      res.json({ status: 'ok', electron: true })
    })

    try {
      log('Loading backend routes...')
      const appModule = await import(`file://${join(distPath, 'app.js').replace(/\\/g, '/')}`)
      if (appModule.default) {
        serverApp.use('/api', appModule.default)
        log('Backend routes loaded successfully')
      } else {
        log('WARNING: appModule has no default export')
      }
    } catch (err) {
      log(`Failed to load backend app: ${(err as Error).message}`)
      log(`Stack: ${(err as Error).stack}`)
    }

    const frontendDist = isDev
      ? join(__dirname, '..', 'dist')
      : join(resourcesPath, 'app', 'dist')

    log(`Frontend dist: ${frontendDist}, exists: ${existsSync(frontendDist)}`)

    if (existsSync(frontendDist) && !isDev) {
      serverApp.use(express.static(frontendDist))
      serverApp.get('*', (_req: any, res: any) => {
        res.sendFile(join(frontendDist, 'index.html'))
      })
    }

    return new Promise((resolve) => {
      server = serverApp.listen(port, '127.0.0.1', () => {
        log(`Backend server running on http://127.0.0.1:${port}`)
        resolve(port)
      })
    })
  } catch (err) {
    log(`Fatal error starting backend: ${(err as Error).message}`)
    log(`Stack: ${(err as Error).stack}`)
    throw err
  }
}

function createWindow() {
  log('Creating main window...')
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: 'AI 创意工坊',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  mainWindow.setMenuBarVisibility(false)

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadURL('http://127.0.0.1:3001')
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(async () => {
  try {
    log('App ready, starting backend...')
    await startBackendServer()
    log('Backend started, creating window...')
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  } catch (err) {
    log(`Failed to start app: ${(err as Error).message}`)
    console.error('Failed to start app:', err)
  }
})

app.on('window-all-closed', () => {
  if (server) {
    server.close()
    server = null
  }
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.handle('get-app-path', () => {
  return app.getPath('userData')
})