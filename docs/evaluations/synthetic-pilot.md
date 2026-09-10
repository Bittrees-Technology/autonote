# Synthetic pilot — September 10, 2026

**Result: transcription regression passed on these fixtures; action extraction is not ready for launch.**

Twenty clips were evaluated: five distinct English scripts and five distinct Portuguese scripts, each rendered clean and with deterministic pink noise. These are ten short fictional scripts in two conditions, not twenty independent real meetings. Speech was synthesized with macOS Daniel and Joana voices. Noise was added with FFmpeg `anoisesrc`, pink noise amplitude 0.035 and seed 42; this is not a calibrated signal-to-noise ratio.

Whisper: multilingual `small`, CPU int8, four threads, beam size five, VAD enabled, prior-text conditioning disabled. Notes: local Ollama `qwen2.5:1.5b`, temperature zero, strict JSON schema and the checked-in evidence validation. Models were already loaded/downloaded for the test; timings exclude download and model initialization.

| Language / condition | Clips | Word error rate | Audio seconds | Transcription + notes seconds |
| --- | ---: | ---: | ---: | ---: |
| English / clean | 5 | 0.81% | 45.7 | 25.3 |
| English / noise | 5 | 0.81% | 45.7 | 22.6 |
| Portuguese / clean | 5 | 3.20% | 55.5 | 33.8 |
| Portuguese / noise | 5 | 5.60% | 55.5 | 26.0 |

Word error rate uses aggregate word-level Levenshtein distance divided by reference word count after lowercasing and ignoring punctuation. Accents remain significant. These scripts are short, single-voice, and have no overlapping speakers. This does not establish general accuracy, diarization quality, live capture reliability, concurrency, or the proposed 60-minute meeting / 10-minute processing target.

## Action review

All 20 outputs passed structural and citation-ID validation. Each fixture contains one explicit commitment, so there are 20 expected commitments across the two conditions. The model proposed seven actions. Manual comparison with the known scripts found two corresponding commitments, five unsupported proposed actions, and eighteen missed commitments. This yields 2/7 supported proposals and 2/20 expected commitments recovered on this small fixture set; it is not an independent human evaluation.

Examples:

- `en-4-noise`: correctly proposed that Daniel verify report totals.
- `pt-2-clean`: proposed documenting browser issues, but also proposed planning a server purchase despite the script explicitly stating nobody agreed to buy a server.
- `pt-5-clean` and `pt-5-noise`: proposed scheduling a meeting and implementing permissions, instead of capturing Ana's commitment to check meeting links.
- The remaining outputs frequently categorized commitments as topics or questions and emitted no actions.

Valid citation IDs alone do not establish semantic support. The current model must remain experimental, with all actions proposed for review and no automatic CRM publication. Before operational launch, evaluate a stronger free local model or improve extraction, repeat these fixtures, and add longer consented conversations with independent human labels. Do not advertise the small model's structural success as semantic accuracy.

[Raw synthetic results](synthetic-qwen-1.5b.json) include the fictional references, transcript segments, notes, and per-case timing. `scripts/pilot.py` runs the same worker transcription/notes settings on a prepared fixture directory. No customer recordings or CRM data were used.
