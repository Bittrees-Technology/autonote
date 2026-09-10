import unittest
from notes import validate_notes, preserve_actions

class NotesTests(unittest.TestCase):
    def payload(self):
        return {'summary':'A meeting','topics':[],'decisions':[],'actions':[{'text':'Prepare sample','evidence':['s1'],'owner':None,'dueDate':None}],'questions':[],'recommendations':[]}
    def test_unknown_evidence_rejected(self):
        with self.assertRaises(ValueError): validate_notes(self.payload(),[{'id':'s2'}])
    def test_missing_owner_remains_null(self):
        self.assertIsNone(validate_notes(self.payload(),[{'id':'s1','text':'Prepare sample'}])['actions'][0]['owner'])
    def test_accepted_actions_survive_regeneration(self):
        n=validate_notes(self.payload(),[{'id':'s1','text':'Prepare sample'}]);old={'actions':[dict(n['actions'][0],status='completed')]}
        new=preserve_actions(n,old)
        self.assertEqual(len(new['actions']),1);self.assertEqual(new['actions'][0]['status'],'completed')
    def test_invalid_date_rejected(self):
        p=self.payload();p['actions'][0]['dueDate']='2026-02-31'
        with self.assertRaises(ValueError):validate_notes(p,[{'id':'s1','text':'Prepare sample'}])
if __name__=='__main__':unittest.main()
