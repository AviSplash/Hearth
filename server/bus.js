// Server-Sent Events hub. Every open tablet/phone keeps one connection and
// refreshes its data whenever another device changes something.

const clients = new Set();

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
}

export function broadcast(scopes) {
  const data = JSON.stringify({ scopes: [].concat(scopes), at: Date.now() });
  for (const res of clients) res.write(`event: change\ndata: ${data}\n\n`);
}

export function clientCount() {
  return clients.size;
}

setInterval(() => {
  for (const res of clients) res.write(': ping\n\n');
}, 25_000).unref();
