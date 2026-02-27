import { useState, useEffect, useCallback, useRef } from "react";
import { TitleBar } from "./components/title-bar";
import { RecordingControl } from "./components/recording-control";
import { TranscriptPanel } from "./components/transcript-panel";
import { MinutesPanel } from "./components/minutes-panel";
import { StatusBar } from "./components/status-bar";
import { Settings, ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

// Audio processing constants
const SAMPLE_RATE = 16000;
const CHUNK_DURATION_SEC = 5; // Send audio chunks every 5 seconds

export default function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [transcriptEntries, setTranscriptEntries] = useState<
    { id: number; time: string; text: string }[]
  >([]);
  const [minutesContent, setMinutesContent] = useState("");
  const [isGeneratingMinutes, setIsGeneratingMinutes] = useState(false);
  const [whisperStatus, setWhisperStatus] = useState<
    "ready" | "loading" | "processing" | "inactive"
  >("inactive");
  const [ollamaStatus, setOllamaStatus] = useState<"connected" | "disconnected">("disconnected");
  const [showSettings, setShowSettings] = useState(false);
  const [selectedModel, setSelectedModel] = useState("qwen2.5:3b");
  const [selectedLang, setSelectedLang] = useState("ko");
  const [whisperModel, setWhisperModel] = useState("base");
  const [availableModels, setAvailableModels] = useState<string[]>(["qwen2.5:3b"]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [micStatus, setMicStatus] = useState<"connected" | "disconnected">("disconnected");
  const [micDevices, setMicDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedMicId, setSelectedMicId] = useState<string>("");
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  const [fileProcessProgress, setFileProcessProgress] = useState<number | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const entryIdRef = useRef(0);
  const fullTranscriptRef = useRef<string[]>([]);

  // Audio refs
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | ScriptProcessorNode | null>(null);
  const audioBufferRef = useRef<Float32Array[]>([]);
  const chunkTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const formatTime = useCallback((totalSeconds: number) => {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }, []);

  // Check Ollama connection on mount
  useEffect(() => {
    const checkOllama = async () => {
      if (window.electronAPI) {
        const result = await window.electronAPI.ollamaCheck();
        setOllamaStatus(result.connected ? "connected" : "disconnected");

        if (result.connected) {
          const models = await window.electronAPI.ollamaModels();
          if (models.length > 0) {
            setAvailableModels(models);
          }
        }
      }
    };

    checkOllama();
    const interval = setInterval(checkOllama, 10000);
    return () => clearInterval(interval);
  }, []);

  // Check microphone availability and list devices
  useEffect(() => {
    const checkMic = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const mics = devices.filter((d) => d.kind === "audioinput");
        setMicDevices(mics);
        setMicStatus(mics.length > 0 ? "connected" : "disconnected");
        if (mics.length > 0 && !selectedMicId) {
          setSelectedMicId(mics[0].deviceId);
        }
      } catch {
        setMicDevices([]);
        setMicStatus("disconnected");
      }
    };

    checkMic();
    navigator.mediaDevices?.addEventListener("devicechange", checkMic);
    return () => {
      navigator.mediaDevices?.removeEventListener("devicechange", checkMic);
    };
  }, [selectedMicId]);

  // Initialize Whisper on mount
  useEffect(() => {
    const initWhisper = async () => {
      if (window.electronAPI) {
        setWhisperStatus("loading");
        const result = await window.electronAPI.whisperInit(whisperModel);
        if (result.success) {
          setWhisperStatus("ready");
        } else {
          console.error("Whisper init failed:", result.error);
          setWhisperStatus("inactive");
        }
      }
    };

    initWhisper();
  }, [whisperModel]);

  // Convert Float32 audio to 16-bit PCM ArrayBuffer
  const float32ToPCM16 = useCallback((float32Array: Float32Array): ArrayBuffer => {
    const buffer = new ArrayBuffer(float32Array.length * 2);
    const view = new DataView(buffer);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
    return buffer;
  }, []);

  // Resample audio to 16kHz
  const resampleTo16kHz = useCallback((audioData: Float32Array, originalSampleRate: number): Float32Array => {
    if (originalSampleRate === SAMPLE_RATE) return audioData;

    const ratio = originalSampleRate / SAMPLE_RATE;
    const newLength = Math.round(audioData.length / ratio);
    const result = new Float32Array(newLength);

    for (let i = 0; i < newLength; i++) {
      const srcIndex = i * ratio;
      const srcIndexFloor = Math.floor(srcIndex);
      const srcIndexCeil = Math.min(srcIndexFloor + 1, audioData.length - 1);
      const t = srcIndex - srcIndexFloor;
      result[i] = audioData[srcIndexFloor] * (1 - t) + audioData[srcIndexCeil] * t;
    }

    return result;
  }, []);

  // Process accumulated audio buffer
  const processAudioChunk = useCallback(async () => {
    if (audioBufferRef.current.length === 0 || !window.electronAPI) return;

    // Merge all audio chunks
    const totalLength = audioBufferRef.current.reduce((acc, buf) => acc + buf.length, 0);
    const merged = new Float32Array(totalLength);
    let offset = 0;
    for (const buf of audioBufferRef.current) {
      merged.set(buf, offset);
      offset += buf.length;
    }
    audioBufferRef.current = [];

    // Resample to 16kHz
    const sampleRate = audioContextRef.current?.sampleRate || 48000;
    const resampled = resampleTo16kHz(merged, sampleRate);

    // Convert to PCM16
    const pcmBuffer = float32ToPCM16(resampled);

    // Extract the previous text context as a prompt for the model
    // This helps the model understand the ongoing sentence, reducing hallucinations
    const recentText = fullTranscriptRef.current.slice(-2).join(" ");

    // Send to Whisper
    setWhisperStatus("processing");
    const result = await window.electronAPI.whisperTranscribe(pcmBuffer, selectedLang, recentText || undefined);
    setWhisperStatus("ready");

    if (result.success && result.text && result.text.trim()) {
      const text = result.text.trim();
      const currentDuration = duration;

      fullTranscriptRef.current.push(text);

      setTranscriptEntries((prev) => [
        ...prev,
        {
          id: entryIdRef.current++,
          time: formatTime(currentDuration),
          text,
        },
      ]);
    }
  }, [selectedLang, duration, formatTime, float32ToPCM16, resampleTo16kHz]);

  // Start recording
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: selectedMicId ? { exact: selectedMicId } : undefined,
          channelCount: 1,
          sampleRate: { ideal: SAMPLE_RATE },
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      mediaStreamRef.current = stream;
      const audioContext = new AudioContext({ sampleRate: undefined }); // Use device default
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);

      // Use ScriptProcessorNode for compatibility
      const bufferSize = 4096;
      const processor = audioContext.createScriptProcessor(bufferSize, 1, 1);

      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        audioBufferRef.current.push(new Float32Array(inputData));
      };

      source.connect(processor);
      processor.connect(audioContext.destination);
      workletNodeRef.current = processor;

      // Set up chunk processing timer
      chunkTimerRef.current = setInterval(() => {
        processAudioChunk();
      }, CHUNK_DURATION_SEC * 1000);

      setIsRecording(true);
      setDuration(0);
      entryIdRef.current = 0;
      setTranscriptEntries([]);
      setMinutesContent("");
      fullTranscriptRef.current = [];

      // Duration timer
      timerRef.current = setInterval(() => {
        setDuration((prev) => prev + 1);
      }, 1000);
    } catch (error: any) {
      console.error("Failed to start recording:", error);
      let msg = "녹음을 시작할 수 없습니다.";
      if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
        msg = "마이크를 찾을 수 없습니다. 마이크가 연결되어 있는지 확인해주세요.";
      } else if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
        msg = "마이크 접근 권한이 거부되었습니다. 설정에서 마이크 권한을 허용해주세요.";
      }
      setErrorMessage(msg);
      setTimeout(() => setErrorMessage(null), 5000);
    }
  }, [processAudioChunk]);

  // Stop recording
  const stopRecording = useCallback(() => {
    setIsRecording(false);
    setWhisperStatus("ready");

    // Stop timers
    if (timerRef.current) clearInterval(timerRef.current);
    if (chunkTimerRef.current) clearInterval(chunkTimerRef.current);

    // Process any remaining audio
    processAudioChunk();

    // Stop media stream
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    // Clean up audio context
    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
  }, [processAudioChunk]);

  const toggleRecording = useCallback(() => {
    if (!isRecording) {
      startRecording();
    } else {
      stopRecording();
    }
  }, [isRecording, startRecording, stopRecording]);

  // Generate minutes via Ollama
  const generateMinutes = useCallback(async () => {
    if (!window.electronAPI || fullTranscriptRef.current.length === 0) return;

    setIsGeneratingMinutes(true);
    setMinutesContent("");

    // Set up streaming listeners
    window.electronAPI.onOllamaChunk((chunk: string) => {
      setMinutesContent((prev) => prev + chunk);
    });

    window.electronAPI.onOllamaDone(() => {
      setIsGeneratingMinutes(false);
      window.electronAPI.removeOllamaListeners();
    });

    const transcript = fullTranscriptRef.current.join("\n");
    const result = await window.electronAPI.ollamaGenerate(transcript, selectedModel);

    if (!result.success) {
      console.error("Minutes generation failed:", result.error);
      setIsGeneratingMinutes(false);
      setMinutesContent("회의록 생성에 실패했습니다: " + (result.error || "알 수 없는 오류"));
      window.electronAPI.removeOllamaListeners();
    }
  }, [selectedModel]);

  // Handle file upload: open native dialog and send file path to backend for ffmpeg decoding
  const handleFileUpload = useCallback(async () => {
    if (!window.electronAPI) return;

    const filePath = await window.electronAPI.selectAudioFile();
    if (!filePath) {
      // User canceled the dialog
      return;
    }

    setIsProcessingFile(true);
    setFileProcessProgress(0);
    setTranscriptEntries([]);
    setMinutesContent("");
    entryIdRef.current = 0;
    fullTranscriptRef.current = [];
    setWhisperStatus("processing");

    // Listen to progress updates
    window.electronAPI.onWhisperFileProgress((progress, text) => {
      if (progress >= 0 && progress <= 100) {
        setFileProcessProgress(progress);
      }

      if (text) {
        fullTranscriptRef.current.push(text);
        setTranscriptEntries((prev) => [
          ...prev,
          {
            id: entryIdRef.current++,
            time: formatTime(0), // Ffmpeg stream doesn't easily give exact chunk start time without extensive math, leaving at 00:00 for simplicty or just counting up.
            text,
          },
        ]);
      }
    });

    try {
      const result = await window.electronAPI.whisperTranscribeFile(filePath, selectedLang);

      if (!result.success) {
        throw new Error(result.error);
      }

      setWhisperStatus("ready");
    } catch (error: any) {
      console.error("File processing error:", error);
      setErrorMessage(
        "오디오 파일 처리에 실패했습니다: " + (error.message || "알 수 없는 에러")
      );
      setTimeout(() => setErrorMessage(null), 5000);
      setWhisperStatus("ready");
    } finally {
      setIsProcessingFile(false);
      setFileProcessProgress(null);
      window.electronAPI.removeWhisperListeners();
    }
  }, [selectedLang, formatTime]);

  const clearTranscript = useCallback(() => {
    setTranscriptEntries([]);
    entryIdRef.current = 0;
    fullTranscriptRef.current = [];
  }, []);

  const copyMinutes = useCallback(() => {
    navigator.clipboard.writeText(minutesContent);
  }, [minutesContent]);

  const downloadMinutes = useCallback(() => {
    const blob = new Blob([minutesContent], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `회의록_${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [minutesContent]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (chunkTimerRef.current) clearInterval(chunkTimerRef.current);
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  return (
    <div
      className="size-full flex flex-col overflow-hidden"
      style={{
        background: "linear-gradient(145deg, #0c0c14 0%, #0a0a12 50%, #0d0b16 100%)",
        fontFamily: "'Inter', sans-serif",
      }}
    >
      <TitleBar />

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Bar - Settings */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg"
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.06)",
                fontSize: "12px",
              }}
            >
              <span className="text-white/30">언어</span>
              <span className="text-white/60">{selectedLang === "ko" ? "한국어" : selectedLang === "en" ? "English" : selectedLang === "ja" ? "日本語" : "中文"}</span>
            </div>
            <div
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg"
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.06)",
                fontSize: "12px",
              }}
            >
              <span className="text-white/30">모델</span>
              <span className="text-white/60">whisper-{whisperModel}</span>
            </div>
            <div
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg"
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.06)",
                fontSize: "12px",
              }}
            >
              <span className="text-white/30">LLM</span>
              <span className="text-white/60">{selectedModel}</span>
            </div>
          </div>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="p-2 rounded-lg text-white/30 hover:text-white/60 hover:bg-white/5 transition-all cursor-pointer"
          >
            <Settings size={16} />
          </button>
        </div>

        {/* Settings Panel */}
        <AnimatePresence>
          {showSettings && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden border-b border-white/5"
            >
              <div className="px-6 py-4 grid grid-cols-4 gap-4" style={{ fontSize: "13px" }}>
                {/* Mic Select */}
                <div className="flex flex-col gap-2">
                  <label className="text-white/30" style={{ fontSize: "11px" }}>
                    마이크
                  </label>
                  <div className="relative">
                    <select
                      value={selectedMicId}
                      onChange={(e) => setSelectedMicId(e.target.value)}
                      className="w-full appearance-none px-3 py-2 rounded-lg text-white/70 cursor-pointer outline-none"
                      style={{
                        background: "rgba(255,255,255,0.05)",
                        border: "1px solid rgba(255,255,255,0.08)",
                        fontSize: "13px",
                      }}
                    >
                      {micDevices.length === 0 ? (
                        <option value="">마이크 없음</option>
                      ) : (
                        micDevices.map((device) => (
                          <option key={device.deviceId} value={device.deviceId}>
                            {device.label || `마이크 ${device.deviceId.slice(0, 8)}`}
                          </option>
                        ))
                      )}
                    </select>
                    <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
                  </div>
                </div>

                {/* Language Select */}
                <div className="flex flex-col gap-2">
                  <label className="text-white/30" style={{ fontSize: "11px" }}>
                    인식 언어
                  </label>
                  <div className="relative">
                    <select
                      value={selectedLang}
                      onChange={(e) => setSelectedLang(e.target.value)}
                      className="w-full appearance-none px-3 py-2 rounded-lg text-white/70 cursor-pointer outline-none"
                      style={{
                        background: "rgba(255,255,255,0.05)",
                        border: "1px solid rgba(255,255,255,0.08)",
                        fontSize: "13px",
                      }}
                    >
                      <option value="ko">한국어</option>
                      <option value="en">English</option>
                      <option value="ja">日本語</option>
                      <option value="zh">中文</option>
                    </select>
                    <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
                  </div>
                </div>

                {/* Whisper Model */}
                <div className="flex flex-col gap-2">
                  <label className="text-white/30" style={{ fontSize: "11px" }}>
                    Whisper 모델
                  </label>
                  <div className="relative">
                    <select
                      value={whisperModel}
                      onChange={(e) => setWhisperModel(e.target.value)}
                      className="w-full appearance-none px-3 py-2 rounded-lg text-white/70 cursor-pointer outline-none"
                      style={{
                        background: "rgba(255,255,255,0.05)",
                        border: "1px solid rgba(255,255,255,0.08)",
                        fontSize: "13px",
                      }}
                    >
                      <option value="base">base (~150MB)</option>
                      <option value="small">small (~500MB)</option>
                      <option value="medium">medium (~1.5GB)</option>
                    </select>
                    <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
                  </div>
                </div>

                {/* Ollama Model */}
                <div className="flex flex-col gap-2">
                  <label className="text-white/30" style={{ fontSize: "11px" }}>
                    Ollama 모델
                  </label>
                  <div className="relative">
                    <select
                      value={selectedModel}
                      onChange={(e) => setSelectedModel(e.target.value)}
                      className="w-full appearance-none px-3 py-2 rounded-lg text-white/70 cursor-pointer outline-none"
                      style={{
                        background: "rgba(255,255,255,0.05)",
                        border: "1px solid rgba(255,255,255,0.08)",
                        fontSize: "13px",
                      }}
                    >
                      {availableModels.map((model) => (
                        <option key={model} value={model}>
                          {model}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Recording Control */}
        <RecordingControl
          isRecording={isRecording}
          isPaused={false}
          isProcessingFile={isProcessingFile}
          fileProcessProgress={fileProcessProgress}
          duration={duration}
          onToggleRecording={toggleRecording}
          onStop={stopRecording}
          onFileUpload={handleFileUpload}
        />

        {/* Panels */}
        <div className="flex-1 flex gap-3 px-4 pb-3 overflow-hidden min-h-0">
          <div className="flex-1 min-w-0">
            <TranscriptPanel
              entries={transcriptEntries}
              isRecording={isRecording}
              onClear={clearTranscript}
            />
          </div>
          <div className="flex-1 min-w-0">
            <MinutesPanel
              content={minutesContent}
              isGenerating={isGeneratingMinutes}
              hasTranscript={transcriptEntries.length > 0}
              onGenerate={generateMinutes}
              onCopy={copyMinutes}
              onDownload={downloadMinutes}
            />
          </div>
        </div>
      </div>

      <StatusBar
        whisperStatus={whisperStatus}
        ollamaStatus={ollamaStatus}
        micStatus={micStatus}
        modelName={selectedModel}
      />

      {/* Error Toast */}
      <AnimatePresence>
        {errorMessage && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-12 left-1/2 -translate-x-1/2 px-5 py-3 rounded-xl z-50"
            style={{
              background: "rgba(239,68,68,0.9)",
              backdropFilter: "blur(10px)",
              fontSize: "13px",
              color: "white",
              maxWidth: "400px",
            }}
          >
            {errorMessage}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
