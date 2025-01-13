/// A simplified agent implementation used as a reference
/// It makes no attempt to handle context limits, and cannot read resources
use async_trait::async_trait;
use futures::stream::BoxStream;
use tokio::sync::Mutex;
use tracing::{debug, instrument};
use anyhow::{Result, Error};

use super::Agent;
use crate::agents::capabilities::Capabilities;
use crate::agents::system::{SystemConfig, SystemResult};
use crate::message::{Message, ToolRequest};
use crate::providers::base::Provider;
use crate::providers::base::ProviderUsage;
use crate::register_agent;
use crate::token_counter::TokenCounter;
use serde_json::Value;

use mcp_core::{Tool, Role, Content};

/// Reference implementation of an Agent
pub struct ReferenceSummarizerAgent {
    capabilities: Mutex<Capabilities>,
    _token_counter: TokenCounter,
}

impl ReferenceSummarizerAgent {
    pub fn new(provider: Box<dyn Provider>) -> Self {
        Self {
            capabilities: Mutex::new(Capabilities::new(provider)),
            _token_counter: TokenCounter::new(),
        }
    }

    async fn prepare_inference(
        &self,
        system_prompt: &str,
        tools: &[Tool],
        messages: &[Message],
        target_limit: usize,
        model_name: &str,
    ) -> Result<Vec<Message>, Error> { 

        let approx_count = self._token_counter.count_chat_tokens(
            system_prompt,
            messages,
            tools,
            Some(model_name),
        );

        if approx_count > target_limit {
            println!("[WARNING] Token budget exceeded. Current count: {} \n Difference: {} tokens over buget. Removing context", approx_count, approx_count - target_limit);

            let summarized_messages = self.summarize(messages, tools).await?;

            println!("New Token Count: {:#?}", self._token_counter.count_chat_tokens(
                system_prompt,
                &summarized_messages,
                tools,
                Some(model_name),
            ));
            return Ok(summarized_messages);
        }

        Ok(messages.to_vec())
    }
    
    async fn get_history_to_summarize(&self, messages: &[Message]) -> Result<Vec<String>, Error> {
        let mut formatted_messages = Vec::new();
        
        for message in messages {
            let mut summary = String::new();
            // Add role prefix
            summary.push_str(&format!("role: {}\n", serde_json::to_string(&message.role).unwrap_or_default()));
            
            // Process each content item
            for content in &message.content {
                match content {
                    crate::message::MessageContent::Text(text) => {
                        summary.push_str(&format!("content:text:\n{}\n", text.text));
                    },
                    crate::message::MessageContent::Image(_) => {
                        summary.push_str("content:image:\n[An image was shared]\n");
                    },
                    crate::message::MessageContent::ToolRequest(req) => {
                        if let Ok(tool_call) = &req.tool_call {
                            summary.push_str(&format!("content:tool_request:\ntool: {}\nargs: {}\n", 
                                tool_call.name, 
                                serde_json::to_string_pretty(&tool_call.arguments).unwrap_or_default()
                            ));
                        }
                    },
                    crate::message::MessageContent::ToolResponse(resp) => {
                        match &resp.tool_result {
                            Ok(result) => {
                                summary.push_str("content:tool_result:error=false\n");
                                for content in result {
                                    if let Content::Text(text) = content {
                                        summary.push_str(&format!("output:{}\n", text.text));
                                    }
                                }
                            },
                            Err(e) => {
                                summary.push_str(&format!("content:tool_result:error=true\noutput:{}\n", e));
                            }
                        }
                    }
                }
            }
            // Append the summary to the formatted messages array
            formatted_messages.push(summary);
        }
        
        Ok(formatted_messages)
    }

    async fn summarize(&self, messages: &[Message], tools: &[Tool]) -> Result<Vec<Message>, Error> {
        // First get the formatted history
        let formatted_messages = self.get_history_to_summarize(messages).await?;
        
        // Get the abridge template
        let template = include_str!("../prompts/abridge.md");
        // Setup minijinja environment
        let mut env = minijinja::Environment::new();
        let _ = env.add_template("abridge", template);
        
        // Create the context object for template rendering
        // formatted_messages[0].content
        let context = serde_json::json!({
            "tools": tools,
            "messages": formatted_messages,
        });

        let tmpl = env.get_template("abridge");
        let prompt = tmpl.unwrap().render(context).unwrap();
    
        // Create a message with the rendered template
        let prompt_message = Message::user().with_text(&prompt);
        
        // Get completion from provider
        // let capabilities = self.capabilities.lock().await;
        let (response, _usage) = {
            let capabilities = self.capabilities.lock().await;
            capabilities.provider().complete_internal(
                "", // No system prompt needed since it's in the template
                &[prompt_message],
                &[],  // No tools needed for summarization
            ).await?
        };

        // Return the summarized message
        Ok(vec![response.clone()])
    }
}

#[async_trait]
impl Agent for ReferenceSummarizerAgent {
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
        // Scope the capabilities lock to release it earlier
        let (tools, system_prompt, estimated_limit, model_name) = {
            let mut capabilities = self.capabilities.lock().await;
            (
                capabilities.get_prefixed_tools().await?,
                capabilities.get_system_prompt().await,
                capabilities.provider().get_model_config().get_estimated_limit(),
                capabilities.provider().get_model_config().model_name.clone()
            )
        };

        // Set the user_message field in the span instead of creating a new event
        if let Some(content) = messages
            .last()
            .and_then(|msg| msg.content.first())
            .and_then(|c| c.as_text())
        {
            debug!("user_message" = &content);
        }

        // Update conversation history for the start of the reply
        // let _resources = capabilities.get_resources().await?;

        messages = self.prepare_inference(
            &system_prompt,
            &tools,
            &messages,
            estimated_limit,
            &model_name,
        ).await?;

        Ok(Box::pin(async_stream::try_stream! {
            let _reply_guard = reply_span.enter();

            loop {
                println!("loop");
                let capabilities = self.capabilities.lock().await;
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

                yield message_tool_response.clone();

                drop(capabilities);
                // let pending = vec![response, message_tool_response];
                println!("loop_prepare_inference");
                messages = self.prepare_inference(
                    &system_prompt,
                    &tools,
                    &messages,
                    estimated_limit,
                    &model_name,
                ).await?;

                messages.push(response);
                messages.push(message_tool_response);
 
            }
        }))
    }

    async fn usage(&self) -> Vec<ProviderUsage> {
        let capabilities = self.capabilities.lock().await;
        capabilities.get_usage().await
    }
}

register_agent!("summarizer", ReferenceSummarizerAgent);
