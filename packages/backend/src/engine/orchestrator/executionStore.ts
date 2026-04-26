// ---------------------------------------------------------------------------
// Execution state — stored per matchId so the API can expose it
// ---------------------------------------------------------------------------

export interface ExecutionWithdraw {
  fillId: string;
  secret: string;
  receiverAddress: string;
}

export interface ExecutionData {
  presidingOrder: {
    orderId: string;
    chain: string;
    withdraws: ExecutionWithdraw[];
  };
  respondingWithdraws: Array<{
    orderId: string;
    fillId: string;
    chain: string;
    secret: string;
    receiverAddress: string;
  }>;
}

export interface ExecutionRecord {
  status: 'pending' | 'done' | 'error';
  data?: ExecutionData;
  error?: string;
}

export class ExecutionStore {
  private readonly records = new Map<string, ExecutionRecord>();

  get(matchId: string): ExecutionRecord | undefined {
    return this.records.get(matchId);
  }

  set(matchId: string, record: ExecutionRecord): void {
    this.records.set(matchId, record);
  }
}
