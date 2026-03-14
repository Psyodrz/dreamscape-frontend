/**
 * Horror HUD - Dark, Ominous, with Typewriter Subtitles
 * Features: Dynamic notifications, ghost warnings, player reactions
 * FIXED: Proper word spacing in typewriter effect
 */
export class HUD {
  constructor() {
    // Load horror font
    const fontLink = document.createElement("link");
    fontLink.href =
      "https://fonts.googleapis.com/css2?family=Special+Elite&display=swap";
    fontLink.rel = "stylesheet";
    document.head.appendChild(fontLink);

    // Main container - TOP CENTER
    this.container = document.createElement("div");
    this.container.id = "game-hud";
    this.container.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      align-items: center;
      gap: 30px;
      font-family: 'Courier New', monospace;
      color: #999;
      pointer-events: none;
      user-select: none;
      z-index: 100;
    `;

    // Lives - bigger hearts
    this.livesContainer = document.createElement("div");
    this.livesContainer.style.cssText = `
      display: flex;
      align-items: center;
      gap: 6px;
    `;
    this.container.appendChild(this.livesContainer);

    // Health bar - BIGGER
    this.healthContainer = document.createElement("div");
    this.healthContainer.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 3px;
      width: 180px;
    `;
    this.container.appendChild(this.healthContainer);

    this.healthLabel = document.createElement("div");
    this.healthLabel.style.cssText = `
      font-size: 10px;
      color: #555;
      letter-spacing: 2px;
      text-transform: uppercase;
    `;
    this.healthLabel.innerText = "VITALITY";
    this.healthContainer.appendChild(this.healthLabel);

    this.healthBarOuter = document.createElement("div");
    this.healthBarOuter.style.cssText = `
      width: 100%;
      height: 10px;
      background: rgba(20, 0, 0, 0.9);
      border: 1px solid rgba(100, 30, 30, 0.5);
      border-radius: 2px;
      overflow: hidden;
    `;
    this.healthContainer.appendChild(this.healthBarOuter);

    this.healthBar = document.createElement("div");
    this.healthBar.style.cssText = `
      width: 100%;
      height: 100%;
      background: linear-gradient(90deg, #660000, #aa0000, #880000);
      transition: width 0.3s ease;
      box-shadow: 0 0 8px rgba(150, 0, 0, 0.5);
    `;
    this.healthBarOuter.appendChild(this.healthBar);

    // Shards counter - BIGGER
    this.shardsContainer = document.createElement("div");
    this.shardsContainer.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 18px;
      color: #556677;
      letter-spacing: 1px;
    `;
    this.container.appendChild(this.shardsContainer);

    this.shardsIcon = document.createElement("span");
    this.shardsIcon.innerText = "◇";
    this.shardsIcon.style.cssText = `
      font-size: 22px;
      color: #445566;
    `;
    this.shardsContainer.appendChild(this.shardsIcon);

    this.shardsText = document.createElement("span");
    this.shardsText.innerText = "0 / 3";
    this.shardsContainer.appendChild(this.shardsText);

    // Stage indicator
    this.stageText = document.createElement("div");
    this.stageText.style.cssText = `
      font-size: 14px;
      color: #444;
      text-transform: uppercase;
      letter-spacing: 3px;
    `;
    this.stageText.innerText = "I";
    this.container.appendChild(this.stageText);

    // ============ TYPEWRITER SUBTITLE BAR ============
    this.subtitleContainer = document.createElement("div");
    this.subtitleContainer.style.cssText = `
      position: fixed;
      bottom: 80px;
      left: 50%;
      transform: translateX(-50%);
      width: 80%;
      max-width: 800px;
      text-align: center;
      pointer-events: none;
      z-index: 101;
    `;
    document.body.appendChild(this.subtitleContainer);

    this.subtitleText = document.createElement("div");
    this.subtitleText.style.cssText = `
      font-family: 'Special Elite', 'Courier New', monospace;
      font-size: 22px;
      color: #bbb;
      text-shadow: 0 0 15px rgba(0, 0, 0, 0.9), 2px 2px 6px rgba(0, 0, 0, 0.7);
      letter-spacing: 3px;
      word-spacing: 8px;
      line-height: 1.6;
      opacity: 0;
      transition: opacity 0.5s ease;
      white-space: pre-wrap;
    `;
    this.subtitleContainer.appendChild(this.subtitleText);

    // Threat info - bottom left
    this.threatContainer = document.createElement("div");
    this.threatContainer.style.cssText = `
      position: fixed;
      bottom: 25px;
      left: 25px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      font-family: 'Courier New', monospace;
      font-size: 13px;
      color: #444;
      z-index: 100;
    `;
    document.body.appendChild(this.threatContainer);

    this.monsterText = document.createElement("div");
    this.monsterText.innerText = "◈ 2";
    this.threatContainer.appendChild(this.monsterText);

    this.trapText = document.createElement("div");
    this.trapText.style.color = "#553322";
    this.trapText.innerText = "▲ 30";
    this.threatContainer.appendChild(this.trapText);

    // Damage overlay
    this.damageOverlay = document.createElement("div");
    this.damageOverlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      background: radial-gradient(ellipse at center, transparent 40%, rgba(100, 0, 0, 0.7) 100%);
      opacity: 0;
      transition: opacity 0.2s ease;
      z-index: 99;
    `;
    document.body.appendChild(this.damageOverlay);

    // Injury vignette
    this.injuryVignette = document.createElement("div");
    this.injuryVignette.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      background: radial-gradient(ellipse at center, transparent 50%, rgba(50, 0, 0, 0.6) 100%);
      opacity: 0;
      transition: opacity 0.5s ease;
      z-index: 98;
    `;
    document.body.appendChild(this.injuryVignette);

    document.body.appendChild(this.container);

    // State
    this.currentLives = 3;
    this.currentHealth = 100;
    this._subtitleQueue = [];
    this._isTyping = false;
    this._typewriterTimeout = null;

    // Initialize
    this.updateLives(3, 3);
    this.updateHealth(100, 100);
  }

  // ============ TYPEWRITER SUBTITLE SYSTEM ============

  showSubtitle(text, duration = 4000, priority = false) {
    if (priority) {
      // Clear queue and show immediately
      this._subtitleQueue = [];
      if (this._typewriterTimeout) clearTimeout(this._typewriterTimeout);
      this._showSubtitleImmediate(text, duration);
    } else {
      this._subtitleQueue.push({ text, duration });
      if (!this._isTyping) {
        this._processQueue();
      }
    }
  }

  _processQueue() {
    if (this._subtitleQueue.length === 0) {
      this._isTyping = false;
      return;
    }

    const { text, duration } = this._subtitleQueue.shift();
    this._showSubtitleImmediate(text, duration);
  }

  _showSubtitleImmediate(text, duration) {
    this._isTyping = true;

    // Clear any existing timeout
    if (this._typewriterTimeout) clearTimeout(this._typewriterTimeout);

    // Reset
    this.subtitleText.innerText = "";
    this.subtitleText.style.opacity = "1";

    // FIXED: Proper word-by-word typewriter for better spacing
    const words = text.split(" ");
    let wordIndex = 0;

    const typeWord = () => {
      if (wordIndex < words.length) {
        // Add word with proper spacing
        if (wordIndex > 0) {
          this.subtitleText.innerText += "  "; // Double space for visibility
        }
        this.subtitleText.innerText += words[wordIndex];
        wordIndex++;

        // Variable delay for natural feel
        const delay = 80 + Math.random() * 60;
        this._typewriterTimeout = setTimeout(typeWord, delay);
      } else {
        // Fully typed, wait then fade
        this._typewriterTimeout = setTimeout(() => {
          this.subtitleText.style.opacity = "0";
          setTimeout(() => this._processQueue(), 600);
        }, duration);
      }
    };

    typeWord();
  }

  clearSubtitle() {
    if (this._typewriterTimeout) clearTimeout(this._typewriterTimeout);
    this._subtitleQueue = [];
    this._isTyping = false;
    this.subtitleText.innerText = "";
    this.subtitleText.style.opacity = "0";
  }

  // ============ HUD UPDATES ============

  updateLives(current, max = 3) {
    this.currentLives = current;
    let html = "";
    for (let i = 0; i < max; i++) {
      if (i < current) {
        html += `<span style="font-size:24px;color:#880022;text-shadow:0 0 5px #550011;">♥</span>`;
      } else {
        html += `<span style="font-size:24px;color:#220011;opacity:0.4;">♥</span>`;
      }
    }
    this.livesContainer.innerHTML = html;
  }

  updateHealth(current, max = 100) {
    this.currentHealth = current;
    const percent = Math.max(0, Math.min(100, (current / max) * 100));

    this.healthBar.style.width = `${percent}%`;

    // Injury vignette and color
    if (percent <= 25) {
      this.injuryVignette.style.opacity = "0.9";
      this.healthBar.style.background =
        "linear-gradient(90deg, #330000, #550000)";
      this.healthBar.style.boxShadow = "0 0 15px rgba(100, 0, 0, 0.8)";
    } else if (percent <= 50) {
      this.injuryVignette.style.opacity = "0.4";
      this.healthBar.style.background =
        "linear-gradient(90deg, #550000, #880000)";
    } else {
      this.injuryVignette.style.opacity = "0";
      this.healthBar.style.background =
        "linear-gradient(90deg, #660000, #aa0000, #880000)";
    }
  }

  updateShards(current, total) {
    this.shardsText.innerText = `${current} / ${total}`;
    if (current >= total) {
      this.shardsIcon.style.color = "#88aacc";
      this.shardsIcon.style.textShadow = "0 0 10px #88aacc";
      this.shardsContainer.style.color = "#88aacc";
    } else {
      this.shardsIcon.style.color = "#445566";
      this.shardsContainer.style.color = "#556677";
    }
  }

  updateStage(stage) {
    const numerals = ["I", "II", "III", "IV", "V"];
    this.stageText.innerText = numerals[stage - 1] || stage;
  }

  updateMonsters(count) {
    this.monsterText.innerText = `◈ ${count}`;
  }

  updateTraps(count) {
    this.trapText.innerText = `▲ ${count}`;
  }

  triggerDamagePulse() {
    this.damageOverlay.style.opacity = "1";
    setTimeout(() => {
      this.damageOverlay.style.opacity = "0";
    }, 350);
  }

  // Legacy methods for compatibility
  showMessage(msg, duration = 4000) {
    this.showSubtitle(msg, duration);
  }

  showPersistentMessage(msg) {
    this.showSubtitle(msg, 6000);
  }

  // Legacy compatibility for showRandomDialogue
  showRandomDialogue(category, priority = false) {
    // Redirect to DialogueManager if available
    if (window.dialogueManager) {
      window.dialogueManager.show(category, priority);
    }
  }

  dispose() {
    if (this._typewriterTimeout) clearTimeout(this._typewriterTimeout);
    if (this.container?.parentNode)
      this.container.parentNode.removeChild(this.container);
    if (this.subtitleContainer?.parentNode)
      this.subtitleContainer.parentNode.removeChild(this.subtitleContainer);
    if (this.damageOverlay?.parentNode)
      this.damageOverlay.parentNode.removeChild(this.damageOverlay);
    if (this.injuryVignette?.parentNode)
      this.injuryVignette.parentNode.removeChild(this.injuryVignette);
    if (this.threatContainer?.parentNode)
      this.threatContainer.parentNode.removeChild(this.threatContainer);
  }
}
