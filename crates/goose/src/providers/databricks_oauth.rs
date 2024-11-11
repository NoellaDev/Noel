use anyhow::Result;
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::Digest;
use std::fs;
use std::path::PathBuf;
use url::Url;

#[derive(Debug, Clone)]
struct OidcEndpoints {
    authorization_endpoint: String,
    token_endpoint: String,
}

#[derive(Serialize, Deserialize)]
struct TokenData {
    access_token: String,
    expires_at: Option<chrono::DateTime<chrono::Utc>>,
}

struct TokenCache {
    cache_path: PathBuf,
}

const BASE_PATH: &str = concat!(env!("HOME"), "/.config/goose/databricks/oauth");

impl TokenCache {
    fn new(host: &str, client_id: &str, scopes: &[String]) -> Self {
        let mut hasher = sha2::Sha256::new();
        hasher.update(host.as_bytes());
        hasher.update(client_id.as_bytes());
        hasher.update(scopes.join(",").as_bytes());
        let hash = format!("{:x}", hasher.finalize());

        fs::create_dir_all(BASE_PATH).unwrap();
        let cache_path = PathBuf::from(BASE_PATH).join(format!("{}.json", hash));

        Self { cache_path }
    }

    fn load_token(&self) -> Option<TokenData> {
        if let Ok(contents) = fs::read_to_string(&self.cache_path) {
            if let Ok(token_data) = serde_json::from_str::<TokenData>(&contents) {
                if let Some(expires_at) = token_data.expires_at {
                    if expires_at > chrono::Utc::now() {
                        return Some(token_data);
                    }
                } else {
                    return Some(token_data);
                }
            }
        }
        None
    }

    fn save_token(&self, token_data: &TokenData) -> Result<(), anyhow::Error> {
        if let Some(parent) = self.cache_path.parent() {
            fs::create_dir_all(parent)?;
        }
        let contents = serde_json::to_string(token_data)?;
        fs::write(&self.cache_path, contents)?;
        Ok(())
    }
}

async fn get_workspace_endpoints(host: &str) -> Result<OidcEndpoints> {
    let host = host.trim_end_matches('/');
    let oidc_url = format!("{}/oidc/.well-known/oauth-authorization-server", host);

    let client = reqwest::Client::new();
    let resp = client.get(&oidc_url).send().await?;

    if !resp.status().is_success() {
        return Err(anyhow::anyhow!(
            "Failed to get OIDC configuration from {}",
            oidc_url
        ));
    }

    let oidc_config: Value = resp.json().await?;

    let authorization_endpoint = oidc_config
        .get("authorization_endpoint")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow::anyhow!("authorization_endpoint not found in OIDC configuration"))?
        .to_string();

    let token_endpoint = oidc_config
        .get("token_endpoint")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow::anyhow!("token_endpoint not found in OIDC configuration"))?
        .to_string();

    Ok(OidcEndpoints {
        authorization_endpoint,
        token_endpoint,
    })
}

struct OAuthClient {
    oidc_endpoints: OidcEndpoints,
    redirect_url: String,
    client_id: String,
    scopes: Vec<String>,
}

impl OAuthClient {
    fn new(
        oidc_endpoints: OidcEndpoints,
        redirect_url: String,
        client_id: String,
        scopes: Vec<String>,
    ) -> Self {
        Self {
            oidc_endpoints,
            redirect_url,
            client_id,
            scopes,
        }
    }

    fn initiate_consent(&self) -> Consent {
        // Generate state and PKCE verifier/challenge
        let state = nanoid::nanoid!(16);
        let verifier = nanoid::nanoid!(64);
        let challenge = {
            let digest = sha2::Sha256::digest(verifier.as_bytes());
            base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(digest)
        };

        // Build authorization URL
        let params = [
            ("response_type", "code"),
            ("client_id", &self.client_id),
            ("redirect_uri", &self.redirect_url),
            ("scope", &self.scopes.join(" ")),
            ("state", &state),
            ("code_challenge", &challenge),
            ("code_challenge_method", "S256"),
        ];
        let authorization_url = format!(
            "{}?{}",
            self.oidc_endpoints.authorization_endpoint,
            serde_urlencoded::to_string(&params).unwrap()
        );

        Consent {
            state,
            verifier,
            authorization_url,
            redirect_url: self.redirect_url.clone(),
            token_endpoint: self.oidc_endpoints.token_endpoint.clone(),
            client_id: self.client_id.clone(),
        }
    }
}

struct Consent {
    state: String,
    verifier: String,
    authorization_url: String,
    redirect_url: String,
    token_endpoint: String,
    client_id: String,
}

impl Consent {
    async fn launch_external_browser(&self) -> Result<TokenData> {
        // Open the authorization URL in the user's browser
        if webbrowser::open(&self.authorization_url).is_err() {
            println!("Open this URL in your browser:\n{}", self.authorization_url);
        }

        // Start a local server to receive the redirect
        use std::sync::{Arc, Mutex};
        use tokio::sync::oneshot;
        use warp::Filter;

        let (tx, rx) = oneshot::channel();

        let state = self.state.clone();
        let tx = Arc::new(Mutex::new(Some(tx)));

        let routes = warp::get()
            .and(warp::path::end())
            .and(warp::query::query::<
                std::collections::HashMap<String, String>,
            >())
            .map(move |params: std::collections::HashMap<String, String>| {
                let code = params.get("code").cloned();
                let received_state = params.get("state").cloned();
                if let (Some(code), Some(received_state)) = (code, received_state) {
                    if received_state == state {
                        if let Some(tx) = tx.lock().unwrap().take() {
                            let _ = tx.send(code);
                        }
                        "Authentication successful! You can close this window."
                    } else {
                        "State mismatch."
                    }
                } else {
                    "Authentication failed."
                }
            });

        let redirect_url = Url::parse(&self.redirect_url)?;
        let port = redirect_url.port().unwrap_or(80);

        let (_addr, server) = warp::serve(routes).bind_ephemeral(([127, 0, 0, 1], port));
        let server_handle = tokio::task::spawn(server);

        // Wait for the authorization code
        let code = rx.await?;

        // Stop the server
        server_handle.abort();

        // Exchange the code for a token
        self.exchange_code_for_token(&code).await
    }

    async fn exchange_code_for_token(&self, code: &str) -> Result<TokenData> {
        let params = [
            ("grant_type", "authorization_code"),
            ("code", code),
            ("redirect_uri", &self.redirect_url),
            ("code_verifier", &self.verifier),
            ("client_id", &self.client_id),
        ];

        let client = reqwest::Client::new();
        let resp = client
            .post(&self.token_endpoint)
            .header("Content-Type", "application/x-www-form-urlencoded")
            .form(&params)
            .send()
            .await?;

        if !resp.status().is_success() {
            let err_text = resp.text().await?;
            return Err(anyhow::anyhow!(
                "Failed to exchange code for token: {}",
                err_text
            ));
        }

        let token_response: serde_json::Value = resp.json().await?;
        let access_token = token_response
            .get("access_token")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("access_token not found in token response"))?
            .to_string();

        let expires_in = token_response
            .get("expires_in")
            .and_then(|v| v.as_u64())
            .unwrap_or(3600);

        let expires_at = chrono::Utc::now() + chrono::Duration::seconds(expires_in as i64);

        Ok(TokenData {
            access_token,
            expires_at: Some(expires_at),
        })
    }
}

pub fn get_oauth_token(host: &str) -> Result<String> {
    tokio::task::block_in_place(|| {
        tokio::runtime::Handle::current().block_on(async { get_oauth_token_async(host).await })
    })
}

pub async fn get_oauth_token_async(host: &str) -> Result<String> {
    let client_id = "databricks-cli";
    let redirect_url = "http://localhost:8020";

    let oidc_endpoints = get_workspace_endpoints(host).await?;
    let scopes = vec!["all-apis".to_string()];

    let token_cache = TokenCache::new(host, client_id, &scopes);

    // Attempt to load token from cache
    if let Some(token_data) = token_cache.load_token() {
        return Ok(token_data.access_token);
    }

    // Create OAuthClient
    let oauth_client = OAuthClient::new(
        oidc_endpoints,
        redirect_url.to_string(),
        client_id.to_string(),
        scopes,
    );

    // Initiate consent
    let consent = oauth_client.initiate_consent();

    // Launch external browser and get token
    let token_data = consent.launch_external_browser().await?;

    // Save token to cache
    token_cache.save_token(&token_data)?;

    Ok(token_data.access_token)
}
