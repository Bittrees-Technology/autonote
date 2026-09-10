"""Synthetic regression pilot; run inside the worker with a fixture directory.

The directory must contain fixtures.json and one <id>.aiff per fictional script.
This evaluates clean speech and deterministic added noise, not real-meeting quality.
"""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import unicodedata
import wave
sys.path.insert(0, '/worker')
from faster_whisper import WhisperModel
from notes import generate_notes

def words(text):
    return re.findall(r'\w+', unicodedata.normalize('NFC', text).lower())

def errors(reference, hypothesis):
    a, b = words(reference), words(hypothesis)
    row = list(range(len(b)+1))
    for i, x in enumerate(a, 1):
        new = [i]
        for j, y in enumerate(b, 1):
            new.append(min(new[-1]+1, row[j]+1, row[j-1]+(x != y)))
        row = new
    return row[-1], len(a)

root = Path(sys.argv[1])
model = WhisperModel(os.getenv('WHISPER_MODEL', 'small'), device='cpu', compute_type='int8', download_root=os.getenv('WHISPER_DOWNLOAD_ROOT'), cpu_threads=4)
results = []
for fixture in json.loads((root/'fixtures.json').read_text()):
    for condition in ['clean', 'noise']:
        name = fixture['id']+'-'+condition
        audio = root/(name+'.wav')
        command = ['ffmpeg', '-v', 'error', '-nostdin', '-i', str(root/(fixture['id']+'.aiff'))]
        if condition == 'noise':
            command += ['-f', 'lavfi', '-i', 'anoisesrc=color=pink:amplitude=0.035:sample_rate=16000:seed=42', '-filter_complex', '[0:a][1:a]amix=inputs=2:duration=first:normalize=0']
        subprocess.run(command+['-ar', '16000', '-ac', '1', '-y', str(audio)], check=True, capture_output=True, timeout=60)
        with wave.open(str(audio)) as f:
            seconds = f.getnframes()/f.getframerate()
        started = time.monotonic()
        output, _ = model.transcribe(str(audio), language=fixture['language'], beam_size=5, vad_filter=True, condition_on_previous_text=False)
        segments = [dict(id=f's{i+1}', start=round(s.start, 3), end=round(s.end, 3), speaker='Unlabeled speaker', text=s.text.strip()) for i, s in enumerate(output) if s.text.strip()]
        elapsed = time.monotonic()-started
        transcript = ' '.join(s['text'] for s in segments)
        count, total = errors(fixture['text'], transcript)
        result = dict(id=name, language=fixture['language'], condition=condition, reference=fixture['text'], transcript=transcript, segments=segments, seconds=seconds, transcriptionSeconds=elapsed, wordErrors=count, referenceWords=total)
        started = time.monotonic()
        try:
            result['notes'], result['notesModel'] = generate_notes(segments)
        except Exception as error:
            result['notesError'] = type(error).__name__
        result['notesSeconds'] = time.monotonic()-started
        results.append(result)
        (root/'results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
        print(name, 'complete', 'notes failed' if 'notesError' in result else 'notes valid', flush=True)
