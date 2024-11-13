use anyhow::Result;
use console::style;
use futures_util::StreamExt;
use rustyline::error::ReadlineError;
use rustyline::history::FileHistory;
use rustyline::{Config, Editor};
use std::path::PathBuf;

use crate::session::manager::Session;
use goose::agent::Agent;
use goose::providers::types::message::Message;

pub struct Repl {
    editor: Editor<(), FileHistory>,
    session: Session,
    agent: Agent,
}

impl Repl {
    pub fn new(session: Session, agent: Agent) -> Result<Self> {
        let config = Config::builder()
            .history_ignore_space(true)
            .completion_type(rustyline::CompletionType::List)
            .build();

        let mut editor = Editor::with_config(config)?;
        let history_file = Self::history_file();
        if history_file.exists() {
            editor.load_history(&history_file)?;
        }

        Ok(Self {
            editor,
            session,
            agent,
        })
    }

    pub async fn run(&mut self) -> Result<()> {
        println!("{}", style("\nGoose REPL").bold().cyan());
        println!("Type {} to exit, {} for help\n", style("exit").dim(), style("/help").dim());

        loop {
            let readline = self.editor.readline("goose> ");
            match readline {
                Ok(line) => {
                    self.editor.add_history_entry(line.as_str())?;

                    if line.trim().eq_ignore_ascii_case("exit") {
                        break;
                    }

                    if line.starts_with('/') {
                        self.handle_command(&line[1..]).await?;
                    } else {
                        self.handle_message(&line).await?;
                    }
                }
                Err(ReadlineError::Interrupted) => {
                    println!("Use 'exit' to quit");
                }
                Err(ReadlineError::Eof) => {
                    break;
                }
                Err(err) => {
                    println!("Error: {:?}", err);
                    break;
                }
            }
        }

        Ok(())
    }

    async fn handle_message(&mut self, message: &str) -> Result<()> {
        let user_message = Message::user(message)?;
        self.session.add_message(user_message.clone());
        
        let mut stream = self.agent.reply(&self.session.messages);
        while let Some(response) = stream.next().await {
            match response {
                Ok(message) => {
                    self.session.add_message(message.clone());
                    for content in &message.content {
                        self.render(&content.summary()).await?;
                    }
                }
                Err(e) => {
                    eprintln!("Error: {}", e);
                    break;
                }
            }
        }

        self.session.save()?;
        println!();
        Ok(())
    }

    async fn handle_command(&mut self, command: &str) -> Result<()> {
        match command.trim() {
            "help" => self.show_help(),
            "clear" => self.editor.clear_screen()?,
            _ => println!("Unknown command: {}", command),
        }
        Ok(())
    }

    async fn render(&self, content: &str) -> Result<()> {
        bat::PrettyPrinter::new()
            .input_from_bytes(content.as_bytes())
            .language("markdown")
            .print()?;
        Ok(())
    }

    fn show_help(&self) {
        println!("\n{}", style("Available Commands:").bold());
        println!("  /help   - Show this help message");
        println!("  /clear  - Clear the screen");
        println!("  exit    - Exit the REPL\n");
    }

    fn history_file() -> PathBuf {
        let mut path = crate::config::config_dir();
        path.push("history.txt");
        path
    }
}