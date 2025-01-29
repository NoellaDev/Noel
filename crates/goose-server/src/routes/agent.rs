use crate::state::AppState;
use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use goose::config::Config;
use goose::{
    agents::{AgentFactory, GooseFreedom},
    model::ModelConfig,
    providers,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::env;

#[derive(Serialize)]
struct VersionsResponse {
    available_versions: Vec<String>,
    default_version: String,
}

#[derive(Deserialize)]
struct CreateAgentRequest {
    version: Option<String>,
    provider: String,
    model: Option<String>,
    freedom: Option<GooseFreedom>,
}

#[derive(Serialize)]
struct CreateAgentResponse {
    version: String,
}

#[derive(Deserialize)]
struct ProviderFile {
    name: String,
    description: String,
    models: Vec<String>,
    required_keys: Vec<String>,
}

#[derive(Serialize)]
struct ProviderDetails {
    name: String,
    description: String,
    models: Vec<String>,
    required_keys: Vec<String>,
}

#[derive(Serialize)]
struct ProviderList {
    id: String,
    details: ProviderDetails,
}

#[derive(Deserialize)]
struct SetFreedomLevelRequest {
    freedom: GooseFreedom,
}

#[derive(Serialize)]
struct SetFreedomLevelResponse {
    freedom: GooseFreedom,
}

async fn get_versions() -> Json<VersionsResponse> {
    let versions = AgentFactory::available_versions();
    let default_version = AgentFactory::default_version().to_string();

    Json(VersionsResponse {
        available_versions: versions.iter().map(|v| v.to_string()).collect(),
        default_version,
    })
}

async fn create_agent(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CreateAgentRequest>,
) -> Result<Json<CreateAgentResponse>, StatusCode> {
    // Verify secret key
    let secret_key = headers
        .get("X-Secret-Key")
        .and_then(|value| value.to_str().ok())
        .ok_or(StatusCode::UNAUTHORIZED)?;

    if secret_key != state.secret_key {
        return Err(StatusCode::UNAUTHORIZED);
    }

    // Set the environment variable for the model if provided
    if let Some(model) = &payload.model {
        let env_var_key = format!("{}_MODEL", payload.provider.to_uppercase());
        env::set_var(env_var_key.clone(), model);
        println!("Set environment variable: {}={}", env_var_key, model);
    }

    let config = Config::global();
    let model = payload.model.unwrap_or_else(|| {
        config
            .get("GOOSE_MODEL")
            .expect("Did not find a model on payload or in env")
    });
    let model_config = ModelConfig::new(model);
    let provider =
        providers::create(&payload.provider, model_config).expect("Failed to create provider");

    let version = payload
        .version
        .unwrap_or_else(|| AgentFactory::default_version().to_string());

    let mut new_agent = AgentFactory::create(&version, provider).expect("Failed to create agent");

    // Set the initial freedom level if provided
    if let Some(freedom) = payload.freedom {
        new_agent.set_freedom_level(freedom).await;
    } else {
        new_agent.set_freedom_level(GooseFreedom::Caged).await; // Default to most restrictive
    }

    let mut agent = state.agent.lock().await;
    *agent = Some(new_agent);

    Ok(Json(CreateAgentResponse { version }))
}

async fn list_providers() -> Json<Vec<ProviderList>> {
    let contents = include_str!("providers_and_keys.json");

    let providers: HashMap<String, ProviderFile> =
        serde_json::from_str(contents).expect("Failed to parse providers_and_keys.json");

    let response: Vec<ProviderList> = providers
        .into_iter()
        .map(|(id, provider)| ProviderList {
            id,
            details: ProviderDetails {
                name: provider.name,
                description: provider.description,
                models: provider.models,
                required_keys: provider.required_keys,
            },
        })
        .collect();

    Json(response)
}

async fn set_freedom_level(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<SetFreedomLevelRequest>,
) -> Result<Json<SetFreedomLevelResponse>, StatusCode> {
    // Verify secret key
    let secret_key = headers
        .get("X-Secret-Key")
        .and_then(|value| value.to_str().ok())
        .ok_or(StatusCode::UNAUTHORIZED)?;

    if secret_key != state.secret_key {
        return Err(StatusCode::UNAUTHORIZED);
    }

    // Update the agent's freedom level
    let mut agent = state.agent.lock().await;
    if let Some(agent) = agent.as_mut() {
        agent.set_freedom_level(payload.freedom.clone()).await;
    }

    Ok(Json(SetFreedomLevelResponse {
        freedom: payload.freedom,
    }))
}

pub fn routes(state: AppState) -> Router {
    Router::new()
        .route("/agent/versions", get(get_versions))
        .route("/agent/providers", get(list_providers))
        .route("/agent", post(create_agent))
        .route("/agent/freedom", post(set_freedom_level))
        .with_state(state)
}
