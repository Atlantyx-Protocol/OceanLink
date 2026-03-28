"use client"

import { useState } from "react"
import { Header } from "@/components/bridge/header"
import { BridgeCard } from "@/components/bridge/bridge-card"
import { Footer } from "@/components/bridge/footer"

export default function BridgePage() {
  const [isConnected, setIsConnected] = useState(false)

  const handleConnectWallet = () => {
    // Placeholder for wallet connection logic (wagmi, viem integration)
    setIsConnected(!isConnected)
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header onConnectWallet={handleConnectWallet} isConnected={isConnected} />
      
      <main className="flex-1 flex items-center justify-center px-4 py-8">
        <BridgeCard
          isConnected={isConnected}
          onConnectWallet={handleConnectWallet}
        />
      </main>

      <Footer />
    </div>
  )
}
