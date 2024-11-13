use anyhow::Result;
use console::style;

pub async fn execute() -> Result<()> {
    let version = env!("CARGO_PKG_VERSION");
    println!(
        "{} - version {}",
        style("Goose CLI").bold().green(),
        style(version).bold()
    );
    Ok(())
}