use anyhow::Result;
use clap::{Parser, Subcommand};

mod commands;
mod config;
mod repl;
mod session;

#[derive(Parser)]
#[command(author, version, about, long_about = None)]
#[command(propagate_version = true)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Configure goose provider settings
    Configure {
        /// Provider name (e.g., openai, databricks)
        #[arg(long)]
        provider: Option<String>,
        
        /// Provider host URL
        #[arg(long)]
        host: Option<String>,
        
        /// Authentication token
        #[arg(long)]
        token: Option<String>,
        
        /// Model processor type
        #[arg(long)]
        processor: Option<String>,
        
        /// Model accelerator type
        #[arg(long)]
        accelerator: Option<String>,
    },
    
    /// Start or resume a session
    Session {
        /// Session ID to resume
        id: Option<String>,
        
        /// Resume the most recent session
        #[arg(long)]
        resume: bool,
        
        /// Run in headless mode (no REPL)
        #[arg(long)]
        headless: bool,
        
        /// Initial plan message
        #[arg(long)]
        plan: Option<String>,
        
        /// Initial plan from file
        #[arg(long)]
        plan_file: Option<String>,
    },
    
    /// Run in headless mode (alias for session --headless)
    Run {
        /// Initial plan message
        #[arg(long)]
        plan: Option<String>,
        
        /// Initial plan from file
        #[arg(long)]
        plan_file: Option<String>,
    },
    
    /// Show version information
    Version,
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Commands::Configure {
            provider,
            host,
            token,
            processor,
            accelerator,
        } => {
            commands::configure::execute(provider, host, token, processor, accelerator).await
        }
        Commands::Session {
            id,
            resume,
            headless,
            plan,
            plan_file,
        } => {
            commands::session::execute(id, resume, headless, plan, plan_file).await
        }
        Commands::Run { plan, plan_file } => {
            commands::run::execute(plan, plan_file).await
        }
        Commands::Version => commands::version::execute().await,
    }
}