/// A reference agent implementation that redacts redundant resource content
use async_trait::async_trait;
use futures::stream::BoxStream;
use std::collections::HashMap;
use tokio::sync::Mutex;
use tracing::{debug, instrument};

use super::Agent;
use crate::agents::capabilities::Capabilities;
use crate::agents::system::{SystemConfig, SystemResult};
use crate::message::{Message, MessageContent, ToolRequest};
use crate::providers::base::Provider;
use crate::providers::base::ProviderUsage;
use crate::register_agent;
use crate::token_counter::TokenCounter;
use mcp_core::content::Content;
use serde_json::Value;

/// Reference implementation of an Agent with resource redaction
pub struct RedactAgent {
    capabilities: Mutex<Capabilities>,
    _token_counter: TokenCounter,
}

impl RedactAgent {
    pub fn new(provider: Box<dyn Provider>) -> Self {
        Self {
            capabilities: Mutex::new(Capabilities::new(provider)),
            _token_counter: TokenCounter::new(),
        }
    }

    /// Redact redundant resource content from messages
    fn redact_redundant_resources(messages: &mut Vec<Message>) {
        // Map to track the last occurrence of each resource URI
        let mut uri_last_index: HashMap<String, usize> = HashMap::new();

        // First pass: find all resource URIs and their last occurrence
        for (idx, message) in messages.iter().enumerate() {
            if let Some(tool_response) = message.content.iter().find_map(|c| c.as_tool_response()) {
                if let Ok(contents) = &tool_response.tool_result {
                    for content in contents {
                        if let Content::Resource(resource) = content {
                            if let Some(uri) = resource.get_uri() {
                                uri_last_index.insert(uri, idx);
                            }
                        }
                    }
                }
            }
        }

        // Second pass: redact content for resources that appear later
        for (idx, message) in messages.iter_mut().enumerate() {
            if let Some(tool_response) = message.content.iter_mut().find_map(|c| {
                if let MessageContent::ToolResponse(tr) = c {
                    Some(tr)
                } else {
                    None
                }
            }) {
                if let Ok(contents) = tool_response.tool_result.as_mut() {
                    for content in contents.iter_mut() {
                        if let Content::Resource(resource) = content {
                            if let Some(uri) = resource.get_uri() {
                                if let Some(&last_idx) = uri_last_index.get(&uri) {
                                    if last_idx > idx {
                                        // This resource appears later, so redact its content
                                        tracing::debug!(
                                            message_index = idx,
                                            resource_uri = uri,
                                            "Redacting resource content that appears later at index {}", 
                                            last_idx
                                        );
                                        resource.set_text(format!("redacted for brevity - the content of {} is available below", uri));
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

#[async_trait]
impl Agent for RedactAgent {
    async fn add_system(&mut self, system: SystemConfig) -> SystemResult<()> {
        let mut capabilities = self.capabilities.lock().await;
        capabilities.add_system(system).await
    }

    async fn remove_system(&mut self, name: &str) {
        let mut capabilities = self.capabilities.lock().await;
        capabilities
            .remove_system(name)
            .await
            .expect("Failed to remove system");
    }

    async fn list_systems(&self) -> Vec<String> {
        let capabilities = self.capabilities.lock().await;
        capabilities
            .list_systems()
            .await
            .expect("Failed to list systems")
    }

    async fn passthrough(&self, _system: &str, _request: Value) -> SystemResult<Value> {
        // TODO implement
        Ok(Value::Null)
    }

    #[instrument(skip(self, messages), fields(user_message))]
    async fn reply(
        &self,
        messages: &[Message],
    ) -> anyhow::Result<BoxStream<'_, anyhow::Result<Message>>> {
        let mut messages = messages.to_vec();
        let reply_span = tracing::Span::current();
        let mut capabilities = self.capabilities.lock().await;
        let tools = capabilities.get_prefixed_tools().await?;
        let system_prompt = capabilities.get_system_prompt().await;
        let _estimated_limit = capabilities
            .provider()
            .get_model_config()
            .get_estimated_limit();

        // Set the user_message field in the span instead of creating a new event
        if let Some(content) = messages
            .last()
            .and_then(|msg| msg.content.first())
            .and_then(|c| c.as_text())
        {
            debug!("user_message" = &content);
        }

        // Update conversation history for the start of the reply
        let _resources = capabilities.get_resources().await?;

        Ok(Box::pin(async_stream::try_stream! {
            let _reply_guard = reply_span.enter();
            loop {
                // Get completion from provider
                let (response, usage) = capabilities.provider().complete(
                    &system_prompt,
                    &messages,
                    &tools,
                ).await?;
                capabilities.record_usage(usage).await;

                // Yield the assistant's response
                yield response.clone();

                tokio::task::yield_now().await;

                // First collect any tool requests
                let tool_requests: Vec<&ToolRequest> = response.content
                    .iter()
                    .filter_map(|content| content.as_tool_request())
                    .collect();

                if tool_requests.is_empty() {
                    break;
                }

                // Then dispatch each in parallel
                let futures: Vec<_> = tool_requests
                    .iter()
                    .filter_map(|request| request.tool_call.clone().ok())
                    .map(|tool_call| capabilities.dispatch_tool_call(tool_call))
                    .collect();

                // Process all the futures in parallel but wait until all are finished
                let outputs = futures::future::join_all(futures).await;

                // Create a message with the responses
                let mut message_tool_response = Message::user();
                // Now combine these into MessageContent::ToolResponse using the original ID
                for (request, output) in tool_requests.iter().zip(outputs.into_iter()) {
                    message_tool_response = message_tool_response.with_tool_response(
                        request.id.clone(),
                        output,
                    );
                }

                // Add new messages to history
                messages.push(response);
                messages.push(message_tool_response.clone());

                // Redact redundant resources in the message history
                Self::redact_redundant_resources(&mut messages);

                // Yield the (potentially redacted) tool response
                yield message_tool_response;
            }
        }))
    }

    async fn usage(&self) -> Vec<ProviderUsage> {
        let capabilities = self.capabilities.lock().await;
        capabilities.get_usage().await
    }
}

register_agent!("redact", RedactAgent);
