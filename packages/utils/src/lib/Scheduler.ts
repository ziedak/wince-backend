import { setTimeout, setInterval, clearTimeout, clearInterval } from "timers";

interface Timer {
  type: "timeout" | "interval";
  id: NodeJS.Timeout | number; // Support both Node.js and browser environments
}

export interface IScheduler {
  setInterval(key: string, ms: number, callback: () => void): void;
  setTimeout(key: string, ms: number, callback: () => void): void;
  clear(key: string): void;
  clearAll(): void;
}

/**
 * Service for managing timeouts and intervals across the application
 * Prevents memory leaks by ensuring all timers are properly cleaned up
 */
export class Scheduler implements IScheduler {
  private timers: Map<string, Timer> = new Map();

  static create(): Scheduler {
    return new Scheduler();
  }

  /**
   * Set an interval with a unique key
   */
  public setInterval(key: string, ms: number, callback: () => void): void {
    this.clearInterval(key); // Clear any existing interval with this key
    const id = setInterval(callback, ms);
    this.timers.set(key, { type: "interval", id });
  }

  /**
   * Set a timeout with a unique key
   */
  public setTimeout(key: string, ms: number, callback: () => void): void {
    this.clearTimeout(key); // Clear any existing timeout with this key
    const id = setTimeout(() => {
      callback();
      this.timers.delete(key);
    }, ms);
    this.timers.set(key, { type: "timeout", id });
  }
  public clear(key: string): void {
    this.clearInterval(key);
    this.clearTimeout(key);
  }
  public clearByKeys(keys: string[]): void {
    keys.forEach((key) => {
      this.clear(key);
    });
  }

  /**
   * Clear an interval by key
   */
  private clearInterval(key: string): void {
    const timer = this.timers.get(key);
    if (timer?.type === "interval") {
      clearInterval(timer.id as NodeJS.Timeout);
      this.timers.delete(key);
    }
  }

  /**
   * Clear a timeout by key
   */
  private clearTimeout(key: string): void {
    const timer = this.timers.get(key);
    if (timer?.type === "timeout") {
      clearTimeout(timer.id as NodeJS.Timeout);
      this.timers.delete(key);
    }
  }

  /**
   * Clear all intervals and timeouts
   */
  public clearAll(): void {
    for (const [key, timer] of this.timers) {
      if (timer.type === "interval") {
        clearInterval(timer.id as NodeJS.Timeout);
      } else {
        clearTimeout(timer.id as NodeJS.Timeout);
      }
      this.timers.delete(key);
    }
  }
}