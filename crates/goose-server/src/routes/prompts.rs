use mcp_core::protocol::{GetPromptResult, ListPromptsResult};

use crate::state::AppState;
use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    routing::post,
    Json, Router,
};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
struct Prompt {
    name: String,
    description: Option<String>,
    required: Option<bool>,
}

#[derive(Serialize, Deserialize)]
struct PromptRequest {
    system: String,
}

async fn list_prompts_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<PromptRequest>,
) -> Result<Json<ListPromptsResult>, StatusCode> {
    // Verify secret key
    let secret_key = headers
        .get("X-Secret-Key")
        .and_then(|value| value.to_str().ok())
        .ok_or(StatusCode::UNAUTHORIZED)?;

    if secret_key != state.secret_key {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let agent = state.agent.lock().await;
    let agent = agent.as_ref().ok_or(StatusCode::NOT_FOUND)?;

    // Get prompts through agent passthrough
    let result = agent
        .passthrough(&request.system, "list_prompts", serde_json::json!({}))
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Deserialize the result to ListPromptsResult
    let prompts_result: ListPromptsResult =
        serde_json::from_value(result).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(prompts_result))
}

async fn get_prompt_handler(
    Path(prompt_name): Path<String>,
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<PromptRequest>,
) -> Result<Json<GetPromptResult>, StatusCode> {
    // Verify secret key
    let secret_key = headers
        .get("X-Secret-Key")
        .and_then(|value| value.to_str().ok())
        .ok_or(StatusCode::UNAUTHORIZED)?;

    if secret_key != state.secret_key {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let agent = state.agent.lock().await;
    let agent = agent.as_ref().ok_or(StatusCode::NOT_FOUND)?;

    // Get prompt through agent passthrough
    let result = agent
        .passthrough(
            &payload.system,
            "get_prompt",
            serde_json::json!({
                "name": prompt_name
            }),
        )
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Deserialize the result to GetPromptResult
    let prompt_result: GetPromptResult =
        serde_json::from_value(result).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(prompt_result))
}

pub fn routes(state: AppState) -> Router {
    Router::new()
        .route("/prompts/list", post(list_prompts_handler))
        .route("/prompts/get/:prompt_name", post(get_prompt_handler))
        .with_state(state)
}
