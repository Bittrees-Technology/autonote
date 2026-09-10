import { test } from "node:test";
import assert from "node:assert/strict";
import { extractiveNotes } from "../lib/extractive-notes";
const segment = (id: string, text: string) => ({
  id,
  text,
  start: 0,
  end: 10,
  speaker: "Unlabeled speaker",
});
test("quoted highlights recover clauses across Whisper timestamp boundaries", () => {
  const notes = extractiveNotes([
    segment(
      "s1",
      "Today we reviewed the website, Maya will prepare the launch checklist, we agreed to keep",
    ),
    segment("s2", "the first release free, the budget question remains open."),
  ]);
  assert.equal(notes.actions.length, 1);
  assert.equal(
    notes.actions[0].text,
    "Maya will prepare the launch checklist,",
  );
  assert.equal(notes.actions[0].owner, null);
  assert.equal(notes.actions[0].dueDate, null);
  assert.equal(notes.actions[0].status, "proposed");
  assert.equal(
    notes.decisions[0].text,
    "we agreed to keep the first release free,",
  );
  assert.deepEqual(notes.decisions[0].evidence, ["s1", "s2"]);
  assert.equal(notes.questions.length, 1);
  assert.equal(notes.recommendations.length, 0);
});
test("questions, hypotheticals and negation are not commitments", () => {
  const notes = extractiveNotes([
    segment(
      "s1",
      "Will Maya prepare the launch? If we agree I will send it. We will not send the draft. Maybe we will launch. Nobody agreed to publish.",
    ),
  ]);
  assert.equal(notes.actions.length, 0);
  assert.equal(notes.decisions.length, 0);
  assert.equal(notes.questions.length, 1);
});
test("Portuguese quotes retain text and do not infer dates or owners", () => {
  const notes = extractiveNotes([
    segment(
      "s1",
      "A Maria vai preparar a lista. Decidimos manter o lançamento gratuito. Não vamos publicar amanhã.",
    ),
  ]);
  assert.equal(notes.actions.length, 1);
  assert.equal(notes.decisions.length, 1);
  assert.equal(notes.actions[0].owner, null);
});
test("question-only transcripts do not report silence", () => {
  assert.match(
    extractiveNotes([segment("s1", "What remains open?")]).summary,
    /What remains open/,
  );
});
