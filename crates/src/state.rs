use crate::models::{Intent, IntentStatus, NettingSolution};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;

#[derive(Default)]
pub struct State {
    intents: HashMap<Uuid, Intent>,
    orderbook: Vec<Uuid>,
    last_solution: Option<NettingSolution>,
}

pub type SharedState = Arc<Mutex<State>>;

impl State {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn insert_intent(&mut self, intent: Intent) {
        self.intents.insert(intent.id, intent);
    }

    pub fn intents(&self) -> Vec<Intent> {
        self.intents.values().cloned().collect()
    }

    pub fn get(&self, id: &Uuid) -> Option<&Intent> {
        self.intents.get(id)
    }

    pub fn get_mut(&mut self, id: &Uuid) -> Option<&mut Intent> {
        self.intents.get_mut(id)
    }

    pub fn add_to_orderbook(&mut self, intent_id: Uuid) {
        self.orderbook.push(intent_id);
    }

    pub fn remove_from_orderbook(&mut self, ids: &HashSet<Uuid>) {
        self.orderbook.retain(|id| !ids.contains(id));
    }

    pub fn orderbook_snapshot(&self) -> Vec<Intent> {
        self.orderbook
            .iter()
            .filter_map(|id| self.intents.get(id))
            .cloned()
            .collect()
    }

    pub fn mark_status(&mut self, ids: &HashSet<Uuid>, status: IntentStatus) {
        for id in ids {
            if let Some(intent) = self.intents.get_mut(id) {
                intent.status = status;
            }
        }
    }

    pub fn set_last_solution(&mut self, solution: NettingSolution) {
        self.last_solution = Some(solution);
    }

    pub fn last_solution(&self) -> Option<NettingSolution> {
        self.last_solution.clone()
    }
}
