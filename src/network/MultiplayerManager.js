/**
 * DreamScape MultiplayerManager
 *
 * Complete rewrite with proper state machine architecture.
 *
 * Architecture:
 * - Socket.IO for signaling, room management, and fallback
 * - PeerJS for low-latency P2P position updates
 * - Automatic fallback to Socket.IO when P2P fails
 */

import { io } from "socket.io-client";
import { RemotePlayer } from "../entities/RemotePlayer.js";

export class MultiplayerManager {
  constructor(game) {
    this.game = game;

    // ═══════════════════════════════════════════════════════════════
    // CONNECTION STATE
    // ═══════════════════════════════════════════════════════════════

    this.socket = null;
    this.peer = null;
    this.connections = new Map(); // socketId -> DataConnection

    // State machine
    this.state = "disconnected"; // disconnected | connecting | lobby | playing
    this.p2pState = "idle"; // idle | initializing | connecting | ready | failed

    // ═══════════════════════════════════════════════════════════════
    // ROOM STATE
    // ═══════════════════════════════════════════════════════════════

    this.roomCode = null;
    this.localPlayerId = null;
    this.isHost = false;
    this.mazeSeed = null;
    this.gameStarted = false;

    // Player data
    this.players = new Map(); // socketId -> PlayerData
    this.playerName = "Player" + Math.floor(Math.random() * 9999);
    this.playerGender = "male";

    // ═══════════════════════════════════════════════════════════════
    // CONFIGURATION
    // ═══════════════════════════════════════════════════════════════

    this.config = {
      serverUrl: import.meta.env.VITE_SERVER_URL || "http://localhost:5000",
      positionUpdateHz: 30,
      fallbackUpdateHz: 10,
      p2pTimeoutMs: 5000,
      maxP2PRetries: 3,
    };

    // Update timing
    this.lastPositionSend = 0;
    this.positionSendInterval = 1000 / this.config.positionUpdateHz;

    // ═══════════════════════════════════════════════════════════════
    // CALLBACKS
    // ═══════════════════════════════════════════════════════════════

    this.onPlayerJoined = null;
    this.onPlayerLeft = null;
    this.onGameEvent = null;

    // ═══════════════════════════════════════════════════════════════
    // INITIALIZE
    // ═══════════════════════════════════════════════════════════════

    // Don't auto-connect - wait for explicit connection request
    // this.connect();
    this.offlineMode = true; // Start in offline mode
  }

  // ═════════════════════════════════════════════════════════════════
  // SOCKET.IO CONNECTION
  // ═════════════════════════════════════════════════════════════════

  connect() {
    if (this.socket && this.socket.connected) return;

    console.log("[MP] Connecting to server:", this.config.serverUrl);
    this.state = "connecting";
    this.offlineMode = false;

    this.socket = io(this.config.serverUrl, {
      reconnectionDelayMax: 10000,
      reconnectionAttempts: 3, // Limit reconnection attempts
      transports: ["websocket", "polling"],
    });

    this._setupSocketHandlers();
  }

  _setupSocketHandlers() {
    // ─────────────────────────────────────────────────────────────
    // CONNECTION EVENTS
    // ─────────────────────────────────────────────────────────────

    this.socket.on("connect", () => {
      console.log("[MP] Connected with ID:", this.socket.id);
      this.localPlayerId = this.socket.id;
      this.state = "lobby";
    });

    this.socket.on("disconnect", () => {
      console.warn("[MP] Disconnected from server");
      this.state = "disconnected";
    });

    this.socket.on("error", (err) => {
      console.error("[MP] Socket error:", err);
      if (this.onGameEvent) this.onGameEvent("error", err.message);
    });

    // ─────────────────────────────────────────────────────────────
    // ROOM EVENTS
    // ─────────────────────────────────────────────────────────────

    this.socket.on("room-created", (data) => {
      console.log("[MP] Room created:", data.roomCode);
      this.roomCode = data.roomCode;
      this.isHost = true;
      this._syncPlayers(data.players);
      if (this.onGameEvent)
        this.onGameEvent("roomCreated", { roomCode: data.roomCode });
    });

    this.socket.on("joined-room", (data) => {
      console.log("[MP] Joined room:", data.roomCode);
      this.roomCode = data.roomCode;
      this.isHost = false;
      this.mazeSeed = data.mazeSeed;
      this._syncPlayers(data.players);
      if (this.onGameEvent)
        this.onGameEvent("joinedRoom", { roomCode: data.roomCode });
    });

    this.socket.on("player-joined", (data) => {
      console.log("[MP] Player joined:", data.player.name);
      this._syncPlayers(data.players);
      if (this.onPlayerJoined) this.onPlayerJoined(data.player);
    });

    this.socket.on("player-left", (data) => {
      console.log("[MP] Player left:", data.playerName);
      this.players.delete(data.playerId);
      this.connections.delete(data.playerId);
      if (this.onPlayerLeft) this.onPlayerLeft(data.playerId);
    });

    this.socket.on("player-ready-changed", (data) => {
      this._syncPlayers(data.players);
    });

    this.socket.on("room-destroyed", (data) => {
      console.warn("[MP] Room destroyed:", data.reason);
      this._cleanup();
      if (this.onGameEvent) this.onGameEvent("roomDestroyed", data);
    });

    // ─────────────────────────────────────────────────────────────
    // GAME EVENTS
    // ─────────────────────────────────────────────────────────────

    this.socket.on("game-started", async (data) => {
      console.log("[MP] Game started! Maze seed:", data.mazeSeed);
      this.mazeSeed = data.mazeSeed;
      this.gameStarted = true;
      this.state = "playing";
      this._syncPlayers(data.players);

      // Initialize P2P mesh
      await this._initP2P();

      if (this.onGameEvent)
        this.onGameEvent("gameStart", { mazeSeed: this.mazeSeed });
    });

    this.socket.on("stage-changed", (data) => {
      console.log("[MP] Stage changed to:", data.stage);
      if (this.onGameEvent)
        this.onGameEvent("stageStart", { stage: data.stage });
    });

    // ─────────────────────────────────────────────────────────────
    // P2P SIGNALING
    // ─────────────────────────────────────────────────────────────

    this.socket.on("peer-id-shared", (data) => {
      console.log(`[P2P] Peer available: ${data.playerName} -> ${data.peerId}`);

      const player = this.players.get(data.socketId);
      if (player) {
        player.peerId = data.peerId;
        this._connectToPeer(data.peerId, data.socketId);
      }
    });

    // ─────────────────────────────────────────────────────────────
    // POSITION SYNC (Fallback)
    // ─────────────────────────────────────────────────────────────

    this.socket.on("player-state", (data) => {
      // Only use if P2P is not working for this player
      if (
        !this.connections.has(data.playerId) ||
        !this.connections.get(data.playerId)?.open
      ) {
        this._updatePlayerState(data.playerId, data);
      }
    });

    this.socket.on("full-state", (data) => {
      console.log("[MP] Received full state");
      this.mazeSeed = data.mazeSeed;
      this._syncPlayers(data.players);
    });

    this.socket.on("player-spawn-confirmed", (data) => {
      const player = this.players.get(data.playerId);
      if (player) player.spawned = true;
    });
  }

  // ═════════════════════════════════════════════════════════════════
  // P2P (PeerJS) CONNECTION
  // ═════════════════════════════════════════════════════════════════

  async _initP2P() {
    this.p2pState = "initializing";

    return new Promise((resolve) => {
      // TURN/STUN servers for NAT traversal
      const iceServers = [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:openrelay.metered.ca:80" },
        {
          urls: "turn:openrelay.metered.ca:80",
          username: "openrelayproject",
          credential: "openrelayproject",
        },
        {
          urls: "turn:openrelay.metered.ca:443",
          username: "openrelayproject",
          credential: "openrelayproject",
        },
      ];

      this.peer = new Peer(undefined, {
        config: { iceServers },
        debug: 0,
      });

      this.peer.on("open", (id) => {
        console.log("[P2P] Initialized with ID:", id);
        this.p2pState = "connecting";

        // Share our peer ID with the room
        this.socket.emit("share-peer-id", {
          roomCode: this.roomCode,
          peerId: id,
        });

        resolve(id);
      });

      this.peer.on("connection", (conn) => {
        this._handleIncomingConnection(conn);
      });

      this.peer.on("error", (err) => {
        console.error("[P2P] Error:", err);
        if (this.p2pState !== "ready") {
          this.p2pState = "failed";
        }
      });

      // Timeout fallback
      setTimeout(() => {
        if (this.p2pState === "initializing") {
          console.warn("[P2P] Initialization timeout");
          this.p2pState = "failed";
          resolve(null);
        }
      }, this.config.p2pTimeoutMs);
    });
  }

  _connectToPeer(peerId, socketId, attempt = 0) {
    if (this.connections.has(socketId)) return;
    if (attempt >= this.config.maxP2PRetries) {
      console.warn(
        `[P2P] Failed to connect to ${socketId} after ${attempt} attempts`
      );
      return;
    }

    console.log(`[P2P] Connecting to ${peerId} (attempt ${attempt + 1})`);

    const conn = this.peer.connect(peerId, {
      reliable: true,
      serialization: "json",
    });

    const timeout = setTimeout(() => {
      if (!conn.open) {
        console.warn(`[P2P] Connection timeout to ${peerId}`);
        conn.close();
        this._connectToPeer(peerId, socketId, attempt + 1);
      }
    }, this.config.p2pTimeoutMs);

    conn.on("open", () => {
      clearTimeout(timeout);
      console.log(`[P2P] Connected to ${socketId}`);
      this._registerConnection(conn, socketId);
    });

    conn.on("error", (err) => {
      clearTimeout(timeout);
      console.error(`[P2P] Connection error:`, err);
    });
  }

  _handleIncomingConnection(conn) {
    console.log("[P2P] Incoming connection from:", conn.peer);

    conn.on("open", () => {
      console.log("[P2P] Incoming connection opened");
      // Send handshake to identify ourselves
      conn.send(this._createHandshake());
    });

    // Wait for handshake to identify the remote player
    const handshakeHandler = (data) => {
      if (data.type === "handshake") {
        console.log(
          `[P2P] Received handshake from ${data.name} (${data.socketId})`
        );
        this._registerConnection(conn, data.socketId);
        this._updatePlayerFromHandshake(data);
        // Remove this one-time handler and add permanent data handler
        conn.off("data", handshakeHandler);
        conn.on("data", (d) => this._handleP2PData(data.socketId, d));
      }
    };

    conn.on("data", handshakeHandler);
  }

  _registerConnection(conn, socketId) {
    this.connections.set(socketId, conn);
    console.log(`[P2P] Registered connection. Total: ${this.connections.size}`);

    // Send our handshake
    conn.send(this._createHandshake());

    // Setup permanent data handler
    conn.on("data", (data) => this._handleP2PData(socketId, data));

    conn.on("close", () => {
      console.log(`[P2P] Connection closed: ${socketId}`);
      this.connections.delete(socketId);
    });

    // Check if all connections are ready
    if (this.connections.size === this.players.size) {
      this.p2pState = "ready";
      console.log("[P2P] All connections established!");
    }
  }

  _createHandshake() {
    const pos = this.game?.player?.body?.translation?.() ||
      this.game?.player?.getPosition?.() || { x: 0, y: 0, z: 0 };
    return {
      type: "handshake",
      socketId: this.localPlayerId,
      name: this.playerName,
      gender: this.playerGender,
      position: { x: pos.x, y: pos.y, z: pos.z },
      rotation: this.game?.player?.mesh?.rotation?.y || 0,
      animState: this.game?.player?.currentAnimState || "idle",
    };
  }

  _handleP2PData(senderId, data) {
    if (data.type === "handshake") {
      this._updatePlayerFromHandshake(data);
      return;
    }

    if (data.type === "state") {
      this._updatePlayerState(senderId, data);
    }
  }

  _updatePlayerFromHandshake(data) {
    let player = this.players.get(data.socketId);
    if (!player) {
      player = {
        id: data.socketId,
        name: data.name,
        gender: data.gender,
        isHost: false,
        position: data.position,
        rotation: data.rotation,
        animState: data.animState,
      };
      this.players.set(data.socketId, player);
    } else {
      player.position = data.position;
      player.rotation = data.rotation;
      player.animState = data.animState;
    }
  }

  _updatePlayerState(playerId, data) {
    const player = this.players.get(playerId);
    if (player) {
      player.position = data.position;
      player.rotation = data.rotation;
      player.animState = data.animState;
      player.lastUpdate = Date.now();

      // Debug: Log received position periodically
      if (Math.random() < 0.05) {
        console.log(
          `[MP] Received position from ${playerId}: (${data.position?.x?.toFixed(
            1
          )}, ${data.position?.z?.toFixed(1)})`
        );
      }
    } else {
      console.warn(`[MP] Received state for unknown player: ${playerId}`);
    }
  }

  // ═════════════════════════════════════════════════════════════════
  // STATE SYNC
  // ═════════════════════════════════════════════════════════════════

  _syncPlayers(playersArray) {
    const newPlayers = new Map();
    for (const p of playersArray) {
      if (p.id === this.localPlayerId) continue;

      const existing = this.players.get(p.id);
      newPlayers.set(p.id, {
        ...existing,
        ...p,
        lastUpdate: existing?.lastUpdate || Date.now(),
      });
    }
    this.players = newPlayers;
  }

  _cleanup() {
    this.roomCode = null;
    this.isHost = false;
    this.gameStarted = false;
    this.state = "lobby";
    this.p2pState = "idle";
    this.players.clear();
    this.connections.forEach((conn) => conn.close());
    this.connections.clear();
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
  }

  // ═════════════════════════════════════════════════════════════════
  // PUBLIC API - Room Management
  // ═════════════════════════════════════════════════════════════════

  async createRoom() {
    this._loadProfile();
    this.socket.emit("create-room", {
      playerName: this.playerName,
      playerGender: this.playerGender,
    });

    return new Promise((resolve) => {
      this.socket.once("room-created", (data) => resolve(data.roomCode));
    });
  }

  async joinRoom(roomCode) {
    this._loadProfile();
    const code = roomCode.trim().toUpperCase();

    this.socket.emit("join-room", {
      roomCode: code,
      playerName: this.playerName,
      playerGender: this.playerGender,
    });

    return new Promise((resolve, reject) => {
      this.socket.once("joined-room", (data) => resolve(data.roomCode));
      this.socket.once("error", (err) => reject(new Error(err.message)));
    });
  }

  startGame() {
    if (!this.isHost) return;

    if (!this.mazeSeed) {
      this.mazeSeed = Math.floor(Math.random() * 100000);
    }

    this.socket.emit("start-game", {
      roomCode: this.roomCode,
      mazeSeed: this.mazeSeed,
    });
  }

  sendGameEvent(event, data) {
    if (event === "playerReady") {
      this.socket.emit("player-ready", {
        roomCode: this.roomCode,
        isReady: data.ready,
      });
    } else if (event === "stageStart" && this.isHost) {
      this.socket.emit("stage-change", {
        roomCode: this.roomCode,
        stage: data.stage,
      });
    }
  }

  requestFullState() {
    this.socket.emit("request-state", { roomCode: this.roomCode });
  }

  // ═════════════════════════════════════════════════════════════════
  // UPDATE LOOP
  // ═════════════════════════════════════════════════════════════════

  update(time) {
    if (!this.gameStarted) return;

    const now = performance.now();
    if (now - this.lastPositionSend < this.positionSendInterval) return;
    this.lastPositionSend = now;

    this._sendLocalState();
  }

  _sendLocalState() {
    if (!this.game?.player?.body) {
      // Debug: Log why we can't send
      if (!this.game) console.warn("[MP] No game reference");
      else if (!this.game.player) console.warn("[MP] No player in game");
      else if (!this.game.player.body) console.warn("[MP] No player body");
      return;
    }

    // Use Rapier's translation() for position
    const pos = this.game.player.body.translation();
    const state = {
      type: "state",
      position: { x: pos.x, y: pos.y, z: pos.z },
      rotation: this.game.player.mesh?.rotation?.y || 0,
      animState: this.game.player.currentAnimState || "idle",
    };

    // Debug: Log position being sent periodically
    if (Math.random() < 0.05) {
      // 5% of updates
      console.log(
        `[MP] Sending position: (${pos.x.toFixed(1)}, ${pos.z.toFixed(
          1
        )}), connections: ${this.connections.size}`
      );
    }

    // Send via P2P if available
    let sentViaP2P = false;
    this.connections.forEach((conn) => {
      if (conn.open) {
        conn.send(state);
        sentViaP2P = true;
      }
    });

    // Fallback to Socket.IO if P2P not working
    if (!sentViaP2P && this.players.size > 0) {
      console.log("[MP] Using Socket.IO fallback for position");
      this.socket.emit("sync-position", {
        roomCode: this.roomCode,
        position: state.position,
        rotation: state.rotation,
        animState: state.animState,
      });
    }
  }

  // ═════════════════════════════════════════════════════════════════
  // GETTERS
  // ═════════════════════════════════════════════════════════════════

  getRemotePlayers() {
    return Array.from(this.players.values());
  }

  getPlayerCount() {
    return this.players.size + 1; // +1 for local player
  }

  isConnected() {
    return this.state !== "disconnected";
  }

  isP2PReady() {
    return this.p2pState === "ready";
  }

  // ═════════════════════════════════════════════════════════════════
  // HELPERS
  // ═════════════════════════════════════════════════════════════════

  _loadProfile() {
    if (window.menuManager) {
      const profile = window.menuManager.getPlayerProfile();
      this.playerName = profile.playerName || this.playerName;
      this.playerGender = profile.characterGender || "male";
    }
  }
}
