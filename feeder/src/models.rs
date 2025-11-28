use serde::{de, Deserialize, Deserializer, Serialize, Serializer};
use std::{fmt, str::FromStr};
use uuid::Uuid;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Chain {
    Base,
    Arbitrum,
    Sepolia,
}

pub const USER_A: &str = "0x9b55124d945b6e61c521add7aa213433b3b1c8a2";
pub const USER_B: &str = "0x3aca6e32bd6268ba2b834e6f23405e10575d19b2";
pub const USER_C: &str = "0x7cb386178d13e21093fdc988c7e77102d6464f3e";
pub const USER_D: &str = "0xe08745df99d3563821b633aa93ee02f7f883f25c";

impl Chain {
    pub fn as_str(&self) -> &'static str {
        match self {
            Chain::Base => "Base",
            Chain::Arbitrum => "Arbitrum",
            Chain::Sepolia => "Sepolia",
        }
    }

}

impl fmt::Display for Chain {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

impl FromStr for Chain {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "base" => Ok(Chain::Base),
            "arbitrum" => Ok(Chain::Arbitrum),
            "sepolia" => Ok(Chain::Sepolia),
            other => Err(format!("invalid chain '{other}'")),
        }
    }
}

impl Serialize for Chain {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.as_str())
    }
}

impl<'de> Deserialize<'de> for Chain {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        Chain::from_str(&s).map_err(de::Error::custom)
    }
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum IntentKind {
    Maker,
    Taker,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Intent {
    pub id: Uuid,
    pub user: String,
    pub from_chain: Chain,
    pub to_chain: Chain,
    pub amount: u64,
    pub kind: IntentKind,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TransferPlanEntry {
    pub chain: Chain,
    pub from: String,
    pub to: String,
    pub amount: u64,
}
