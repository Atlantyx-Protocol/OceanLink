mod api;
mod balances;
mod blockchain;
mod matching;
mod models;
mod orderbook;

use api::router;
use blockchain::{BlockchainClient, SharedBlockchainClient};
use orderbook::init_state;
use ethers::core::types::Address;
use std::env;
use std::net::SocketAddr;
use std::str::FromStr;
use std::sync::Arc;

#[tokio::main]
async fn main() {
    let state = init_state();
    
    // Initialize blockchain client from environment variables
    let base_rpc = env::var("BASE_RPC_URL")
        .expect("BASE_RPC_URL environment variable must be set");
    let base_token_address = env::var("BASE_TOKEN_ADDRESS")
        .expect("BASE_TOKEN_ADDRESS environment variable must be set");
    let base_token_address = Address::from_str(&base_token_address)
        .expect("Invalid BASE_TOKEN_ADDRESS");
    
    let b_private_key = env::var("B_PRIVATE_KEY")
        .expect("B_PRIVATE_KEY environment variable must be set");
    let c_private_key = env::var("C_PRIVATE_KEY")
        .expect("C_PRIVATE_KEY environment variable must be set");
    let d_private_key = env::var("D_PRIVATE_KEY")
        .expect("D_PRIVATE_KEY environment variable must be set");
    
    let blockchain: SharedBlockchainClient = Arc::new(BlockchainClient::new(
        base_rpc,
        base_token_address,
        b_private_key,
        c_private_key,
        d_private_key,
    ));
    
    let app = router(state, blockchain);

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
