use crate::blockchain::MockBlockchainClient;
use crate::executor::{ExecutionError, Executor};
use crate::models::{Intent, IntentStatus, NettingSolution};
use crate::risk::RiskEngine;
use crate::solver::compute_solution;
use crate::state::SharedState;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::Arc;
use uuid::Uuid;

#[derive(Clone)]
pub struct AppContext {
    pub state: SharedState,
    pub risk_engine: Arc<dyn RiskEngine + Send + Sync>,
    pub executor: Arc<Executor<MockBlockchainClient>>,
}

impl AppContext {
    pub fn new(
        state: SharedState,
        risk_engine: Arc<dyn RiskEngine + Send + Sync>,
        executor: Arc<Executor<MockBlockchainClient>>,
    ) -> Self {
        Self {
            state,
            risk_engine,
            executor,
        }
    }

    pub async fn create_intent(&self, req: CreateIntentRequest) -> Intent {
        let mut intent = Intent {
            id: Uuid::new_v4(),
            user_id: req.user_id,
            from_chain: req.from_chain,
            to_chain: req.to_chain,
            amount: req.amount,
            signature: req.signature,
            status: IntentStatus::PendingRisk,
        };

        {
            let mut guard = self.state.lock().await;
            guard.insert_intent(intent.clone());
        }

        if self.risk_engine.check_intent(&intent) {
            let mut guard = self.state.lock().await;
            let should_enqueue = if let Some(stored) = guard.get_mut(&intent.id) {
                stored.status = IntentStatus::InOrderbook;
                intent = stored.clone();
                true
            } else {
                false
            };

            if should_enqueue {
                guard.add_to_orderbook(intent.id);
            }
        }

        intent
    }

    pub async fn list_intents(&self) -> Vec<Intent> {
        let guard = self.state.lock().await;
        guard.intents()
    }

    pub async fn last_solution(&self) -> Option<NettingSolution> {
        let guard = self.state.lock().await;
        guard.last_solution()
    }

    pub async fn match_and_execute(&self) -> Result<Option<NettingSolution>, ExecutionError> {
        let snapshot = {
            let guard = self.state.lock().await;
            guard.orderbook_snapshot()
        };

        let Some(solution) = compute_solution(&snapshot) else {
            return Ok(None);
        };

        let involved: HashSet<Uuid> = solution.involved_intent_ids.iter().copied().collect();

        {
            let mut guard = self.state.lock().await;
            guard.mark_status(&involved, IntentStatus::Matched);
            guard.set_last_solution(solution.clone());
        }

        self.executor.execute_solution(&solution).await?;

        {
            let mut guard = self.state.lock().await;
            guard.mark_status(&involved, IntentStatus::Executed);
            guard.remove_from_orderbook(&involved);
        }

        Ok(Some(solution))
    }
}

#[derive(Serialize, Deserialize, Debug)]
pub struct CreateIntentRequest {
    pub user_id: String,
    pub from_chain: crate::models::ChainId,
    pub to_chain: crate::models::ChainId,
    pub amount: u64,
    pub signature: String,
}
