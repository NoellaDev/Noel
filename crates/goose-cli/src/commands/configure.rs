use anyhow::Result;
use cliclack::{input, password, select, spinner};
use console::style;
use futures_util::StreamExt;

use crate::config::provider::ProviderConfig;
use goose::agent::Agent;
use goose::developer::DeveloperSystem;
use goose::providers::factory::{self, ProviderType};
use goose::providers::types::message::Message;

pub async fn execute(
    provider: Option<String>,
    host: Option<String>,
    token: Option<String>,
    processor: Option<String>,
    accelerator: Option<String>,
) -> Result<()> {
    println!("{}", style("Goose Configuration").bold().cyan());
    println!("Let's set up your provider configuration\n");

    let provider_name = match provider {
        Some(p) => p,
        None => select("Select your provider")
            .item("openai", "OpenAI", "GPT-4 and other models")
            .item("databricks", "Databricks", "Hosted AI models")
            .interact()?
            .to_string(),
    };

    let host = match host {
        Some(h) => h,
        None => input("Provider host URL")
            .placeholder(match provider_name.as_str() {
                "openai" => "https://api.openai.com",
                "databricks" => "https://your-workspace.cloud.databricks.com",
                _ => "https://",
            })
            .validate(|input: &String| {
                if input.starts_with("http") {
                    Ok(())
                } else {
                    Err("Host must start with http:// or https://")
                }
            })
            .interact()?,
    };

    let token = match token {
        Some(t) => t,
        None => password("Authentication token")
            .validate(|input: &String| {
                if input.len() > 10 {
                    Ok(())
                } else {
                    Err("Token seems too short")
                }
            })
            .interact()?,
    };

    let processor = match processor {
        Some(p) => p,
        None => select("Select processor type")
            .item("gpu", "GPU", "NVIDIA GPU acceleration")
            .item("cpu", "CPU", "Standard CPU processing")
            .interact()?
            .to_string(),
    };

    let accelerator = match accelerator {
        Some(a) => a,
        None => select("Select accelerator type")
            .item("cuda", "CUDA", "NVIDIA CUDA")
            .item("rocm", "ROCm", "AMD ROCm")
            .item("none", "None", "No acceleration")
            .interact()?
            .to_string(),
    };

    // Save the configuration
    let config = ProviderConfig {
        provider: provider_name.clone(),
        host,
        token,
        processor,
        accelerator,
    };
    config.save()?;

    // Test the configuration
    let spin = spinner();
    spin.start("Testing provider connection");

    let provider_type = match provider_name.as_str() {
        "openai" => ProviderType::OpenAi,
        "databricks" => ProviderType::Databricks,
        _ => anyhow::bail!("Unsupported provider type"),
    };

    let provider = factory::get_provider(
        provider_type,
        goose::providers::configs::ProviderConfig::from_config(&config)?,
    )?;

    // Test the provider with a simple message
    let mut agent = Agent::new(provider, "gpt-4".to_string());
    agent.add_system(Box::new(DeveloperSystem::new()));
    
    let mut messages = vec![Message::user("Say hello in a fun way!")?];
    let mut stream = agent.reply(&messages);
    let mut response = String::new();
    
    while let Some(msg) = stream.next().await {
        match msg {
            Ok(message) => {
                messages.push(message.clone());
                for content in &message.content {
                    response.push_str(&content.summary());
                }
            }
            Err(e) => {
                eprintln!("Error: {}", e);
                break;
            }
        }
    }

    spin.stop("Configuration saved successfully!");
    println!("\n{}", style("Test response:").green().bold());
    println!("{}", response);

    Ok(())
}

trait ConfigConversion {
    fn from_config(config: &ProviderConfig) -> Result<goose::providers::configs::ProviderConfig>;
}

impl ConfigConversion for goose::providers::configs::ProviderConfig {
    fn from_config(config: &ProviderConfig) -> Result<Self> {
        match config.provider.as_str() {
            "openai" => Ok(Self::OpenAi(goose::providers::configs::OpenAiProviderConfig {
                host: config.host.clone(),
                api_key: config.token.clone(),
            })),
            "databricks" => Ok(Self::Databricks(
                goose::providers::configs::DatabricksProviderConfig {
                    host: config.host.clone(),
                    token: config.token.clone(),
                },
            )),
            _ => anyhow::bail!("Unsupported provider type"),
        }
    }
}