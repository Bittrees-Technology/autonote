import type { Meeting, Notes } from "./model";
const item = (id: string, text: string, evidence: string[], extra = {}) => ({
  id,
  text,
  evidence,
  owner: null,
  dueDate: null,
  status: "proposed" as const,
  ...extra,
});
const notes: Notes = {
  summary:
    "The team agreed to start AutoNote with a dependable recording-to-notes workflow. The pilot will focus on clear transcripts, useful next steps, and private sharing. Calendar capture will follow after the core experience is tested.",
  topics: [
    item("t1", "A focused first release", ["s1", "s2"]),
    item("t2", "Pilot quality and privacy", ["s3", "s4"]),
  ],
  decisions: [
    item("d1", "Start with uploads and microphone recording.", ["s2"]),
  ],
  actions: [
    item("a1", "Prepare three sample recordings for the pilot.", ["s3"], {
      owner: "Morgan",
    }),
    item("a2", "Review the workspace sharing experience.", ["s4"], {
      owner: "Alex",
    }),
  ],
  questions: [
    item("q1", "Which meeting platform should be integrated first?", ["s5"]),
  ],
  recommendations: [
    item("r1", "Choose the first calendar platform at the next check-in.", [
      "s5",
    ]),
  ],
};
export const demoMeeting: Meeting = {
  id: "demo",
  workspace_id: "demo",
  creator_id: "demo",
  title: "AutoNote · product check-in",
  status: "ready",
  visibility: "private",
  language: "en",
  duration: 1260,
  created_at: "2026-09-10T09:00:00Z",
  version: 1,
  notes_stale: false,
  error: null,
  canEdit: true,
  recording_deleted: true,
  notes,
  transcript: [
    {
      id: "s1",
      start: 0,
      end: 18,
      speaker: "Alex",
      text: "Let’s keep the first release focused. I want to finish a conversation and have a clear record of what we decided and what happens next.",
    },
    {
      id: "s2",
      start: 18,
      end: 38,
      speaker: "Morgan",
      text: "Agreed. We’ll start with uploads and microphone recording. Once that feels reliable, we can bring in scheduled meeting capture.",
    },
    {
      id: "s3",
      start: 38,
      end: 57,
      speaker: "Morgan",
      text: "I’ll prepare three sample recordings for the pilot. We should include a noisy room and a conversation with overlapping speakers.",
    },
    {
      id: "s4",
      start: 57,
      end: 78,
      speaker: "Alex",
      text: "I’ll review the workspace sharing experience. Recordings should start private, and it needs to be clear when we share them with the team.",
    },
    {
      id: "s5",
      start: 78,
      end: 97,
      speaker: "Morgan",
      text: "One open question: which meeting platform do we integrate first? Let’s decide at the next check-in after we see what the pilot team uses.",
    },
  ],
};
