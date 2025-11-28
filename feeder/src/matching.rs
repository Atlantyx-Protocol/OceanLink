use crate::models::{Chain, Intent, IntentKind, TransferPlanEntry, USER_A, USER_B, USER_C, USER_D};

const REQUIRED_TOTAL: u64 = 1_000_000;
const PLAN: [(Chain, &str, &str, u64); 6] = [
    (Chain::Sepolia, USER_A, USER_B, 500_000),
    (Chain::Sepolia, USER_A, USER_C, 300_000),
    (Chain::Sepolia, USER_A, USER_D, 200_000),
    (Chain::Base, USER_B, USER_A, 500_000),
    (Chain::Base, USER_C, USER_A, 300_000),
    (Chain::Base, USER_D, USER_A, 200_000),
];

pub fn match_a_against_makers(intents: &[Intent]) -> Option<Vec<TransferPlanEntry>> {
    let total_a: u64 = intents
        .iter()
        .filter(|intent| {
            intent.user == USER_A
                && intent.from_chain == Chain::Sepolia
                && intent.to_chain == Chain::Base
                && intent.kind == IntentKind::Taker
        })
        .map(|intent| intent.amount)
        .sum();

    if total_a < REQUIRED_TOTAL {
        return None;
    }

    Some(
        PLAN.iter()
            .map(|(chain, from, to, amount)| TransferPlanEntry {
                chain: *chain,
                from: (*from).to_string(),
                to: (*to).to_string(),
                amount: *amount,
            })
            .collect(),
    )
}

pub fn plan_for_chain(chain: Chain) -> Vec<TransferPlanEntry> {
    PLAN.iter()
        .filter(|(entry_chain, _, _, _)| *entry_chain == chain)
        .map(|(entry_chain, from, to, amount)| TransferPlanEntry {
            chain: *entry_chain,
            from: (*from).to_string(),
            to: (*to).to_string(),
            amount: *amount,
        })
        .collect()
}
