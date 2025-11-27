use crate::models::ChainId;
use async_trait::async_trait;
use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
};
use thiserror::Error;

pub type TxHash = String;

#[derive(Debug, Error)]
pub enum BlockchainError {
    #[error("transfer failed: {0}")]
    TransferFailed(String),
}

#[derive(Clone, Debug)]
pub struct RecordedTx {
    pub chain: ChainId,
    pub from_user: String,
    pub to_user: String,
    pub amount: u64,
    pub tx_hash: TxHash,
}

#[async_trait]
pub trait BlockchainClient: Send + Sync + Clone + 'static {
    async fn send_local_transfer(
        &self,
        chain: ChainId,
        from_user: &str,
        to_user: &str,
        amount: u64,
    ) -> Result<TxHash, BlockchainError>;
}

#[derive(Default, Clone)]
pub struct MockBlockchainClient {
    inner: Arc<MockBlockchainInner>,
}

#[derive(Default)]
struct MockBlockchainInner {
    recorded: Mutex<Vec<RecordedTx>>,
    balances: Mutex<HashMap<(ChainId, String), u64>>,
    counter: AtomicU64,
}

impl MockBlockchainClient {
    pub fn set_balance(&self, chain: ChainId, user: &str, amount: u64) {
        let mut balances = self.inner.balances.lock().expect("balances lock poisoned");
        balances.insert((chain, user.to_string()), amount);
    }

    pub fn balance(&self, chain: ChainId, user: &str) -> u64 {
        let balances = self.inner.balances.lock().expect("balances lock poisoned");
        *balances.get(&(chain, user.to_string())).unwrap_or(&0)
    }

    pub fn recorded_txs(&self) -> Vec<RecordedTx> {
        let recorded = self.inner.recorded.lock().expect("recorded lock poisoned");
        recorded.clone()
    }
}

#[async_trait]
impl BlockchainClient for MockBlockchainClient {
    async fn send_local_transfer(
        &self,
        chain: ChainId,
        from_user: &str,
        to_user: &str,
        amount: u64,
    ) -> Result<TxHash, BlockchainError> {
        let mut balances = self.inner.balances.lock().expect("balances lock poisoned");
        let from_key = (chain, from_user.to_string());
        let to_key = (chain, to_user.to_string());

        let from_balance = balances.get_mut(&from_key).ok_or_else(|| {
            BlockchainError::TransferFailed(format!("missing balance for {}", from_user))
        })?;

        if *from_balance < amount {
            return Err(BlockchainError::TransferFailed(format!(
                "insufficient balance for {}",
                from_user
            )));
        }

        *from_balance -= amount;
        let to_balance = balances.entry(to_key).or_insert(0);
        *to_balance += amount;
        drop(balances);

        let tx_hash = format!(
            "tx-{}",
            self.inner
                .counter
                .fetch_add(1, Ordering::SeqCst)
                .to_string()
        );

        let mut recorded = self.inner.recorded.lock().expect("recorded lock poisoned");
        recorded.push(RecordedTx {
            chain,
            from_user: from_user.to_string(),
            to_user: to_user.to_string(),
            amount,
            tx_hash: tx_hash.clone(),
        });
        Ok(tx_hash)
    }
}
