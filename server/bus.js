// Server-Sent Events hub. Every open tablet/phone keeps one connection and
// refreshes its data whenever another device changes something. This needs
// one long-running server that sees every change; when data lives in shared
// cloud storage, screens poll /api/poll instead.

const clients = new Set();
let pinger = null;

export function sseHandler(req, res) {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  res.write(`event: hello\ndata: ${JSON.stringify({ at: Date.now() })}\n\n`);
  clients.add(res);
  req.on('close', () => clients.delete(res));
  // Keep proxies from closing quiet connections. Started here rather than at
  // load time, because serverless hosts don't allow timers outside a request.
  pinger ||= setInterval(() => {
    for (const c of clients) c.write(': ping\n\n');
  }, 25_000);
  pinger.unref?.();
}

export function broadcast(scopes) {
  const data = JSON.stringify({ scopes: [].concat(scopes), at: Date.now() });
  for (const res of clients) res.write(`event: change\ndata: ${data}\n\n`);
}

export function clientCount() {
  return clients.size;
}
