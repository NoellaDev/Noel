pub mod provider;
pub mod provider_conversion;

use std::path::PathBuf;

pub fn config_dir() -> PathBuf {
    let mut path = dirs::config_dir().expect("Could not find config directory");
    path.push("goose");
    std::fs::create_dir_all(&path).expect("Could not create config directory");
    path
}