use crate::models::Chain;
use serde::Serialize;
use std::collections::HashMap;

pub type BalanceKey = (Chain, String);
pub type Balances = HashMap<BalanceKey, u64>;

#[derive(Debug, Serialize)]
pub struct BalanceSnapshot {
    pub chain: Chain,
    pub user: String,
    pub amount: u64,
}

pub fn mint(balances: &mut Balances, chain: Chain, user: &str, amount: u64) {
    let entry = balances
        .entry((chain, user.to_string()))
        .or_insert_with(|| 0u64);
    *entry += amount;
}

pub fn snapshot(balances: &Balances) -> Vec<BalanceSnapshot> {
    balances
        .iter()
        .map(|((chain, user), amount)| BalanceSnapshot {
            chain: *chain,
            user: user.clone(),
            amount: *amount,
        })
        .collect()
}
