use crate::blockchain::{BlockchainClient, BlockchainError};
use crate::models::NettingSolution;
use std::fmt;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ExecutionError {
    #[error("blockchain error: {0}")]
    Blockchain(#[from] BlockchainError),
}

pub struct Executor<C>
where
    C: BlockchainClient,
{
    client: C,
}

impl<C> Executor<C>
where
    C: BlockchainClient,
{
    pub fn new(client: C) -> Self {
        Self { client }
    }

    pub fn client(&self) -> C {
        self.client.clone()
    }

    pub async fn execute_solution(&self, solution: &NettingSolution) -> Result<(), ExecutionError> {
        for tx in &solution.txs {
            self.client
                .send_local_transfer(tx.chain, &tx.from_user, &tx.to_user, tx.amount)
                .await?;
        }
        Ok(())
    }
}

impl<C> fmt::Debug for Executor<C>
where
    C: BlockchainClient,
{
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Executor").finish_non_exhaustive()
    }
}
