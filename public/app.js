"use strict";
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const ICE = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun.cloudflare.com:3478" }] };
const S = { role: null, code: "", ws: null, pc: null, stream: null, ended: false, retry: 0, lost: 0, lostPC: 0, rs: 0,
  id: Math.random().toString(36).slice(2), pending: [], ac: null, an: null, raf: 0, lvl: 0, rt: 0, tt: 0 };

/* ---------- startup, lite mode, particles ---------- */
const lite = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 4) <= 2 || matchMedia("(prefers-reduced-motion: reduce)").matches;
if (lite) document.documentElement.classList.add("lite");
setTimeout(() => { $("#splash").classList.add("out"); setTimeout(() => $("#splash").remove(), 900); }, 2800);
(function () {
  if (lite) return;
  const c = $("#bg"), x = c.getContext("2d"); let w, h; const P = [];
  const rs = () => { w = c.width = innerWidth; h = c.height = innerHeight; }; rs(); addEventListener("resize", rs);
  for (let i = 0; i < 45; i++) P.push({ x: Math.random() * innerWidth, y: Math.random() * innerHeight, r: Math.random() * 1.8 + .4, v: Math.random() * .25 + .05, a: Math.random() * 6 });
  (function f() { x.clearRect(0, 0, w, h);
    for (const p of P) { p.y -= p.v; p.a += .02; if (p.y < 0) { p.y = h; p.x = Math.random() * w; }
      x.fillStyle = `rgba(150,200,255,${.25 + .25 * Math.sin(p.a)})`; x.beginPath(); x.arc(p.x, p.y, p.r, 0, 7); x.fill(); }
    requestAnimationFrame(f); })();
})();

/* ---------- UI helpers ---------- */
const supported = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.RTCPeerConnection && window.WebSocket);
const show = id => $$(".screen").forEach(s => s.classList.toggle("on", s.id === id));
const sTitle = t => $("#sTitle").textContent = t, rTitle = t => $("#rTitle").textContent = t;
const showCode = b => $("#codeCard").classList.toggle("min", !b);
function setStatus(k, t) { const p = $("#pill"); p.className = "pill s-" + k; p.querySelector("span").textContent = t; p.hidden = false; $$(".link").forEach(l => l.dataset.state = k); }
function toast(t, s = "") { const e = $("#toast"); e.innerHTML = "<b></b><span></span>"; e.firstChild.textContent = t; e.lastChild.textContent = s; e.classList.add("on"); clearTimeout(S.tt); S.tt = setTimeout(() => e.classList.remove("on"), 3200); }
function closeModal() { $("#modal").classList.remove("on"); }
function modal(o) {
  $("#mIcon").textContent = o.icon || ""; $("#mTitle").textContent = o.title; $("#mText").textContent = o.text || ""; $("#mReady").hidden = !o.ready;
  const a = $("#mBtn"), b = $("#mBtn2"); a.disabled = false; a.textContent = o.btn || "OK"; a.onclick = o.onbtn || closeModal;
  b.hidden = !o.btn2; b.textContent = o.btn2 || ""; b.onclick = o.onbtn2 || closeModal;
  $("#modal").classList.add("on"); setTimeout(() => a.focus(), 50);
}
const ERR = {
  mic: ["🚫", "Microphone Access Denied", "Please allow microphone permission from your browser settings."],
  not_found: ["🔍", "Room Not Found", "Check the 6-digit code."],
  room_full: ["🚪", "Room Full", "Only one receiver can join this room."],
  failed: ["⚠️", "Connection Failed", "Please try again."],
  unsupported: ["🌐", "Browser Not Supported", "Please use a modern browser with WebRTC support (HTTPS required)."]
};
const fail = k => { const e = ERR[k] || ERR.failed; modal({ icon: e[0], title: e[1], text: e[2], btn: "OK" }); };
document.addEventListener("pointerdown", e => { // ripple
  const b = e.target.closest(".btn"); if (!b) return; const r = b.getBoundingClientRect(), s = document.createElement("span");
  s.className = "rip"; s.style.left = e.clientX - r.left + "px"; s.style.top = e.clientY - r.top + "px"; b.append(s); setTimeout(() => s.remove(), 700);
});
$$("[data-go]").forEach(b => b.onclick = () => show(b.dataset.go));
$$("[data-end]").forEach(b => b.onclick = () => endSession());

/* ---------- teardown ---------- */
function stopStream() { if (S.stream) S.stream.getTracks().forEach(t => t.stop()); S.stream = null; }
function closePC() { const p = S.pc; if (!p) return; S.pc = null; p.onconnectionstatechange = p.oniceconnectionstatechange = p.onicecandidate = p.ontrack = null; try { p.close(); } catch {} }
function stopViz() { cancelAnimationFrame(S.raf); if (S.ac) { try { S.ac.close(); } catch {} } S.ac = S.an = null; S.lvl = 0; $$(".stage").forEach(s => s.style.setProperty("--lvl", 0)); }
function teardown() {
  clearTimeout(S.rt); S.ended = true; closePC(); stopViz();
  if (S.ws) { const w = S.ws; S.ws = null; try { w.close(); } catch {} }
  stopStream(); const a = $("#audio"); a.srcObject = null;
  $("#pill").hidden = true; S.role = null; S.pending = [];
  $("#muteMic").classList.remove("off"); $("#muteMic span").textContent = "Mute Mic"; $("#sender").classList.remove("muted");
}
function endSession() { if (S.role === "sender") sendWS({ type: "end" }); teardown(); show("home"); closeModal(); }

/* ---------- mic + room creation ---------- */
$("#startMic").onclick = () => {
  if (!supported()) return fail("unsupported");
  modal({ icon: "🎤", title: "Microphone Access", text: "EchoLink needs microphone permission to transmit your voice live.", btn: "Allow Microphone", onbtn: allowMic, btn2: "Cancel" });
};
async function allowMic() {
  stopStream();
  try { S.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } }); }
  catch (e) { try { S.stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { return fail("mic"); } }
  modal({ icon: "🎤", title: "MICROPHONE READY", ready: true, btn: "Create Live Room", onbtn: createRoom, btn2: "Cancel", onbtn2: () => { stopStream(); closeModal(); } });
}
async function createRoom() {
  const b = $("#mBtn"); b.disabled = true; b.innerHTML = '<span class="spin"></span> Creating Room...';
  try { const r = await fetch("/api/create", { method: "POST" }); if (!r.ok) throw 0; S.code = (await r.json()).code; }
  catch { return fail("failed"); }
  S.role = "sender"; S.ended = false; S.retry = 0; closeModal();
  $("#code").innerHTML = [...S.code].map((d, i) => `<b style="--i:${i}">${d}</b>${i === 2 ? "<u></u>" : ""}`).join("");
  show("sender"); showCode(true); setStatus("waiting", "WAITING"); sTitle("WAITING FOR DEVICE");
  startViz(S.stream, $("#vizS")); openWS();
}
$("#copy").onclick = async () => {
  try { await navigator.clipboard.writeText(S.code); } catch { const t = document.createElement("textarea"); t.value = S.code; document.body.append(t); t.select(); try { document.execCommand("copy"); } catch {} t.remove(); }
  toast("Code copied", S.code);
};
$("#share").onclick = async () => {
  const text = `Join my EchoLink room\n\nRoom Code: ${S.code}\n\nOpen EchoLink and enter the code.`;
  if (navigator.share) { try { await navigator.share({ title: "EchoLink", text, url: location.origin }); } catch {} } else $("#copy").click();
};
$("#muteMic").onclick = e => {
  const t = S.stream && S.stream.getAudioTracks()[0]; if (!t) return; t.enabled = !t.enabled;
  e.currentTarget.classList.toggle("off", !t.enabled); e.currentTarget.querySelector("span").textContent = t.enabled ? "Mute Mic" : "Unmute Mic";
  $("#sender").classList.toggle("muted", !t.enabled);
};

/* ---------- join flow ---------- */
$("#joinBtn").onclick = () => { if (!supported()) return fail("unsupported"); $("#codeIn").value = ""; show("join"); setTimeout(() => $("#codeIn").focus(), 450); };
$("#codeIn").oninput = e => { const d = e.target.value.replace(/\D/g, "").slice(0, 6); e.target.value = d.length > 3 ? d.slice(0, 3) + " " + d.slice(3) : d; };
$("#codeIn").onkeydown = e => { if (e.key === "Enter") $("#connect").click(); };
$("#connect").onclick = () => {
  const c = $("#codeIn").value.replace(/\D/g, ""), i = $("#codeIn");
  if (c.length !== 6) { i.classList.remove("shake"); void i.offsetWidth; i.classList.add("shake"); return fail("not_found"); }
  S.code = c; S.role = "receiver"; S.ended = false; S.retry = 0;
  show("recv"); setStatus("connecting", "CONNECTING"); rTitle("CONNECTING..."); $("#tap").hidden = true; openWS();
};
$("#vol").oninput = e => { $("#audio").volume = +e.target.value; };
$("#muteSp").onclick = e => { const a = $("#audio"); a.muted = !a.muted; e.currentTarget.textContent = a.muted ? "🔇" : "🔊"; };
$("#fs").onclick = () => {
  const d = document, el = d.documentElement;
  if (d.fullscreenElement || d.webkitFullscreenElement) (d.exitFullscreen || d.webkitExitFullscreen).call(d);
  else { const f = el.requestFullscreen || el.webkitRequestFullscreen; if (f) f.call(el); else toast("Fullscreen not supported"); }
};
$("#tap").onclick = () => { if (S.ac) S.ac.resume().catch(() => {}); $("#audio").play().then(() => { $("#tap").hidden = true; }).catch(() => {}); };

/* ---------- signaling (WebSocket) ---------- */
const sendWS = o => { if (S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify(o)); };
function openWS() {
  const u = (location.protocol === "https:" ? "wss://" : "ws://") + location.host + `/ws?code=${S.code}&role=${S.role}&id=${S.id}`;
  let ws; try { ws = new WebSocket(u); } catch { return fail("failed"); }
  S.ws = ws;
  ws.onopen = () => { S.retry = 0; };
  ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch { return; } onMsg(m); };
  ws.onclose = () => { if (S.ws !== ws || S.ended) return; retryWS(); };
}
function retryWS() {
  if (S.retry === 0) { S.lost = 1; setStatus("connecting", "RECONNECTING"); toast("Connection lost", "Trying to reconnect..."); }
  if (S.retry > 8) { teardown(); show("home"); return fail("failed"); }
  const d = Math.min(1000 * 2 ** S.retry++, 8000);
  setTimeout(() => { if (!S.ended && S.role) openWS(); }, d);
}
async function onMsg(m) {
  switch (m.type) {
    case "error": teardown(); show("home"); fail(m.code); break;
    case "joined":
      if (S.lost) { S.lost = 0; toast("Connection restored"); }
      if (S.role === "sender") { if (m.peer) startOffer(); else { closePC(); setStatus("waiting", "WAITING"); } }
      else setStatus("connecting", m.peer ? "CONNECTING" : "WAITING FOR SENDER");
      break;
    case "peer-joined": if (S.role === "sender") startOffer(); break;
    case "peer-left":
      closePC();
      if (S.role === "sender") { setStatus("waiting", "WAITING"); sTitle("WAITING FOR DEVICE"); showCode(true); }
      else { setStatus("disconnected", "DISCONNECTED"); rTitle("SENDER DISCONNECTED"); }
      break;
    case "ended": teardown(); show("home"); modal({ icon: "👋", title: "Session Ended", text: "The sender ended this session.", btn: "OK" }); break;
    case "offer": if (S.role === "receiver") await onOffer(m); break;
    case "answer": if (S.pc) { try { await S.pc.setRemoteDescription(m.sdp); flush(); } catch {} } break;
    case "candidate": addCand(m.candidate); break;
  }
}

/* ---------- WebRTC ---------- */
const tune = sdp => sdp.replace(/(a=fmtp:\d+ [^\r\n]*minptime=10[^\r\n]*)/g, (l) => /maxaveragebitrate/.test(l) ? l : l + ";stereo=0;sprop-stereo=0;maxaveragebitrate=32000");
async function addCand(c) { if (!S.pc || !c) return; if (!S.pc.remoteDescription) { S.pending.push(c); return; } try { await S.pc.addIceCandidate(c); } catch {} }
async function flush() { for (const c of S.pending.splice(0)) { try { await S.pc.addIceCandidate(c); } catch {} } }
function makePC() {
  closePC(); const pc = new RTCPeerConnection(ICE); S.pc = pc; S.pending = [];
  pc.onicecandidate = e => { if (e.candidate) sendWS({ type: "candidate", candidate: e.candidate }); };
  pc.onconnectionstatechange = () => { if (S.pc === pc) onPCState(pc.connectionState); };
  pc.oniceconnectionstatechange = () => { if (S.pc === pc && pc.iceConnectionState === "failed" && S.role === "sender") restartIce(); };
  return pc;
}
async function startOffer() {
  if (!S.stream) return;
  try {
    const pc = makePC(); setStatus("connecting", "CONNECTING"); sTitle("CONNECTING...");
    S.stream.getAudioTracks().forEach(t => pc.addTrack(t, S.stream));
    pc.getSenders().forEach(s => { try { const p = s.getParameters(); if (!p.encodings || !p.encodings.length) p.encodings = [{}]; p.encodings[0].maxBitrate = 32000; s.setParameters(p).catch(() => {}); } catch {} });
    const o = await pc.createOffer(); o.sdp = tune(o.sdp);
    await pc.setLocalDescription(o);
    sendWS({ type: "offer", sdp: pc.localDescription, fresh: true });
  } catch { fail("failed"); }
}
async function restartIce() {
  if (!S.pc || S.role !== "sender") return;
  if (++S.rs > 2) { S.rs = 0; return startOffer(); }
  try { const o = await S.pc.createOffer({ iceRestart: true }); o.sdp = tune(o.sdp); await S.pc.setLocalDescription(o); sendWS({ type: "offer", sdp: S.pc.localDescription, fresh: false }); } catch {}
}
async function onOffer(m) {
  try {
    let pc = S.pc;
    if (m.fresh || !pc) { pc = makePC(); pc.ontrack = onTrack; setStatus("connecting", "CONNECTING"); }
    await pc.setRemoteDescription(m.sdp); flush();
    const a = await pc.createAnswer(); await pc.setLocalDescription(a);
    sendWS({ type: "answer", sdp: pc.localDescription });
  } catch { fail("failed"); }
}
function onTrack(e) {
  const st = e.streams[0] || new MediaStream([e.track]), a = $("#audio");
  a.srcObject = st; a.volume = +$("#vol").value;
  a.play().then(() => { $("#tap").hidden = true; }).catch(() => { $("#tap").hidden = false; });
  startViz(st, $("#vizR"));
}
function onPCState(st) {
  if (st === "connected") {
    clearTimeout(S.rt); S.rs = 0; setStatus("connected", "CONNECTED");
    if (S.role === "sender") { sTitle("LIVE MICROPHONE"); showCode(false); }
    else { rTitle("CONNECTED TO ECHOLINK"); setTimeout(() => { if (S.pc && S.pc.connectionState === "connected") rTitle("LIVE AUDIO"); }, 1400); }
    if (S.lostPC) { S.lostPC = 0; toast("Connection restored"); }
  } else if (st === "connecting") setStatus("connecting", "CONNECTING");
  else if (st === "disconnected") {
    S.lostPC = 1; setStatus("connecting", "RECONNECTING"); toast("Connection lost", "Trying to reconnect...");
    clearTimeout(S.rt); S.rt = setTimeout(() => restartIce(), 2500);
  } else if (st === "failed") { S.lostPC = 1; setStatus("disconnected", "DISCONNECTED"); restartIce(); }
}

/* ---------- real audio visualizer (AnalyserNode) ---------- */
function startViz(stream, cv) {
  stopViz();
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC || !stream) return;
  let an; try { S.ac = new AC(); const src = S.ac.createMediaStreamSource(stream); an = S.ac.createAnalyser(); an.fftSize = 256; an.smoothingTimeConstant = .82; src.connect(an); S.an = an; S.ac.resume(); } catch { return; }
  const x = cv.getContext("2d"), f = new Uint8Array(an.frequencyBinCount), dpr = Math.min(devicePixelRatio || 1, 2), stage = cv.parentElement;
  const draw = () => {
    S.raf = requestAnimationFrame(draw);
    const W = cv.clientWidth * dpr, H = cv.clientHeight * dpr; if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    an.getByteFrequencyData(f); let sum = 0; for (let i = 0; i < f.length; i++) sum += f[i];
    S.lvl += (Math.min(1, sum / f.length / 90) - S.lvl) * .25;
    const cx = W / 2, cy = H / 2, R = Math.min(W, H) * .2; x.clearRect(0, 0, W, H);
    for (let i = 0; i < 3; i++) { x.beginPath(); x.arc(cx, cy, R * (1.2 + i * .25) + S.lvl * R * (.7 - i * .2), 0, 6.283); x.strokeStyle = `rgba(120,190,255,${Math.max(0, .3 - i * .08 + S.lvl * .5)})`; x.lineWidth = 2 * dpr; x.stroke(); }
    const n = 56; x.lineCap = "round"; x.lineWidth = 3 * dpr;
    for (let i = 0; i < n; i++) {
      const v = f[2 + (i % 48)] / 255, a = i / n * 6.283 - 1.57, r1 = R * 1.12, r2 = r1 + 3 * dpr + v * R * 1.1;
      x.strokeStyle = `hsla(${190 + i * 2.5},100%,70%,${.45 + v * .55})`; x.beginPath(); x.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); x.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2); x.stroke();
    }
    stage.style.setProperty("--lvl", S.lvl.toFixed(3));
  };
  draw();
}
if (!supported()) setTimeout(() => fail("unsupported"), 3200);
