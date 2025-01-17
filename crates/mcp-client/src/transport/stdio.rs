use std::collections::HashMap;
use std::sync::Arc;
use tokio::process::{Child, ChildStdin, ChildStdout, Command};

use async_trait::async_trait;
use mcp_core::protocol::JsonRpcMessage;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::mpsc;

use super::{send_message, Error, PendingRequests, Transport, TransportHandle, TransportMessage};

/// A `StdioTransport` uses a child process's stdin/stdout as a communication channel.
///
/// It uses channels for message passing and handles responses asynchronously through a background task.
pub struct StdioActor {
    receiver: mpsc::Receiver<TransportMessage>,
    pending_requests: Arc<PendingRequests>,
    _process: Child, // we store the process to keep it alive
    stdin: ChildStdin,
    stdout: ChildStdout,
}

impl StdioActor {
    pub async fn run(self) {
        tokio::join!(
            Self::handle_incoming_messages(self.stdout, self.pending_requests.clone()),
            Self::handle_outgoing_messages(
                self.receiver,
                self.stdin,
                self.pending_requests.clone()
            )
        );
    }

    async fn handle_incoming_messages(stdout: ChildStdout, pending_requests: Arc<PendingRequests>) {
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        loop {
            match reader.read_line(&mut line).await {
                Ok(0) => {
                    eprintln!("Child process ended (EOF on stdout)");
                    break;
                } // EOF
                Ok(_) => {
                    if let Ok(message) = serde_json::from_str::<JsonRpcMessage>(&line) {
                        tracing::debug!(
                            message = ?message,
                            "Received incoming message"
                        );

                        if let JsonRpcMessage::Response(response) = &message {
                            if let Some(id) = &response.id {
                                pending_requests.respond(&id.to_string(), Ok(message)).await;
                            }
                        }
                    }
                    line.clear();
                }
                Err(e) => {
                    tracing::error!(error = ?e, "Error reading line");
                    break;
                }
            }
        }
    }

    async fn handle_outgoing_messages(
        mut receiver: mpsc::Receiver<TransportMessage>,
        mut stdin: ChildStdin,
        pending_requests: Arc<PendingRequests>,
    ) {
        while let Some(transport_msg) = receiver.recv().await {
            let message_str = match serde_json::to_string(&transport_msg.message) {
                Ok(s) => s,
                Err(e) => {
                    if let Some(tx) = transport_msg.response_tx {
                        let _ = tx.send(Err(Error::Serialization(e)));
                    }
                    continue;
                }
            };

            tracing::debug!(message = ?transport_msg.message, "Sending outgoing message");

            if let Some(response_tx) = transport_msg.response_tx {
                if let JsonRpcMessage::Request(request) = &transport_msg.message {
                    if let Some(id) = &request.id {
                        pending_requests.insert(id.to_string(), response_tx).await;
                    }
                }
            }

            if let Err(e) = stdin
                .write_all(format!("{}\n", message_str).as_bytes())
                .await
            {
                tracing::error!(error = ?e, "Error writing message to child process");
                pending_requests.clear().await;
                break;
            }

            if let Err(e) = stdin.flush().await {
                tracing::error!(error = ?e, "Error flushing message to child process");
                pending_requests.clear().await;
                break;
            }
        }
    }
}

#[derive(Clone)]
pub struct StdioTransportHandle {
    sender: mpsc::Sender<TransportMessage>,
}

#[async_trait::async_trait]
impl TransportHandle for StdioTransportHandle {
    async fn send(&self, message: JsonRpcMessage) -> Result<JsonRpcMessage, Error> {
        send_message(&self.sender, message).await
    }
}

pub struct StdioTransport {
    command: String,
    args: Vec<String>,
    env: HashMap<String, String>,
}

impl StdioTransport {
    pub fn new<S: Into<String>>(
        command: S,
        args: Vec<String>,
        env: HashMap<String, String>,
    ) -> Self {
        Self {
            command: command.into(),
            args,
            env: env,
        }
    }

    fn prepare_hermit_install(hermit_bin: &str) -> String {
        format!(
            r#"HERMIT_BIN={}
            mkdir -p ~/.goose/mcp-hermit/bin
            cd ~/.goose/mcp-hermit/
            cp $HERMIT_BIN ~/.goose/mcp-hermit/bin
            PATH=~/.goose/mcp-hermit/bin:$PATH
            which hermit
            hermit init
            hermit install node
            which hermit
            which node
            which npx
            env > /tmp/hermit-env.txt"#,
            hermit_bin
        )
    }

    async fn spawn_process(&self) -> Result<(Child, ChildStdin, ChildStdout), Error> {
        let mut final_env = self.env.clone();

        if self.command == "npx" {
            if let Ok(hermit_bin) = std::env::var("HERMIT_BIN") {
                println!("npx command detected with HERMIT_BIN set, preparing hermit environment.");
                // Run the hermit installation commands
                let output = std::process::Command::new("sh")
                    .arg("-c")
                    .arg(Self::prepare_hermit_install(&hermit_bin))
                    .output()
                    .map_err(|e| {
                        Error::StdioProcessError(format!("Failed to run hermit install: {}", e))
                    })?;

                if !output.status.success() {
                    return Err(Error::StdioProcessError(
                        "Hermit installation failed".into(),
                    ));
                }

                // Now read the environment from the file we created
                if let Ok(hermit_env) = std::fs::read_to_string("/tmp/hermit-env.txt") {
                    for line in hermit_env.lines() {
                        if let Some((key, value)) = line.split_once('=') {
                            final_env.insert(key.to_string(), value.to_string());
                        }
                    }
                }
            }
        }

        let mut process = Command::new(&self.command)
            .envs(&final_env)
            .args(&self.args)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::inherit())
            .kill_on_drop(true)
            // 0 sets the process group ID equal to the process ID
            .process_group(0) // don't inherit signal handling from parent process
            .spawn()
            .map_err(|e| Error::StdioProcessError(e.to_string()))?;

        let stdin = process
            .stdin
            .take()
            .ok_or_else(|| Error::StdioProcessError("Failed to get stdin".into()))?;

        let stdout = process
            .stdout
            .take()
            .ok_or_else(|| Error::StdioProcessError("Failed to get stdout".into()))?;

        Ok((process, stdin, stdout))
    }
}

#[async_trait]
impl Transport for StdioTransport {
    type Handle = StdioTransportHandle;

    async fn start(&self) -> Result<Self::Handle, Error> {
        let (process, stdin, stdout) = self.spawn_process().await?;
        let (message_tx, message_rx) = mpsc::channel(32);

        let actor = StdioActor {
            receiver: message_rx,
            pending_requests: Arc::new(PendingRequests::new()),
            _process: process,
            stdin,
            stdout,
        };

        tokio::spawn(actor.run());

        let handle = StdioTransportHandle { sender: message_tx };
        Ok(handle)
    }

    async fn close(&self) -> Result<(), Error> {
        Ok(())
    }
}