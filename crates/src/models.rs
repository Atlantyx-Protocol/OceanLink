use serde::{Deserialize, Serialize};
use std::fmt;
use uuid::Uuid;

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum ChainId {
    Base,
    Arbitrum,
}

impl fmt::Display for ChainId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ChainId::Base => write!(f, "Base"),
            ChainId::Arbitrum => write!(f, "Arbitrum"),
        }
    }
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub enum IntentStatus {
    PendingRisk,
    InOrderbook,
    Matched,
    Executed,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Intent {
    pub id: Uuid,
    pub user_id: String,
    pub from_chain: ChainId,
    pub to_chain: ChainId,
    pub amount: u64,
    pub status: IntentStatus,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct LocalTx {
    pub from_user: String,
    pub to_user: String,
    pub chain: ChainId,
    pub amount: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NettingSolution {
    pub txs: Vec<LocalTx>,
    pub involved_intent_ids: Vec<Uuid>,
}
