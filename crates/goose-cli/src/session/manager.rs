use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Session {
    pub id: String,
    pub messages: Vec<goose::providers::types::message::Message>,
    #[serde(with = "chrono::serde::ts_seconds")]
    pub created_at: chrono::DateTime<chrono::Utc>,
    #[serde(with = "chrono::serde::ts_seconds")]
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

impl Session {
    pub fn new() -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            messages: Vec::new(),
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
        }
    }

    pub fn load(id: &str) -> Result<Option<Self>> {
        let path = Self::session_path(id);
        if !path.exists() {
            return Ok(None);
        }
        let content = std::fs::read_to_string(path)?;
        Ok(Some(serde_json::from_str(&content)?))
    }

    pub fn save(&mut self) -> Result<()> {
        self.updated_at = chrono::Utc::now();
        let path = Self::session_path(&self.id);
        let content = serde_json::to_string_pretty(self)?;
        std::fs::create_dir_all(path.parent().unwrap())?;
        std::fs::write(path, content)?;
        Ok(())
    }

    pub fn add_message(&mut self, message: goose::providers::types::message::Message) {
        self.messages.push(message);
    }

    fn session_path(id: &str) -> PathBuf {
        let mut path = crate::config::config_dir();
        path.push("sessions");
        path.push(format!("{}.json", id));
        path
    }

    pub fn list_sessions() -> Result<Vec<String>> {
        let mut path = crate::config::config_dir();
        path.push("sessions");
        if !path.exists() {
            return Ok(Vec::new());
        }

        let mut sessions = Vec::new();
        for entry in std::fs::read_dir(path)? {
            let entry = entry?;
            if let Some(file_name) = entry.file_name().to_str() {
                if file_name.ends_with(".json") {
                    sessions.push(file_name[..file_name.len() - 5].to_string());
                }
            }
        }
        Ok(sessions)
    }

    pub fn get_latest_session() -> Result<Option<String>> {
        let sessions = Self::list_sessions()?;
        if sessions.is_empty() {
            return Ok(None);
        }

        let mut latest = None;
        let mut latest_time = chrono::DateTime::<chrono::Utc>::MIN_UTC;

        for session_id in sessions {
            if let Some(session) = Self::load(&session_id)? {
                if session.updated_at > latest_time {
                    latest_time = session.updated_at;
                    latest = Some(session_id);
                }
            }
        }

        Ok(latest)
    }
}