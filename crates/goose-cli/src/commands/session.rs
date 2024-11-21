use rand::{distributions::Alphanumeric, Rng};
use std::path::PathBuf;

use goose::agent::Agent;
use goose::models::message::Message;
use goose::providers::factory;

use crate::commands::expected_config::get_recommended_models;
use crate::profile::profile::Profile;
use crate::profile::profile_handler::{load_profiles, PROFILE_DEFAULT_NAME};
use crate::profile::provider_helper::set_provider_config;
use crate::profile::provider_helper::PROVIDER_OPEN_AI;
use crate::prompt::cliclack::CliclackPrompt;
use crate::prompt::prompt::Prompt;
use crate::session::session::Session;
use crate::session::session_file::ensure_session_dir;

pub fn build_session<'a>(session: Option<String>, profile: Option<String>) -> Box<Session<'a>> {
    let session_name = session_name(session);
    let session_file: PathBuf = ensure_session_dir()
        .expect("Failed to create session directory")
        .join(format!("{}.jsonl", session_name));

    let loaded_profile = load_profile(profile);

    // TODO: Reconsider fn name as we are just using the fn to ask the user if env vars are not set
    let provider_config =
        set_provider_config(&loaded_profile.provider, loaded_profile.model.clone());

    // TODO: Odd to be prepping the provider rather than having that done in the agent?
    let provider = factory::get_provider(provider_config).unwrap();
    let agent = Box::new(Agent::new(provider));
    let mut prompt = Box::new(CliclackPrompt::new());

    prompt.render(Box::new(Message::assistant().with_text(format!(
        r#"Stretching wings...
    Provider: {}
    Model: {}
    Session file: {}"#,
        loaded_profile.provider,
        loaded_profile.processor,
        session_file.display()
    ))));

    Box::new(Session::new(agent, prompt, session_file))
}

fn session_name(session: Option<String>) -> String {
    match session {
        Some(name) => name.to_lowercase(),
        None => rand::thread_rng()
            .sample_iter(&Alphanumeric)
            .take(4)
            .map(char::from)
            .collect::<String>()
            .to_lowercase(),
    }
}

fn load_profile(profile_name: Option<String>) -> Box<Profile> {
    let profiles = load_profiles().unwrap();
    let loaded_profile = if profiles.is_empty() {
        let recommended_models = get_recommended_models(PROVIDER_OPEN_AI);
        Box::new(Profile {
            provider: PROVIDER_OPEN_AI.to_string(),
            model: recommended_models.model.to_string(),
            additional_systems: Vec::new(),
        })
    } else {
        match profile_name {
            Some(name) => match profiles.get(name.as_str()) {
                Some(profile) => Box::new(profile.clone()),
                None => panic!("Profile '{}' not found", name),
            },
            None => match profiles.get(PROFILE_DEFAULT_NAME) {
                Some(profile) => Box::new(profile.clone()),
                None => panic!(
                    "No '{}' profile found. Run configure to create a profile.",
                    PROFILE_DEFAULT_NAME
                ),
            }, // Default to the first profile. TODO: Define a constant name for the default profile.
        }
    };
    loaded_profile
}
