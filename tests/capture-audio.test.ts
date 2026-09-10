import { test } from "node:test";
import assert from "node:assert/strict";
import { captureAudio } from "../lib/capture-audio";

class Track extends EventTarget {
  readyState = "live";
  constructor(
    public kind: string,
    public surface = "browser",
  ) {
    super();
  }
  stop() {
    this.readyState = "ended";
  }
  getSettings() {
    return { displaySurface: this.surface };
  }
}
class Stream {
  constructor(public tracks: Track[]) {}
  getTracks() {
    return this.tracks;
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === "audio");
  }
  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === "video");
  }
}

test("meeting capture rejects missing tab audio and releases the shared tab", async () => {
  const video = new Track("video");
  let microphoneRequested = false;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        getDisplayMedia: async () => new Stream([video]),
        getUserMedia: async () => {
          microphoneRequested = true;
        },
      },
    },
  });
  await assert.rejects(
    captureAudio("meeting", () => {}),
    /No meeting audio/,
  );
  assert.equal(video.readyState, "ended");
  assert.equal(microphoneRequested, false);
});

test("meeting capture releases all shared tracks when microphone is denied", async () => {
  const video = new Track("video"),
    audio = new Track("audio");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        getDisplayMedia: async () => new Stream([video, audio]),
        getUserMedia: async () => {
          throw new Error("denied");
        },
      },
    },
  });
  await assert.rejects(
    captureAudio("meeting", () => {}),
    /denied/,
  );
  assert.equal(video.readyState, "ended");
  assert.equal(audio.readyState, "ended");
});

test("meeting capture mixes both audio sources without exposing video to recorder and cleans up", async () => {
  const video = new Track("video"),
    tabAudio = new Track("audio"),
    mic = new Track("audio"),
    mixed = new Track("audio");
  const connected: unknown[] = [];
  let closed = false,
    ended = 0;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        getDisplayMedia: async () => new Stream([video, tabAudio]),
        getUserMedia: async () => new Stream([mic]),
      },
    },
  });
  Object.defineProperty(globalThis, "AudioContext", {
    configurable: true,
    value: class {
      state = "running";
      resume() {
        return Promise.resolve();
      }
      close() {
        closed = true;
        return Promise.resolve();
      }
      createMediaStreamDestination() {
        return { stream: new Stream([mixed]) };
      }
      createMediaStreamSource(input: unknown) {
        return {
          connect() {
            connected.push(input);
          },
        };
      }
    },
  });
  const capture = await captureAudio("meeting", () => {
    ended++;
  });
  assert.equal(connected.length, 2);
  assert.equal(capture.stream.getVideoTracks().length, 0);
  video.dispatchEvent(new Event("ended"));
  assert.equal(ended, 1);
  capture.cleanup();
  capture.cleanup();
  assert.equal(closed, true);
  assert.ok(
    [video, tabAudio, mic, mixed].every((t) => t.readyState === "ended"),
  );
  mic.dispatchEvent(new Event("ended"));
  assert.equal(ended, 1);
});
