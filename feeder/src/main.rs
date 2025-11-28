mod api;
mod balances;
mod matching;
mod models;
mod orderbook;

use api::router;
use orderbook::init_state;
use std::net::SocketAddr;

#[tokio::main]
async fn main() {
    let state = init_state();
    let app = router(state);

    let addr: SocketAddr = "127.0.0.1:8081".parse().expect("valid address");
    println!("feeder running on http://{addr}");

    axum::serve(
        tokio::net::TcpListener::bind(addr)
            .await
            .expect("failed to bind listener"),
        app,
    )
    .await
    .expect("server crashed");
}
