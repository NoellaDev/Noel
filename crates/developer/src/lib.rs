mod lang;
mod process_store;

use anyhow::Result;
use base64::Engine;
use indoc::formatdoc;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs,
    future::Future,
    io::Cursor,
    path::{Path, PathBuf},
    pin::Pin,
};
use tokio::process::Command;
use url::Url;

use mcp_core::{
    handler::{ResourceError, ToolError},
    protocol::ServerCapabilities,
    resource::Resource,
    tool::Tool,
};
use mcp_server::router::CapabilitiesBuilder;
use mcp_server::Router;

use mcp_core::content::Content;
use mcp_core::role::Role;

use std::process::Stdio;
use std::sync::{Arc, Mutex};
use tracing::info;
use xcap::{Monitor, Window};

pub struct DeveloperRouter {
    tools: Vec<Tool>,
    // The cwd, active_resources, and file_history are shared across threads
    // so we need to use an Arc to ensure thread safety
    cwd: Arc<Mutex<PathBuf>>,
    active_resources: Arc<Mutex<HashMap<String, Resource>>>,
    file_history: Arc<Mutex<HashMap<PathBuf, Vec<String>>>>,
    instructions: String,
}

impl DeveloperRouter {
    pub fn new() -> Self {
        let bash_tool = Tool::new(
            "bash".to_string(),
            "Run a bash command in the shell in the current working directory".to_string(),
            json!({
                "type": "object",
                "required": ["command"],
                "properties": {
                    "command": {"type": "string"}
                }
            }),
        );

        let text_editor_tool = Tool::new(
            "text_editor".to_string(),
            "Perform text editing operations on files.".to_string(),
            json!({
                "type": "object",
                "required": ["command", "path"],
                "properties": {
                    "path": {"type": "string"},
                    "command": {
                        "type": "string",
                        "enum": ["view", "write", "str_replace", "undo_edit"]
                    },
                    "new_str": {"type": "string"},
                    "old_str": {"type": "string"},
                    "file_text": {"type": "string"}
                }
            }),
        );

        let list_windows_tool = Tool::new(
            "list_windows".to_string(),
            "List all open windows".to_string(),
            json!({
                "type": "object",
                "required": [],
                "properties": {}
            }),
        );

        let screen_capture_tool = Tool::new(
            "screen_capture".to_string(),
            "Capture a screenshot of a specified display or window.\nYou can capture either:\n1. A full display (monitor) using the display parameter\n2. A specific window by its title using the window_title parameter\n\nOnly one of display or window_title should be specified.".to_string(),
            json!({
                "type": "object",
                "required": [],
                "properties": {
                    "display": {
                        "type": "integer",
                        "default": 0,
                        "description": "The display number to capture (0 is main display)"
                    },
                    "window_title": {
                        "type": "string",
                        "default": null,
                        "description": "Optional: the exact title of the window to capture. use the list_windows tool to find the available windows."
                    }
                }
            }),
        );

        let instructions = "Developer instructions...".to_string(); // Reuse from original code

        let cwd = std::env::current_dir().unwrap();
        let mut resources = HashMap::new();
        let uri = format!("str:///{}", cwd.display());
        let resource = Resource::new(
            uri.clone(),
            Some("text".to_string()),
            Some("cwd".to_string()),
        )
        .unwrap();
        resources.insert(uri, resource);

        Self {
            tools: vec![
                bash_tool,
                text_editor_tool,
                list_windows_tool,
                screen_capture_tool,
            ],
            cwd: Arc::new(Mutex::new(cwd)),
            active_resources: Arc::new(Mutex::new(resources)),
            file_history: Arc::new(Mutex::new(HashMap::new())),
            instructions,
        }
    }

    // Helper method to resolve a path relative to cwd
    fn resolve_path(&self, path_str: &str) -> Result<PathBuf, ToolError> {
        let cwd = self.cwd.lock().unwrap();
        let expanded = shellexpand::tilde(path_str);
        let path = Path::new(expanded.as_ref());
        let resolved_path = if path.is_absolute() {
            path.to_path_buf()
        } else {
            cwd.join(path)
        };

        Ok(resolved_path)
    }

    // Implement bash tool functionality
    async fn bash(&self, params: Value) -> Result<Vec<Content>, ToolError> {
        let command =
            params
                .get("command")
                .and_then(|v| v.as_str())
                .ok_or(ToolError::InvalidParameters(
                    "The command string is required".to_string(),
                ))?;

        // Disallow commands that should use other tools
        if command.trim_start().starts_with("cat") {
            return Err(ToolError::InvalidParameters(
                "Do not use `cat` to read files, use the view mode on the text editor tool"
                    .to_string(),
            ));
        }
        // TODO consider enforcing ripgrep over find?

        // Redirect stderr to stdout to interleave outputs
        let cmd_with_redirect = format!("{} 2>&1", command);

        // Execute the command
        let child = Command::new("bash")
            .stdout(Stdio::piped()) // These two pipes required to capture output later.
            .stderr(Stdio::piped())
            .kill_on_drop(true) // Critical so that the command is killed when the agent.reply stream is interrupted.
            .arg("-c")
            .arg(cmd_with_redirect)
            .spawn()
            .map_err(|e| ToolError::ExecutionError(e.to_string()))?;

        // Store the process ID with the command as the key
        let pid: Option<u32> = child.id();
        if let Some(pid) = pid {
            crate::process_store::store_process(pid);
        }

        // Wait for the command to complete and get output
        let output = child
            .wait_with_output()
            .await
            .map_err(|e| ToolError::ExecutionError(e.to_string()))?;

        // Remove the process ID from the store
        if let Some(pid) = pid {
            crate::process_store::remove_process(pid);
        }

        let output_str = format!(
            "Finished with Status Code: {}\nOutput:\n{}",
            output.status,
            String::from_utf8_lossy(&output.stdout)
        );
        Ok(vec![
            Content::text(output_str.clone()).with_audience(vec![Role::Assistant]),
            Content::text(output_str)
                .with_audience(vec![Role::User])
                .with_priority(0.0),
        ])
    }

    // Implement text_editor tool functionality
    async fn text_editor(&self, params: Value) -> Result<Vec<Content>, ToolError> {
        let command = params
            .get("command")
            .and_then(|v| v.as_str())
            .ok_or_else(|| {
                ToolError::InvalidParameters("Missing 'command' parameter".to_string())
            })?;

        let path_str = params
            .get("path")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::InvalidParameters("Missing 'path' parameter".into()))?;

        let path = self.resolve_path(path_str)?;

        match command {
            "view" => self.text_editor_view(&path).await,
            "write" => {
                let file_text = params
                    .get("file_text")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| {
                        ToolError::InvalidParameters("Missing 'file_text' parameter".into())
                    })?;

                self.text_editor_write(&path, file_text).await
            }
            "str_replace" => {
                let old_str = params
                    .get("old_str")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| {
                        ToolError::InvalidParameters("Missing 'old_str' parameter".into())
                    })?;
                let new_str = params
                    .get("new_str")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| {
                        ToolError::InvalidParameters("Missing 'new_str' parameter".into())
                    })?;

                self.text_editor_replace(&path, old_str, new_str).await
            }
            "undo_edit" => self.text_editor_undo(&path).await,
            _ => Err(ToolError::InvalidParameters(format!(
                "Unknown command '{}'",
                command
            ))),
        }
    }

    async fn text_editor_view(&self, path: &PathBuf) -> Result<Vec<Content>, ToolError> {
        if path.is_file() {
            // Check file size first (2MB limit)
            const MAX_FILE_SIZE: u64 = 2 * 1024 * 1024; // 2MB in bytes
            const MAX_CHAR_COUNT: usize = 1 << 20; // 2^20 characters (1,048,576)

            let file_size = std::fs::metadata(path)
                .map_err(|e| {
                    ToolError::ExecutionError(format!("Failed to get file metadata: {}", e))
                })?
                .len();

            if file_size > MAX_FILE_SIZE {
                return Err(ToolError::ExecutionError(format!(
                    "File '{}' is too large ({:.2}MB). Maximum size is 2MB to prevent memory issues.",
                    path.display(),
                    file_size as f64 / 1024.0 / 1024.0
                )));
            }

            // Create a new resource and add it to active_resources
            let uri = Url::from_file_path(path)
                .map_err(|_| ToolError::ExecutionError("Invalid file path".into()))?
                .to_string();

            // Read the content once
            let content = std::fs::read_to_string(path)
                .map_err(|e| ToolError::ExecutionError(format!("Failed to read file: {}", e)))?;

            let char_count = content.chars().count();
            if char_count > MAX_CHAR_COUNT {
                return Err(ToolError::ExecutionError(format!(
                    "File '{}' has too many characters ({}). Maximum character count is {}.",
                    path.display(),
                    char_count,
                    MAX_CHAR_COUNT
                )));
            }

            // Create and store the resource
            let resource =
                Resource::new(uri.clone(), Some("text".to_string()), None).map_err(|e| {
                    ToolError::ExecutionError(format!("Failed to create resource: {}", e))
                })?;

            self.active_resources.lock().unwrap().insert(uri, resource);

            let language = lang::get_language_identifier(path);
            let formatted = formatdoc! {"
                ### {path}
                ```{language}
                {content}
                ```
                ",
                path=path.display(),
                language=language,
                content=content,
            };

            // The LLM gets just a quick update as we expect the file to view in the status
            // but we send a low priority message for the human
            Ok(vec![
                Content::text(format!(
                    "The file content for {} is now available in the system status.",
                    path.display()
                ))
                .with_audience(vec![Role::Assistant]),
                Content::text(formatted)
                    .with_audience(vec![Role::User])
                    .with_priority(0.0),
            ])
        } else {
            Err(ToolError::ExecutionError(format!(
                "The path '{}' does not exist or is not a file.",
                path.display()
            )))
        }
    }

    async fn text_editor_write(
        &self,
        path: &PathBuf,
        file_text: &str,
    ) -> Result<Vec<Content>, ToolError> {
        // Get the URI for the file
        let uri = Url::from_file_path(path)
            .map_err(|_| ToolError::ExecutionError("Invalid file path".into()))?
            .to_string();

        // Check if file already exists and is active
        if path.exists() && !self.active_resources.lock().unwrap().contains_key(&uri) {
            return Err(ToolError::InvalidParameters(format!(
                "File '{}' exists but is not active. View it first before overwriting.",
                path.display()
            )));
        }

        // Save history for undo
        self.save_file_history(path)?;

        // Write to the file
        std::fs::write(path, file_text)
            .map_err(|e| ToolError::ExecutionError(format!("Failed to write file: {}", e)))?;

        // Create and store resource

        let resource = Resource::new(uri.clone(), Some("text".to_string()), None)
            .map_err(|e| ToolError::ExecutionError(e.to_string()))?;
        self.active_resources.lock().unwrap().insert(uri, resource);

        // Try to detect the language from the file extension
        let language = path.extension().and_then(|ext| ext.to_str()).unwrap_or("");

        Ok(vec![
            Content::text(format!("Successfully wrote to {}", path.display()))
                .with_audience(vec![Role::Assistant]),
            Content::text(formatdoc! {r#"
                ### {path}
                ```{language}
                {content}
                ```
                "#,
                path=path.display(),
                language=language,
                content=file_text,
            })
            .with_audience(vec![Role::User])
            .with_priority(0.2),
        ])
    }

    async fn text_editor_replace(
        &self,
        path: &PathBuf,
        old_str: &str,
        new_str: &str,
    ) -> Result<Vec<Content>, ToolError> {
        // Get the URI for the file
        let uri = Url::from_file_path(path)
            .map_err(|_| ToolError::ExecutionError("Invalid file path".into()))?
            .to_string();

        // Check if file exists and is active
        if !path.exists() {
            return Err(ToolError::InvalidParameters(format!(
                "File '{}' does not exist",
                path.display()
            )));
        }
        if !self.active_resources.lock().unwrap().contains_key(&uri) {
            return Err(ToolError::InvalidParameters(format!(
                "You must view '{}' before editing it",
                path.display()
            )));
        }

        // Read content
        let content = std::fs::read_to_string(path)
            .map_err(|e| ToolError::ExecutionError(format!("Failed to read file: {}", e)))?;

        // Ensure 'old_str' appears exactly once
        if content.matches(old_str).count() > 1 {
            return Err(ToolError::InvalidParameters(
                "'old_str' must appear exactly once in the file, but it appears multiple times"
                    .into(),
            ));
        }
        if content.matches(old_str).count() == 0 {
            return Err(ToolError::InvalidParameters(
                "'old_str' must appear exactly once in the file, but it does not appear in the file. Make sure the string exactly matches existing file content, including spacing.".into(),
            ));
        }

        // Save history for undo
        self.save_file_history(path)?;

        // Replace and write back
        let new_content = content.replace(old_str, new_str);
        std::fs::write(path, &new_content)
            .map_err(|e| ToolError::ExecutionError(format!("Failed to write file: {}", e)))?;

        // Update resource
        if let Some(resource) = self.active_resources.lock().unwrap().get_mut(&uri) {
            resource.update_timestamp();
        }

        // Try to detect the language from the file extension
        let language = path.extension().and_then(|ext| ext.to_str()).unwrap_or("");

        Ok(vec![
            Content::text("Successfully replaced text").with_audience(vec![Role::Assistant]),
            Content::text(formatdoc! {r#"
                ### {path}

                *Before*:
                ```{language}
                {old_str}
                ```

                *After*:
                ```{language}
                {new_str}
                ```
                "#,
                path=path.display(),
                language=language,
                old_str=old_str,
                new_str=new_str,
            })
            .with_audience(vec![Role::User])
            .with_priority(0.2),
        ])
    }

    async fn text_editor_undo(&self, path: &PathBuf) -> Result<Vec<Content>, ToolError> {
        let mut history = self.file_history.lock().unwrap();
        if let Some(contents) = history.get_mut(path) {
            if let Some(previous_content) = contents.pop() {
                // Write previous content back to file
                std::fs::write(path, previous_content).map_err(|e| {
                    ToolError::ExecutionError(format!("Failed to write file: {}", e))
                })?;
                Ok(vec![Content::text("Undid the last edit")])
            } else {
                Err(ToolError::InvalidParameters(
                    "No edit history available to undo".into(),
                ))
            }
        } else {
            Err(ToolError::InvalidParameters(
                "No edit history available to undo".into(),
            ))
        }
    }

    fn save_file_history(&self, path: &PathBuf) -> Result<(), ToolError> {
        let mut history = self.file_history.lock().unwrap();
        let content = if path.exists() {
            std::fs::read_to_string(path)
                .map_err(|e| ToolError::ExecutionError(format!("Failed to read file: {}", e)))?
        } else {
            String::new()
        };
        history.entry(path.clone()).or_default().push(content);
        Ok(())
    }

    // Implement window listing functionality
    async fn list_windows(&self, _params: Value) -> Result<Vec<Content>, ToolError> {
        let windows = Window::all()
            .map_err(|_| ToolError::ExecutionError("Failed to list windows".into()))?;

        let window_titles: Vec<String> =
            windows.into_iter().map(|w| w.title().to_string()).collect();

        Ok(vec![
            Content::text("The following windows are available.")
                .with_audience(vec![Role::Assistant]),
            Content::text(format!("Available windows:\n{}", window_titles.join("\n")))
                .with_audience(vec![Role::User])
                .with_priority(0.0),
        ])
    }

    async fn screen_capture(&self, params: Value) -> Result<Vec<Content>, ToolError> {
        let mut image = if let Some(window_title) =
            params.get("window_title").and_then(|v| v.as_str())
        {
            // Try to find and capture the specified window
            let windows = Window::all()
                .map_err(|_| ToolError::ExecutionError("Failed to list windows".into()))?;

            let window = windows
                .into_iter()
                .find(|w| w.title() == window_title)
                .ok_or_else(|| {
                    ToolError::ExecutionError(format!(
                        "No window found with title '{}'",
                        window_title
                    ))
                })?;

            window.capture_image().map_err(|e| {
                ToolError::ExecutionError(format!(
                    "Failed to capture window '{}': {}",
                    window_title, e
                ))
            })?
        } else {
            // Default to display capture if no window title is specified
            let display = params.get("display").and_then(|v| v.as_u64()).unwrap_or(0) as usize;

            let monitors = Monitor::all()
                .map_err(|_| ToolError::ExecutionError("Failed to access monitors".into()))?;
            let monitor = monitors.get(display).ok_or_else(|| {
                ToolError::ExecutionError(format!(
                    "{} was not an available monitor, {} found.",
                    display,
                    monitors.len()
                ))
            })?;

            monitor.capture_image().map_err(|e| {
                ToolError::ExecutionError(format!("Failed to capture display {}: {}", display, e))
            })?
        };

        // Resize the image to a reasonable width while maintaining aspect ratio
        let max_width = 768;
        if image.width() > max_width {
            let scale = max_width as f32 / image.width() as f32;
            let new_height = (image.height() as f32 * scale) as u32;
            image = xcap::image::imageops::resize(
                &image,
                max_width,
                new_height,
                xcap::image::imageops::FilterType::Lanczos3,
            )
        };

        let mut bytes: Vec<u8> = Vec::new();
        image
            .write_to(&mut Cursor::new(&mut bytes), xcap::image::ImageFormat::Png)
            .map_err(|e| {
                ToolError::ExecutionError(format!("Failed to write image buffer {}", e))
            })?;

        // Convert to base64
        let data = base64::prelude::BASE64_STANDARD.encode(bytes);

        Ok(vec![
            Content::text("Screenshot captured").with_audience(vec![Role::Assistant]),
            Content::image(data, "image/png")
                .with_audience(vec![Role::User])
                .with_priority(0.0),
        ])
    }

    async fn read_resource_internal(&self, uri: &str) -> Result<String, ResourceError> {
        // Ensure the resource exists in the active resources map
        let active_resources = self.active_resources.lock().unwrap();
        let resource = active_resources
            .get(uri)
            .ok_or_else(|| ResourceError::NotFound(format!("Resource '{}' not found", uri)))?;

        let url =
            Url::parse(uri).map_err(|e| ResourceError::NotFound(format!("Invalid URI: {}", e)))?;

        // Read content based on scheme and mime_type
        match url.scheme() {
            "file" => {
                let path = url
                    .to_file_path()
                    .map_err(|_| ResourceError::NotFound("Invalid file path in URI".into()))?;

                // Ensure file exists
                if !path.exists() {
                    return Err(ResourceError::NotFound(format!(
                        "File does not exist: {}",
                        path.display()
                    )));
                }

                match resource.mime_type.as_str() {
                    "text" => {
                        // Read the file as UTF-8 text
                        fs::read_to_string(&path).map_err(|e| {
                            ResourceError::ExecutionError(format!("Failed to read file: {}", e))
                        })
                    }
                    "blob" => {
                        // Read as bytes, base64 encode
                        let bytes = fs::read(&path).map_err(|e| {
                            ResourceError::ExecutionError(format!("Failed to read file: {}", e))
                        })?;
                        Ok(base64::prelude::BASE64_STANDARD.encode(bytes))
                    }
                    mime_type => Err(ResourceError::ExecutionError(format!(
                        "Unsupported mime type: {}",
                        mime_type
                    ))),
                }
            }
            "str" => {
                // For str:// URIs, we only support text
                if resource.mime_type != "text" {
                    return Err(ResourceError::ExecutionError(format!(
                        "str:// URI only supports text mime type, got {}",
                        resource.mime_type
                    )));
                }

                // The `Url::path()` gives us the portion after `str:///`
                let content_encoded = url.path().trim_start_matches('/');
                let decoded = urlencoding::decode(content_encoded).map_err(|e| {
                    ResourceError::ExecutionError(format!("Failed to decode str:// content: {}", e))
                })?;
                Ok(decoded.into_owned())
            }
            scheme => Err(ResourceError::NotFound(format!(
                "Unsupported URI scheme: {}",
                scheme
            ))),
        }
    }
}

impl Router for DeveloperRouter {
    fn name(&self) -> String {
        "developer".to_string()
    }

    fn instructions(&self) -> String {
        self.instructions.clone()
    }

    fn capabilities(&self) -> ServerCapabilities {
        CapabilitiesBuilder::new().with_tools(true).build()
    }

    fn list_tools(&self) -> Vec<Tool> {
        self.tools.clone()
    }

    fn call_tool(
        &self,
        tool_name: &str,
        arguments: Value,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<Content>, ToolError>> + Send + 'static>> {
        let this = self.clone();
        let tool_name = tool_name.to_string();
        Box::pin(async move {
            match tool_name.as_str() {
                "bash" => this.bash(arguments).await,
                "text_editor" => this.text_editor(arguments).await,
                "list_windows" => this.list_windows(arguments).await,
                "screen_capture" => this.screen_capture(arguments).await,
                _ => Err(ToolError::NotFound(format!("Tool {} not found", tool_name))),
            }
        })
    }

    fn list_resources(&self) -> Vec<Resource> {
        let resources = self
            .active_resources
            .lock()
            .unwrap()
            .values()
            .cloned()
            .collect();
        info!("Listing resources: {:?}", resources);
        resources
    }

    fn read_resource(
        &self,
        uri: &str,
    ) -> Pin<Box<dyn Future<Output = Result<String, ResourceError>> + Send + 'static>> {
        let this = self.clone();
        let uri = uri.to_string();
        info!("Reading resource: {}", uri);
        Box::pin(async move {
            match this.read_resource_internal(&uri).await {
                Ok(content) => Ok(content),
                Err(e) => Err(e.into()),
            }
        })
    }
}

impl Clone for DeveloperRouter {
    fn clone(&self) -> Self {
        Self {
            tools: self.tools.clone(),
            cwd: Arc::clone(&self.cwd),
            active_resources: Arc::clone(&self.active_resources),
            file_history: Arc::clone(&self.file_history),
            instructions: self.instructions.clone(),
        }
    }
}
