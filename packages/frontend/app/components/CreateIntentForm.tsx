'use client'

import { useState } from 'react'
import { useAccount, useWalletClient } from 'wagmi'
import { INTENT_EIP712_DOMAIN, INTENT_EIP712_TYPES } from '@/lib/eip712'
import { Intent } from '@/lib/types'

const ORDERBOOK_API_URL = process.env.NEXT_PUBLIC_ORDERBOOK_API_URL || 'http://localhost:3001'

const CHAINS = [
  { id: 84532, name: 'Base Sepolia' },
  { id: 11155111, name: 'Sepolia' },
  { id: 421614, name: 'Arbitrum Sepolia' },
  { id: 31337, name: 'Localhost (Base)' },
  { id: 31338, name: 'Localhost (Sepolia)' },
  { id: 31339, name: 'Localhost (Arbitrum)' },
]

// Token addresses per chain (should match deployed contracts)
const TOKEN_ADDRESSES: Record<string, string> = {
  '84532': process.env.NEXT_PUBLIC_BASE_TOKEN_ADDRESS || '0xCdBb9C109Da8FF1423C753A9D4cEb85d680DC0fa', // Base Sepolia
  '11155111': process.env.NEXT_PUBLIC_SEPOLIA_TOKEN_ADDRESS || '0xDB6676239269Ae5b8665d9eF9656D6b272A8C7A8', // Sepolia
  '421614': process.env.NEXT_PUBLIC_ARBITRUM_TOKEN_ADDRESS || '0x0000000000000000000000000000000000000000', // Arbitrum Sepolia (needs to be set)
  '31337': process.env.NEXT_PUBLIC_BASE_TOKEN_ADDRESS || '0x0000000000000000000000000000000000000000', // Localhost Base
  '31338': process.env.NEXT_PUBLIC_SEPOLIA_TOKEN_ADDRESS || '0x0000000000000000000000000000000000000000', // Localhost Sepolia
  '31339': process.env.NEXT_PUBLIC_ARBITRUM_TOKEN_ADDRESS || '0x0000000000000000000000000000000000000000', // Localhost Arbitrum
}

export function CreateIntentForm() {
  const { address } = useAccount()
  const { data: walletClient } = useWalletClient()
  const [srcChainId, setSrcChainId] = useState<string>('84532')
  const [dstChainId, setDstChainId] = useState<string>('421614')
  const [amount, setAmount] = useState<string>('')
  const [minAmountOut, setMinAmountOut] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!address || !walletClient) {
      setError('Wallet not connected')
      return
    }

    setLoading(true)
    setError(null)
    setSuccess(null)

    try {
      const amountBigInt = BigInt(Math.floor(parseFloat(amount) * 1e6)) // USDC has 6 decimals
      const minAmountOutBigInt = minAmountOut
        ? BigInt(Math.floor(parseFloat(minAmountOut) * 1e6))
        : amountBigInt

      const expiry = BigInt(Math.floor(Date.now() / 1000) + 3600) // 1 hour from now
      const nonce = BigInt(Date.now()) // Simple nonce using timestamp

      const tokenAddress = TOKEN_ADDRESSES[srcChainId]
      if (!tokenAddress || tokenAddress === '0x0000000000000000000000000000000000000000') {
        throw new Error(`Token address not configured for chain ${srcChainId}`)
      }

      const intent: Intent = {
        user: address,
        srcChainId: BigInt(srcChainId),
        dstChainId: BigInt(dstChainId),
        token: tokenAddress as `0x${string}`,
        amount: amountBigInt,
        minAmountOut: minAmountOutBigInt,
        expiry,
        nonce,
      }

      // Sign the intent
      const domain = INTENT_EIP712_DOMAIN(intent.srcChainId)
      const signature = await walletClient.signTypedData({
        domain,
        types: INTENT_EIP712_TYPES,
        primaryType: 'Intent',
        message: intent,
      })

      // Submit to backend
      const response = await fetch(`${ORDERBOOK_API_URL}/intents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          intent: {
            ...intent,
            user: intent.user,
            srcChainId: intent.srcChainId.toString(),
            dstChainId: intent.dstChainId.toString(),
            token: intent.token,
            amount: intent.amount.toString(),
            minAmountOut: intent.minAmountOut.toString(),
            expiry: intent.expiry.toString(),
            nonce: intent.nonce.toString(),
          },
          signature,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to submit intent')
      }

      const result = await response.json()
      setSuccess(`Intent created successfully! ID: ${result.id}`)
      
      // Reset form
      setAmount('')
      setMinAmountOut('')
    } catch (err: any) {
      setError(err.message || 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
      <div>
        <label className="block text-sm font-medium mb-1">Source Chain</label>
        <select
          value={srcChainId}
          onChange={(e) => setSrcChainId(e.target.value)}
          className="w-full px-3 py-2 border rounded dark:bg-gray-800 dark:border-gray-700"
          required
        >
          {CHAINS.map((chain) => (
            <option key={chain.id} value={chain.id}>
              {chain.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Destination Chain</label>
        <select
          value={dstChainId}
          onChange={(e) => setDstChainId(e.target.value)}
          className="w-full px-3 py-2 border rounded dark:bg-gray-800 dark:border-gray-700"
          required
        >
          {CHAINS.filter((c) => c.id.toString() !== srcChainId).map((chain) => (
            <option key={chain.id} value={chain.id}>
              {chain.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Amount (USDC)</label>
        <input
          type="number"
          step="0.000001"
          min="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-full px-3 py-2 border rounded dark:bg-gray-800 dark:border-gray-700"
          placeholder="100.0"
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Min Amount Out (USDC, optional)</label>
        <input
          type="number"
          step="0.000001"
          min="0"
          value={minAmountOut}
          onChange={(e) => setMinAmountOut(e.target.value)}
          className="w-full px-3 py-2 border rounded dark:bg-gray-800 dark:border-gray-700"
          placeholder="Auto-fills to amount if empty"
        />
      </div>

      {error && (
        <div className="p-3 bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 rounded">
          {error}
        </div>
      )}

      {success && (
        <div className="p-3 bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 rounded">
          {success}
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? 'Creating Intent...' : 'Create Intent'}
      </button>
    </form>
  )
}

