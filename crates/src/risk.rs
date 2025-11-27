use crate::models::Intent;

pub trait RiskEngine: Send + Sync {
    fn check_intent(&self, intent: &Intent) -> bool;
}

#[derive(Default)]
pub struct AlwaysPassRiskEngine;

impl RiskEngine for AlwaysPassRiskEngine {
    fn check_intent(&self, _intent: &Intent) -> bool {
        true
    }
}
