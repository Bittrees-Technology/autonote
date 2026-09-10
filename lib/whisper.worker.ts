import { env, pipeline } from "@huggingface/transformers";
env.allowLocalModels = false;
env.backends.onnx.wasm!.numThreads = 1;
const model = "onnx-community/whisper-base";
const revision = "1846881b6b3a3024392c1eea3ad983695bc23925";
let transcriber: any;
let running = false;
self.onmessage = async (event: MessageEvent) => {
  if (running) return;
  running = true;
  try {
    self.postMessage({
      type: "progress",
      message: "Preparing Whisper on this device…",
    });
    transcriber ||= await pipeline("automatic-speech-recognition", model, {
      device: "wasm",
      dtype: "q8",
      revision,
      progress_callback: (p: any) => {
        if (p.status === "progress")
          self.postMessage({
            type: "progress",
            message: `Downloading speech model · ${Math.round(p.progress || 0)}% of ${p.file || "file"}`,
          });
      },
    });
    const { samples, language } = event.data;
    const audio = new Float32Array(samples);
    // Bounded windows give visible progress and avoid unbounded decoder context.
    const segments: {
      id: string;
      start: number;
      end: number;
      speaker: string;
      text: string;
    }[] = [];
    const window = 25 * 16000;
    for (let start = 0; start < audio.length; start += window) {
      const part = audio.slice(start, Math.min(start + window, audio.length));
      const offset = start / 16000;
      let energy = 0;
      for (const sample of part) energy += sample * sample;
      if (Math.sqrt(energy / part.length) > 0.001) {
        const output = await transcriber(part, {
          return_timestamps: true,
          task: "transcribe",
          ...(language === "auto"
            ? {}
            : { language: language === "pt" ? "portuguese" : "english" }),
          max_new_tokens: 224,
        });
        const chunks = output.chunks?.length
          ? output.chunks
          : [{ text: output.text, timestamp: [0, part.length / 16000] }];
        for (const chunk of chunks) {
          const text = String(chunk.text || "").trim();
          if (!text) continue;
          const limit = offset + part.length / 16000;
          const a = Math.min(
            limit,
            Math.max(
              offset,
              segments.at(-1)?.start || 0,
              offset + (chunk.timestamp?.[0] || 0),
            ),
          );
          const b = Math.max(
            a,
            Math.min(
              limit,
              offset + (chunk.timestamp?.[1] ?? part.length / 16000),
            ),
          );
          segments.push({
            id: `s${segments.length + 1}`,
            start: Math.round(a * 1000) / 1000,
            end: Math.round(b * 1000) / 1000,
            speaker: "Unlabeled speaker",
            text,
          });
        }
      }
      self.postMessage({
        type: "progress",
        message: `Transcribing on this device · ${Math.round((Math.min(start + window, audio.length) / audio.length) * 100)}%`,
        percent: Math.round(
          (Math.min(start + window, audio.length) / audio.length) * 100,
        ),
      });
    }
    self.postMessage({
      type: "complete",
      transcript: segments,
      duration: audio.length / 16000,
    });
  } catch {
    self.postMessage({
      type: "error",
      message:
        "Whisper could not finish on this device. Check your connection and available memory, then try a shorter recording. Your audio has not been uploaded.",
    });
  } finally {
    running = false;
  }
};
