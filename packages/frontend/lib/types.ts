export type Intent = {
  user: string; // EVM address
  srcChainId: bigint;
  dstChainId: bigint;
  token: string; // USDC address (on srcChain)
  amount: bigint; // amount user wants to send
  minAmountOut: bigint;
  expiry: bigint; // unix timestamp
  nonce: bigint;
};

