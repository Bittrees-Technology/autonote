// Unknown in-flight states stay fast so new worker stages cannot stall updates.
export function workspacePollInterval(mode: string, meetings: {status: string}[]) {
  if (mode === "device") return 60000;
  return meetings.some(m => !["ready", "failed", "deleted"].includes(m.status)) ? 5000 : 30000;
}
