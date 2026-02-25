import { Mic, MicOff, Square } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface RecordingControlProps {
  isRecording: boolean;
  isPaused: boolean;
  duration: number;
  onToggleRecording: () => void;
  onStop: () => void;
}

function formatDuration(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function RecordingControl({
  isRecording,
  isPaused,
  duration,
  onToggleRecording,
  onStop,
}: RecordingControlProps) {
  return (
    <div
      className="flex flex-col items-center gap-5 py-6"
      style={{ fontFamily: "'Inter', sans-serif" }}
    >
      {/* Waveform visualization */}
      <div className="flex items-center gap-[3px] h-12">
        {Array.from({ length: 32 }).map((_, i) => {
          const baseHeight = isRecording
            ? 8 + Math.sin(i * 0.5) * 20 + Math.random() * 16
            : 4;
          return (
            <motion.div
              key={i}
              className="w-[3px] rounded-full"
              style={{
                background: isRecording
                  ? `linear-gradient(to top, #ef4444, #f97316)`
                  : "rgba(255,255,255,0.1)",
              }}
              animate={{
                height: isRecording ? [baseHeight * 0.3, baseHeight, baseHeight * 0.5] : 4,
              }}
              transition={{
                duration: 0.4 + Math.random() * 0.4,
                repeat: Infinity,
                repeatType: "reverse",
                ease: "easeInOut",
                delay: i * 0.03,
              }}
            />
          );
        })}
      </div>

      {/* Timer */}
      <div
        className="tabular-nums tracking-widest"
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: "32px",
          color: isRecording ? "#f87171" : "rgba(255,255,255,0.3)",
        }}
      >
        {formatDuration(duration)}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-4">
        <AnimatePresence mode="wait">
          {isRecording && (
            <motion.button
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              onClick={onStop}
              className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-all cursor-pointer"
            >
              <Square size={18} fill="currentColor" />
            </motion.button>
          )}
        </AnimatePresence>

        <button
          onClick={onToggleRecording}
          className="relative cursor-pointer"
        >
          {/* Pulse rings */}
          {isRecording && (
            <>
              <motion.div
                className="absolute inset-0 rounded-full bg-red-500/20"
                animate={{ scale: [1, 1.8], opacity: [0.4, 0] }}
                transition={{ duration: 1.5, repeat: Infinity, ease: "easeOut" }}
              />
              <motion.div
                className="absolute inset-0 rounded-full bg-red-500/15"
                animate={{ scale: [1, 2.2], opacity: [0.3, 0] }}
                transition={{
                  duration: 1.5,
                  repeat: Infinity,
                  ease: "easeOut",
                  delay: 0.3,
                }}
              />
            </>
          )}
          <motion.div
            className="relative w-16 h-16 rounded-full flex items-center justify-center"
            style={{
              background: isRecording
                ? "linear-gradient(135deg, #ef4444, #dc2626)"
                : "linear-gradient(135deg, #3b82f6, #6366f1)",
              boxShadow: isRecording
                ? "0 0 30px rgba(239,68,68,0.4)"
                : "0 0 20px rgba(99,102,241,0.3)",
            }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            {isRecording ? (
              <MicOff size={24} className="text-white" />
            ) : (
              <Mic size={24} className="text-white" />
            )}
          </motion.div>
        </button>
      </div>

      <p
        className="text-white/30"
        style={{ fontSize: "12px", fontFamily: "'Inter', sans-serif" }}
      >
        {isRecording ? "녹음 중... 마이크 버튼을 눌러 중지" : "마이크 버튼을 눌러 녹음 시작"}
      </p>
    </div>
  );
}
