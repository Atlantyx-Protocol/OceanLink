'use client'

import { useAccount, useConnect, useDisconnect } from 'wagmi'
import { CreateIntentForm } from './components/CreateIntentForm'
import { MyIntentsList } from './components/MyIntentsList'

export default function Home() {
  const { address, isConnected } = useAccount()
  const { connect, connectors } = useConnect()
  const { disconnect } = useDisconnect()

  return (
    <main className="min-h-screen p-8 max-w-6xl mx-auto">
      <header className="mb-8">
        <h1 className="text-4xl font-bold mb-4">OceanLink</h1>
        <p className="text-gray-600 dark:text-gray-400 mb-4">
          Cross-Chain Stablecoin Netting Protocol MVP
        </p>
        <div className="flex items-center gap-4">
          {isConnected ? (
            <>
              <div className="px-4 py-2 bg-green-100 dark:bg-green-900 rounded">
                Connected: {address?.slice(0, 6)}...{address?.slice(-4)}
              </div>
              <button
                onClick={() => disconnect()}
                className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
              >
                Disconnect
              </button>
            </>
          ) : (
            <div className="flex gap-2">
              {connectors.map((connector) => (
                <button
                  key={connector.uid}
                  onClick={() => connect({ connector })}
                  className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                >
                  Connect {connector.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      {isConnected ? (
        <div className="space-y-8">
          <section>
            <h2 className="text-2xl font-semibold mb-4">Create Intent</h2>
            <CreateIntentForm />
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">My Intents</h2>
            <MyIntentsList />
          </section>
        </div>
      ) : (
        <div className="text-center py-12 text-gray-500">
          Please connect your wallet to continue
        </div>
      )}
    </main>
  )
}

