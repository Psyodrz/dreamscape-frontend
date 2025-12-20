import { io } from 'socket.io-client';

/**
 * MultiplayerManager - Hybrid Architecture
 * - Lobby Signaling: Socket.IO (Centralized, Reliable)
 * - Gameplay Data: PeerJS (P2P, Low Latency)
 */
export class MultiplayerManager {
  constructor(game) {
    this.game = game;
    this.socket = null;
    this.peer = null;
    
    // Connections
    this.connections = new Map(); // peerId -> DataConnection
    this.players = new Map(); // id -> playerData
    
    // Room state
    this.roomCode = null;
    this.localPlayerId = null; // Socket ID
    this.isHost = false;
    this.mazeSeed = null;
    this.gameStarted = false;
    
    // Configuration
    // For local dev: 'http://<YOUR_PC_IP>:3000'
    // For production: 'https://your-render-app.onrender.com'
    this.SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3000';
    
    // Callbacks
    this.onPlayerJoined = null;
    this.onPlayerLeft = null;
    this.onGameEvent = null;
    
    // Local Player Init
    this.playerName = 'Player' + Math.floor(Math.random() * 9999);
    
    // Connect to Lobby Server immediately on init
    this.connectToLobby();
  }
  
  /**
   * Connect to the centralized Lobby Server (Socket.IO)
   */
  connectToLobby() {
    console.log('MultiplayerManager: Connecting to Lobby Server at', this.SERVER_URL);
    
    this.socket = io(this.SERVER_URL, {
      reconnectionDelayMax: 10000,
      transports: ['websocket', 'polling'] // Force robust transports
    });
    
    this.socket.on('connect', () => {
      console.log('MultiplayerManager: Connected to Lobby Server with ID:', this.socket.id);
      this.localPlayerId = this.socket.id;
    });
    
    this.socket.on('disconnect', () => {
      console.warn('MultiplayerManager: Disconnected from Lobby Server');
    });
    
    this.socket.on('error', (err) => {
      console.error('MultiplayerManager: Socket Error:', err);
      if (this.onGameEvent) this.onGameEvent('error', err.message);
    });

    // --- LOBBY EVENTS ---
    
    this.socket.on('room-created', (data) => {
      console.log('Room Created:', data);
      this.roomCode = data.roomCode;
      this.isHost = true;
      this._updatePlayerList(data.players);
    });
    
    this.socket.on('joined-room', (data) => {
      console.log('Joined Room:', data);
      this.roomCode = data.roomCode;
      this.isHost = false;
      this.mazeSeed = data.mazeSeed;
      this._updatePlayerList(data.players);
    });
    
    this.socket.on('player-joined', (newPlayer) => {
      console.log('Player Joined:', newPlayer);
      this._addPlayer(newPlayer);
      if (this.onPlayerJoined) this.onPlayerJoined(newPlayer.id, newPlayer.name);
    });
    
    this.socket.on('player-left', ({ playerId }) => {
      console.log('Player Left:', playerId);
      this.players.delete(playerId);
      this.connections.delete(playerId); // Close P2P if active
      if (this.onPlayerLeft) this.onPlayerLeft(playerId);
      this._broadcastPlayerListUI(); // Update UI
    });
    
    this.socket.on('player-update', (player) => {
      this._addPlayer(player); // Update state (e.g. ready status)
    });
    
    this.socket.on('new-host', ({ playerId }) => {
      if (this.localPlayerId === playerId) {
        this.isHost = true;
        console.log('You are now the Host');
        // Notify UI
        if (this.onGameEvent) this.onGameEvent('host-migration', true);
      }
      // Update player list to show new host crown
      const p = this.players.get(playerId);
      if (p) {
        p.isHost = true;
        this._broadcastPlayerListUI();
      }
    });

    // --- GAME START & P2P HANDSHAKE ---
    
    this.socket.on('game-started', async (data) => {
      console.log('Game Started! Initializing P2P Mesh...');
      this.gameStarted = true;
      this.mazeSeed = data.mazeSeed;
      
      // Notify Game/UI to switch scenes
      if (this.onGameEvent) this.onGameEvent('gameStart', { mazeSeed: this.mazeSeed });
      
      
      // Phase 3: P2P Mesh initialization
      console.log('Phase 3: Game Started. Initializing P2P Mesh...');
      
      // Initialize PeerJS for gameplay data
      await this.initPeerJS();
      
      // Share our Peer ID with the room via Server
      this.socket.emit('share-peer-id', { 
        roomCode: this.roomCode, 
        peerId: this.peer.id 
      });
    });
    
    this.socket.on('peer-id-shared', ({ socketId, peerId }) => {
      // Another player is ready for P2P
      console.log(`Peer Available: ${socketId} -> ${peerId}`);
      
      // Store their Peer ID mapping
      const player = this.players.get(socketId);
      if (player) {
        player.peerId = peerId;
        
        // Connect to them! (Mesh topology: everyone connects to everyone)
        // To avoid duplicate connections, generally let the one with higher ID connect, or just connect both ways and PeerJS handles it.
        // Simple approach: Just connect.
        if (socketId !== this.localPlayerId) {
          this._connectToPeer(peerId, socketId);
        }
      }
    });
  }
  
  /**
   * Initialize PeerJS (WebRTC)
   * Only called after Game Start
   */
  async initPeerJS() {
    return new Promise((resolve) => {
      // Use free TURN servers (OpenRelay) for mobile data support
      const iceServers = [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:openrelay.metered.ca:80' },
        { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
        { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
        { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }
      ];

      this.peer = new Peer(undefined, {
        config: {
          iceServers: iceServers,
          iceTransportPolicy: 'all'
        },
        debug: 1
      });
      
      this.peer.on('open', (id) => {
        console.log('PeerJS initialized with ID:', id);
        resolve(id);
      });
      
      this.peer.on('connection', (conn) => {
        this._handleIncomingP2P(conn);
      });
      
      this.peer.on('error', (err) => {
        console.error('PeerJS Error:', err);
      });
    });
  }
  
  _connectToPeer(remotePeerId, remoteSocketId) {
    if (this.connections.has(remoteSocketId)) return; // Already connected
    
    console.log(`Connecting P2P to ${remotePeerId}...`);
    // Phase 3 Requirement: Reliable Data Channels
    const conn = this.peer.connect(remotePeerId, { 
      reliable: true,
      serialization: 'json'
    });
    
    this._setupP2PConnection(conn, remoteSocketId);
  }
  
  _handleIncomingP2P(conn) {
    // We need to map this connection back to a Socket ID
    // PeerJS metadata could hold it, or we infer from the handshake
    // For now, wait for first data packet? Or better, send metadata.
    
    // Easier: Since we don't know *who* this is yet, wait for 'open' and data.
    conn.on('open', () => {
       console.log('Incoming P2P connection opened');
       // Send our Socket ID as first message so they know who we are
       conn.send({ type: 'handshake', socketId: this.localPlayerId });
    });
    
    conn.on('data', (data) => {
       if (data.type === 'handshake') {
          console.log(`Mapped P2P connection to Player ${data.socketId}`);
          this._setupP2PConnection(conn, data.socketId);
       }
    });
  }
  
  _setupP2PConnection(conn, socketId) {
    // If we're initiating, send our handshake
    if (conn.open) {
        conn.send({ type: 'handshake', socketId: this.localPlayerId });
    } else {
        conn.on('open', () => {
            conn.send({ type: 'handshake', socketId: this.localPlayerId });
        });
    }

    this.connections.set(socketId, conn);
    
    conn.on('data', (data) => {
      this._handleGameData(socketId, data);
    });
    
    conn.on('close', () => {
      this.connections.delete(socketId);
    });
    
    conn.on('error', (err) => {
       console.error('P2P connection error:', err);
    });
  }
  
  _handleGameData(senderId, data) {
    if (data.type === 'playerState') {
       const player = this.players.get(senderId);
       if (player) {
         player.position = data.position;
         player.rotation = data.rotation;
         player.animState = data.animState;
       }
    }
  }

  // --- PUBLIC API ---

  async createRoom() {
    if (!this.socket) return;
    
    // GET PROFILE
    if (window.menuManager) {
        const profile = window.menuManager.getPlayerProfile();
        this.playerName = profile.playerName || this.playerName;
        this.playerGender = profile.characterGender || 'male';
    }
    
    this.socket.emit('create-room', {
      playerName: this.playerName,
      playerGender: this.playerGender
    });
    
    // Return a promise that resolves when room-created event fires? 
    // Or just let the event handler update UI. Current UI expects a return value (roomCode).
    // We can wrap in promise.
    return new Promise((resolve) => {
       this.socket.once('room-created', (data) => {
          resolve(data.roomCode);
       });
    });
  }
  
  async joinRoom(roomCode) {
    if (!this.socket) return;
    
    roomCode = roomCode.trim().toUpperCase();
    
    // GET PROFILE
    if (window.menuManager) {
        const profile = window.menuManager.getPlayerProfile();
        this.playerName = profile.playerName || this.playerName;
        this.playerGender = profile.characterGender || 'male';
    }

    this.socket.emit('join-room', {
      roomCode,
      playerName: this.playerName,
      playerGender: this.playerGender
    });
    
    return new Promise((resolve, reject) => {
       this.socket.once('joined-room', () => resolve(roomCode));
       this.socket.once('error', (err) => reject(new Error(err.message)));
       
       // Timeout
       setTimeout(() => reject(new Error('Join timeout - Server unresponsive')), 5000);
    });
  }
  
  startGame() {
    if (this.isHost && this.roomCode) {
      // If we don't have a seed yet, generate one (Server might override, but good to have)
      if (!this.mazeSeed) {
        this.mazeSeed = Math.floor(Math.random() * 100000);
      }
      console.log('MultiplayerManager: Sending start-game with seed:', this.mazeSeed);
      this.socket.emit('start-game', { 
        roomCode: this.roomCode,
        mazeSeed: this.mazeSeed 
      });
    }
  }
  
  sendGameEvent(event, data) {
     if (event === 'playerReady') {
       this.socket.emit('player-ready', { 
         roomCode: this.roomCode, 
         isReady: data.ready 
       });
     }
  }
  
  // Update Loop (to be called by Main Game Loop)
  update(time, delta) {
    if (!this.gameStarted) return;
    
    // Phase 3 Requirement: Throttle to ~30Hz (every 33ms)
    this.timeSinceLastUpdate = (this.timeSinceLastUpdate || 0) + (delta || 0.016);
    if (this.timeSinceLastUpdate < 0.033) return;
    this.timeSinceLastUpdate = 0;
    
    this._sendLocalState();
  }
  
  _sendLocalState() {
    if (!this.game || !this.game.player) return;
    const playerBody = this.game.player.body;
    if (!playerBody) return;
    
    const state = {
      type: 'playerState',
      position: { x: playerBody.position.x, y: playerBody.position.y, z: playerBody.position.z },
      rotation: this.game.player.mesh ? this.game.player.mesh.rotation.y : 0,
      animState: this.game.player.currentAnimState || 'idle'
    };
    
    // Broadcast via PeerJS to all connected peers
    this.connections.forEach(conn => {
       if (conn.open) conn.send(state);
    });
  }

  // --- HELPERS ---
  
  _updatePlayerList(playersData) {
    this.players.clear();
    playersData.forEach(p => this._addPlayer(p));
    this._broadcastPlayerListUI();
  }
  
  _addPlayer(p) {
    if (p.id === this.localPlayerId) return; // Don't add self to remote map
    this.players.set(p.id, {
       id: p.id,
       name: p.name,
       gender: p.gender,
       isHost: p.isHost,
       isReady: p.isReady,
       position: { x: 0, y: 0, z: 0 },
       rotation: 0,
       animState: 'idle'
    });
    this._broadcastPlayerListUI();
  }
  
  _broadcastPlayerListUI() {
     // Reconstruct list including self
     const list = [
       { id: this.localPlayerId, name: this.playerName, isHost: this.isHost, gender: this.playerGender, isReady: true },
       ...Array.from(this.players.values())
     ];
     
     // Update UI directly via callback (hacky but compatible with existing UI code)
     // Actually, existing UI reads from `this.players`. We need to populate it differently or update UI code.
     // Existing UI uses `this.mp.players` Map.
     // So we keep `this.players` updated.
     
     if (this.onPlayerJoined) this.onPlayerJoined(); // Trigger UI refresh
  }
  
  getRemotePlayers() {
    return Array.from(this.players.values());
  }
  
  destroy() {
    if (this.socket) this.socket.disconnect();
    if (this.peer) this.peer.destroy();
  }
}
