use std::sync::RwLock;

/// Represents different trust levels for performing operations
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum TrustLevel {
    /// No destructive actions allowed (0)
    NoDestructive,
    /// Confirm with user before destructive actions (1)
    ConfirmDestructive,
    /// Allow all actions without confirmation (2)
    AllowAll,
}

impl Default for TrustLevel {
    fn default() -> Self {
        TrustLevel::ConfirmDestructive // Default to middle ground - confirm destructive actions
    }
}

impl From<u8> for TrustLevel {
    fn from(value: u8) -> Self {
        match value {
            0 => TrustLevel::NoDestructive,
            1 => TrustLevel::ConfirmDestructive,
            _ => TrustLevel::AllowAll,
        }
    }
}

impl From<TrustLevel> for u8 {
    fn from(level: TrustLevel) -> Self {
        match level {
            TrustLevel::NoDestructive => 0,
            TrustLevel::ConfirmDestructive => 1,
            TrustLevel::AllowAll => 2,
        }
    }
}

/// Manages trust level state and provides methods to check and modify trust settings
pub struct TrustManager {
    level: RwLock<TrustLevel>,
}

impl Default for TrustManager {
    fn default() -> Self {
        Self::new()
    }
}

impl TrustManager {
    /// Creates a new TrustManager with default trust level
    pub fn new() -> Self {
        Self {
            level: RwLock::new(TrustLevel::default()),
        }
    }

    /// Creates a new TrustManager with a specific trust level
    pub fn with_level(level: TrustLevel) -> Self {
        Self {
            level: RwLock::new(level),
        }
    }

    /// Gets the current trust level
    pub fn get_level(&self) -> TrustLevel {
        *self.level.read().unwrap()
    }

    /// Sets a new trust level
    pub fn set_level(&self, new_level: TrustLevel) {
        *self.level.write().unwrap() = new_level;
    }

    /// Checks if a destructive action is allowed
    /// Returns true if the action should proceed, false if it should be blocked
    pub fn can_perform_destructive(&self) -> bool {
        match self.get_level() {
            TrustLevel::NoDestructive => false,
            TrustLevel::AllowAll => true,
            TrustLevel::ConfirmDestructive => {
                // In a real implementation, this would interact with the user
                // For now, we'll just return false to be safe
                false
            }
        }
    }

    /// Checks if a command is potentially destructive
    /// This is a basic implementation that could be expanded
    pub fn is_destructive_command(&self, command: &str) -> bool {
        let command = command.trim().to_lowercase();

        // List of destructive command prefixes
        let destructive_prefixes = [
            "rm",
            "del",
            "remove",
            "write",
            "overwrite",
            "delete",
            "drop",
        ];

        destructive_prefixes
            .iter()
            .any(|prefix| command.starts_with(prefix))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_trust_level_conversion() {
        assert_eq!(TrustLevel::from(0), TrustLevel::NoDestructive);
        assert_eq!(TrustLevel::from(1), TrustLevel::ConfirmDestructive);
        assert_eq!(TrustLevel::from(2), TrustLevel::AllowAll);
        assert_eq!(TrustLevel::from(255), TrustLevel::AllowAll); // Any value > 1 is AllowAll

        assert_eq!(u8::from(TrustLevel::NoDestructive), 0);
        assert_eq!(u8::from(TrustLevel::ConfirmDestructive), 1);
        assert_eq!(u8::from(TrustLevel::AllowAll), 2);
    }

    #[test]
    fn test_trust_manager_defaults() {
        let manager = TrustManager::new();
        assert_eq!(manager.get_level(), TrustLevel::ConfirmDestructive);
    }

    #[test]
    fn test_trust_level_changes() {
        let manager = TrustManager::new();

        manager.set_level(TrustLevel::NoDestructive);
        assert_eq!(manager.get_level(), TrustLevel::NoDestructive);

        manager.set_level(TrustLevel::AllowAll);
        assert_eq!(manager.get_level(), TrustLevel::AllowAll);
    }

    #[test]
    fn test_destructive_command_detection() {
        let manager = TrustManager::new();

        // Test destructive commands
        assert!(manager.is_destructive_command("rm -rf /"));
        assert!(manager.is_destructive_command("delete file.txt"));
        assert!(manager.is_destructive_command("remove old_data"));
        assert!(manager.is_destructive_command("write new content"));

        // Test non-destructive commands
        assert!(!manager.is_destructive_command("ls"));
        assert!(!manager.is_destructive_command("cd /"));
        assert!(!manager.is_destructive_command("echo hello"));
        assert!(!manager.is_destructive_command("pwd"));
    }

    #[test]
    fn test_destructive_action_permissions() {
        let manager = TrustManager::new();

        // Test NoDestructive level
        manager.set_level(TrustLevel::NoDestructive);
        assert!(!manager.can_perform_destructive());

        // Test AllowAll level
        manager.set_level(TrustLevel::AllowAll);
        assert!(manager.can_perform_destructive());

        // Test ConfirmDestructive level
        manager.set_level(TrustLevel::ConfirmDestructive);
        // Currently returns false as user interaction is not implemented
        assert!(!manager.can_perform_destructive());
    }
}
