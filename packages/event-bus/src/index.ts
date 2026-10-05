// Empty on purpose: each module adds its events through interface augmentation.
export interface DomainEvents {}

export type DomainEventName = keyof DomainEvents;

export type DomainEventListener<N extends DomainEventName> = (payload: DomainEvents[N]) => void;

export type EventBus = {
  emit<N extends DomainEventName>(name: N, payload: DomainEvents[N]): void;
  on<N extends DomainEventName>(name: N, listener: DomainEventListener<N>): () => void;
};

export type ListenerErrorHandler = (error: unknown, name: DomainEventName) => void;

export function createEventBus(
  onListenerError: ListenerErrorHandler = (error, name) => {
    console.error(`A listener of "${String(name)}" failed`, error);
  },
): EventBus {
  const listeners = new Map<DomainEventName, Set<(payload: never) => void>>();

  return {
    emit(name, payload) {
      for (const listener of listeners.get(name) ?? []) {
        try {
          (listener as DomainEventListener<typeof name>)(payload);
        } catch (error) {
          onListenerError(error, name);
        }
      }
    },
    on(name, listener) {
      const set = listeners.get(name) ?? new Set();
      listeners.set(name, set);
      set.add(listener);
      return () => {
        set.delete(listener);
      };
    },
  };
}

export const events: EventBus = createEventBus();
