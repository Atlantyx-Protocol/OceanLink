use crate::app::{AppContext, CreateIntentRequest};
use crate::models::{Intent, NettingSolution};
use axum::{
    Json, Router,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};

pub fn router(ctx: AppContext) -> Router {
    Router::new()
        .route("/intents", post(create_intent).get(list_intents))
        .route("/solutions", get(get_solution))
        .route("/match-and-execute", post(match_and_execute))
        .with_state(ctx)
}

async fn create_intent(
    State(ctx): State<AppContext>,
    Json(payload): Json<CreateIntentRequest>,
) -> impl IntoResponse {
    let intent = ctx.create_intent(payload).await;
    (StatusCode::CREATED, Json(intent))
}

async fn list_intents(State(ctx): State<AppContext>) -> impl IntoResponse {
    let intents = ctx.list_intents().await;
    Json(intents)
}

async fn get_solution(State(ctx): State<AppContext>) -> impl IntoResponse {
    let solution = ctx.last_solution().await;
    Json(solution)
}

async fn match_and_execute(State(ctx): State<AppContext>) -> Response {
    match ctx.match_and_execute().await {
        Ok(Some(solution)) => (StatusCode::OK, Json(solution)).into_response(),
        Ok(None) => StatusCode::NO_CONTENT.into_response(),
        Err(err) => {
            eprintln!("match_and_execute error: {err:?}");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}
