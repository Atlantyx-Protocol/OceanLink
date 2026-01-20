import { Address, TypedDataDomain, TypedDataField } from "viem";

export const INTENT_EIP712_DOMAIN = (chainId: bigint): TypedDataDomain => ({
  name: "OceanLink",
  version: "1",
  chainId: chainId,
  verifyingContract: "0x0000000000000000000000000000000000000000" as Address,
});

export const INTENT_EIP712_TYPES: Record<string, TypedDataField[]> = {
  Intent: [
    { name: "user", type: "address" },
    { name: "srcChainId", type: "uint256" },
    { name: "dstChainId", type: "uint256" },
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "minAmountOut", type: "uint256" },
    { name: "expiry", type: "uint256" },
    { name: "nonce", type: "uint256" },
  ],
};

