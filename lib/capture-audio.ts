/** Capture only the chosen tab's audio plus microphone; never record video. */
export async function captureAudio(
  mode: "microphone" | "meeting",
  onEnded: () => void,
) {
  const inputs: MediaStream[] = [];
  let context: AudioContext | undefined;
  let output: MediaStream | undefined;
  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    for (const stream of [...inputs, ...(output ? [output] : [])])
      stream.getTracks().forEach((track) => track.stop());
    if (context && context.state !== "closed")
      void context.close().catch(() => {});
  };
  try {
    if (mode === "meeting") {
      if (!navigator.mediaDevices?.getDisplayMedia)
        throw new Error(
          "Tab audio is unavailable here. Open AutoNote in desktop Chrome or Edge, or upload a recording.",
        );
      // Must be the first awaited browser operation, while user activation is live.
      const display = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: "browser" },
        audio: true,
      });
      inputs.push(display);
      if (
        display.getVideoTracks()[0]?.getSettings().displaySurface !== "browser"
      )
        throw new Error(
          "Choose the meeting browser tab, not a window or entire screen.",
        );
      if (!display.getAudioTracks().length)
        throw new Error(
          "No meeting audio was shared. Choose the meeting tab and enable Share tab audio.",
        );
    }
    const microphone = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    inputs.push(microphone);
    if (
      inputs.some((stream) =>
        stream.getTracks().some((track) => track.readyState === "ended"),
      )
    )
      throw new Error(
        "Audio sharing ended before recording started. Please try again.",
      );
    if (mode === "meeting") {
      context = new AudioContext();
      await context.resume();
      const destination = context.createMediaStreamDestination();
      for (const input of inputs) {
        const source = context.createMediaStreamSource(input);
        source.connect(destination);
      }
      // No connection to speakers: avoids playing the microphone back to the user.
      output = destination.stream;
    } else output = microphone;
    for (const input of inputs)
      for (const track of input.getTracks())
        track.addEventListener(
          "ended",
          () => {
            if (!closed) {
              onEnded();
              cleanup();
            }
          },
          { once: true },
        );
    return { stream: output, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}
