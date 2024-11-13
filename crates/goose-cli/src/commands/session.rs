use anyhow::Result;
use console::style;
use futures_util::StreamExt;

use crate::config::provider::ProviderConfig;
use crate::repl::engine::Repl;
use crate::session::manager::Session;
use goose::agent::Agent;
use goose::developer::DeveloperSystem;
use goose::providers::factory;

pub async fn execute(
    id: Option<String>,
    resume: bool,
    headless: bool,
    plan: Option<String>,
    plan_file: Option<String>,
) -> Result<()> {
    // Load provider configuration
    let config = ProviderConfig::load()?.ok_or_else(|| {
        anyhow::anyhow!("No provider configuration found. Run 'goose configure' first.")
    })?;

    // Setup the session
    let mut session = if let Some(id) = id {
        Session::load(&id)?.ok_or_else(|| anyhow::anyhow!("Session not found"))?
    } else if resume {
        let latest = Session::get_latest_session()?
            .ok_or_else(|| anyhow::anyhow!("No previous sessions found"))?;
        Session::load(&latest)?.unwrap()
    } else {
        Session::new()
    };

    use crate::config::provider_conversion::ConfigConversion;
    
    // Setup the agent
    let provider = factory::get_provider(
        config.to_provider_type()?,
        config.to_provider_config()?,
    )?;

    let mut agent = Agent::new(provider, "gpt-4".to_string());
    agent.add_system(Box::new(DeveloperSystem::new()));

    // Handle initial plan if provided
    if let Some(plan_text) = plan {
        session.add_message(goose::providers::types::message::Message::user(&plan_text)?);
    } else if let Some(plan_file) = plan_file {
        let plan_text = std::fs::read_to_string(plan_file)?;
        session.add_message(goose::providers::types::message::Message::user(&plan_text)?);
    }

    if headless {
        // In headless mode, just process the messages we have
        if session.messages.is_empty() {
            anyhow::bail!("No messages to process in headless mode");
        }

        let mut stream = agent.reply(&session.messages);
        while let Some(response) = stream.next().await {
            match response {
                Ok(message) => {
                    session.add_message(message.clone());
                    for content in &message.content {
                        let summary = content.summary();
                        bat::PrettyPrinter::new()
                            .input_from_bytes(summary.as_bytes())
                            .language("markdown")
                            .print()?;
                    }
                }
                Err(e) => {
                    eprintln!("Error: {}", e);
                    break;
                }
            }
        }
        session.save()?;
    } else {
        // Start the REPL
        println!(
            "{}",
            style(format!("Session ID: {}", session.id)).dim()
        );
        let mut repl = Repl::new(session, agent)?;
        repl.run().await?;
    }

    Ok(())
}