"use client"

import { Input } from "@/components/ui/input"
import { TokenSelector, type Network, type Token } from "./token-selector"
import { Pencil } from "lucide-react"
import { Button } from "@/components/ui/button"

interface InputCardProps {
  label: string
  amount: string
  onAmountChange: (value: string) => void
  equivalentValue: string
  token: Token
  network: Network
  networks: Network[]
  onNetworkChange: (network: Network) => void
  balance?: string
  address?: string
  onAddressChange?: (value: string) => void
  showAddress?: boolean
  addressLabel?: string
}

export function InputCard({
  label,
  amount,
  onAmountChange,
  equivalentValue,
  token,
  network,
  networks,
  onNetworkChange,
  balance,
  address,
  onAddressChange,
  showAddress = false,
  addressLabel = "Address",
}: InputCardProps) {
  return (
    <div className="rounded-2xl bg-card p-4 md:p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
        {showAddress && address && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="hidden sm:inline">{addressLabel}:</span>
            <span className="font-mono text-foreground text-xs sm:text-sm">
              {address.slice(0, 6)}...{address.slice(-4)}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => onAddressChange?.("")}
            >
              <Pencil className="h-3 w-3" />
            </Button>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-1 flex-1 min-w-0">
          <Input
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => {
              const value = e.target.value
              if (/^\d*\.?\d*$/.test(value)) {
                onAmountChange(value)
              }
            }}
            className="border-0 bg-transparent text-3xl md:text-4xl font-semibold text-foreground placeholder:text-muted-foreground/50 p-0 h-auto focus-visible:ring-0"
          />
          <span className="text-sm text-muted-foreground">{equivalentValue}</span>
        </div>
        <TokenSelector
          token={token}
          network={network}
          networks={networks}
          onNetworkChange={onNetworkChange}
          balance={balance}
        />
      </div>
    </div>
  )
}
