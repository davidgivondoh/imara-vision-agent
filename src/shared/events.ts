type Listener = (...args: unknown[]) => void

export class EventBus {
  private listeners = new Map<string, Set<Listener>>()

  on(event: string, listener: Listener): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)!.add(listener)

    return () => {
      this.listeners.get(event)?.delete(listener)
    }
  }

  once(event: string, listener: Listener): () => void {
    const wrapper: Listener = (...args) => {
      unsub()
      listener(...args)
    }
    const unsub = this.on(event, wrapper)
    return unsub
  }

  emit(event: string, ...args: unknown[]): void {
    const handlers = this.listeners.get(event)
    if (!handlers) return
    for (const handler of handlers) {
      try {
        handler(...args)
      } catch (err) {
        console.error(`[EventBus] Error in handler for "${event}":`, err)
      }
    }
  }

  off(event: string, listener?: Listener): void {
    if (!listener) {
      this.listeners.delete(event)
    } else {
      this.listeners.get(event)?.delete(listener)
    }
  }

  removeAll(): void {
    this.listeners.clear()
  }
}

export const globalBus = new EventBus()
