use ocean_link_backend::app::{AppContext, CreateIntentRequest};
use ocean_link_backend::blockchain::MockBlockchainClient;
use ocean_link_backend::executor::Executor;
use ocean_link_backend::models::{ChainId, IntentStatus, LocalTx};
use ocean_link_backend::risk::{AlwaysPassRiskEngine, RiskEngine};
use ocean_link_backend::state::State;
use std::sync::Arc;
use tokio::sync::Mutex;

fn sort_key(tx: &LocalTx) -> (u8, &str, &str, u64) {
    (
        match tx.chain {
            ChainId::Base => 0,
            ChainId::Arbitrum => 1,
        },
        &tx.from_user,
        &tx.to_user,
        tx.amount,
    )
}

#[tokio::test]
async fn nets_four_intents_end_to_end() {
    let state = Arc::new(Mutex::new(State::new()));
    let risk_engine: Arc<dyn RiskEngine + Send + Sync> = Arc::new(AlwaysPassRiskEngine::default());
    let blockchain = MockBlockchainClient::default();

    blockchain.set_balance(ChainId::Base, "A", 1_000_000);
    blockchain.set_balance(ChainId::Arbitrum, "A", 0);
    blockchain.set_balance(ChainId::Arbitrum, "B", 500_000);
    blockchain.set_balance(ChainId::Arbitrum, "C", 300_000);
    blockchain.set_balance(ChainId::Arbitrum, "D", 200_000);

    let executor = Arc::new(Executor::new(blockchain.clone()));
    let ctx = AppContext::new(state.clone(), risk_engine, executor);

    let a_intent = ctx
        .create_intent(CreateIntentRequest {
            user_id: "A".into(),
            from_chain: ChainId::Base,
            to_chain: ChainId::Arbitrum,
            amount: 1_000_000,
            signature: "sig-a".into(),
        })
        .await;

    let b_intent = ctx
        .create_intent(CreateIntentRequest {
            user_id: "B".into(),
            from_chain: ChainId::Arbitrum,
            to_chain: ChainId::Base,
            amount: 500_000,
            signature: "sig-b".into(),
        })
        .await;

    let c_intent = ctx
        .create_intent(CreateIntentRequest {
            user_id: "C".into(),
            from_chain: ChainId::Arbitrum,
            to_chain: ChainId::Base,
            amount: 300_000,
            signature: "sig-c".into(),
        })
        .await;

    let d_intent = ctx
        .create_intent(CreateIntentRequest {
            user_id: "D".into(),
            from_chain: ChainId::Arbitrum,
            to_chain: ChainId::Base,
            amount: 200_000,
            signature: "sig-d".into(),
        })
        .await;

    assert_eq!(a_intent.status, IntentStatus::InOrderbook);
    assert_eq!(b_intent.status, IntentStatus::InOrderbook);
    assert_eq!(c_intent.status, IntentStatus::InOrderbook);
    assert_eq!(d_intent.status, IntentStatus::InOrderbook);

    let solution = ctx
        .match_and_execute()
        .await
        .expect("solver should succeed")
        .expect("solution expected");

    assert_eq!(solution.txs.len(), 6);
    assert_eq!(solution.involved_intent_ids.len(), 4);

    let mut actual_txs = solution.txs.clone();
    actual_txs.sort_by(|a, b| sort_key(a).cmp(&sort_key(b)));

    let mut expected = vec![
        LocalTx {
            chain: ChainId::Base,
            from_user: "A".into(),
            to_user: "B".into(),
            amount: 500_000,
        },
        LocalTx {
            chain: ChainId::Base,
            from_user: "A".into(),
            to_user: "C".into(),
            amount: 300_000,
        },
        LocalTx {
            chain: ChainId::Base,
            from_user: "A".into(),
            to_user: "D".into(),
            amount: 200_000,
        },
        LocalTx {
            chain: ChainId::Arbitrum,
            from_user: "B".into(),
            to_user: "A".into(),
            amount: 500_000,
        },
        LocalTx {
            chain: ChainId::Arbitrum,
            from_user: "C".into(),
            to_user: "A".into(),
            amount: 300_000,
        },
        LocalTx {
            chain: ChainId::Arbitrum,
            from_user: "D".into(),
            to_user: "A".into(),
            amount: 200_000,
        },
    ];
    expected.sort_by(|a, b| sort_key(a).cmp(&sort_key(b)));

    assert_eq!(actual_txs, expected);

    let recorded = blockchain.recorded_txs();
    assert_eq!(recorded.len(), 6);

    let mut sorted_recorded = recorded.clone();
    sorted_recorded.sort_by(|a, b| {
        sort_key(&LocalTx {
            chain: a.chain,
            from_user: a.from_user.clone(),
            to_user: a.to_user.clone(),
            amount: a.amount,
        })
        .cmp(&sort_key(&LocalTx {
            chain: b.chain,
            from_user: b.from_user.clone(),
            to_user: b.to_user.clone(),
            amount: b.amount,
        }))
    });

    for (tx, expected_tx) in sorted_recorded.iter().zip(expected.iter()) {
        assert_eq!(tx.chain, expected_tx.chain);
        assert_eq!(tx.from_user, expected_tx.from_user);
        assert_eq!(tx.to_user, expected_tx.to_user);
        assert_eq!(tx.amount, expected_tx.amount);
    }

    let guard = ctx.state.lock().await;
    for intent_id in solution.involved_intent_ids {
        let intent = guard
            .get(&intent_id)
            .expect("intent should exist after execution");
        assert_eq!(intent.status, IntentStatus::Executed);
    }
    drop(guard);

    assert_eq!(blockchain.balance(ChainId::Base, "A"), 0);
    assert_eq!(blockchain.balance(ChainId::Base, "B"), 500_000);
    assert_eq!(blockchain.balance(ChainId::Base, "C"), 300_000);
    assert_eq!(blockchain.balance(ChainId::Base, "D"), 200_000);

    assert_eq!(blockchain.balance(ChainId::Arbitrum, "A"), 1_000_000);
    assert_eq!(blockchain.balance(ChainId::Arbitrum, "B"), 0);
    assert_eq!(blockchain.balance(ChainId::Arbitrum, "C"), 0);
    assert_eq!(blockchain.balance(ChainId::Arbitrum, "D"), 0);
}
