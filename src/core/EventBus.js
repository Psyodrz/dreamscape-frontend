/**
 * EventBus - Lightweight pub/sub system for decoupled communication
 *
 * Usage:
 *   events.on('event-name', callback)    → Subscribe (returns unsubscribe fn)
 *   events.emit('event-name', data)      → Publish
 *   events.off('event-name', callback)   → Unsubscribe
 *
 * @fileoverview Zero-dependency event system for UI ↔ Core communication
 */

class EventBus {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this.listeners = new Map();
  }

  /**
   * Subscribe to an event
   * @param {string} event - Event name
   * @param {Function} callback - Handler function
   * @returns {Function} Unsubscribe function (call to remove listener)
   */
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);

    // Return unsubscribe function for easy cleanup
    return () => this.off(event, callback);
  }

  /**
   * Subscribe to an event for ONE emission only
   * @param {string} event - Event name
   * @param {Function} callback - Handler function
   */
  once(event, callback) {
    const wrapper = (data) => {
      this.off(event, wrapper);
      callback(data);
    };
    this.on(event, wrapper);
  }

  /**
   * Unsubscribe from an event
   * @param {string} event - Event name
   * @param {Function} callback - Handler to remove
   */
  off(event, callback) {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.delete(callback);
      if (handlers.size === 0) {
        this.listeners.delete(event);
      }
    }
  }

  /**
   * Emit an event to all subscribers
   * @param {string} event - Event name
   * @param {*} [data] - Optional data payload
   */
  emit(event, data) {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.forEach((callback) => {
        try {
          callback(data);
        } catch (error) {
          console.error(`[EventBus] Error in handler for "${event}":`, error);
        }
      });
    }
  }

  /**
   * Remove all listeners (use sparingly, mainly for testing)
   */
  clear() {
    this.listeners.clear();
  }

  /**
   * Debug: log all registered events
   */
  debug() {
    console.log("[EventBus] Registered events:", [...this.listeners.keys()]);
  }
}

// Singleton instance for app-wide use
const events = new EventBus();

export { EventBus, events };
export default events;
