import { z } from "zod";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const segmentSchema = z.object({
  id: z.string().max(100),
  start: z.number().nonnegative(),
  end: z.number().nonnegative(),
  speaker: z.string().max(100),
  text: z.string().max(10000),
});
export const itemSchema = z.object({
  id: z.string().max(100),
  text: z.string().trim().min(1).max(4000),
  evidence: z.array(z.string().max(100)).min(1).max(30),
  owner: z.string().max(150).nullable().default(null),
  dueDate: z.union([z.iso.date(), z.null()]).default(null),
  status: z
    .enum(["proposed", "accepted", "completed", "dismissed"])
    .default("proposed"),
});
export const notesSchema = z.object({
  summary: z.string().max(12000),
  topics: z.array(itemSchema).max(100),
  decisions: z.array(itemSchema).max(100),
  actions: z.array(itemSchema).max(100),
  questions: z.array(itemSchema).max(100),
  recommendations: z.array(itemSchema).max(100),
});
export type Segment = z.infer<typeof segmentSchema>;
export type Notes = z.infer<typeof notesSchema>;
export type Meeting = {
  id: string;
  workspace_id: string;
  creator_id: string;
  title: string;
  status: string;
  visibility: "private" | "workspace";
  language: string;
  duration: number | null;
  created_at: string;
  version: number;
  transcript: Segment[];
  notes: Notes | null;
  notes_stale: boolean;
  error: string | null;
  canEdit?: boolean;
  recording_deleted: boolean;
  processing_mode?: "server" | "device";
};
export function validateEvidence(notes: Notes, segments: Segment[]) {
  const ids = new Set(segments.map((s) => s.id));
  for (const key of [
    "topics",
    "decisions",
    "actions",
    "questions",
    "recommendations",
  ] as const)
    for (const item of notes[key])
      if (item.evidence.some((id) => !ids.has(id)))
        throw new HttpError(
          400,
          "A note refers to a missing transcript segment.",
        );
  return notes;
}
export function visibleTo(
  m: { creator_id: string; visibility: string },
  user: string,
  member: boolean,
  grant: boolean,
) {
  return (
    member && (m.creator_id === user || m.visibility === "workspace" || grant)
  );
}
