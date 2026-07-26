/**
 * Trivia rooms — connection spike.
 *
 * Phase 1 goal, and nothing more: prove two browsers can land in the same
 * room and see each other. No questions, no scoring, no game. If this
 * doesn't work, nothing built on top of it would have either.
 */

const ROOM_CODE = /^[A-Z0-9]{4,6}$/;
const MAX_PLAYERS = 8;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return new Response('ok', { headers: { 'content-type': 'text/plain' } });
    }

    if (url.pathname !== '/room') {
      return new Response('not found', { status: 404 });
    }

    const code = (url.searchParams.get('code') || '').toUpperCase();
    if (!ROOM_CODE.test(code)) {
      return new Response('bad room code', { status: 400 });
    }

    // idFromName is deterministic: the same code always reaches the same
    // object, from anywhere in the world. That is the whole trick.
    const id = env.ROOM.idFromName(code);
    return env.ROOM.get(id).fetch(request);
  },
};

export class Room {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }

    const url = new URL(request.url);
    const name = (url.searchParams.get('name') || 'anon').slice(0, 16);

    if (this.ctx.getWebSockets().length >= MAX_PLAYERS) {
      return new Response('room full', { status: 403 });
    }

    const [client, server] = Object.values(new WebSocketPair());

    // Hibernation API: the object can be evicted from memory while these
    // sockets stay open, so a room full of people thinking about a question
    // costs nothing. Plain .accept() would keep it resident and billing.
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ name, id: crypto.randomUUID() });

    this.broadcast({ type: 'roster', players: this.roster() });

    return new Response(null, { status: 101, webSocket: client });
  }

  roster() {
    return this.ctx.getWebSockets().map((ws) => {
      const a = ws.deserializeAttachment() || {};
      return { id: a.id, name: a.name };
    });
  }

  broadcast(payload, except = null) {
    const msg = JSON.stringify(payload);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      try {
        ws.send(msg);
      } catch {
        // socket already gone; the close handler will tidy the roster
      }
    }
  }

  async webSocketMessage(ws, raw) {
    const me = ws.deserializeAttachment() || {};
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }

    if (data.type === 'say') {
      this.broadcast({
        type: 'said',
        from: me.name,
        text: String(data.text || '').slice(0, 200),
      });
    }
  }

  async webSocketClose(ws) {
    // getWebSockets() still includes this socket during the close handler,
    // so filter it out rather than trusting the raw list.
    const remaining = this.ctx.getWebSockets().filter((s) => s !== ws);
    const players = remaining.map((s) => {
      const a = s.deserializeAttachment() || {};
      return { id: a.id, name: a.name };
    });
    for (const s of remaining) {
      try {
        s.send(JSON.stringify({ type: 'roster', players }));
      } catch {
        /* ignore */
      }
    }
  }

  async webSocketError(ws) {
    return this.webSocketClose(ws);
  }
}
