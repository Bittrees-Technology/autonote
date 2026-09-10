import type { Notes, Segment } from "./model";

/** Quoted candidates, never generated commitments or inferred owners/deadlines. */
export function extractiveNotes(segments: Segment[]): Notes {
  const notes: Notes = {
    summary: "",
    topics: [],
    decisions: [],
    actions: [],
    questions: [],
    recommendations: [],
  };
  const seen = new Set<string>();
  let cursor = 0;
  const spans = segments.map((s) => {
    const start = cursor;
    cursor += s.text.length + 1;
    return { id: s.id, start, end: cursor - 1 };
  });
  const transcript = segments.map((s) => s.text).join(" ");
  // Whisper may put a sentence boundary inside a timestamped segment or
  // a timestamp boundary inside a sentence. Keep source spans for both cases.
  for (const match of transcript.matchAll(/[^.!?,;]+[.!?,;]?/gu)) {
    const text = match[0].trim();
    if (text.length < 8 || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    const normalized = text
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "");
    const uncertain =
      /\b(not|never|nobody|no one|didn't|haven't|hasn't|won't|cannot|can't|nao|ninguem|nunca|if|would|could|should|might|maybe|perhaps|talvez|se)\b/.test(
        normalized,
      );
    const candidate = {
      id: `quote-${seen.size}`,
      text: text.slice(0, 4000),
      evidence: spans
        .filter(
          (s) =>
            s.start < match.index! + Math.min(match[0].length, 4000) &&
            s.end > match.index!,
        )
        .map((s) => s.id),
      owner: null,
      dueDate: null,
      status: "proposed" as const,
    };
    if (
      (text.endsWith("?") ||
        /\b(open question|remains open|still needs|em aberto|precisa de)\b/.test(
          normalized,
        )) &&
      notes.questions.length < 15
    )
      notes.questions.push(candidate);
    else if (
      !uncertain &&
      /\b(agreed|decided|decision|decidimos|decidiu|concordamos|acordamos)\b/.test(
        normalized,
      ) &&
      notes.decisions.length < 15
    )
      notes.decisions.push(candidate);
    else if (
      !uncertain &&
      /\b(will|i['’]ll|we['’]ll|committed to|vai|vamos|vou|comprometeu)\b/.test(
        normalized,
      ) &&
      notes.actions.length < 30
    )
      notes.actions.push(candidate);
    else if (notes.topics.length < 6) notes.topics.push(candidate);
  }
  const highlights = [
    ...notes.decisions,
    ...notes.actions,
    ...notes.topics,
    ...notes.questions,
  ].slice(0, 6);
  notes.summary =
    highlights
      .map((i) => i.text)
      .join("\n\n")
      .slice(0, 6000) ||
    "No speech was detected. Check the recording before trying again.";
  return notes;
}
