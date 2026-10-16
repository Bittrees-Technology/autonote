import test from "node:test";
import assert from "node:assert/strict";
import {workspacePollInterval} from "../lib/workspace-polling";
test("idle cloud workspace slows down but every processing stage stays live", () => {
 assert.equal(workspacePollInterval("server", []),30000);
 assert.equal(workspacePollInterval("server", [{status:"ready"},{status:"failed"}]),30000);
 for(const status of ["uploading","queued","transcribing","generating notes","future worker stage"])
  assert.equal(workspacePollInterval("server", [{status:"ready"},{status}]),5000);
 assert.equal(workspacePollInterval("server", [{status:"ready"}]),30000);
 assert.equal(workspacePollInterval("device", [{status:"queued"}]),60000);
});
