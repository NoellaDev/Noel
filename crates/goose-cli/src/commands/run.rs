use anyhow::Result;

pub async fn execute(plan: Option<String>, plan_file: Option<String>) -> Result<()> {
    // Run is just an alias for session --headless
    super::session::execute(None, false, true, plan, plan_file).await
}