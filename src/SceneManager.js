/**
 * SceneManager - Simple state machine for scene transitions
 */
export class SceneManager {
  constructor() {
    this.currentState = 'home';
    this.listeners = {
      home: [],
      game: []
    };
  }
  
  /**
   * Get current state
   */
  getState() {
    return this.currentState;
  }
  
  /**
   * Set state and notify listeners
   * @param {'home' | 'game'} state 
   */
  setState(state) {
    if (state !== 'home' && state !== 'game') {
      console.error('Invalid state:', state);
      return;
    }
    
    const previousState = this.currentState;
    this.currentState = state;
    
    console.log(`SceneManager: ${previousState} → ${state}`);
    
    // Notify listeners
    this.listeners[state].forEach(callback => {
      try {
        callback(previousState);
      } catch (e) {
        console.error('SceneManager callback error:', e);
      }
    });
  }
  
  /**
   * Register a listener for state changes
   * @param {'home' | 'game'} state 
   * @param {Function} callback 
   */
  on(state, callback) {
    if (this.listeners[state]) {
      this.listeners[state].push(callback);
    }
  }
  
  /**
   * Remove a listener
   * @param {'home' | 'game'} state 
   * @param {Function} callback 
   */
  off(state, callback) {
    if (this.listeners[state]) {
      const index = this.listeners[state].indexOf(callback);
      if (index > -1) {
        this.listeners[state].splice(index, 1);
      }
    }
  }
}
