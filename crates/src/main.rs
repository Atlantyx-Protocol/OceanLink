use ocean_link_backend::api::router;
use ocean_link_backend::app::AppContext;
use ocean_link_backend::blockchain::MockBlockchainClient;
use ocean_link_backend::executor::Executor;
use ocean_link_backend::risk::{AlwaysPassRiskEngine, RiskEngine};
use ocean_link_backend::state::State;
use std::sync::Arc;
use tokio::sync::Mutex;

#[tokio::main]
async fn main() {
    let state = Arc::new(Mutex::new(State::new()));
    let risk_engine: Arc<dyn RiskEngine + Send + Sync> = Arc::new(AlwaysPassRiskEngine::default());
    let blockchain = MockBlockchainClient::default();
    let executor = Arc::new(Executor::new(blockchain));
    let ctx = AppContext::new(state, risk_engine, executor);

    let app = router(ctx);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:8080")
        .await
        .expect("failed to bind listener");
    println!("Backend running on http://127.0.0.1:8080");
    axum::serve(listener, app)
        .await
        .expect("server crashed unexpectedly");
}
