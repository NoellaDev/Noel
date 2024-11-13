use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize)]
pub struct ProviderConfig {
    pub provider: String,
    pub host: String,
    pub token: String,
    pub processor: String,
    pub accelerator: String,
}

impl ProviderConfig {
    pub fn load() -> Result<Option<Self>> {
        let path = Self::config_path();
        if !path.exists() {
            return Ok(None);
        }
        let content = std::fs::read_to_string(path)?;
        Ok(Some(serde_yaml::from_str(&content)?))
    }

    pub fn save(&self) -> Result<()> {
        let path = Self::config_path();
        let content = serde_yaml::to_string(self)?;
        std::fs::write(path, content)?;
        Ok(())
    }

    fn config_path() -> PathBuf {
        let mut path = super::config_dir();
        path.push("provider.yaml");
        path
    }
}