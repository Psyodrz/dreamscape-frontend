/**
 * MultiplayerUI - Handles multiplayer lobby and voice chat UI
 */
import { getAudioManager } from "../systems/AudioManager.js";

export class MultiplayerUI {
  constructor(multiplayerManager) {
    this.mp = multiplayerManager;
    this.onGameStart = null;

    // Cache DOM elements
    this.elements = {
      overlay: document.getElementById("multiplayer-overlay"),
      lobbyTitle: document.getElementById("lobby-title"),
      modeSelect: document.getElementById("mode-select"),
      joinInput: document.getElementById("join-input"),
      roomLobby: document.getElementById("room-lobby"),

      btnHost: document.getElementById("btn-host"),
      btnJoin: document.getElementById("btn-join"),
      btnMpBack: document.getElementById("btn-mp-back"),

      roomCodeInput: document.getElementById("room-code-input"),
      btnJoinConfirm: document.getElementById("btn-join-confirm"),
      btnJoinBack: document.getElementById("btn-join-back"),

      roomCodeDisplay: document.getElementById("room-code-display"),
      playerList: document.getElementById("player-list"),
      btnStartGame: document.getElementById("btn-mp-start-game"),
      btnReady: document.getElementById("btn-ready"),
      waitingText: document.getElementById("waiting-text"),
      btnLeaveRoom: document.getElementById("btn-leave-room"),

      // Main menu
      btnMultiplayer: document.getElementById("btn-multiplayer"),
      menuOverlay: document.getElementById("menu-overlay"),

      // Character selection
      mpCharSelect: document.getElementById("mp-char-select"),
      mpPlayerName: document.getElementById("mp-player-name"),
      mpGenderSelect: document.getElementById("mp-gender-select"),
      btnCharConfirm: document.getElementById("btn-char-confirm"),
      btnCharBack: document.getElementById("btn-char-back"),
    };

    // Player profile for multiplayer
    this.playerProfile = {
      name: "Player" + Math.floor(Math.random() * 10000),
      gender: "male",
    };

    // Pending action after character selection
    this.pendingAction = null; // 'host' or 'join'

    this._bindEvents();
    this._bindMultiplayerCallbacks();
  }

  _bindEvents() {
    // Multiplayer button from main menu
    if (this.elements.btnMultiplayer) {
      this.elements.btnMultiplayer.addEventListener("click", () => this.show());
      this.elements.btnMultiplayer.addEventListener("touchstart", (e) => {
        e.preventDefault();
        this.show();
      });
    }

    // Mode selection - now shows character selection first
    this.elements.btnHost?.addEventListener("click", () =>
      this._showCharSelect("host")
    );
    this.elements.btnJoin?.addEventListener("click", () =>
      this._showCharSelect("join")
    );
    this.elements.btnMpBack?.addEventListener("click", () => this.hide());

    // Character selection
    this._setupGenderSelect();
    this.elements.btnCharConfirm?.addEventListener("click", () =>
      this._confirmCharacter()
    );
    this.elements.btnCharBack?.addEventListener("click", () =>
      this._showModeSelect()
    );

    // Join input
    this.elements.btnJoinConfirm?.addEventListener("click", () =>
      this._joinRoom()
    );
    this.elements.btnJoinBack?.addEventListener("click", () =>
      this._showModeSelect()
    );
    this.elements.roomCodeInput?.addEventListener("keyup", (e) => {
      if (e.key === "Enter") this._joinRoom();
    });

    // Room lobby
    if (this.elements.btnStartGame) {
      this.elements.btnStartGame.addEventListener("click", () =>
        this._startGame()
      );
      this.elements.btnStartGame.addEventListener("touchstart", (e) => {
        e.preventDefault();
        this._startGame();
      });
    }
    if (this.elements.btnReady) {
      this.elements.btnReady.addEventListener("click", () =>
        this._toggleReady()
      );
      this.elements.btnReady.addEventListener("touchstart", (e) => {
        e.preventDefault();
        this._toggleReady();
      });
    }
    this.elements.btnLeaveRoom?.addEventListener("click", () =>
      this._leaveRoom()
    );
  }

  _bindMultiplayerCallbacks() {
    // Player joined/left callbacks
    this.mp.onPlayerJoined = (peerId, name) => {
      console.log("Player joined:", name);
      this._updatePlayerList();
    };

    this.mp.onPlayerLeft = (peerId) => {
      console.log("Player left:", peerId);
      this._updatePlayerList();
    };

    // Game event handler - handles gameStart from host
    this.mp.onGameEvent = (event, data) => {
      console.log("Game event received:", event, data);

      if (event === "gameStart") {
        console.log("Received gameStart event from host!");
        this._handleGameStartFromHost(data);
      }
    };
  }

  /**
   * Handle game start event received from host (for guest players)
   */
  _handleGameStartFromHost(data) {
    console.log("Guest starting game from host event...");

    // Store maze seed from host so we generate the same maze
    if (data.mazeSeed !== undefined) {
      this.mp.mazeSeed = data.mazeSeed;
      console.log("Guest received maze seed:", data.mazeSeed);
    }

    // Hide multiplayer overlay
    const multiplayerOverlay = document.getElementById("multiplayer-overlay");
    if (multiplayerOverlay) {
      multiplayerOverlay.classList.add("hidden");
      multiplayerOverlay.style.display = "none";
    }

    // Use the onGameStart callback if set (preferred method from main.js)
    if (this.onGameStart) {
      console.log("Starting game via onGameStart callback...");
      this.onGameStart(true); // true = multiplayer mode
      return;
    }

    // Fallback: Use sceneManager directly
    if (window.sceneManager) {
      console.log("Starting game via sceneManager...");
      document.getElementById("menu-overlay")?.classList.add("hidden");
      document.getElementById("loading-screen")?.classList.remove("hidden");
      window.sceneManager.setState("game");
    } else if (window.menuManager) {
      console.log("Starting game via menuManager...");
      window.menuManager.elements.menuOverlay?.classList.add("hidden");
      window.menuManager.elements.loadingScreen?.classList.remove("hidden");
      if (window.menuManager.onPlay) {
        window.menuManager.onPlay(window.menuManager.getPlayerProfile());
      }
    } else {
      console.error("No method available to start game as guest!");
      alert("Unable to start game. Please refresh and try again.");
    }
  }

  // ==================== VIEW STATES ====================

  show() {
    this.elements.menuOverlay?.classList.add("hidden");
    this.elements.overlay?.classList.remove("hidden");
    this._showModeSelect();
  }

  hide() {
    this.elements.overlay?.classList.add("hidden");
    this.elements.menuOverlay?.classList.remove("hidden");
  }

  _showModeSelect() {
    this.elements.modeSelect?.classList.remove("hidden");
    this.elements.mpCharSelect?.classList.add("hidden");
    this.elements.joinInput?.classList.add("hidden");
    this.elements.roomLobby?.classList.add("hidden");
    this.elements.lobbyTitle.textContent = "MULTIPLAYER";
  }

  _setupGenderSelect() {
    const genderBtns =
      this.elements.mpGenderSelect?.querySelectorAll(".toggle-btn");
    console.log(
      "MultiplayerUI: Setting up gender select, buttons found:",
      genderBtns?.length
    );
    if (genderBtns) {
      genderBtns.forEach((btn) => {
        console.log("MultiplayerUI: Button data-gender:", btn.dataset.gender);
        btn.addEventListener("click", () => {
          genderBtns.forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");
          this.playerProfile.gender = btn.dataset.gender;
          console.log(
            "MultiplayerUI: Gender selected:",
            this.playerProfile.gender
          );
        });
      });
    }
  }

  _showCharSelect(action) {
    this.pendingAction = action;
    this.elements.modeSelect?.classList.add("hidden");
    this.elements.mpCharSelect?.classList.remove("hidden");
    this.elements.lobbyTitle.textContent = "CREATE CHARACTER";

    // Pre-fill default name
    if (this.elements.mpPlayerName) {
      this.elements.mpPlayerName.value = this.playerProfile.name;
    }
  }

  _confirmCharacter() {
    // Get player name
    const name =
      this.elements.mpPlayerName?.value.trim() ||
      "Player" + Math.floor(Math.random() * 10000);
    this.playerProfile.name = name;

    // Update the multiplayer manager with player info
    this.mp.playerName = this.playerProfile.name;
    this.mp.playerGender = this.playerProfile.gender;

    console.log("MultiplayerUI: Character confirmed:", this.playerProfile);
    console.log("MultiplayerUI: mp.playerGender is now:", this.mp.playerGender);

    // Continue with the pending action
    if (this.pendingAction === "host") {
      this._createRoom();
    } else if (this.pendingAction === "join") {
      this._showJoinInput();
    }
  }

  _showJoinInput() {
    this.elements.modeSelect?.classList.add("hidden");
    this.elements.mpCharSelect?.classList.add("hidden");
    this.elements.joinInput?.classList.remove("hidden");
    this.elements.roomLobby?.classList.add("hidden");
    this.elements.lobbyTitle.textContent = "JOIN ROOM";
    this.elements.roomCodeInput?.focus();
  }

  _showRoomLobby() {
    this.elements.modeSelect?.classList.add("hidden");
    this.elements.joinInput?.classList.add("hidden");
    this.elements.mpCharSelect?.classList.add("hidden"); // Fix: Ensure character select is hidden
    this.elements.roomLobby?.classList.remove("hidden");

    // Debug: Check host status
    console.log("Is Host:", this.mp.isHost);

    this.elements.lobbyTitle.textContent = this.mp.isHost
      ? "YOUR ROOM"
      : "ROOM LOBBY";

    // Re-query the button elements to ensure we have the correct references
    const startBtn = document.getElementById("btn-mp-start-game");
    const readyBtn = document.getElementById("btn-ready");
    const waitText = document.getElementById("waiting-text");

    // Show correct buttons based on host status
    if (this.mp.isHost === true) {
      // Host sees START GAME button only
      console.log("Showing START GAME for host");
      if (startBtn) {
        startBtn.style.setProperty("display", "block", "important");
        // Attach click handler directly
        startBtn.onclick = () => {
          console.log("START GAME clicked!");
          this._startGame();
        };
      }
      if (readyBtn) {
        readyBtn.style.setProperty("display", "none", "important");
      }
      if (waitText) {
        waitText.style.setProperty("display", "none", "important");
      }
    } else {
      // Guests see READY button and waiting text only
      console.log("Showing READY for guest");
      if (startBtn) {
        startBtn.style.setProperty("display", "none", "important");
      }
      if (readyBtn) {
        readyBtn.style.setProperty("display", "block", "important");
        // Attach click handler directly
        readyBtn.onclick = () => {
          console.log("READY clicked!");
          this._toggleReady();
        };
      }
      if (waitText) {
        waitText.style.setProperty("display", "block", "important");
      }
    }

    this._updatePlayerList();
  }

  // ==================== ROOM ACTIONS ====================

  async _createRoom() {
    try {
      this.elements.lobbyTitle.textContent = "CONNECTING...";

      // Safety timeout: If it takes >3 seconds, warn the user (Render might be waking up)
      const timeoutId = setTimeout(() => {
        if (this.elements.lobbyTitle.textContent === "CONNECTING...") {
          this.elements.lobbyTitle.textContent = "WAKING SERVER...";
        }
      }, 3000);

      const roomCode = await this.mp.createRoom();
      clearTimeout(timeoutId);

      // Show 6-char room code
      this.elements.roomCodeDisplay.textContent = roomCode;

      // Click to copy
      this.elements.roomCodeDisplay.style.cursor = "pointer";
      this.elements.roomCodeDisplay.onclick = () => {
        navigator.clipboard.writeText(roomCode).then(() => {
          alert("Code copied: " + roomCode);
        });
      };

      console.log("Room code:", roomCode);

      this._showRoomLobby();
    } catch (err) {
      console.error("Failed to create room:", err);
      // Show specific error message to help debugging
      alert(`Failed to create room: ${err.message}`);
      this._showModeSelect();
    }
  }

  async _joinRoom() {
    const code = this.elements.roomCodeInput?.value.trim().toUpperCase();
    if (!code || code.length !== 6) {
      alert("Please enter a 6-character room code");
      return;
    }

    try {
      this.elements.lobbyTitle.textContent = "JOINING...";
      await this.mp.joinRoom(code);
      this.elements.roomCodeDisplay.textContent = code;
      this._showRoomLobby();
    } catch (err) {
      console.error("Failed to join room:", err);
      alert(`Failed to join room: ${err.message}`);
      this._showJoinInput();
    }
  }

  _toggleReady() {
    // Toggle local ready state
    this.isReady = !this.isReady;

    // Update button appearance
    if (this.elements.btnReady) {
      if (this.isReady) {
        this.elements.btnReady.textContent = "✗ NOT READY";
        this.elements.btnReady.classList.remove("btn-secondary");
        this.elements.btnReady.classList.add("btn-primary");
      } else {
        this.elements.btnReady.textContent = "✓ READY";
        this.elements.btnReady.classList.remove("btn-primary");
        this.elements.btnReady.classList.add("btn-secondary");
      }
    }

    // Send ready state to host
    this.mp.sendGameEvent("playerReady", {
      playerId: this.mp.localPlayerId,
      ready: this.isReady,
    });

    console.log("Ready state:", this.isReady);
  }

  _leaveRoom() {
    this.mp.destroy();
    this.hide();
  }

  _startGame() {
    console.log("_startGame called, isHost:", this.mp.isHost);

    if (!this.mp.isHost) {
      console.log("Not host, ignoring start game");
      return;
    }

    console.log("Host triggering start game via server...");

    // Use the manager to start the game properly via Socket.IO
    this.mp.startGame();

    // Update button state to prevent double clicks
    if (this.elements.btnStartGame) {
      this.elements.btnStartGame.textContent = "STARTING...";
      this.elements.btnStartGame.disabled = true;
    }

    // DO NOT manually transition here.
    // Wait for the 'gameStart' event from the server (handled in _handleGameStartFromHost)
    // This ensures Host and Clients stay in sync.
  }

  // ==================== PLAYER LIST ====================

  _updatePlayerList() {
    if (!this.elements.playerList) return;

    this.elements.playerList.innerHTML = "";

    // 1. Add Local Player (You)
    const localItem = document.createElement("div");
    localItem.className = "player-item";

    // Check if we are ready (host is always ready effectively?)
    // For guests, we track local ready state in UI
    const isReady = this.mp.isHost ? true : this.isReady || false;

    localItem.innerHTML = `
      <div class="player-avatar ${this.mp.isHost ? "host" : "guest"}">
        ${this.mp.isHost ? "👑" : "👤"}
      </div>
      <span class="player-name">${this.mp.playerName} (You)</span>
      <span class="player-status ${isReady ? "ready" : ""}">${
      isReady ? "READY" : "●"
    }</span>
    `;
    this.elements.playerList.appendChild(localItem);

    // 2. Add Remote Players
    this.mp.players.forEach((player, id) => {
      const item = document.createElement("div");
      item.className = "player-item";

      // Determine status text
      let statusText = "●";
      let statusClass = "";

      if (player.isHost) {
        statusText = "HOST";
        statusClass = "host";
      } else if (player.isReady) {
        statusText = "READY";
        statusClass = "ready";
      }

      item.innerHTML = `
        <div class="player-avatar ${player.isHost ? "host" : "guest"}">
          ${player.isHost ? "👑" : "👤"}
        </div>
        <span class="player-name">${player.name}</span>
        <span class="player-status ${statusClass}">${statusText}</span>
      `;
      this.elements.playerList.appendChild(item);
    });
  }
}
