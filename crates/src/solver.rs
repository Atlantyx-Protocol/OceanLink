use crate::models::{ChainId, Intent, LocalTx, NettingSolution};
use std::collections::HashSet;
use uuid::Uuid;

#[derive(Clone)]
struct WorkingIntent {
    id: Uuid,
    user: String,
    from_chain: ChainId,
    to_chain: ChainId,
    remaining: u64,
}

pub fn compute_solution(intents: &[Intent]) -> Option<NettingSolution> {
    let mut base_to_arbitrum: Vec<WorkingIntent> = intents
        .iter()
        .filter(|intent| intent.from_chain == ChainId::Base && intent.to_chain == ChainId::Arbitrum)
        .map(|intent| WorkingIntent {
            id: intent.id,
            user: intent.user_id.clone(),
            from_chain: intent.from_chain,
            to_chain: intent.to_chain,
            remaining: intent.amount,
        })
        .collect();

    let mut arbitrum_to_base: Vec<WorkingIntent> = intents
        .iter()
        .filter(|intent| intent.from_chain == ChainId::Arbitrum && intent.to_chain == ChainId::Base)
        .map(|intent| WorkingIntent {
            id: intent.id,
            user: intent.user_id.clone(),
            from_chain: intent.from_chain,
            to_chain: intent.to_chain,
            remaining: intent.amount,
        })
        .collect();

    if base_to_arbitrum.is_empty() || arbitrum_to_base.is_empty() {
        return None;
    }

    let mut i = 0;
    let mut j = 0;
    let mut txs = Vec::new();
    let mut involved: HashSet<Uuid> = HashSet::new();

    while i < base_to_arbitrum.len() && j < arbitrum_to_base.len() {
        let from_base = &mut base_to_arbitrum[i];
        let from_arbitrum = &mut arbitrum_to_base[j];
        let amount = from_base.remaining.min(from_arbitrum.remaining);

        if amount == 0 {
            break;
        }

        txs.push(LocalTx {
            chain: ChainId::Base,
            from_user: from_base.user.clone(),
            to_user: from_arbitrum.user.clone(),
            amount,
        });
        txs.push(LocalTx {
            chain: ChainId::Arbitrum,
            from_user: from_arbitrum.user.clone(),
            to_user: from_base.user.clone(),
            amount,
        });

        from_base.remaining -= amount;
        from_arbitrum.remaining -= amount;
        involved.insert(from_base.id);
        involved.insert(from_arbitrum.id);

        if from_base.remaining == 0 {
            i += 1;
        }
        if from_arbitrum.remaining == 0 {
            j += 1;
        }
    }

    if txs.is_empty() {
        return None;
    }

    Some(NettingSolution {
        txs,
        involved_intent_ids: involved.into_iter().collect(),
    })
}
