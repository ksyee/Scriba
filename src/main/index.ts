import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { WhisperService } from './services/whisper'
import { OllamaService } from './services/ollama'

let mainWindow: BrowserWindow | null = null
let whisperService: WhisperService | null = null
const ollamaService = new OllamaService()

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0c0c14',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Detect dev vs production
  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Window control IPC handlers
function setupWindowIPC(): void {
  ipcMain.on('window:minimize', () => {
    mainWindow?.minimize()
  })

  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow?.maximize()
    }
  })

  ipcMain.on('window:close', () => {
    mainWindow?.close()
  })
}

// Whisper IPC handlers
function setupWhisperIPC(): void {
  ipcMain.handle('whisper:init', async (_event, modelName: string) => {
    try {
      whisperService = new WhisperService()
      await whisperService.init(modelName)
      return { success: true }
    } catch (error: any) {
      console.error('Whisper init error:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('whisper:transcribe', async (_event, pcmData: ArrayBuffer, lang: string) => {
    if (!whisperService) {
      return { success: false, error: 'Whisper not initialized' }
    }
    try {
      const text = await whisperService.transcribe(pcmData, lang)
      return { success: true, text }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('whisper:dispose', async () => {
    if (whisperService) {
      whisperService.dispose()
      whisperService = null
    }
    return { success: true }
  })
}

// Ollama IPC handlers
function setupOllamaIPC(): void {
  ipcMain.handle('ollama:check', async () => {
    return await ollamaService.checkConnection()
  })

  ipcMain.handle('ollama:generate', async (event, transcript: string, model: string) => {
    try {
      await ollamaService.generateMinutes(transcript, model, (chunk: string) => {
        event.sender.send('ollama:chunk', chunk)
      })
      event.sender.send('ollama:done')
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('ollama:models', async () => {
    return await ollamaService.getModels()
  })
}

app.whenReady().then(() => {
  app.setAppUserModelId('com.scriba.app')

  setupWindowIPC()
  setupWhisperIPC()
  setupOllamaIPC()

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (whisperService) {
    whisperService.dispose()
  }
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
