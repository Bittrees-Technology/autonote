"""AutoNote durable worker. No credentials or meeting text are written to logs."""
import json
import os
import subprocess
import tempfile
import threading
import time
import uuid
from contextlib import contextmanager
import boto3
import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from notes import generate_notes

MAX_BYTES = 1024 ** 3
MAX_SECONDS = 7200
_model = None


def db():
    return psycopg.connect(os.environ['DATABASE_URL'], row_factory=dict_row)


def s3():
    return boto3.client('s3', endpoint_url=os.getenv('S3_ENDPOINT') or None,
        region_name=os.getenv('S3_REGION', 'us-east-1'),
        aws_access_key_id=os.environ['S3_ACCESS_KEY_ID'], aws_secret_access_key=os.environ['S3_SECRET_ACCESS_KEY'])


def claim():
    with db() as conn:
        candidate = conn.execute("""SELECT m.id FROM meetings m WHERE m.deleted_at IS NULL
          AND EXISTS(SELECT 1 FROM jobs j WHERE j.meeting_id=m.id AND j.generation=m.version AND j.attempts<3
          AND ((j.state='queued' AND j.available_at<=now()) OR (j.state='running' AND j.leased_until<now())))
          ORDER BY m.created_at FOR UPDATE OF m SKIP LOCKED LIMIT 1""").fetchone()
        if not candidate:
            return None
        job = conn.execute("""SELECT j.* FROM jobs j JOIN meetings m ON m.id=j.meeting_id
          WHERE j.meeting_id=%s AND j.generation=m.version AND j.attempts<3
          AND ((j.state='queued' AND j.available_at<=now()) OR (j.state='running' AND j.leased_until<now()))
          ORDER BY j.id FOR UPDATE OF j SKIP LOCKED LIMIT 1""",(candidate['id'],)).fetchone()
        if not job:
            return None
        job['lease_token'] = uuid.uuid4()
        conn.execute("UPDATE jobs SET state='running',attempts=attempts+1,lease_token=%s,leased_until=now()+interval '2 minutes' WHERE id=%s", (job['lease_token'], job['id']))
        conn.execute("UPDATE meetings SET status=%s,error=NULL WHERE id=%s AND deleted_at IS NULL AND version=%s", ('transcribing' if job['stage']=='transcribe' else 'generating notes', job['meeting_id'], job['generation']))
        return job


@contextmanager
def heartbeat(job):
    stop = threading.Event()
    def beat():
        while not stop.wait(20):
            try:
                with db() as conn:
                    conn.execute("UPDATE jobs SET leased_until=now()+interval '2 minutes' WHERE id=%s AND lease_token=%s AND state='running'", (job['id'], job['lease_token']))
            except Exception:
                print('Heartbeat temporarily unavailable', flush=True)
    thread = threading.Thread(target=beat, daemon=True)
    thread.start()
    try:
        yield
    finally:
        stop.set()
        thread.join(timeout=1)


def live_meeting(conn, job):
    # All product edits/deletes lock the meeting before touching jobs.
    m = conn.execute('SELECT * FROM meetings WHERE id=%s FOR UPDATE', (job['meeting_id'],)).fetchone()
    j = conn.execute('SELECT * FROM jobs WHERE id=%s FOR UPDATE', (job['id'],)).fetchone()
    if not m or m['deleted_at'] or m['version'] != job['generation'] or not j or j['state'] != 'running' or j['lease_token'] != job['lease_token']:
        return None
    return m


def transcribe(m, job):
    global _model
    store = s3()
    bucket = os.environ['S3_BUCKET']
    obj = store.get_object(Bucket=bucket, Key=m['object_key'])
    if obj['ContentLength'] > MAX_BYTES:
        raise ValueError('Recording exceeds the 1 GB limit.')
    with tempfile.TemporaryDirectory(prefix='autonote-') as folder:
        source, audio = folder+'/source', folder+'/audio.wav'
        total = 0
        with open(source, 'wb') as out:
            for chunk in obj['Body'].iter_chunks(1024*1024):
                total += len(chunk)
                if total > MAX_BYTES:
                    raise ValueError('Recording exceeds the 1 GB limit.')
                out.write(chunk)
        probe = subprocess.run(['ffprobe','-protocol_whitelist','file,pipe','-v','error','-show_entries','format=duration','-of','json',source], capture_output=True, timeout=30, check=True)
        try:
            declared = float(json.loads(probe.stdout)['format'].get('duration', 0))
        except (KeyError, ValueError):
            declared = 0
        if declared > MAX_SECONDS+1:
            raise ValueError('Recording exceeds the two-hour limit.')
        subprocess.run(['ffmpeg','-protocol_whitelist','file,pipe','-nostdin','-v','error','-i',source,'-t',str(MAX_SECONDS+1),'-vn','-ar','16000','-ac','1','-y',audio], capture_output=True, timeout=300, check=True)
        import wave
        with wave.open(audio) as wav:
            duration = wav.getnframes()/wav.getframerate()
        if duration > MAX_SECONDS:
            raise ValueError('Recording exceeds the two-hour limit.')
        from faster_whisper import WhisperModel
        if _model is None:
            _model = WhisperModel(os.getenv('WHISPER_MODEL','small'),device=os.getenv('WHISPER_DEVICE','cpu'),compute_type=os.getenv('WHISPER_COMPUTE_TYPE','int8'),download_root=os.getenv('WHISPER_DOWNLOAD_ROOT') or None,cpu_threads=4)
        language = None if m['language']=='auto' else m['language']
        output, info = _model.transcribe(audio,language=language,beam_size=5,vad_filter=True,condition_on_previous_text=False)
        segments = [{'id':f's{i+1}','start':round(s.start,3),'end':round(s.end,3),'speaker':'Unlabeled speaker','text':s.text.strip()} for i,s in enumerate(output) if s.text.strip()]
        diarization = 'disabled'
        if os.getenv('DIARIZATION_MODEL') and segments:
            from pyannote.audio import Pipeline
            pipeline = Pipeline.from_pretrained(os.environ['DIARIZATION_MODEL'], token=os.getenv('HF_TOKEN'))
            prediction = pipeline(audio)
            annotation = getattr(prediction, 'speaker_diarization', prediction)
            turns = list(annotation.itertracks(yield_label=True))
            labels = {}
            for seg in segments:
                overlaps = {}
                for turn, _, label in turns:
                    overlaps[label] = overlaps.get(label,0)+max(0,min(seg['end'],turn.end)-max(seg['start'],turn.start))
                best = max(overlaps, key=overlaps.get) if overlaps else None
                if best is not None and overlaps[best]>0:
                    labels.setdefault(best, f'Speaker {len(labels)+1}')
                    seg['speaker'] = labels[best]
            diarization = os.environ['DIARIZATION_MODEL']
        with db() as conn:
            if not live_meeting(conn,job):
                return
            conn.execute("INSERT INTO revisions(meeting_id,version,kind,payload) VALUES(%s,%s,'machine-transcript',%s)", (m['id'],job['generation'],Jsonb({'segments':segments,'model':os.getenv('WHISPER_MODEL','small'),'diarization':diarization,'language':info.language})))
            conn.execute("UPDATE meetings SET transcript=%s,duration=%s,status='generating notes',updated_at=now() WHERE id=%s", (Jsonb(segments),duration,m['id']))
            conn.execute('INSERT INTO usage(workspace_id,meeting_id,minutes) VALUES(%s,%s,%s)',(m['workspace_id'],m['id'],duration/60))
            conn.execute("UPDATE jobs SET state='done',lease_token=NULL WHERE id=%s",(job['id'],))
            conn.execute("INSERT INTO jobs(meeting_id,generation,stage) VALUES(%s,%s,'notes') ON CONFLICT DO NOTHING",(m['id'],job['generation']))


def process_notes(m,job):
    notes, model = generate_notes(m['transcript'],m['notes'])
    with db() as conn:
        if not live_meeting(conn,job):
            return
        conn.execute("INSERT INTO revisions(meeting_id,version,kind,payload) VALUES(%s,%s,'machine-notes',%s)",(m['id'],job['generation'],Jsonb({'notes':notes,'model':model,'promptVersion':'1'})))
        conn.execute("UPDATE meetings SET notes=%s,notes_stale=false,status='ready',error=NULL,updated_at=now() WHERE id=%s",(Jsonb(notes),m['id']))
        conn.execute("UPDATE jobs SET state='done',lease_token=NULL WHERE id=%s",(job['id'],))


def fail(job,error):
    # Only known validation/configuration messages are safe for the interface.
    safe = str(error) if isinstance(error,(ValueError,RuntimeError)) else 'Processing failed. Retry or ask your workspace operator to check the worker.'
    if len(safe)>250:
        safe='Processing failed. Retry or ask your workspace operator to check the worker.'
    with db() as conn:
        if not live_meeting(conn,job):
            return
        j=conn.execute('SELECT attempts FROM jobs WHERE id=%s',(job['id'],)).fetchone()
        retry = j['attempts']<3 and not isinstance(error,ValueError)
        conn.execute("UPDATE jobs SET state=%s,last_error=%s,lease_token=NULL,available_at=now()+interval '1 minute' WHERE id=%s",('queued' if retry else 'failed',safe,job['id']))
        conn.execute('UPDATE meetings SET status=%s,error=%s WHERE id=%s',('generating notes' if retry and job['stage']=='notes' else 'queued' if retry else 'failed',safe,job['meeting_id']))
    print(f"Job {job['id']} failed ({type(error).__name__})",flush=True)


def cleanup():
    with db() as conn:
        # Recover final-attempt crashes, rather than leaving a meeting running forever.
        conn.execute("UPDATE jobs SET state='failed',last_error='Worker lease expired after final attempt.' WHERE state='running' AND leased_until<now() AND attempts>=3")
        conn.execute("UPDATE meetings m SET status='failed',error='Processing was interrupted. Retry this meeting.' WHERE deleted_at IS NULL AND EXISTS(SELECT 1 FROM jobs j WHERE j.meeting_id=m.id AND j.generation=m.version AND j.state='failed') AND status IN ('queued','transcribing','generating notes')")
        conn.execute("UPDATE meetings SET deleted_at=now(),status='deleting',version=version+1 WHERE status='uploading' AND created_at<now()-interval '1 day' AND deleted_at IS NULL")
        rows=conn.execute("""SELECT m.id FROM meetings m JOIN workspaces w ON w.id=m.workspace_id WHERE
          (m.deleted_at IS NOT NULL AND m.status<>'deleted') OR
          (m.recording_deleted=false AND m.status IN ('ready','failed') AND m.created_at<now()-make_interval(days=>w.retention_days)) LIMIT 30""").fetchall()
    store=s3()
    for row in rows:
        with db() as conn:
            m=conn.execute('SELECT * FROM meetings WHERE id=%s FOR UPDATE',(row['id'],)).fetchone()
            if not m['deleted_at'] and m['status'] not in ('ready','failed'):
                continue
            if m['upload_id']:
                try:
                    store.abort_multipart_upload(Bucket=os.environ['S3_BUCKET'],Key=m['object_key'],UploadId=m['upload_id'])
                except store.exceptions.ClientError as e:
                    if e.response['Error']['Code']!='NoSuchUpload':
                        raise
            if m['object_key']:
                store.delete_object(Bucket=os.environ['S3_BUCKET'],Key=m['object_key'])
            if m['deleted_at']:
                conn.execute('DELETE FROM crm_previews WHERE meeting_id=%s',(m['id'],))
                conn.execute('DELETE FROM revisions WHERE meeting_id=%s',(m['id'],))
                conn.execute('DELETE FROM meeting_grants WHERE meeting_id=%s',(m['id'],))
                conn.execute('DELETE FROM jobs WHERE meeting_id=%s',(m['id'],))
                conn.execute("UPDATE meetings SET title='Deleted meeting',transcript='[]',notes=NULL,error=NULL,status='deleted',object_key=NULL,upload_id=NULL,recording_deleted=true WHERE id=%s",(m['id'],))
            else:
                conn.execute('UPDATE meetings SET recording_deleted=true,object_key=NULL WHERE id=%s',(m['id'],))
    with db() as conn:
        conn.execute("DELETE FROM challenges WHERE expires_at<now()-interval '1 day'")
        conn.execute('DELETE FROM sessions WHERE expires_at<now()')
        conn.execute('DELETE FROM google_pending WHERE expires_at<now()')
        conn.execute("DELETE FROM google_selections WHERE ends_at<now()-interval '1 day'")
        conn.execute('DELETE FROM crm_pending WHERE expires_at<now()')
        conn.execute('DELETE FROM crm_previews WHERE expires_at<now()')
        conn.execute("DELETE FROM rate_limits WHERE resets_at<now()-interval '1 day'")


def main():
    last_cleanup=0
    print('AutoNote worker ready',flush=True)
    while True:
        try:
            if time.time()-last_cleanup>60:
                cleanup()
                last_cleanup=time.time()
            job=claim()
            if not job:
                time.sleep(3)
                continue
            with db() as conn:
                m=conn.execute('SELECT * FROM meetings WHERE id=%s',(job['meeting_id'],)).fetchone()
            try:
                with heartbeat(job):
                    if job['stage']=='transcribe':
                        transcribe(m,job)
                    else:
                        process_notes(m,job)
                print(f"Job {job['id']} completed",flush=True)
            except Exception as e:
                fail(job,e)
        except Exception as e:
            print(f'Worker service unavailable ({type(e).__name__})',flush=True)
            time.sleep(5)

if __name__=='__main__':
    main()
