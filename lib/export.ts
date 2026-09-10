import type { Meeting } from "./model";
function time(seconds: number, srt = false) {
  const ms = Math.round(seconds * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}${srt ? "," : "."}${String(ms % 1000).padStart(3, "0")}`;
}
export function exportMeeting(m: Meeting, format: string) {
  if (format === "json")
    return JSON.stringify(
      {
        title: m.title,
        language: m.language,
        duration: m.duration,
        transcript: m.transcript,
        notes: m.notes,
        notesStale: m.notes_stale,
      },
      null,
      2,
    );
  if (format === "srt" || format === "vtt")
    return (
      (format === "vtt" ? "WEBVTT\n\n" : "") +
      m.transcript
        .map(
          (s, i) =>
            `${format === "srt" ? `${i + 1}\n` : ""}${time(s.start, format === "srt")} --> ${time(s.end, format === "srt")}\n${s.speaker}: ${s.text.replace(/-->/g, "→")}\n`,
        )
        .join("\n")
    );
  if (format === "txt")
    return m.transcript
      .map((s) => `[${time(s.start)}] ${s.speaker}: ${s.text}`)
      .join("\n");
  return (
    `# ${m.title}\n\n${m.notes?.summary || "Notes are not yet available."}\n${m.notes_stale ? "\nTranscript was edited; these notes need review.\n" : ""}` +
    (m.notes
      ? (
          [
            "topics",
            "decisions",
            "actions",
            "questions",
            "recommendations",
          ] as const
        )
          .map(
            (k) =>
              `\n## ${k[0].toUpperCase() + k.slice(1)}\n\n` +
              m
                .notes![k].map(
                  (i) =>
                    `- ${i.text}${k === "actions" ? ` (${i.status}; ${i.owner || "Unassigned"}; ${i.dueDate || "No date stated"})` : ""} [${i.evidence
                      .map((id) => {
                        const s = m.transcript.find((s) => s.id === id);
                        return s ? time(s.start) : id;
                      })
                      .join(", ")}]`,
                )
                .join("\n"),
          )
          .join("\n")
      : "") +
    "\n\n## Transcript\n\n" +
    m.transcript
      .map((s) => `**${time(s.start)} · ${s.speaker}** ${s.text}`)
      .join("\n\n")
  );
}
