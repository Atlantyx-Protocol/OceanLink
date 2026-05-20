import { EventEmitter } from 'node:events';

// in-process pub/sub for per-order lifecycle events. producers:
// matchingService, orchestrator. consumers: SSE route (GET /orders/:id/events).
// single EventEmitter on event name 'order'; subscribers filter by orderId.

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
    // allow many concurrent SSE subscribers without Node's default warning
    this.setMaxListeners(0);
  }

  publish(event: Omit<OrderEvent, 'timestamp'>): void {
    const full: OrderEvent = { ...event, timestamp: Date.now() };
    this.emit('order', full);
  }

  // emit the same event for a batch of orderIds (e.g. all orders in a match)
  publishMany(orderIds: string[], event: Omit<OrderEvent, 'timestamp' | 'orderId'>): void {
    for (const orderId of orderIds) {
      this.publish({ ...event, orderId });
    }
  }
}

export const orderEvents = new OrderEventBus();
