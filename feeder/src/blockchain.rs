use ethers::{
    core::types::{Address, Bytes, U256},
    middleware::SignerMiddleware,
    providers::{Http, Middleware, Provider},
    signers::LocalWallet,
    types::TransactionRequest,
};
use std::str::FromStr;
use std::sync::Arc;

pub struct BlockchainClient {
    base_rpc: String,
    base_token_address: Address,
    b_private_key: String,
    c_private_key: String,
    d_private_key: String,
}

impl BlockchainClient {
    pub fn new(
        base_rpc: String,
        base_token_address: Address,
        b_private_key: String,
        c_private_key: String,
        d_private_key: String,
    ) -> Self {
        Self {
            base_rpc,
            base_token_address,
            b_private_key,
            c_private_key,
            d_private_key,
        }
    }

    pub async fn send_erc20_transfer(&self, from: &str, to: &str, amount: u64) -> Result<String, String> {
        let provider = Provider::<Http>::try_from(&self.base_rpc)
            .map_err(|e| format!("Failed to create provider: {e}"))?;

        let private_key = match from {
            "0x3aca6e32bd6268ba2b834e6f23405e10575d19b2" | "0x3ACa6E32BD6268ba2b834e6F23405e10575d19B2" => {
                &self.b_private_key
            }
            "0x7cb386178d13e21093fdc988c7e77102d6464f3e" | "0x7CB386178D13e21093FDc988C7e77102D6464F3E" => {
                &self.c_private_key
            }
            "0xe08745df99d3563821b633aa93ee02f7f883f25c" | "0xE08745df99d3563821b633aA93Ee02F7F883F25c" => {
                &self.d_private_key
            }
            _ => return Err(format!("Unknown sender address: {from}")),
        };

        let wallet = LocalWallet::from_str(private_key)
            .map_err(|e| format!("Invalid private key: {e}"))?;
        let to_addr = Address::from_str(to)
            .map_err(|e| format!("Invalid to address: {e}"))?;

        // ERC20 transfer function signature: transfer(address to, uint256 amount)
        // Function selector: 0xa9059cbb
        let mut data = vec![0xa9u8, 0x05u8, 0x9cu8, 0xbbu8];

        // Encode to address (32 bytes, right-aligned)
        let mut to_bytes = [0u8; 32];
        to_bytes[12..].copy_from_slice(to_addr.as_bytes());
        data.extend_from_slice(&to_bytes);

        // Encode amount (32 bytes) - USDT has 6 decimals
        let amount_u256 = U256::from(amount) * U256::from(1_000_000u64); // Convert to wei-equivalent
        let mut amount_bytes = [0u8; 32];
        amount_u256.to_big_endian(&mut amount_bytes);
        data.extend_from_slice(&amount_bytes);

        // Combine wallet + provider into a signing client
        let wallet_with_provider = SignerMiddleware::new(provider, wallet);

        let tx = TransactionRequest::new()
            .to(self.base_token_address)
            .data(Bytes::from(data));

        let pending_tx = wallet_with_provider
            .send_transaction(tx, None)
            .await
            .map_err(|e| format!("Failed to send transaction: {e}"))?;

        let tx_hash = pending_tx.tx_hash();
        Ok(format!("{tx_hash:#x}"))
    }
}

pub type SharedBlockchainClient = Arc<BlockchainClient>;
