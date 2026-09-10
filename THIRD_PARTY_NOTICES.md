# Third-party notices

AutoNote original application code is released under the MIT license in LICENSE.

The email/SIWE authentication and client wallet flow are adapted from Bittrees CRM, copyright Bittrees Technology, MIT licensed. Preserve the original LICENSE when redistributing that code.

Whisper code and model weights are MIT licensed: https://github.com/openai/whisper
faster-whisper is MIT licensed: https://github.com/SYSTRAN/faster-whisper
Other JavaScript and Python dependencies retain their own licenses; see installed package metadata and the checked-in dependency manifests/locks. Do not present this project’s MIT license as a relicense of dependencies.

FFmpeg is packaged from Debian; its selected build configuration and component licenses must be checked when redistributing worker binaries. Container images and runtime components retain their own notices.

Optional pyannote library, selected diarization model, and Hugging Face access conditions must each be reviewed before deployment. No optional model weights are included in this repository.

The notes adapter can use services or local models with separate terms. The development evaluation used Ollama and Qwen2.5 1.5B; no model weights are redistributed here. Read.ai branding, assets, source, and proprietary scoring are not included.

Interface typography: DM Sans and Manrope are loaded from Google Fonts under their respective open font licenses. Production operators may self-host these fonts to remove external font requests.

The hosted device mode uses Transformers.js 3.8.1 (Apache-2.0), ONNX Runtime Web (MIT), and the ONNX conversion of Whisper base from https://huggingface.co/onnx-community/whisper-base at revision 1846881b6b3a3024392c1eea3ad983695bc23925. Model files are downloaded to the browser; no weights are committed to this repository. Preserve dependency and upstream Whisper notices when redistributing. The `sharp` override addresses a transitive dependency advisory; it is not used for browser audio inference.
