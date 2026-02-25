import { contextBridge, ipcRenderer } from 'electron'

export interface ElectronAPI {
  // Window controls
  minimize: () => void
  maximize: () => void
  close: () => void

  // Whisper STT
  whisperInit: (modelName: string) => Promise<{ success: boolean; error?: string }>
  whisperTranscribe: (pcmData: ArrayBuffer, lang: string) => Promise<{ success: boolean; text?: string; error?: string }>
  whisperDispose: () => Promise<{ success: boolean }>

  // Ollama
  ollamaCheck: () => Promise<{ connected: boolean }>
  ollamaGenerate: (transcript: string, model: string) => Promise<{ success: boolean; error?: string }>
  ollamaModels: () => Promise<string[]>
  onOllamaChunk: (callback: (chunk: string) => void) => void
  onOllamaDone: (callback: () => void) => void
  removeOllamaListeners: () => void
}

const electronAPI: ElectronAPI = {
  // Window controls
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),

  // Whisper STT
  whisperInit: (modelName: string) => ipcRenderer.invoke('whisper:init', modelName),
  whisperTranscribe: (pcmData: ArrayBuffer, lang: string) => ipcRenderer.invoke('whisper:transcribe', pcmData, lang),
  whisperDispose: () => ipcRenderer.invoke('whisper:dispose'),

  // Ollama
  ollamaCheck: () => ipcRenderer.invoke('ollama:check'),
  ollamaGenerate: (transcript: string, model: string) => ipcRenderer.invoke('ollama:generate', transcript, model),
  ollamaModels: () => ipcRenderer.invoke('ollama:models'),
  onOllamaChunk: (callback: (chunk: string) => void) => {
    ipcRenderer.on('ollama:chunk', (_event, chunk) => callback(chunk))
  },
  onOllamaDone: (callback: () => void) => {
    ipcRenderer.on('ollama:done', () => callback())
  },
  removeOllamaListeners: () => {
    ipcRenderer.removeAllListeners('ollama:chunk')
    ipcRenderer.removeAllListeners('ollama:done')
  }
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)
