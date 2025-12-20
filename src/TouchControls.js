/**
 * TouchControls - Mobile touch input system
 * Provides virtual joystick, camera look, and action buttons
 */
export class TouchControls {
  constructor() {
    // Device detection
    this.isMobileDevice = this._detectMobile();
    
    // Control state (normalized -1 to 1)
    this.moveForward = 0;
    this.moveRight = 0;
    this.lookDeltaX = 0;
    this.lookDeltaY = 0;
    
    // Button states
    this.sprint = false;
    this.jump = false;
    this.flashlight = false;
    this.invisibility = false;
    
    // Joystick state
    this.joystickActive = false;
    this.joystickStartX = 0;
    this.joystickStartY = 0;
    this.joystickCurrentX = 0;
    this.joystickCurrentY = 0;
    this.joystickTouchId = null;
    
    // Camera look state
    this.lookActive = false;
    this.lookLastX = 0;
    this.lookLastY = 0;
    this.lookTouchId = null;
    this.lookSensitivity = 0.3;
    
    // Joystick config
    this.joystickMaxRadius = 50;
    this.joystickDeadzone = 0.15;
    
    // DOM elements (will be set in init)
    this.elements = {};
    
    // Only init on mobile
    if (this.isMobileDevice) {
      this._initUI();
      this._bindEvents();
    }
  }
  
  _detectMobile() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
           ('ontouchstart' in window) ||
           (navigator.maxTouchPoints > 0);
  }
  
  _initUI() {
    // Show touch controls container
    const container = document.getElementById('touch-controls');
    if (container) {
      container.classList.remove('hidden');
    }
    
    // Cache DOM elements
    this.elements = {
      container: container,
      joystickArea: document.getElementById('joystick-area'),
      joystickBase: document.getElementById('joystick-base'),
      joystickThumb: document.getElementById('joystick-thumb'),
      lookArea: document.getElementById('look-area'),
      btnSprint: document.getElementById('btn-sprint'),
      btnJump: document.getElementById('btn-jump'),
      btnFlashlight: document.getElementById('btn-flashlight')
    };
  }
  
  _bindEvents() {
    // Prevent default touch behaviors
    document.addEventListener('touchmove', (e) => {
      if (e.target.closest('#touch-controls')) {
        e.preventDefault();
      }
    }, { passive: false });
    
    // Joystick events
    if (this.elements.joystickArea) {
      this.elements.joystickArea.addEventListener('touchstart', (e) => this._onJoystickStart(e), { passive: false });
      this.elements.joystickArea.addEventListener('touchmove', (e) => this._onJoystickMove(e), { passive: false });
      this.elements.joystickArea.addEventListener('touchend', (e) => this._onJoystickEnd(e), { passive: false });
      this.elements.joystickArea.addEventListener('touchcancel', (e) => this._onJoystickEnd(e), { passive: false });
    }
    
    // Look area events
    if (this.elements.lookArea) {
      this.elements.lookArea.addEventListener('touchstart', (e) => this._onLookStart(e), { passive: false });
      this.elements.lookArea.addEventListener('touchmove', (e) => this._onLookMove(e), { passive: false });
      this.elements.lookArea.addEventListener('touchend', (e) => this._onLookEnd(e), { passive: false });
      this.elements.lookArea.addEventListener('touchcancel', (e) => this._onLookEnd(e), { passive: false });
    }
    
    // Sprint button
    if (this.elements.btnSprint) {
      this.elements.btnSprint.addEventListener('touchstart', (e) => {
        e.preventDefault();
        this.sprint = true;
        this.elements.btnSprint.classList.add('active');
      }, { passive: false });
      this.elements.btnSprint.addEventListener('touchend', (e) => {
        e.preventDefault();
        this.sprint = false;
        this.elements.btnSprint.classList.remove('active');
      }, { passive: false });
    }
    
    // Jump button
    if (this.elements.btnJump) {
      this.elements.btnJump.addEventListener('touchstart', (e) => {
        e.preventDefault();
        this.jump = true;
        this.elements.btnJump.classList.add('active');
      }, { passive: false });
      this.elements.btnJump.addEventListener('touchend', (e) => {
        e.preventDefault();
        this.jump = false;
        this.elements.btnJump.classList.remove('active');
      }, { passive: false });
    }
    
    // Flashlight toggle
    if (this.elements.btnFlashlight) {
      this.elements.btnFlashlight.addEventListener('touchstart', (e) => {
        e.preventDefault();
        this.flashlight = !this.flashlight;
        this.elements.btnFlashlight.classList.toggle('active', this.flashlight);
      }, { passive: false });
    }
    
    // Fullscreen toggle
    this.elements.btnFullscreen = document.getElementById('btn-fullscreen');
    if (this.elements.btnFullscreen) {
      this.elements.btnFullscreen.addEventListener('touchstart', (e) => {
        e.preventDefault();
        // Dispatch custom event for main.js to handle
        window.dispatchEvent(new CustomEvent('toggleFullscreen'));
        this.elements.btnFullscreen.classList.add('active');
        setTimeout(() => this.elements.btnFullscreen.classList.remove('active'), 200);
      }, { passive: false });
      
      // Also handle click for desktop testing
      this.elements.btnFullscreen.addEventListener('click', (e) => {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('toggleFullscreen'));
      });
    }

  }
  
  // ==================== JOYSTICK ====================
  
  _onJoystickStart(e) {
    e.preventDefault();
    if (this.joystickTouchId !== null) return;
    
    const touch = e.changedTouches[0];
    this.joystickTouchId = touch.identifier;
    this.joystickActive = true;
    
    const rect = this.elements.joystickArea.getBoundingClientRect();
    this.joystickStartX = touch.clientX - rect.left;
    this.joystickStartY = touch.clientY - rect.top;
    this.joystickCurrentX = this.joystickStartX;
    this.joystickCurrentY = this.joystickStartY;
    
    // Position joystick base at touch point
    if (this.elements.joystickBase) {
      this.elements.joystickBase.style.left = `${this.joystickStartX}px`;
      this.elements.joystickBase.style.top = `${this.joystickStartY}px`;
      this.elements.joystickBase.classList.add('active');
    }
    
    this._updateJoystickVisual();
  }
  
  _onJoystickMove(e) {
    e.preventDefault();
    if (!this.joystickActive) return;
    
    // Find our touch
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      if (touch.identifier === this.joystickTouchId) {
        const rect = this.elements.joystickArea.getBoundingClientRect();
        this.joystickCurrentX = touch.clientX - rect.left;
        this.joystickCurrentY = touch.clientY - rect.top;
        this._updateJoystickVisual();
        break;
      }
    }
  }
  
  _onJoystickEnd(e) {
    e.preventDefault();
    
    // Check if our touch ended
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === this.joystickTouchId) {
        this.joystickActive = false;
        this.joystickTouchId = null;
        this.moveForward = 0;
        this.moveRight = 0;
        
        // Reset visual
        if (this.elements.joystickBase) {
          this.elements.joystickBase.classList.remove('active');
        }
        if (this.elements.joystickThumb) {
          this.elements.joystickThumb.style.transform = 'translate(-50%, -50%)';
        }
        break;
      }
    }
  }
  
  _updateJoystickVisual() {
    const dx = this.joystickCurrentX - this.joystickStartX;
    const dy = this.joystickCurrentY - this.joystickStartY;
    
    // Calculate distance and clamp to max radius
    const distance = Math.sqrt(dx * dx + dy * dy);
    const clampedDistance = Math.min(distance, this.joystickMaxRadius);
    const angle = Math.atan2(dy, dx);
    
    // Calculate clamped position
    const clampedX = Math.cos(angle) * clampedDistance;
    const clampedY = Math.sin(angle) * clampedDistance;
    
    // Update thumb position
    if (this.elements.joystickThumb) {
      this.elements.joystickThumb.style.transform = `translate(calc(-50% + ${clampedX}px), calc(-50% + ${clampedY}px))`;
    }
    
    // Calculate normalized input (-1 to 1)
    const normalizedX = clampedX / this.joystickMaxRadius;
    const normalizedY = clampedY / this.joystickMaxRadius;
    
    // Apply deadzone
    const magnitude = Math.sqrt(normalizedX * normalizedX + normalizedY * normalizedY);
    if (magnitude < this.joystickDeadzone) {
      this.moveForward = 0;
      this.moveRight = 0;
    } else {
      // Remap from deadzone to 1
      const remapped = (magnitude - this.joystickDeadzone) / (1 - this.joystickDeadzone);
      this.moveRight = (normalizedX / magnitude) * remapped;
      this.moveForward = -(normalizedY / magnitude) * remapped; // Inverted Y
    }
  }
  
  // ==================== CAMERA LOOK ====================
  
  _onLookStart(e) {
    e.preventDefault();
    if (this.lookTouchId !== null) return;
    
    const touch = e.changedTouches[0];
    this.lookTouchId = touch.identifier;
    this.lookActive = true;
    this.lookLastX = touch.clientX;
    this.lookLastY = touch.clientY;
  }
  
  _onLookMove(e) {
    e.preventDefault();
    if (!this.lookActive) return;
    
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      if (touch.identifier === this.lookTouchId) {
        const dx = touch.clientX - this.lookLastX;
        const dy = touch.clientY - this.lookLastY;
        
        // Accumulate look delta (will be consumed per frame)
        this.lookDeltaX += dx * this.lookSensitivity;
        this.lookDeltaY += dy * this.lookSensitivity;
        
        this.lookLastX = touch.clientX;
        this.lookLastY = touch.clientY;
        break;
      }
    }
  }
  
  _onLookEnd(e) {
    e.preventDefault();
    
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === this.lookTouchId) {
        this.lookActive = false;
        this.lookTouchId = null;
        break;
      }
    }
  }
  
  // ==================== PUBLIC API ====================
  
  /**
   * Get and consume look delta (call once per frame)
   */
  consumeLookDelta() {
    const delta = { x: this.lookDeltaX, y: this.lookDeltaY };
    this.lookDeltaX = 0;
    this.lookDeltaY = 0;
    return delta;
  }
  
  /**
   * Get movement input
   */
  getMovement() {
    return {
      forward: this.moveForward,
      right: this.moveRight
    };
  }
  
  /**
   * Get button states
   */
  getButtons() {
    return {
      sprint: this.sprint,
      jump: this.jump,
      flashlight: this.flashlight,
      invisibility: this.invisibility
    };
  }
  
  /**
   * Consume jump (reset after reading)
   */
  consumeJump() {
    const jumped = this.jump;
    // Don't reset here - let touchend handle it
    return jumped;
  }
  
  /**
   * Check if on mobile
   */
  isMobile() {
    return this.isMobileDevice;
  }
  
  /**
   * Show/hide controls
   */
  setVisible(visible) {
    if (this.elements.container) {
      this.elements.container.classList.toggle('hidden', !visible);
    }
  }
  
  /**
   * Set look sensitivity (0.1 to 2.0, default 1.0 = 0.3 base)
   */
  setSensitivity(multiplier) {
    // Base sensitivity is 0.3, multiplier adjusts it
    this.lookSensitivity = 0.3 * multiplier;
    console.log('TouchControls: Sensitivity set to', this.lookSensitivity);
  }
}