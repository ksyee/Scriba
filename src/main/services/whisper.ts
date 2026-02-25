import path from 'path'
import { app } from 'electron'
import fs from 'fs'

let whisperModule: any = null

export class WhisperService {
  private context: any = null
  private modelPath: string = ''

  async init(modelName: string = 'base'): Promise<void> {
    // Dynamically import whisper.node
    if (!whisperModule) {
      try {
        whisperModule = require('@fugood/whisper.node')
      } catch (e) {
        console.error('Failed to load @fugood/whisper.node:', e)
        throw new Error('whisper.node 모듈을 로드할 수 없습니다. npm install을 다시 실행해 주세요.')
      }
    }

    // Set model path in app data directory
    const modelsDir = path.join(app.getPath('userData'), 'models')
    if (!fs.existsSync(modelsDir)) {
      fs.mkdirSync(modelsDir, { recursive: true })
    }

    const modelFileName = `ggml-${modelName}.bin`
    this.modelPath = path.join(modelsDir, modelFileName)

    // Download model if not exists
    if (!fs.existsSync(this.modelPath)) {
      console.log(`Downloading Whisper model: ${modelName}...`)
      await this.downloadModel(modelName, this.modelPath)
    }

    // Initialize whisper context using the correct API
    console.log(`Loading Whisper model from: ${this.modelPath}`)
    this.context = await whisperModule.initWhisper({
      filePath: this.modelPath,
      useGpu: false,
    })
    console.log('Whisper model loaded successfully')
  }

  private async downloadModel(modelName: string, destPath: string): Promise<void> {
    const modelUrls: Record<string, string> = {
      'tiny': 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin',
      'base': 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
      'small': 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin',
      'medium': 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin',
    }

    const url = modelUrls[modelName]
    if (!url) {
      throw new Error(`Unknown model: ${modelName}. Available: ${Object.keys(modelUrls).join(', ')}`)
    }

    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Failed to download model: ${response.statusText}`)
    }

    const buffer = await response.arrayBuffer()
    fs.writeFileSync(destPath, Buffer.from(buffer))
    console.log(`Model downloaded to: ${destPath}`)
  }

  async transcribe(pcmData: ArrayBuffer, language: string = 'ko'): Promise<string> {
    if (!this.context) {
      throw new Error('Whisper not initialized. Call init() first.')
    }

    try {
      // transcribeData returns { stop, promise }
      const { promise } = this.context.transcribeData(pcmData, {
        language,
        maxLen: 0,
        translate: false,
        temperature: 0.0,
      })

      const result = await promise

      if (result && result.result && result.result.length > 0) {
        return result.result.map((segment: any) => segment.text).join(' ').trim()
      }
      return ''
    } catch (error) {
      console.error('Transcription error:', error)
      throw error
    }
  }

  dispose(): void {
    if (this.context) {
      try {
        this.context.release()
      } catch (e) {
        // ignore cleanup errors
      }
      this.context = null
    }
  }
}
