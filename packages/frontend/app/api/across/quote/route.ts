import { NextRequest, NextResponse } from 'next/server';
import { env } from '@/config/env';

const TESTNET_BASE_URL = 'https://testnet.across.to/api';
const MAINNET_BASE_URL = 'https://app.across.to/api';

// only forward recognized params to the upstream Across API
const ALLOWED_PARAMS = new Set([
  'tradeType',
  'originChainId',
  'destinationChainId',
  'inputToken',
  'outputToken',
  'amount',
  'depositor',
  'recipient',
  'integratorId',
]);

export async function GET(request: NextRequest) {
  const incoming = request.nextUrl.searchParams;

  // sanitized query string with only whitelisted keys
  const filtered = new URLSearchParams();
  for (const key of ALLOWED_PARAMS) {
    const value = incoming.get(key);
    if (value) filtered.set(key, value);
  }

  // minimum required params
  if (!filtered.get('amount') || !filtered.get('originChainId') || !filtered.get('depositor')) {
    return NextResponse.json(
      { success: false, error: 'Missing required parameters' },
      { status: 400 }
    );
  }

  const isTestnet = env.network === 'testnet';
  const baseUrl = isTestnet ? TESTNET_BASE_URL : MAINNET_BASE_URL;
  const apiKey = env.across.apiKey;

  const headers: HeadersInit = {};
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  try {
    const upstreamRes = await fetch(`${baseUrl}/swap/approval?${filtered}`, { headers });
    const body = await upstreamRes.text();

    return new NextResponse(body, {
      status: upstreamRes.status,
      headers: {
        'Content-Type': upstreamRes.headers.get('Content-Type') || 'application/json',
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ success: false, error: msg }, { status: 502 });
  }
}
