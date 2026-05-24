import { env } from '@/config/env';
import type { ServerOrderEvent } from './events';

// opens an SSE stream for orderId. invokes onEvent for every parsed event,
// then auto-closes on the terminal 'done' / 'error' events. SSE must hit the
// backend directly — not through the Next.js proxy.
export function subscribeToOrderEvents(
  orderId: string,
  onEvent: (event: ServerOrderEvent) => void
): void {
  const url = `${env.backendUrl}/api/orders/${orderId}/events`;
  const es = new EventSource(url);

  es.onmessage = (e) => {
    let event: ServerOrderEvent;
    try {
      event = JSON.parse(e.data);
    } catch {
      return;
    }
    onEvent(event);
    if (event.type === 'done' || event.type === 'error') {
      es.close();
    }
  };

  es.onerror = () => {
    es.close();
  };
}
