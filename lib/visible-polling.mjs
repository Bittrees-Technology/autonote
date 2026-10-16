// Display polling only: protected operations still check current server authority.
export function startVisiblePolling(task, { intervalMs, immediate = true, doc = document, win = window, timers = globalThis, onError = () => {} }) {
  let stopped = false, running = false, timer;
  const clear = () => { if (timer !== undefined) timers.clearTimeout(timer); timer = undefined; };
  const schedule = () => {
    clear();
    if (!stopped && !doc.hidden) timer = timers.setTimeout(run, typeof intervalMs === 'function' ? intervalMs() : intervalMs);
  };
  async function run() {
    clear();
    if (stopped || doc.hidden || running) return;
    running = true;
    try { await task(); } catch (error) { onError(error); }
    finally { running = false; schedule(); }
  }
  const visibility = () => { if (doc.hidden) clear(); else void run(); };
  const focus = () => { if (!doc.hidden) void run(); };
  doc.addEventListener('visibilitychange', visibility);
  win.addEventListener('focus', focus);
  if (immediate) void run(); else schedule();
  return () => { stopped = true; clear(); doc.removeEventListener('visibilitychange', visibility); win.removeEventListener('focus', focus); };
}
