'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001';

// auto-refresh interval while page is visible — short enough that new orders
// and status transitions appear "live" without hammering the backend.
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

interface UseBridgeActivityResult {
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

  // tracks whether this is the first load (full spinner) vs a background
  // refresh (small indicator)
  const hasLoadedRef = useRef(false);

  const fetchOrders = useCallback(async () => {
    if (!address) {
      setOrders([]);
      setTotal(0);
      hasLoadedRef.current = false;
      return;
    }

    if (hasLoadedRef.current) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    try {
      const url = `${BACKEND_URL}/api/orders?userAddress=${address}&pageSize=${pageSize}`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
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

  // initial fetch + refetch when address changes
  useEffect(() => {
    void fetchOrders();
  }, [fetchOrders]);

  // poll while document is visible. pauses on hidden tabs to save resources
  // and immediately refetches when the tab regains focus.
  useEffect(() => {
    if (!address) return;

    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer !== null) return;
      timer = setInterval(() => {
        if (document.visibilityState === 'visible') {
          void fetchOrders();
        }
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
        void fetchOrders();
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
  }, [address, fetchOrders]);

  return { orders, total, isLoading, isRefreshing, error, refetch: fetchOrders };
}
