"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { InputCard } from "./input-card"
import { ArrowDownUp } from "lucide-react"
import type { Network, Token } from "./token-selector"

const NETWORKS: Network[] = [
  { id: "ethereum-sepolia", name: "Ethereum Sepolia", icon: "⟠" },
  { id: "arbitrum-sepolia", name: "Arbitrum Sepolia", icon: "🔵" },
  { id: "base-sepolia", name: "Base Sepolia", icon: "🔷" },
]

const USDC_TOKEN: Token = {
  symbol: "USDC",
  name: "USD Coin",
  icon: "💲",
}

interface BridgeCardProps {
  isConnected: boolean
  onConnectWallet: () => void
}

export function BridgeCard({ isConnected, onConnectWallet }: BridgeCardProps) {
  const [fromAmount, setFromAmount] = useState("")
  const [toAmount, setToAmount] = useState("")
  const [fromNetwork, setFromNetwork] = useState(NETWORKS[0])
  const [toNetwork, setToNetwork] = useState(NETWORKS[1])
  const [fromAddress, setFromAddress] = useState("0x1234567890abcdef1234567890abcdef12345678")
  const [toAddress, setToAddress] = useState("0x742d35Cc6634C0532925a3b844Bc454e4438f44e")

  const handleSwapDirection = () => {
    const tempNetwork = fromNetwork
    const tempAmount = fromAmount
    setFromNetwork(toNetwork)
    setToNetwork(tempNetwork)
    setFromAmount(toAmount)
    setToAmount(tempAmount)
  }

  const handleFromAmountChange = (value: string) => {
    setFromAmount(value)
    // In a real app, this would calculate based on exchange rates/fees
    setToAmount(value)
  }

  const handleToAmountChange = (value: string) => {
    setToAmount(value)
    setFromAmount(value)
  }

  const formatUsdValue = (amount: string) => {
    const num = parseFloat(amount) || 0
    return `≈ $${num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }

  return (
    <div className="w-full max-w-md mx-auto">
      <div className="rounded-3xl bg-secondary/50 p-3 md:p-4">
        <InputCard
          label="From"
          amount={fromAmount}
          onAmountChange={handleFromAmountChange}
          equivalentValue={formatUsdValue(fromAmount)}
          token={USDC_TOKEN}
          network={fromNetwork}
          networks={NETWORKS}
          onNetworkChange={setFromNetwork}
          balance={isConnected ? "1,234.56" : undefined}
          address={fromAddress}
          onAddressChange={setFromAddress}
          showAddress={isConnected}
          addressLabel="From"
        />

        <div className="relative py-2">
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <Button
              variant="secondary"
              size="icon"
              onClick={handleSwapDirection}
              className="h-10 w-10 rounded-xl bg-secondary hover:bg-secondary/80 border border-border shadow-lg transition-transform hover:scale-105"
            >
              <ArrowDownUp className="h-4 w-4 text-foreground" />
            </Button>
          </div>
        </div>

        <InputCard
          label="To"
          amount={toAmount}
          onAmountChange={handleToAmountChange}
          equivalentValue={formatUsdValue(toAmount)}
          token={USDC_TOKEN}
          network={toNetwork}
          networks={NETWORKS}
          onNetworkChange={setToNetwork}
          balance={isConnected ? "567.89" : undefined}
          address={toAddress}
          onAddressChange={setToAddress}
          showAddress={isConnected}
          addressLabel="To"
        />

        <div className="mt-4">
          {isConnected ? (
            <Button
              className="w-full h-14 text-base font-semibold rounded-xl bg-accent hover:bg-accent/90 text-accent-foreground"
              disabled={!fromAmount || parseFloat(fromAmount) <= 0}
            >
              {!fromAmount || parseFloat(fromAmount) <= 0
                ? "Enter an amount"
                : "Bridge"}
            </Button>
          ) : (
            <Button
              onClick={onConnectWallet}
              className="w-full h-14 text-base font-semibold rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              Connect Wallet
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
