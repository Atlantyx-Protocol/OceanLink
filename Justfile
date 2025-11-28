set shell := ["bash", "-uc"]
set dotenv-load := true

default: stack-dev

# Start the feeder service using environment variables from `.env`
#
# Usage:
#   just stack-dev
stack-dev:
    cargo run -p feeder

