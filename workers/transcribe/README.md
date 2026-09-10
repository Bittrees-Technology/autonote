# Processing worker

Run via the root Compose file or build this folder as a container. The standard image is CPU-based and includes faster-whisper, FFmpeg, and the notes adapter. It runs as an unprivileged user; use an isolated host and resource limits for untrusted media.

`DATABASE_URL`, the S3 variables, and model settings are documented in the root `.env.example`. The worker needs SQL transactions and row locks; do not use a connection proxy mode that invalidates them. The queue uses leases rather than a process-local queue, so restart is safe. Only a live lease on the current meeting generation may publish output.

CPU defaults: `WHISPER_MODEL=small`, `WHISPER_DEVICE=cpu`, `WHISPER_COMPUTE_TYPE=int8`. For multilingual transcription, choose `small` or another multilingual model. GPU deployment requires a CUDA-compatible base image and validated ctranslate2/CUDA versions; the default Docker image is not a GPU image.

Notes use a chat-completions-compatible endpoint ending in `/v1`, a configured model, and an optional API key. Strict JSON schema output is the default; set `NOTES_FORMAT=json_object` only for an endpoint without schema support. Transcript chunks are bounded before generation, validated against known source IDs, and merged. Unstated owners and nonliteral dates are left empty. Invalid output retries at most three attempts; transcripts remain accessible. Semantic accuracy still requires pilot evaluation.

Optional diarization: build a separately pinned image with `pyannote.audio` and its PyTorch dependencies, configure a compatible `DIARIZATION_MODEL`, and supply `HF_TOKEN` if its model requires access. The adapter accepts the `speaker_diarization` output or a direct annotation. Review model terms and telemetry configuration. This optional path is not included in the default image and was not exercised in initial validation.

The cleanup loop runs every minute. It removes deleted content, expired recordings, and abandoned application uploads, plus expired auth records. Keep a cleanup worker running even at zero transcription traffic. Storage-side lifecycle cleanup should additionally remove orphaned multipart uploads, including those created immediately before a failed database transaction.
