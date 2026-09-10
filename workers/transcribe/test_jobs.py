"""Database-backed lease and deletion races, always in a dedicated test DB."""
import os
import unittest
import uuid
from psycopg.types.json import Jsonb
from worker import db, claim, live_meeting, process_notes

class JobTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not os.environ['DATABASE_URL'].endswith('/autonote_test'):
            raise RuntimeError('Dedicated test database required')
    def setUp(self):
        self.user,self.workspace,self.meeting=uuid.uuid4(),uuid.uuid4(),uuid.uuid4()
        with db() as c:
            c.execute("INSERT INTO users(id,name) VALUES(%s,'Worker test')",(self.user,))
            c.execute("INSERT INTO workspaces(id,name) VALUES(%s,'Worker test')",(self.workspace,))
            c.execute("INSERT INTO meetings(id,workspace_id,creator_id,title,status) VALUES(%s,%s,%s,'Fixture','queued')",(self.meeting,self.workspace,self.user))
            c.execute("INSERT INTO jobs(meeting_id,generation,stage) VALUES(%s,1,'notes')",(self.meeting,))
    def tearDown(self):
        with db() as c:
            c.execute('DELETE FROM meetings WHERE id=%s',(self.meeting,))
            c.execute('DELETE FROM workspaces WHERE id=%s',(self.workspace,))
            c.execute('DELETE FROM users WHERE id=%s',(self.user,))
    def test_live_lease_not_claimed_twice(self):
        j=claim();self.assertEqual(j['meeting_id'],self.meeting);self.assertIsNone(claim())
    def test_expired_lease_fences_old_worker(self):
        old=claim()
        with db() as c:c.execute("UPDATE jobs SET leased_until=now()-interval '1 second' WHERE id=%s",(old['id'],))
        new=claim();self.assertNotEqual(old['lease_token'],new['lease_token'])
        with db() as c:self.assertIsNone(live_meeting(c,old));self.assertIsNotNone(live_meeting(c,new))
    def test_deleted_meeting_cannot_be_published(self):
        j=claim()
        with db() as c:
            m=c.execute('SELECT * FROM meetings WHERE id=%s',(self.meeting,)).fetchone()
            c.execute("UPDATE meetings SET deleted_at=now(),version=version+1,status='deleting' WHERE id=%s",(self.meeting,))
        process_notes(m,j)
        with db() as c:
            r=c.execute('SELECT status,notes FROM meetings WHERE id=%s',(self.meeting,)).fetchone()
            self.assertEqual(r['status'],'deleting');self.assertIsNone(r['notes'])
    def test_silence_does_not_create_hallucinated_actions(self):
        j=claim()
        with db() as c:m=c.execute('SELECT * FROM meetings WHERE id=%s',(self.meeting,)).fetchone()
        process_notes(m,j)
        with db() as c:
            r=c.execute('SELECT status,notes FROM meetings WHERE id=%s',(self.meeting,)).fetchone()
            self.assertEqual(r['status'],'ready');self.assertEqual(r['notes']['actions'],[])
if __name__=='__main__':unittest.main()
