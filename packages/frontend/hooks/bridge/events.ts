import type { OrderStatus } from './types';

export interface ServerOrderEvent {
  orderId: string;
  type: 'queued' | 'matched' | 'plan' | 'htlc_created' | 'withdrawn' | 'done' | 'error';
  message: string;
  data?: Record<string, unknown>;
  timestamp: number;
}

export interface Withdrawal {
  chain: string;
  txHash: string;
}

export const EVENT_TO_STATUS: Record<ServerOrderEvent['type'], OrderStatus | null> = {
  queued: 'QUEUED',
  matched: 'MATCHED',
  plan: 'MATCHED',
  htlc_created: 'MATCHED',
  withdrawn: 'MATCHED',
  done: 'COMPLETED',
  error: 'FAILED',
};
