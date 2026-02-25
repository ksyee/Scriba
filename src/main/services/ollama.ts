export class OllamaService {
  private baseUrl = 'http://localhost:11434'

  async checkConnection(): Promise<{ connected: boolean }> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(3000)
      })
      return { connected: response.ok }
    } catch {
      return { connected: false }
    }
  }

  async getModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`)
      if (!response.ok) return []
      const data = await response.json()
      return (data.models || []).map((m: any) => m.name)
    } catch {
      return []
    }
  }

  async generateMinutes(
    transcript: string,
    model: string,
    onChunk: (chunk: string) => void
  ): Promise<void> {
    const prompt = `다음은 회의 중 녹음된 음성을 텍스트로 변환한 내용입니다. 이 내용을 분석하여 체계적인 회의록을 작성해주세요.

## 요구사항
1. 회의 제목을 추론하여 작성
2. 핵심 논의 사항을 주제별로 정리
3. 결론 및 액션 아이템 도출
4. 마크다운 형식으로 작성

## 회의 내용
${transcript}

## 회의록`

    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        stream: true,
        options: {
          temperature: 0.3,
          top_p: 0.9,
          num_predict: 2048
        }
      })
    })

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.statusText}`)
    }

    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error('No response body')
    }

    const decoder = new TextDecoder()

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const text = decoder.decode(value, { stream: true })
      const lines = text.split('\n').filter(line => line.trim())

      for (const line of lines) {
        try {
          const json = JSON.parse(line)
          if (json.response) {
            onChunk(json.response)
          }
        } catch {
          // ignore malformed JSON lines
        }
      }
    }
  }
}
