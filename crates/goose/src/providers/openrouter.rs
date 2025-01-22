use anyhow::{anyhow, Error, Result};
use async_trait::async_trait;
use reqwest::Client;
use serde_json::{json, Value};
use std::time::Duration;

use super::base::{Provider, ProviderUsage, Usage};
use super::configs::ModelConfig;
use super::utils::{emit_debug_trace, get_model, handle_response};
use crate::message::Message;
use crate::providers::formats::openai::{
    create_request, get_usage, is_context_length_error, response_to_message,
};
use mcp_core::tool::Tool;

pub const OPENROUTER_DEFAULT_MODEL: &str = "anthropic/claude-3.5-sonnet";
pub const OPENROUTER_MODEL_PREFIX_ANTHROPIC: &str = "anthropic";

#[derive(serde::Serialize)]
pub struct OpenRouterProvider {
    #[serde(skip)]
    client: Client,
    host: String,
    api_key: String,
    model: ModelConfig,
}

impl OpenRouterProvider {
    pub fn from_env() -> Result<Self> {
        let api_key =
            crate::key_manager::get_keyring_secret("OPENROUTER_API_KEY", Default::default())?;
        let host = std::env::var("OPENROUTER_HOST")
            .unwrap_or_else(|_| "https://openrouter.ai".to_string());
        let model_name = std::env::var("OPENROUTER_MODEL")
            .unwrap_or_else(|_| OPENROUTER_DEFAULT_MODEL.to_string());

        let client = Client::builder()
            .timeout(Duration::from_secs(600))
            .build()?;

        Ok(Self {
            client,
            host,
            api_key,
            model: ModelConfig::new(model_name),
        })
    }

    async fn post(&self, payload: Value) -> Result<Value> {
        let url = format!(
            "{}/api/v1/chat/completions",
            self.host.trim_end_matches('/')
        );

        let response = self
            .client
            .post(&url)
            .header("Content-Type", "application/json")
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("HTTP-Referer", "https://github.com/block/goose")
            .header("X-Title", "Goose")
            .json(&payload)
            .send()
            .await?;

        handle_response(payload, response).await
    }
}

// For anthropic model, we can enable prompt caching to save cost. Since openrouter is the OpenAI compatible
// endpoint, we need to modify the open ai request to have anthropic fields.
fn update_request_for_anthropic(original_payload: &Value) -> Value {
    let mut payload = original_payload.clone();

    if let Some(messages_spec) = payload
        .as_object_mut()
        .and_then(|obj| obj.get_mut("messages"))
        .and_then(|messages| messages.as_array_mut())
    {
        // Add "cache_control" to the last and second-to-last "user" messages.
        // During each turn, we mark the final message with cache_control so the conversation can be
        // incrementally cached. The second-to-last user message is also marked for caching with the
        // cache_control parameter, so that this checkpoint can read from the previous cache.
        let mut user_count = 0;
        for message in messages_spec.iter_mut().rev() {
            if message.get("role") == Some(&json!("user")) {
                if let Some(content) = message.get_mut("content") {
                    if let Some(content_str) = content.as_str() {
                        *content = json!([{
                            "type": "text",
                            "text": content_str,
                            "cache_control": { "type": "ephemeral" }
                        }]);
                    }
                }
                user_count += 1;
                if user_count >= 2 {
                    break;
                }
            }
        }

        // Update the system message to have cache_control field.
        if let Some(system_message) = messages_spec
            .iter_mut()
            .find(|msg| msg.get("role") == Some(&json!("system")))
        {
            if let Some(content) = system_message.get_mut("content") {
                if let Some(content_str) = content.as_str() {
                    *system_message = json!({
                        "role": "system",
                        "content": [{
                            "type": "text",
                            "text": content_str,
                            "cache_control": { "type": "ephemeral" }
                        }]
                    });
                }
            }
        }
    }
    payload
}

fn create_request_based_on_model(
    model_config: &ModelConfig,
    system: &str,
    messages: &[Message],
    tools: &[Tool],
) -> anyhow::Result<Value, Error> {
    let mut payload = create_request(
        model_config,
        system,
        messages,
        tools,
        &super::utils::ImageFormat::OpenAi,
    )?;

    if model_config
        .model_name
        .starts_with(OPENROUTER_MODEL_PREFIX_ANTHROPIC)
    {
        payload = update_request_for_anthropic(&payload);
    }

    Ok(payload)
}

#[async_trait]
impl Provider for OpenRouterProvider {
    fn get_model_config(&self) -> &ModelConfig {
        &self.model
    }

    #[tracing::instrument(
        skip(self, system, messages, tools),
        fields(model_config, input, output, input_tokens, output_tokens, total_tokens)
    )]
    async fn complete(
        &self,
        system: &str,
        messages: &[Message],
        tools: &[Tool],
    ) -> Result<(Message, ProviderUsage)> {
        // Create the base payload
        let payload = create_request_based_on_model(&self.model, system, messages, tools)?;

        // Make request
        let response = self.post(payload.clone()).await?;

        // Raise specific error if context length is exceeded
        if let Some(error) = response.get("error") {
            if let Some(err) = is_context_length_error(error) {
                return Err(err.into());
            }
            return Err(anyhow!("OpenRouter API error: {}", error));
        }

        // Parse response
        let message = response_to_message(response.clone())?;
        let usage = self.get_usage(&response)?;
        let model = get_model(&response);
        emit_debug_trace(self, &payload, &response, &usage);
        Ok((message, ProviderUsage::new(model, usage)))
    }

    fn get_usage(&self, data: &Value) -> Result<Usage> {
        get_usage(data)
    }
}
