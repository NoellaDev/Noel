use super::base::ProviderConfig;
use anyhow::Result;

pub struct DatabricksProviderConfig {
    pub host: String,
    pub token: Option<String>,
    pub use_oauth: bool,
}

impl DatabricksProviderConfig {
    pub fn new(host: String, token: Option<String>, use_oauth: bool) -> Self {
        Self {
            host,
            token,
            use_oauth,
        }
    }
}

impl ProviderConfig for DatabricksProviderConfig {
    fn from_env() -> Result<Self> {
        // Get required host
        let host = Self::get_env("DATABRICKS_HOST", true, None)?
            .ok_or_else(|| anyhow::anyhow!("Databricks host must be set"))?;

        // Get optional token
        let token = Self::get_env("DATABRICKS_TOKEN", false, None)?;

        // Get use_oauth flag
        let use_oauth = Self::get_env("DATABRICKS_USE_OAUTH", false, Some("false".to_string()))?
            .map(|s| s.to_lowercase() == "true")
            .unwrap_or(false);

        // Ensure that either token is set or use_oauth is true
        if token.is_none() && !use_oauth {
            return Err(anyhow::anyhow!(
                "Authentication not configured: set DATABRICKS_TOKEN or DATABRICKS_USE_OAUTH=true"
            ));
        }

        Ok(Self::new(host, token, use_oauth))
    }
}
