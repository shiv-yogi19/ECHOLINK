import { DurableObject } from "cloudflare:workers";

const json = (o, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/api/create" && req.method === "POST") {
      for (let i = 0; i < 8; i++) {
        const code = String((crypto.getRandomValues(new Uint32Array(1))[0] % 900000) + 100000);
        const r = await env.ROOMS.get(env.ROOMS.idFromName(code)).fetch("https://room/create", { method: "POST" });
        if (r.status === 200) return json({ code });
      }
      return json({ error: "busy" }, 503);
    }
    if (url.pathname === "/ws") {
      const code = url.searchParams.get("code") || "";
      if (!/^\d{6}$/.test(code) || req.headers.get("Upgrade") !== "websocket") return new Response("Bad request", { status: 400 });
      return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(req);
    }
    return new Response("Not found", { status: 404 });
  },
};

const send = (ws, o) => { try { ws.send(JSON.stringify(o)); } catch {} };

// One Durable Object per room: 1 sender + 1 receiver. Relays signaling only; audio never touches the server.
export class Room extends DurableObject {
  peers = {}; // role -> { ws, id }

  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/create") {
      if (await this.ctx.storage.get("created")) return new Response("exists", { status: 409 });
      await this.ctx.storage.put("created", 1);
      await this.ctx.storage.setAlarm(Date.now() + 10 * 60e3); // nobody joined → expire
      return new Response("ok");
    }
    const created = await this.ctx.storage.get("created");
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    const done = new Response(null, { status: 101, webSocket: client });

    const role = url.searchParams.get("role") === "sender" ? "sender" : "receiver";
    const other = role === "sender" ? "receiver" : "sender";
    const id = url.searchParams.get("id") || "x";

    if (!created) { send(server, { type: "error", code: "not_found" }); server.close(1000, "nf"); return done; }
    const cur = this.peers[role];
    if (cur && cur.id !== id) { send(server, { type: "error", code: "room_full" }); server.close(1000, "full"); return done; }
    if (cur) { try { cur.ws.close(1000, "replaced"); } catch {} }

    this.peers[role] = { ws: server, id };
    await this.ctx.storage.deleteAlarm();
    send(server, { type: "joined", peer: !!this.peers[other] });
    if (this.peers[other]) send(this.peers[other].ws, { type: "peer-joined" });

    server.addEventListener("message", (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.type === "end" && role === "sender") return void this.endRoom();
      if (["offer", "answer", "candidate"].includes(m.type) && this.peers[other]) send(this.peers[other].ws, m);
    });
    const left = () => this.left(role, server);
    server.addEventListener("close", left);
    server.addEventListener("error", left);
    return done;
  }

  async left(role, ws) {
    if (this.peers[role]?.ws !== ws) return;
    delete this.peers[role];
    const other = this.peers[role === "sender" ? "receiver" : "sender"];
    if (other) send(other.ws, { type: "peer-left" });
    else await this.ctx.storage.setAlarm(Date.now() + 60e3); // empty → cleanup in 60s
  }

  async endRoom() {
    for (const p of Object.values(this.peers)) { send(p.ws, { type: "ended" }); try { p.ws.close(1000, "ended"); } catch {} }
    this.peers = {};
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  async alarm() {
    if (Object.keys(this.peers).length === 0) await this.ctx.storage.deleteAll();
  }
}
