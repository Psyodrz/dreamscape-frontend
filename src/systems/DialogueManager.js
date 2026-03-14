/**
 * Dialogue Manager - Centralized Horror Dialogue System
 * Handles all player reactions, environmental warnings, and atmospheric text
 */

class DialogueManager {
  constructor() {
    this.hud = null;
    this.lastDialogueTime = {};
    this.cooldowns = {
      ghostNear: 12000,
      ghostVeryClose: 6000,
      trapHit: 3000,
      damage: 2000,
      lowHealth: 10000,
      mudTrap: 4000,
      spikeTrap: 4000,
    };

    // ============ EXTENSIVE DIALOGUE POOLS ============
    this.dialogues = {
      // === GHOST PROXIMITY ===
      ghostNear: [
        "Something is watching me...",
        "I feel... cold.",
        "There's something in the darkness.",
        "The air grows thick.",
        "I hear footsteps... not my own.",
        "Am I alone here?",
        "The shadows seem to move.",
        "I sense a presence nearby.",
        "My skin crawls...",
        "What was that sound?",
      ],

      ghostVeryClose: [
        "NO NO NO NO!",
        "IT'S RIGHT BEHIND ME!",
        "I can hear it breathing...",
        "RUN! NOW!",
        "Don't look back!",
        "Move! MOVE!",
        "Too close... too close!",
        "It's here... it's HERE!",
        "I need to get away!",
        "Oh god... oh god...",
      ],

      // === DAMAGE REACTIONS ===
      damage: [
        "Argh!",
        "DAMN IT!",
        "That hurt!",
        "Shit!",
        "No... no!",
        "Ugh!",
        "I'm hurt!",
        "Pain... such pain!",
        "GAH!",
        "I can't take much more!",
      ],

      // === SPIKE TRAP SPECIFIC ===
      spikeTrap: [
        "SPIKES! Watch the floor!",
        "A trap! I almost died!",
        "Those spikes came out of nowhere!",
        "My leg... the spikes!",
        "Sharp... too sharp!",
        "A spike trap! This place is cursed!",
        "Blood... my blood.",
        "The floor is trying to kill me!",
        "I stepped on something... SPIKES!",
        "That was too close!",
      ],

      // === MUD TRAP SPECIFIC ===
      mudTrap: [
        "My feet... I'm stuck!",
        "The ground is pulling me down!",
        "This mud... it's like quicksand!",
        "I can barely move!",
        "Something is wrong with the floor!",
        "My legs feel so heavy!",
        "I'm sinking... can't move fast!",
        "The mud is slowing me down!",
        "I need to get out of this!",
        "It's like the ground is alive!",
      ],

      // === GENERIC TRAP REACTIONS ===
      trapGeneric: [
        "A trap!",
        "Careful!",
        "Watch your step!",
        "This place is a death trap!",
        "I need to be more careful.",
        "Another trap... how many more?",
        "They're everywhere!",
        "I have to watch where I step.",
      ],

      // === SHARD COLLECTION ===
      shardCollect: [
        "A memory fragment...",
        "I remember... something.",
        "Another piece of the puzzle.",
        "The shard resonates with power.",
        "One step closer to escape.",
        "A part of me... returns.",
        "The darkness stirs as I take this.",
        "I can feel my memories returning.",
        "This shard... it's warm.",
        "I'm getting closer to the truth.",
      ],

      // === LOW HEALTH ===
      lowHealth: [
        "I'm not going to make it...",
        "Everything is fading...",
        "Just... a little... further.",
        "I can't die here!",
        "My vision is blurring...",
        "I'm losing too much blood...",
        "Stay... awake...",
        "The darkness is consuming me...",
        "I have to keep going...",
        "Am I... dying?",
      ],

      // === PORTAL UNLOCKED ===
      portalOpen: [
        "THE PORTAL IS OPEN!",
        "FREEDOM... I CAN FEEL IT!",
        "THE EXIT! I FOUND IT!",
        "I need to find the way out!",
        "The shards... they work!",
      ],

      // === LEVEL START / MISSION ===
      levelStart: [
        "Find the memory shards... escape this nightmare.",
        "I must collect the shards to open the portal.",
        "The shards are the key... but the darkness hunts me.",
        "Somewhere in this maze are the shards I need.",
        "I have to find the fragments before THEY find me.",
      ],

      // === TUTORIALS / HINTS ===
      tutorial: [
        "Press F to toggle your flashlight...",
        "Use WASD to move. SHIFT to run.",
        "The shards glow faintly in the darkness...",
        "Watch for traps on the floor...",
        "Hide in the shadows when IT comes...",
      ],

      torchHint: [
        "It's so dark... Press F for the torch.",
        "I can barely see... where's my torch? (F)",
        "The darkness is suffocating... F for fire.",
        "This torch... it flickers in the darkness. (F)",
      ],

      // === EXPLORATION / ATMOSPHERE ===
      exploration: [
        "This place feels wrong...",
        "The walls... they seem to close in.",
        "I hear whispers in the dark.",
        "Every shadow could hide something.",
        "I need to stay focused.",
        "What horrors lurk here?",
        "The silence is deafening.",
        "I've been here before... haven't I?",
        "Something is rotting here...",
        "The air smells of death.",
        "These walls have witnessed horror.",
        "I can feel eyes on me...",
        "What happened to the others?",
        "This place... it's alive.",
      ],

      // === NEAR DEATH ===
      nearDeath: [
        "I'm dying... this is it...",
        "No... not like this!",
        "The darkness takes me...",
        "I can't... breathe...",
        "Is this the end?",
        "Everything goes cold...",
        "Mother... I'm sorry...",
        "The void... it calls me...",
      ],

      // === DEATH / RESPAWN ===
      death: [
        "The darkness claims you... but not yet.",
        "Death is not the end... not here.",
        "You awaken... but something followed.",
        "The nightmare continues...",
        "You cheat death... this time.",
      ],

      // === HEARTBEAT / TERROR ===
      terror: [
        "My heart... it's pounding...",
        "I can feel it getting closer...",
        "Please... please let me live...",
        "I don't want to die here!",
        "What is that thing?!",
        "It knows I'm here...",
        "Every step could be my last...",
        "The fear... it's overwhelming...",
      ],
    };

    // Track used dialogues to avoid repetition
    this.usedDialogues = {};
    for (const category in this.dialogues) {
      this.usedDialogues[category] = [];
    }
  }

  setHUD(hud) {
    this.hud = hud;
  }

  /**
   * Show a random dialogue from a category
   * @param {string} category - The dialogue category
   * @param {boolean} priority - If true, interrupts current dialogue
   * @param {number} duration - How long to show (default 4000ms)
   */
  show(category, priority = false, duration = 4000) {
    if (!this.hud) return;

    const now = Date.now();
    const cooldown = this.cooldowns[category] || 2000;

    // Check cooldown
    if (
      this.lastDialogueTime[category] &&
      now - this.lastDialogueTime[category] < cooldown
    ) {
      return;
    }

    const pool = this.dialogues[category];
    if (!pool || pool.length === 0) return;

    // Get a non-repeated dialogue if possible
    let text = this._getUniqueDialogue(category, pool);

    this.lastDialogueTime[category] = now;
    this.hud.showSubtitle(text, duration, priority);
  }

  /**
   * Get a dialogue that hasn't been used recently
   */
  _getUniqueDialogue(category, pool) {
    const used = this.usedDialogues[category];

    // Filter out recently used
    const available = pool.filter((d) => !used.includes(d));

    let text;
    if (available.length > 0) {
      text = available[Math.floor(Math.random() * available.length)];
    } else {
      // Reset if all used
      this.usedDialogues[category] = [];
      text = pool[Math.floor(Math.random() * pool.length)];
    }

    // Track usage (keep last 50% to allow variety)
    used.push(text);
    if (used.length > Math.ceil(pool.length / 2)) {
      used.shift();
    }

    return text;
  }

  /**
   * Show a specific text (not from pool)
   */
  showText(text, duration = 4000, priority = false) {
    if (!this.hud) return;
    this.hud.showSubtitle(text, duration, priority);
  }

  /**
   * Clear any active dialogue
   */
  clear() {
    if (this.hud && this.hud.clearSubtitle) {
      this.hud.clearSubtitle();
    }
  }
}

// Singleton instance
let dialogueManagerInstance = null;

export function getDialogueManager() {
  if (!dialogueManagerInstance) {
    dialogueManagerInstance = new DialogueManager();
  }
  return dialogueManagerInstance;
}

export { DialogueManager };
