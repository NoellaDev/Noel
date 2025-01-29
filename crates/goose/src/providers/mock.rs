use async_trait::async_trait;
use mcp_core::tool::Tool;

use crate::message::Message;
use crate::model::{ModelConfig, GPT_4O_TOKENIZER};
use crate::providers::base::{Provider, ProviderMetadata, ProviderUsage, Usage};
use crate::providers::errors::ProviderError;

pub struct MockProvider {
    model_config: ModelConfig,
}

impl Default for MockProvider {
    fn default() -> Self {
        Self {
            model_config: ModelConfig {
                model_name: "mock".to_string(),
                temperature: Some(0.7),
                max_tokens: Some(1000),
                context_limit: Some(4096),
                tokenizer_name: GPT_4O_TOKENIZER.to_string(),
            },
        }
    }
}

#[async_trait]
impl Provider for MockProvider {
    async fn complete(
        &self,
        _system_prompt: &str,
        _messages: &[Message],
        _tools: &[Tool],
    ) -> Result<(Message, ProviderUsage), ProviderError> {
        Ok((
            Message::assistant(),
            ProviderUsage::new("mock".to_string(), Usage::default()),
        ))
    }

    fn get_model_config(&self) -> ModelConfig {
        self.model_config.clone()
    }

    fn metadata() -> ProviderMetadata
    where
        Self: Sized,
    {
        ProviderMetadata {
            name: "mock".to_string(),
            display_name: "Mock Provider".to_string(),
            description: "A mock provider for testing".to_string(),
            default_model: "mock".to_string(),
            known_models: vec!["mock".to_string()],
            model_doc_link: "".to_string(),
            config_keys: vec![],
        }
    }
}
