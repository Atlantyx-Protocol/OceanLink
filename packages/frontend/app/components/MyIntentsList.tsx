'use client'

import { useAccount } from 'wagmi'
import { useQuery } from '@tanstack/react-query'

const ORDERBOOK_API_URL = process.env.NEXT_PUBLIC_ORDERBOOK_API_URL || 'http://localhost:3001'

const CHAIN_NAMES: Record<string, string> = {
  '84532': 'Base Sepolia',
  '11155111': 'Sepolia',
  '421614': 'Arbitrum Sepolia',
  '31337': 'Localhost (Base)',
  '31338': 'Localhost (Sepolia)',
  '31339': 'Localhost (Arbitrum)',
}

type Intent = {
  id: number
  user: string
  srcChainId: string
  dstChainId: string
  token: string
  amount: string
  minAmountOut: string
  expiry: string
  nonce: string
  status: string
  createdAt: string
  updatedAt: string
}

async function fetchIntents(userAddress: string): Promise<Intent[]> {
  const response = await fetch(`${ORDERBOOK_API_URL}/intents?user_address=${userAddress}`)
  if (!response.ok) {
    throw new Error('Failed to fetch intents')
  }
  return response.json()
}

export function MyIntentsList() {
  const { address } = useAccount()

  const { data: intents, isLoading, error } = useQuery({
    queryKey: ['intents', address],
    queryFn: () => fetchIntents(address!),
    enabled: !!address,
    refetchInterval: 5000, // Refetch every 5 seconds
  })

  if (!address) {
    return <div className="text-gray-500">Connect wallet to view intents</div>
  }

  if (isLoading) {
    return <div className="text-gray-500">Loading intents...</div>
  }

  if (error) {
    return <div className="text-red-500">Error loading intents: {String(error)}</div>
  }

  if (!intents || intents.length === 0) {
    return <div className="text-gray-500">No intents found</div>
  }

  const formatAmount = (amount: string) => {
    const num = BigInt(amount) / BigInt(1e6)
    return num.toString() + '.' + (BigInt(amount) % BigInt(1e6)).toString().padStart(6, '0')
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse border border-gray-300 dark:border-gray-700">
        <thead>
          <tr className="bg-gray-100 dark:bg-gray-800">
            <th className="border border-gray-300 dark:border-gray-700 px-4 py-2 text-left">ID</th>
            <th className="border border-gray-300 dark:border-gray-700 px-4 py-2 text-left">Route</th>
            <th className="border border-gray-300 dark:border-gray-700 px-4 py-2 text-left">Amount</th>
            <th className="border border-gray-300 dark:border-gray-700 px-4 py-2 text-left">Status</th>
            <th className="border border-gray-300 dark:border-gray-700 px-4 py-2 text-left">Created</th>
          </tr>
        </thead>
        <tbody>
          {intents.map((intent) => (
            <tr key={intent.id} className="hover:bg-gray-50 dark:hover:bg-gray-900">
              <td className="border border-gray-300 dark:border-gray-700 px-4 py-2">{intent.id}</td>
              <td className="border border-gray-300 dark:border-gray-700 px-4 py-2">
                {CHAIN_NAMES[intent.srcChainId] || intent.srcChainId} →{' '}
                {CHAIN_NAMES[intent.dstChainId] || intent.dstChainId}
              </td>
              <td className="border border-gray-300 dark:border-gray-700 px-4 py-2">
                {formatAmount(intent.amount)} USDC
              </td>
              <td className="border border-gray-300 dark:border-gray-700 px-4 py-2">
                <span
                  className={`px-2 py-1 rounded text-xs ${
                    intent.status === 'EXECUTED'
                      ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200'
                      : intent.status === 'MATCHED'
                      ? 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200'
                      : intent.status === 'PENDING'
                      ? 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200'
                  }`}
                >
                  {intent.status}
                </span>
              </td>
              <td className="border border-gray-300 dark:border-gray-700 px-4 py-2">
                {new Date(intent.createdAt).toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

