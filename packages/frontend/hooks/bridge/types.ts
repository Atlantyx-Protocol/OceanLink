import type { SupportedChain } from '@/config/chains';

export type BridgeStep =
  | 'idle'
  | 'checking'
  | 'approving'
  | 'submitting'
  | 'tracking'
  | 'done'
  | 'error';

// mirrors backend OrderStatus
export type OrderStatus = 'QUEUED' | 'PARTIAL' | 'MATCHED' | 'COMPLETED' | 'FAILED' | 'EXPIRED';

export interface BridgeState {
  step: BridgeStep;
  approvalTxHash: `0x${string}` | null;
  orderId: string | null;
  orderStatus: OrderStatus | null;
  error: string | null;
  isLoading: boolean;
}

export interface BridgeParams {
  amount: string;
  srcChain: SupportedChain;
  desChain: SupportedChain;
  userAddress: `0x${string}`;
  incentiveFee?: string;
  // override the default 30-minute deadline (in seconds)
  deadlineSeconds?: number;
}
