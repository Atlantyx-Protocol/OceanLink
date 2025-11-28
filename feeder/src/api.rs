use crate::balances::{self, BalanceSnapshot};
use crate::matching::{match_a_against_makers, plan_for_chain};
use crate::models::{Chain, Intent, IntentKind, TransferPlanEntry, USER_A};
use crate::orderbook::{add_intent, AppState, SharedState};
use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::str::FromStr;
use tokio::sync::MutexGuard;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
struct DepositRequest {
    user: String,
    chain: String,
    amount: u64,
    recipient_on_other_chain: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct DepositResponse {
    pub user: String,
    pub chain: Chain,
    pub amount: u64,
    pub recipient_on_other_chain: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct OrderRequest {
    pub user: String,
    pub from_chain: String,
    pub to_chain: String,
    pub amount: u64,
}

#[derive(Debug, Serialize)]
pub struct OrderResponse {
    pub intent_id: Uuid,
    pub transfers: Vec<TransferReceipt>,
}

#[derive(Debug, Serialize)]
pub struct MatchResponse {
    pub solution: Vec<TransferPlanEntry>,
}

#[derive(Debug, Serialize)]
pub struct TransferReceipt {
    pub chain: Chain,
    pub from: String,
    pub to: String,
    pub amount: u64,
    pub tx_hash: String,
}

pub fn router(state: SharedState) -> Router {
    Router::new()
        .route("/deposit", post(deposit))
        .route("/order", post(create_order))
        .route("/match", post(run_matching))
        .route("/orderbook", get(list_orderbook))
        .route("/balances", get(list_balances))
        .with_state(state)
}

fn parse_chain(value: &str) -> Result<Chain, String> {
    Chain::from_str(value)
}

async fn deposit(
    State(state): State<SharedState>,
    Json(payload): Json<DepositRequest>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let chain = parse_chain(&payload.chain).map_err(|err| (StatusCode::BAD_REQUEST, err))?;
    let recipient = payload.recipient_on_other_chain.clone();

    let mut guard = state.lock().await;
    balances::mint(&mut guard.balances, chain, &payload.user, payload.amount);

    Ok((
        StatusCode::OK,
        Json(DepositResponse {
            user: payload.user,
            chain,
            amount: payload.amount,
            recipient_on_other_chain: recipient,
        }),
    ))
}

async fn create_order(
    State(state): State<SharedState>,
    Json(payload): Json<OrderRequest>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let from_chain =
        parse_chain(&payload.from_chain).map_err(|err| (StatusCode::BAD_REQUEST, err))?;
    let to_chain = parse_chain(&payload.to_chain).map_err(|err| (StatusCode::BAD_REQUEST, err))?;

    if payload.user != USER_A {
        return Err((
            StatusCode::BAD_REQUEST,
            "only the configured taker address may place orders in this demo".into(),
        ));
    }

    if payload.amount < 1_000_000 {
        return Err((
            StatusCode::BAD_REQUEST,
            "minimum taker amount is 1,000,000 USDC for this demo".into(),
        ));
    }

    if from_chain != Chain::Sepolia || to_chain != Chain::Base {
        return Err((
            StatusCode::BAD_REQUEST,
            "taker orders must be from Sepolia to Base in this demo".into(),
        ));
    }

    let intent = Intent {
        id: Uuid::new_v4(),
        user: payload.user.clone(),
        from_chain,
        to_chain,
        amount: payload.amount,
        kind: IntentKind::Taker,
    };

    let intent_id = intent.id;
    {
        let mut guard = state.lock().await;
        add_intent(&mut guard, intent);
    }

    let settlement_plan = plan_for_chain(to_chain);
    if settlement_plan.is_empty() {
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            "no settlement plan defined for target chain".into(),
        ));
    }

    let receipts = settlement_plan
        .into_iter()
        .map(|entry| TransferReceipt {
            chain: entry.chain,
            from: entry.from,
            to: entry.to,
            amount: entry.amount,
            tx_hash: format!("0x{}", Uuid::new_v4().simple()),
        })
        .collect();

    Ok((
        StatusCode::CREATED,
        Json(OrderResponse {
            intent_id,
            transfers: receipts,
        }),
    ))
}

async fn run_matching(
    State(state): State<SharedState>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let guard = state.lock().await;
    let solution = match_a_against_makers(&guard.orderbook).ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            "insufficient taker liquidity from user A (need 1,000,000 USDC)".to_string(),
        )
    })?;
    Ok((StatusCode::OK, Json(MatchResponse { solution })))
}

async fn list_orderbook(State(state): State<SharedState>) -> impl IntoResponse {
    let guard = state.lock().await;
    Json(guard.orderbook.clone())
}

async fn list_balances(State(state): State<SharedState>) -> impl IntoResponse {
    let guard: MutexGuard<'_, AppState> = state.lock().await;
    let snapshot: Vec<BalanceSnapshot> = balances::snapshot(&guard.balances);
    Json(snapshot)
}
