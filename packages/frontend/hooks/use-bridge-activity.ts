'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { env } from '@/config/env';

// short enough that new orders and status transitions feel "live", but won't
// hammer the backend when the user idles on the page.
const POLL_INTERVAL_MS = 4_000;

export type BridgeOrderStatus =
  | 'QUEUED'
  | 'PARTIAL'
  | 'MATCHED'
  | 'COMPLETED'
  | 'FAILED'
  | 'EXPIRED';

export interface BridgeOrder {
  orderId: string;
  srcChain: number;
  desChain: number;
  amount: string;
  incentiveFee?: string;
  deadline: number;
  createdAt: number;
  status: BridgeOrderStatus;
  userAddress: string;
}

interface OrdersResponse {
  data: BridgeOrder[];
  total: number;
  page: number;
  pageSize: number;
}

export interface UseBridgeActivityResult {
  orders: BridgeOrder[];
  total: number;
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useBridgeActivity(
  address: `0x${string}` | undefined,
  pageSize = 20
): UseBridgeActivityResult {
  const [orders, setOrders] = useState<BridgeOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // distinguishes the first load (full spinner) from background refreshes
  const hasLoadedRef = useRef(false);

  const fetchOrders = useCallback(async () => {
    if (!address) {
      setOrders([]);
      setTotal(0);
      hasLoadedRef.current = false;
      return;
    }

    if (hasLoadedRef.current) setIsRefreshing(true);
    else setIsLoading(true);

    try {
      const url = `${env.backendUrl}/api/orders?userAddress=${address}&pageSize=${pageSize}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const json = (await res.json()) as OrdersResponse;
      setOrders(json.data);
      setTotal(json.total);
      setError(null);
      hasLoadedRef.current = true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load activity');
      if (!hasLoadedRef.current) {
        setOrders([]);
        setTotal(0);
      }
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [address, pageSize]);

  useEffect(() => {
    void fetchOrders();
  }, [fetchOrders]);

  useEffect(() => {
    if (!address) return;
    return startVisibilityAwarePoll(fetchOrders);
  }, [address, fetchOrders]);

  return { orders, total, isLoading, isRefreshing, error, refetch: fetchOrders };
}

// polls while the document is visible. pauses on hidden tabs and refetches
// immediately when the tab regains focus.
function startVisibilityAwarePoll(fetcher: () => Promise<void>): () => void {
  let timer: ReturnType<typeof setInterval> | null = null;

  const start = () => {
    if (timer !== null) return;
    timer = setInterval(() => {
      if (document.visibilityState === 'visible') void fetcher();
    }, POLL_INTERVAL_MS);
  };

  const stop = () => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  const onVisibility = () => {
    if (document.visibilityState === 'visible') {
      void fetcher();
      start();
    } else {
      stop();
    }
  };

  document.addEventListener('visibilitychange', onVisibility);
  if (document.visibilityState === 'visible') start();

  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
    stop();
  };
}
