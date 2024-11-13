use anyhow::Result;
use goose::providers::factory::ProviderType;

use crate::config::provider::ProviderConfig;

pub trait ConfigConversion {
    fn to_provider_type(&self) -> Result<ProviderType>;
    fn to_provider_config(&self) -> Result<goose::providers::configs::ProviderConfig>;
}

impl ConfigConversion for ProviderConfig {
    fn to_provider_type(&self) -> Result<ProviderType> {
        match self.provider.as_str() {
            "openai" => Ok(ProviderType::OpenAi),
            "databricks" => Ok(ProviderType::Databricks),
            _ => anyhow::bail!("Unsupported provider type"),
        }
    }

    fn to_provider_config(&self) -> Result<goose::providers::configs::ProviderConfig> {
        match self.provider.as_str() {
            "openai" => Ok(goose::providers::configs::ProviderConfig::OpenAi(
                goose::providers::configs::OpenAiProviderConfig {
                    host: self.host.clone(),
                    api_key: self.token.clone(),
                },
            )),
            "databricks" => Ok(goose::providers::configs::ProviderConfig::Databricks(
                goose::providers::configs::DatabricksProviderConfig {
                    host: self.host.clone(),
                    token: self.token.clone(),
                },
            )),
            _ => anyhow::bail!("Unsupported provider type"),
        }
    }
}