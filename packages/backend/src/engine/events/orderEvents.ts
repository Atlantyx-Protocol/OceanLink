import { EventEmitter } from 'node:events';

// ---------------------------------------------------------------------------
// OrderEventBus — in-process pub/sub for per-order lifecycle events.
//
// Producers: matchingService, orchestrator.
// Consumers: SSE route (GET /orders/:id/events) forwards matching events
// to the connected browser.
//
// This is intentionally simple: a single EventEmitter, one event name
// ('order'), subscribers filter by orderId.
// ---------------------------------------------------------------------------

export type OrderEventType =
  | 'queued'
  | 'matched'
  | 'plan'
  | 'htlc_created'
  | 'withdrawn'
  | 'done'
  | 'error';

export interface OrderEvent {
  orderId: string;
  type: OrderEventType;
  message: string;
  data?: Record<string, unknown>;
  timestamp: number;
}

class OrderEventBus extends EventEmitter {
  constructor() {
    super();
    // Allow many concurrent SSE subscribers without Node's default warning.
    this.setMaxListeners(0);
  }

  publish(event: Omit<OrderEvent, 'timestamp'>): void {
    const full: OrderEvent = { ...event, timestamp: Date.now() };
    this.emit('order', full);
  }

  /** Emit the same event for a batch of orderIds (e.g. all orders in a match). */
  publishMany(orderIds: string[], event: Omit<OrderEvent, 'timestamp' | 'orderId'>): void {
    for (const orderId of orderIds) {
      this.publish({ ...event, orderId });
    }
  }
}

export const orderEvents = new OrderEventBus();
