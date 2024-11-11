use anyhow::{Context, Result};
use bat::PrettyPrinter;
use clap::Parser;
use cliclack::{input, spinner};
use console::style;
use goose::providers::configs::databricks::DatabricksProviderConfig;
use goose::providers::databricks::DatabricksProvider;
use serde_json::json;
use std::env;

use goose::providers::base::{Provider, Usage};
use goose::providers::configs::openai::OpenAiProviderConfig;
use goose::providers::openai::OpenAiProvider;
use goose::providers::types::content::Content;
use goose::providers::types::message::Message;
use goose::providers::types::tool::Tool;

#[derive(Parser)]
#[command(author, version, about, long_about = None)]
struct Cli {
    /// Provider option (openai or databricks)
    #[arg(short, long, default_value = "open-ai")]
    #[arg(value_enum)]
    provider: ProviderVariant,

    /// OpenAI API Key (can also be set via OPENAI_API_KEY environment variable)
    #[arg(long)]
    api_key: Option<String>,

    /// Databricks host (can also be set via DATABRICKS_HOST environment variable)
    #[arg(long)]
    databricks_host: Option<String>,

    /// Databricks token (can also be set via DATABRICKS_TOKEN environment variable)
    #[arg(long)]
    databricks_token: Option<String>,

    /// Model to use
    #[arg(short, long, default_value = "gpt-4o")]
    model: String,
}

#[derive(clap::ValueEnum, Clone, Debug)]
enum ProviderVariant {
    OpenAi,
    Databricks,
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    let provider = get_provider(&cli)?;

    // Add word counting tool
    let parameters = json!({
        "type": "object",
        "properties": {
                "text": {
                    "type": "string",
                    "description": "The text to count words in"
                }
        },
        "required": ["text"]
    });

    let word_count_tool = Tool::new(
        "count_words".to_string(),
        "Count the number of words in text".to_string(),
        parameters,
        |args| {
            let text = args
                .get("text")
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            Ok(json!({ "count": text.split_whitespace().count() }))
        },
    );

    let tools = vec![word_count_tool];

    println!(
        "Example goose CLI {}",
        style("- type \"exit\" to end the session").dim()
    );
    println!("\n");

    loop {
        let message_text: String = input("Message:").placeholder("").multiline().interact()?;

        if message_text.trim().eq_ignore_ascii_case("exit") {
            break;
        }

        let spin = spinner();
        spin.start("awaiting reply");

        // Create user message and get completion
        let user_message = Message::user(&message_text)?;
        let (response_message, _usage) = provider
            .complete(
                &cli.model,
                "You are a helpful assistant.",
                &[user_message],
                &tools, // Changed from &[] to &tools
                None,   // default temperature
                None,   // default max_tokens
            )
            .await?; // Added .await since complete returns a Future

        spin.stop("");

        if response_message.has_tool_use() {
            render(
                &Content::ToolUse(response_message.tool_use().first().unwrap().clone()).summary(),
            )
            .await;
        } else {
            render(&response_message.text()).await;
        }

        println!("\n");
    }
    Ok(())
}

async fn render(content: &str) {
    PrettyPrinter::new()
        .input_from_bytes(content.as_bytes())
        .language("markdown")
        .print()
        .unwrap();
}

enum ProviderType {
    OpenAi(OpenAiProvider),
    Databricks(DatabricksProvider),
}

fn get_provider(cli: &Cli) -> Result<ProviderType> {
    match cli.provider {
        ProviderVariant::OpenAi => create_openai_provider(cli),
        ProviderVariant::Databricks => create_databricks_provider(cli),
    }
}

fn create_openai_provider(cli: &Cli) -> Result<ProviderType> {
    let api_key = cli
        .api_key
        .clone()
        .or_else(|| env::var("OPENAI_API_KEY").ok())
        .context("API key must be provided via --api-key or OPENAI_API_KEY environment variable")?;

    Ok(ProviderType::OpenAi(OpenAiProvider::new(
        OpenAiProviderConfig {
            api_key,
            host: "https://api.openai.com".to_string(),
        },
    )?))
}

fn create_databricks_provider(cli: &Cli) -> Result<ProviderType> {
    let databricks_host = cli
        .databricks_host
        .clone()
        .or_else(|| env::var("DATABRICKS_HOST").ok())
        .unwrap_or("https://block-lakehouse-production.cloud.databricks.com".to_string());

    // databricks_token is optional. if not provided, we will use OAuth
    let databricks_token = cli
        .databricks_token
        .clone()
        .or_else(|| env::var("DATABRICKS_TOKEN").ok());

    Ok(ProviderType::Databricks(DatabricksProvider::new(
        DatabricksProviderConfig {
            host: databricks_host,
            token: databricks_token,
            use_oauth: true,
        },
    )?))
}

impl Provider for ProviderType {
    async fn complete(
        &self,
        model: &str,
        system: &str,
        messages: &[Message],
        tools: &[Tool],
        temperature: Option<f32>,
        max_tokens: Option<i32>,
    ) -> Result<(Message, Usage)> {
        match self {
            ProviderType::OpenAi(provider) => {
                provider
                    .complete(model, system, messages, tools, temperature, max_tokens)
                    .await
            }
            ProviderType::Databricks(provider) => {
                provider
                    .complete(model, system, messages, tools, temperature, max_tokens)
                    .await
            }
        }
    }

    fn from_env() -> Result<Self> {
        // Default to Databricks provider if no specific environment is set
        create_databricks_provider(&Cli::parse())
    }
}
