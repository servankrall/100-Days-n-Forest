/* ============================================================
   src/net.js — 5 kişiye kadar co-op + sesli sohbet (BETA)
   PeerJS'in ÜCRETSİZ bulut sinyalizasyonunu kullanır (kendi sunucu yok).
   - Arkadaş ID'si = PeerJS peer kimliği (örn. ORM-PLAYER1234).
   - Veri kanalı: oyuncu konum/durum senkronu (~10 Hz) -> uzak avatarlar.
   - Sesli sohbet: WebRTC media (bas-konuş ile mikrofon track'i açılır/kapanır).
   Tek başına oyunu ETKİLEMEZ; yalnızca host/join ile devreye girer.
   Not: Bu ortamda gerçek eşlerle test EDİLEMEDİ -> beta. Katı NAT'larda
   bağlantı için ileride TURN sunucusu gerekebilir.
   ============================================================ */
let PeerCtor = null;

// NAT/güvenlik duvarı aşımı: STUN + ücretsiz TURN (çoğu ağda bağlantıyı sağlar).
const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:global.stun.twilio.com:3478" },
  { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
  { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
  { urls: "turn:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" },
];

export const net = {
  peer: null, id: null, conns: {}, calls: {}, localStream: null, micOn: false,
  online: false, host: false,
  onJoin: null, onLeave: null, onState: null, onChat: null, onStatus: null, onData: null,

  async _load() {
    if (PeerCtor) return true;
    try {
      const m = await import("peerjs");
      PeerCtor = m.Peer || (m.default && (m.default.Peer || m.default));
      return !!PeerCtor;
    } catch (e) { console.warn("[net] peerjs yüklenemedi:", e); return false; }
  },

  // Bir oda kur (host). myId = oyuncunun Friend ID'si. open olunca id döner.
  async start(myId) {
    if (!(await this._load())) throw new Error("Çok oyunculu modül bu sürümde yüklenemedi.");
    if (this.peer) this.disconnect();
    return new Promise((resolve, reject) => {
      let done = false;
      const p = new PeerCtor(myId, { debug: 1, config: { iceServers: ICE_SERVERS } });
      this.peer = p;
      const to = setTimeout(() => { if (!done) { done = true; reject(new Error("Sinyal sunucusuna bağlanılamadı (zaman aşımı).")); } }, 12000);
      p.on("open", (id) => { if (done) return; done = true; clearTimeout(to); this.id = id; this.online = true; this._status("Bağlı: " + id); resolve(id); });
      p.on("connection", (c) => this._setupConn(c));
      p.on("call", (call) => {
        try { call.answer(this.localStream || undefined); } catch (e) {}
        call.on("stream", (rs) => this._playRemote(call.peer, rs));
        this.calls[call.peer] = call;
      });
      p.on("error", (err) => { this._status("Hata: " + (err && err.type || err)); if (!done) { done = true; clearTimeout(to); reject(err); } });
      p.on("disconnected", () => { this._status("Sinyalden koptu, yeniden bağlanılıyor..."); try { p.reconnect(); } catch (e) {} });
    });
  },

  // Bir arkadaşın odasına katıl (onun Friend ID'siyle).
  joinHost(hostId, meta) {
    if (!this.peer) return;
    this.host = false;
    const c = this.peer.connect(hostId, { reliable: false, metadata: meta || {} });
    this._setupConn(c);
  },

  _setupConn(c) {
    c.on("open", () => {
      if (Object.keys(this.conns).length >= 4) { try { c.close(); } catch (e) {} return; } // maks 5 (sen + 4)
      this.conns[c.peer] = c;
      if (this.onJoin) this.onJoin(c.peer, c.metadata || {});
      if (this.micOn) this._callPeer(c.peer);
    });
    c.on("data", (d) => {
      if (!d) return;
      if (d.t === "state" && this.onState) this.onState(c.peer, d);
      else if (d.t === "chat" && this.onChat) this.onChat(c.peer, d);
      else if (this.onData) this.onData(c.peer, d);   // down / revive / revived vb. özel mesajlar
    });
    c.on("close", () => { delete this.conns[c.peer]; if (this.onLeave) this.onLeave(c.peer); });
    c.on("error", () => {});
  },

  broadcast(obj) { for (const id in this.conns) { try { this.conns[id].send(obj); } catch (e) {} } },
  peerCount() { return Object.keys(this.conns).length; },
  peerIds() { return Object.keys(this.conns); },

  // --- Sesli sohbet ---
  async enableMic() {
    if (this.localStream) return this.localStream;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error("mic yok");
    this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.setMic(false); // varsayılan kapalı (bas-konuş)
    for (const id in this.conns) this._callPeer(id);
    return this.localStream;
  },
  setMic(on) { this.micOn = on; if (this.localStream) this.localStream.getAudioTracks().forEach((t) => { t.enabled = on; }); },
  _callPeer(id) {
    if (!this.peer || !this.localStream || this.calls[id]) return;
    try { const call = this.peer.call(id, this.localStream); if (call) { call.on("stream", (rs) => this._playRemote(id, rs)); this.calls[id] = call; } } catch (e) {}
  },
  _playRemote(id, stream) {
    let a = document.getElementById("aud-" + id);
    if (!a) { a = document.createElement("audio"); a.id = "aud-" + id; a.autoplay = true; a.playsInline = true; document.body.appendChild(a); }
    a.srcObject = stream;
  },

  _status(s) { if (this.onStatus) this.onStatus(s); },
  disconnect() {
    for (const id in this.calls) { try { this.calls[id].close(); } catch (e) {} }
    for (const id in this.conns) { try { this.conns[id].close(); } catch (e) {} }
    if (this.peer) { try { this.peer.destroy(); } catch (e) {} }
    document.querySelectorAll("audio[id^='aud-']").forEach((a) => a.remove());
    this.peer = null; this.conns = {}; this.calls = {}; this.online = false; this.host = false;
  },
};
