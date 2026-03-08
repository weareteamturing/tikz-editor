use base64::Engine;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStderr, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

const ASSISTANT_EVENT_NAME: &str = "desktop-assistant-event";
const WATCH_INTERVAL_MS: u64 = 300;

#[derive(Clone)]
pub struct AssistantState {
    inner: Arc<AssistantStateInner>,
}

struct AssistantStateInner {
    app: AppHandle,
    process: Mutex<Option<ProcessHandle>>,
    documents: Mutex<HashMap<String, DocumentAssistantSession>>,
    approval_policy: Mutex<String>,
    watcher_started: Mutex<bool>,
}

struct ProcessHandle {
    _child: Child,
    stdin: Arc<Mutex<ChildStdin>>,
    pending: Arc<Mutex<HashMap<String, Sender<Value>>>>,
    next_request_id: Arc<AtomicU64>,
}

#[derive(Clone)]
enum PendingServerRequestKind {
    CommandApproval,
    FileChangeApproval,
    ToolRequestUserInput,
    DynamicToolCall,
}

#[derive(Clone)]
struct PendingServerRequest {
    id: Value,
    kind: PendingServerRequestKind,
}

#[derive(Clone)]
struct DocumentAssistantSession {
    document_id: String,
    thread_id: String,
    workspace_path: PathBuf,
    figure_path: PathBuf,
    preview_path: PathBuf,
    items: Vec<Value>,
    pending_server_requests: HashMap<String, PendingServerRequest>,
    current_turn_id: Option<String>,
    last_seen_figure_source: String,
    revision_counter: u64,
}

#[derive(Serialize)]
pub struct AssistantThreadSummary {
    #[serde(rename = "threadId")]
    pub thread_id: String,
    #[serde(rename = "workspacePath")]
    pub workspace_path: String,
    #[serde(rename = "figurePath")]
    pub figure_path: String,
    #[serde(rename = "previewPath")]
    pub preview_path: String,
}

#[derive(Serialize)]
pub struct AssistantThreadStatePayload {
    #[serde(rename = "threadId")]
    pub thread_id: String,
    #[serde(rename = "workspacePath")]
    pub workspace_path: String,
    #[serde(rename = "figurePath")]
    pub figure_path: String,
    #[serde(rename = "previewPath")]
    pub preview_path: String,
    pub items: Vec<Value>,
}

#[derive(Clone, Serialize)]
struct AssistantEventPayload {
    #[serde(rename = "type")]
    kind: String,
    #[serde(flatten)]
    data: Value,
}

impl AssistantState {
    pub fn new(app: AppHandle) -> Self {
        let state = Self {
            inner: Arc::new(AssistantStateInner {
                app,
                process: Mutex::new(None),
                documents: Mutex::new(HashMap::new()),
                approval_policy: Mutex::new("on-request".to_string()),
                watcher_started: Mutex::new(false),
            }),
        };
        state.start_file_watcher();
        state
    }

    fn start_file_watcher(&self) {
        let mut started = self
            .inner
            .watcher_started
            .lock()
            .expect("watcher lock poisoned");
        if *started {
            return;
        }
        *started = true;
        let state = self.clone();
        thread::spawn(move || loop {
            thread::sleep(Duration::from_millis(WATCH_INTERVAL_MS));
            state.poll_figure_files();
        });
    }

    fn poll_figure_files(&self) {
        let sessions = {
            let docs = self
                .inner
                .documents
                .lock()
                .expect("documents lock poisoned");
            docs.values().cloned().collect::<Vec<_>>()
        };

        for session in sessions {
            let Ok(source) = fs::read_to_string(&session.figure_path) else {
                continue;
            };
            let mut docs = self
                .inner
                .documents
                .lock()
                .expect("documents lock poisoned");
            let Some(current) = docs.get_mut(&session.document_id) else {
                continue;
            };
            if source == current.last_seen_figure_source {
                continue;
            }
            current.last_seen_figure_source = source.clone();
            current.revision_counter += 1;
            let revision = format!("rev-{}", current.revision_counter);
            drop(docs);
            let _ = self.emit_event(AssistantEventPayload {
                kind: "source-updated".to_string(),
                data: json!({
                  "documentId": session.document_id,
                  "source": source,
                  "revisionToken": revision
                }),
            });
        }
    }

    fn ensure_process(&self) -> Result<(), String> {
        if self
            .inner
            .process
            .lock()
            .map_err(|_| "process lock unavailable".to_string())?
            .is_some()
        {
            return Ok(());
        }

        let mut child = Command::new("codex")
            .args(["app-server"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| format!("Failed to start `codex app-server`: {error}"))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Failed to open app-server stdin".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Failed to open app-server stdout".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "Failed to open app-server stderr".to_string())?;

        let pending = Arc::new(Mutex::new(HashMap::<String, Sender<Value>>::new()));
        let next_request_id = Arc::new(AtomicU64::new(1));
        let state = self.clone();
        spawn_stdout_reader(state.clone(), stdout, pending.clone());
        spawn_stderr_reader(stderr);

        let process = ProcessHandle {
            _child: child,
            stdin: Arc::new(Mutex::new(stdin)),
            pending,
            next_request_id,
        };
        {
            let mut process_slot = self
                .inner
                .process
                .lock()
                .map_err(|_| "process lock unavailable".to_string())?;
            *process_slot = Some(process);
        }

        let initialize_result = self.request(
            "initialize",
            json!({
              "clientInfo": {
                "name": "tikz_editor_desktop",
                "title": "TikZ Editor Desktop",
                "version": "0.1.0"
              },
              "capabilities": {
                "experimentalApi": true
              }
            }),
        )?;
        if initialize_result.get("error").is_some() {
            return Err("Failed to initialize Codex App Server.".to_string());
        }
        self.notify("initialized", json!({}))?;
        self.configure_approval_policy();
        Ok(())
    }

    fn configure_approval_policy(&self) {
        if let Ok(result) = self.request("configRequirements/read", json!({})) {
            let allowed = result
                .get("requirements")
                .and_then(|value| value.get("allowedApprovalPolicies"))
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let allowed_strings = allowed
                .iter()
                .filter_map(Value::as_str)
                .map(normalize_approval_policy_value)
                .collect::<Vec<_>>();
            let next = if allowed_strings.iter().any(|value| *value == "never") {
                "never"
            } else if allowed_strings.iter().any(|value| *value == "on-request") {
                "on-request"
            } else if allowed_strings.iter().any(|value| *value == "untrusted") {
                "untrusted"
            } else if allowed_strings.iter().any(|value| *value == "on-failure") {
                "on-failure"
            } else {
                allowed_strings.first().copied().unwrap_or("on-request")
            };
            if let Ok(mut approval_policy) = self.inner.approval_policy.lock() {
                *approval_policy = next.to_string();
            }
        }
    }

    fn request(&self, method: &str, params: Value) -> Result<Value, String> {
        self.ensure_process()?;
        let (id, stdin, pending) = {
            let process_guard = self
                .inner
                .process
                .lock()
                .map_err(|_| "process lock unavailable".to_string())?;
            let process = process_guard
                .as_ref()
                .ok_or_else(|| "Codex app-server is unavailable".to_string())?;
            (
                process.next_request_id.fetch_add(1, Ordering::Relaxed),
                process.stdin.clone(),
                process.pending.clone(),
            )
        };

        let (sender, receiver) = mpsc::channel();
        pending
            .lock()
            .map_err(|_| "pending lock unavailable".to_string())?
            .insert(id.to_string(), sender);

        let payload = json!({
          "id": id,
          "method": method,
          "params": params
        });
        let line = serde_json::to_string(&payload).map_err(|error| error.to_string())?;
        {
            let mut writer = stdin
                .lock()
                .map_err(|_| "stdin lock unavailable".to_string())?;
            writer
                .write_all(line.as_bytes())
                .map_err(|error| error.to_string())?;
            writer.write_all(b"\n").map_err(|error| error.to_string())?;
            writer.flush().map_err(|error| error.to_string())?;
        }

        let response = receiver
            .recv_timeout(Duration::from_secs(120))
            .map_err(|_| {
                format!("Timed out waiting for `{method}` response from Codex App Server")
            })?;

        if let Some(error) = response.get("error") {
            return Err(error
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("Codex App Server request failed.")
                .to_string());
        }

        Ok(response.get("result").cloned().unwrap_or(Value::Null))
    }

    fn notify(&self, method: &str, params: Value) -> Result<(), String> {
        self.ensure_process()?;
        let stdin = {
            let process_guard = self
                .inner
                .process
                .lock()
                .map_err(|_| "process lock unavailable".to_string())?;
            process_guard
                .as_ref()
                .ok_or_else(|| "Codex app-server is unavailable".to_string())?
                .stdin
                .clone()
        };
        let payload = json!({
          "method": method,
          "params": params
        });
        let line = serde_json::to_string(&payload).map_err(|error| error.to_string())?;
        let mut writer = stdin
            .lock()
            .map_err(|_| "stdin lock unavailable".to_string())?;
        writer
            .write_all(line.as_bytes())
            .map_err(|error| error.to_string())?;
        writer.write_all(b"\n").map_err(|error| error.to_string())?;
        writer.flush().map_err(|error| error.to_string())
    }

    pub fn ensure_document_thread(
        &self,
        document_id: String,
        source: String,
        thread_id: Option<String>,
        workspace_path: Option<String>,
        figure_path: Option<String>,
        preview_path: Option<String>,
    ) -> Result<AssistantThreadSummary, String> {
        self.ensure_process()?;

        if let Some(existing) = self
            .inner
            .documents
            .lock()
            .map_err(|_| "documents lock unavailable".to_string())?
            .get(&document_id)
            .cloned()
        {
            return Ok(summary_from_session(&existing));
        }

        let workspace =
            resolve_workspace(&self.inner.app, &document_id, workspace_path.as_deref())?;
        let figure = figure_path
            .map(PathBuf::from)
            .unwrap_or_else(|| workspace.join("figure.tex"));
        let preview = preview_path
            .map(PathBuf::from)
            .unwrap_or_else(|| workspace.join("current.png"));

        fs::create_dir_all(&workspace).map_err(|error| error.to_string())?;
        fs::write(&figure, &source).map_err(|error| error.to_string())?;

        let thread_id = if let Some(existing_thread_id) = thread_id {
            let _ = self.request(
                "thread/resume",
                json!({
                  "threadId": existing_thread_id,
                  "cwd": workspace.to_string_lossy().to_string()
                }),
            )?;
            existing_thread_id
        } else {
            let result = self.request(
        "thread/start",
        json!({
          "cwd": workspace.to_string_lossy().to_string(),
          "serviceName": "tikz-editor-desktop",
          "dynamicTools": [
            {
              "name": "get_latest_preview_png",
              "description": "Request a freshly rendered PNG preview of figure.tex from the TikZ editor.",
              "inputSchema": {
                "type": "object",
                "properties": {},
                "additionalProperties": false
              }
            }
          ]
        }),
      )?;
            result
                .get("thread")
                .and_then(|value| value.get("id"))
                .and_then(Value::as_str)
                .ok_or_else(|| "App-server did not return a thread id".to_string())?
                .to_string()
        };

        let session = DocumentAssistantSession {
            document_id: document_id.clone(),
            thread_id: thread_id.clone(),
            workspace_path: workspace.clone(),
            figure_path: figure.clone(),
            preview_path: preview.clone(),
            items: Vec::new(),
            pending_server_requests: HashMap::new(),
            current_turn_id: None,
            last_seen_figure_source: source,
            revision_counter: 0,
        };
        self.inner
            .documents
            .lock()
            .map_err(|_| "documents lock unavailable".to_string())?
            .insert(document_id, session.clone());
        Ok(summary_from_session(&session))
    }

    pub fn start_turn(
        &self,
        document_id: String,
        prompt: String,
        source: String,
        png_base64: Option<String>,
    ) -> Result<Option<String>, String> {
        let summary = self.ensure_document_thread(
            document_id.clone(),
            source.clone(),
            None,
            None,
            None,
            None,
        )?;
        self.sync_source(document_id.clone(), source.clone())?;
        if let Some(base64_png) = png_base64 {
            write_base64_file(Path::new(&summary.preview_path), &base64_png)?;
        }

        let input = build_turn_input(
            &summary.figure_path,
            &summary.preview_path,
            &prompt,
            &source,
        );
        let result = self.request(
      "turn/start",
      json!({
        "threadId": summary.thread_id,
        "cwd": summary.workspace_path,
        "input": input,
        "approvalPolicy": self.inner.approval_policy.lock().map_err(|_| "approval policy unavailable".to_string())?.clone(),
        "sandboxPolicy": {
          "type": "workspaceWrite",
          "writableRoots": [summary.workspace_path],
          "networkAccess": false
        }
      }),
    )?;

        let turn_id = result
            .get("turn")
            .and_then(|value| value.get("id"))
            .and_then(Value::as_str)
            .map(str::to_string);
        if let Some(session) = self
            .inner
            .documents
            .lock()
            .map_err(|_| "documents lock unavailable".to_string())?
            .get_mut(&document_id)
        {
            session.current_turn_id = turn_id.clone();
        }
        Ok(turn_id)
    }

    pub fn interrupt_turn(&self, document_id: String) -> Result<(), String> {
        let session = self
            .inner
            .documents
            .lock()
            .map_err(|_| "documents lock unavailable".to_string())?
            .get(&document_id)
            .cloned()
            .ok_or_else(|| "Assistant thread not initialized for document".to_string())?;
        if let Some(turn_id) = session.current_turn_id {
            let _ = self.request(
                "turn/interrupt",
                json!({ "threadId": session.thread_id, "turnId": turn_id }),
            )?;
        }
        Ok(())
    }

    pub fn sync_source(&self, document_id: String, source: String) -> Result<(), String> {
        let mut docs = self
            .inner
            .documents
            .lock()
            .map_err(|_| "documents lock unavailable".to_string())?;
        let session = docs
            .get_mut(&document_id)
            .ok_or_else(|| "Assistant thread not initialized for document".to_string())?;
        fs::create_dir_all(&session.workspace_path).map_err(|error| error.to_string())?;
        fs::write(&session.figure_path, &source).map_err(|error| error.to_string())?;
        session.last_seen_figure_source = source;
        Ok(())
    }

    pub fn respond_to_approval(
        &self,
        document_id: String,
        request_id: String,
        decision: String,
    ) -> Result<(), String> {
        let pending_request = {
            let docs = self
                .inner
                .documents
                .lock()
                .map_err(|_| "documents lock unavailable".to_string())?;
            let session = docs
                .get(&document_id)
                .ok_or_else(|| "Assistant thread not initialized for document".to_string())?;
            session
                .pending_server_requests
                .get(&request_id)
                .cloned()
                .ok_or_else(|| "Unknown approval request".to_string())?
        };

        match pending_request.kind {
            PendingServerRequestKind::CommandApproval
            | PendingServerRequestKind::FileChangeApproval => self.send_server_request_response(
                pending_request.id,
                json!({ "decision": normalize_approval_decision_value(&decision) }),
            ),
            PendingServerRequestKind::ToolRequestUserInput => {
                // Until a dedicated question UI exists, return empty answers to unblock the turn.
                self.send_server_request_response(pending_request.id, json!({ "answers": {} }))
            }
            PendingServerRequestKind::DynamicToolCall => {
                Err("Request is not an approval request".to_string())
            }
        }
    }

    pub fn respond_to_dynamic_tool_call(
        &self,
        document_id: String,
        request_id: String,
        result: Value,
    ) -> Result<(), String> {
        if let Some(image_data) = extract_dynamic_tool_image_base64(&result) {
            let preview_path = {
                let docs = self
                    .inner
                    .documents
                    .lock()
                    .map_err(|_| "documents lock unavailable".to_string())?;
                docs.get(&document_id)
                    .map(|session| session.preview_path.clone())
                    .ok_or_else(|| "Assistant thread not initialized for document".to_string())?
            };
            write_base64_file(&preview_path, &image_data)?;
        }

        let pending_request = {
            let docs = self
                .inner
                .documents
                .lock()
                .map_err(|_| "documents lock unavailable".to_string())?;
            let session = docs
                .get(&document_id)
                .ok_or_else(|| "Assistant thread not initialized for document".to_string())?;
            session
                .pending_server_requests
                .get(&request_id)
                .cloned()
                .ok_or_else(|| "Unknown dynamic tool request".to_string())?
        };
        if !matches!(
            pending_request.kind,
            PendingServerRequestKind::DynamicToolCall
        ) {
            return Err("Request is not a dynamic tool call".to_string());
        }
        self.send_server_request_response(pending_request.id, result)
    }

    pub fn load_thread_state(
        &self,
        document_id: String,
    ) -> Result<Option<AssistantThreadStatePayload>, String> {
        let docs = self
            .inner
            .documents
            .lock()
            .map_err(|_| "documents lock unavailable".to_string())?;
        let Some(session) = docs.get(&document_id) else {
            return Ok(None);
        };
        Ok(Some(AssistantThreadStatePayload {
            thread_id: session.thread_id.clone(),
            workspace_path: session.workspace_path.to_string_lossy().to_string(),
            figure_path: session.figure_path.to_string_lossy().to_string(),
            preview_path: session.preview_path.to_string_lossy().to_string(),
            items: session.items.clone(),
        }))
    }

    fn send_server_request_response(&self, request_id: Value, result: Value) -> Result<(), String> {
        self.ensure_process()?;
        let stdin = {
            let process_guard = self
                .inner
                .process
                .lock()
                .map_err(|_| "process lock unavailable".to_string())?;
            process_guard
                .as_ref()
                .ok_or_else(|| "Codex app-server is unavailable".to_string())?
                .stdin
                .clone()
        };
        let payload = json!({
          "id": request_id,
          "result": result
        });
        let line = serde_json::to_string(&payload).map_err(|error| error.to_string())?;
        let mut writer = stdin
            .lock()
            .map_err(|_| "stdin lock unavailable".to_string())?;
        writer
            .write_all(line.as_bytes())
            .map_err(|error| error.to_string())?;
        writer.write_all(b"\n").map_err(|error| error.to_string())?;
        writer.flush().map_err(|error| error.to_string())
    }

    fn send_server_request_error(
        &self,
        request_id: Value,
        code: i64,
        message: &str,
    ) -> Result<(), String> {
        self.ensure_process()?;
        let stdin = {
            let process_guard = self
                .inner
                .process
                .lock()
                .map_err(|_| "process lock unavailable".to_string())?;
            process_guard
                .as_ref()
                .ok_or_else(|| "Codex app-server is unavailable".to_string())?
                .stdin
                .clone()
        };
        let payload = json!({
          "id": request_id,
          "error": {
            "code": code,
            "message": message
          }
        });
        let line = serde_json::to_string(&payload).map_err(|error| error.to_string())?;
        let mut writer = stdin
            .lock()
            .map_err(|_| "stdin lock unavailable".to_string())?;
        writer
            .write_all(line.as_bytes())
            .map_err(|error| error.to_string())?;
        writer.write_all(b"\n").map_err(|error| error.to_string())?;
        writer.flush().map_err(|error| error.to_string())
    }

    fn handle_response(
        &self,
        message: Value,
        pending: &Arc<Mutex<HashMap<String, Sender<Value>>>>,
    ) {
        let Some(id) = message.get("id").and_then(request_id_to_key) else {
            return;
        };
        let maybe_sender = pending.lock().ok().and_then(|mut map| map.remove(&id));
        if let Some(sender) = maybe_sender {
            let _ = sender.send(message);
        }
    }

    fn handle_server_request(&self, message: Value) {
        let Some(id) = message.get("id").cloned() else {
            return;
        };
        let Some(id_key) = request_id_to_key(&id) else {
            let _ = self.send_server_request_error(
                id,
                -32600,
                "Server request id must be string or number.",
            );
            return;
        };
        let Some(method) = message.get("method").and_then(Value::as_str) else {
            return;
        };
        let params = message.get("params").cloned().unwrap_or(Value::Null);
        let Some(document_id) = self.document_id_from_params(&params) else {
            let _ = self.emit_event(AssistantEventPayload {
        kind: "error".to_string(),
        data: json!({ "message": format!("Unhandled app-server request `{method}` without thread context.") }),
      });
            let _ = self.send_server_request_error(
                id,
                -32602,
                "Missing or unknown thread context for server request.",
            );
            return;
        };

        match method {
            "item/tool/call" => {
                if let Ok(mut docs) = self.inner.documents.lock() {
                    if let Some(session) = docs.get_mut(&document_id) {
                        session.pending_server_requests.insert(
                            id_key.clone(),
                            PendingServerRequest {
                                id: id.clone(),
                                kind: PendingServerRequestKind::DynamicToolCall,
                            },
                        );
                    }
                }
                let _ = self.emit_event(AssistantEventPayload {
                    kind: "dynamic-tool-call".to_string(),
                    data: json!({
                      "documentId": document_id,
                      "requestId": id_key,
                      "itemId": params.get("itemId").and_then(Value::as_str),
                      "tool": params.get("tool").and_then(Value::as_str).unwrap_or("dynamic-tool"),
                      "arguments": params.get("arguments").cloned().unwrap_or(Value::Null)
                    }),
                });
            }
            "item/commandExecution/requestApproval" => {
                if let Ok(mut docs) = self.inner.documents.lock() {
                    if let Some(session) = docs.get_mut(&document_id) {
                        session.pending_server_requests.insert(
                            id_key.clone(),
                            PendingServerRequest {
                                id: id.clone(),
                                kind: PendingServerRequestKind::CommandApproval,
                            },
                        );
                    }
                }
                let _ = self.emit_event(AssistantEventPayload {
          kind: "approval-requested".to_string(),
          data: json!({
            "documentId": document_id,
            "approval": {
              "kind": "command",
              "requestId": id_key,
              "itemId": params.get("itemId").and_then(Value::as_str).unwrap_or_default(),
              "threadId": params.get("threadId").and_then(Value::as_str).unwrap_or_default(),
              "turnId": params.get("turnId").and_then(Value::as_str).unwrap_or_default(),
              "reason": params.get("reason").cloned().unwrap_or(Value::Null),
              "command": params.get("command").cloned().unwrap_or(Value::Null),
              "cwd": params.get("cwd").cloned().unwrap_or(Value::Null),
              "availableDecisions": params.get("availableDecisions").cloned().unwrap_or(Value::Null)
            }
          }),
        });
            }
            "item/fileChange/requestApproval" => {
                if let Ok(mut docs) = self.inner.documents.lock() {
                    if let Some(session) = docs.get_mut(&document_id) {
                        session.pending_server_requests.insert(
                            id_key.clone(),
                            PendingServerRequest {
                                id: id.clone(),
                                kind: PendingServerRequestKind::FileChangeApproval,
                            },
                        );
                    }
                }
                let _ = self.emit_event(AssistantEventPayload {
          kind: "approval-requested".to_string(),
          data: json!({
            "documentId": document_id,
            "approval": {
              "kind": "fileChange",
              "requestId": id_key,
              "itemId": params.get("itemId").and_then(Value::as_str).unwrap_or_default(),
              "threadId": params.get("threadId").and_then(Value::as_str).unwrap_or_default(),
              "turnId": params.get("turnId").and_then(Value::as_str).unwrap_or_default(),
              "reason": params.get("reason").cloned().unwrap_or(Value::Null),
              "grantRoot": params.get("grantRoot").cloned().unwrap_or(Value::Null)
            }
          }),
        });
            }
            "item/tool/requestUserInput" | "tool/requestUserInput" => {
                if let Ok(mut docs) = self.inner.documents.lock() {
                    if let Some(session) = docs.get_mut(&document_id) {
                        session.pending_server_requests.insert(
                            id_key.clone(),
                            PendingServerRequest {
                                id: id.clone(),
                                kind: PendingServerRequestKind::ToolRequestUserInput,
                            },
                        );
                    }
                }
                let _ = self.emit_event(AssistantEventPayload {
          kind: "approval-requested".to_string(),
          data: json!({
            "documentId": document_id,
            "approval": {
              "kind": "toolInput",
              "requestId": id_key,
              "threadId": params.get("threadId").and_then(Value::as_str).unwrap_or_default(),
              "turnId": params.get("turnId").cloned().unwrap_or(Value::Null),
              "payload": params
            }
          }),
        });
            }
            _ => {
                let _ = self.emit_event(AssistantEventPayload {
                    kind: "error".to_string(),
                    data: json!({
                      "documentId": document_id,
                      "message": format!("Unhandled app-server request `{method}`.")
                    }),
                });
                let _ = self.send_server_request_error(
                    id,
                    -32601,
                    &format!("Unsupported server request method `{method}`"),
                );
            }
        }
    }

    fn handle_notification(&self, message: Value) {
        let Some(method) = message.get("method").and_then(Value::as_str) else {
            return;
        };
        let params = message.get("params").cloned().unwrap_or(Value::Null);
        let document_id = self.document_id_from_params(&params);

        match method {
            "turn/started" => {
                if let Some(document_id) = document_id {
                    let turn_id = params
                        .get("turn")
                        .and_then(|value| value.get("id"))
                        .and_then(Value::as_str)
                        .map(str::to_string);
                    if let Ok(mut docs) = self.inner.documents.lock() {
                        if let Some(session) = docs.get_mut(&document_id) {
                            session.current_turn_id = turn_id.clone();
                        }
                    }
                    let _ = self.emit_event(AssistantEventPayload {
                        kind: "turn-status".to_string(),
                        data: json!({
                          "documentId": document_id,
                          "turnId": turn_id,
                          "status": "inProgress"
                        }),
                    });
                }
            }
            "turn/completed" => {
                if let Some(document_id) = document_id {
                    let turn = params.get("turn").cloned().unwrap_or(Value::Null);
                    let status = turn
                        .get("status")
                        .and_then(Value::as_str)
                        .unwrap_or("completed");
                    let error = turn
                        .get("error")
                        .and_then(|value| {
                            value.get("message").or_else(|| value.get("error")).cloned()
                        })
                        .unwrap_or(Value::Null);
                    if let Ok(mut docs) = self.inner.documents.lock() {
                        if let Some(session) = docs.get_mut(&document_id) {
                            session.current_turn_id = None;
                        }
                    }
                    let _ = self.emit_event(AssistantEventPayload {
                        kind: "turn-status".to_string(),
                        data: json!({
                          "documentId": document_id,
                          "status": status,
                          "turnId": turn.get("id").cloned().unwrap_or(Value::Null),
                          "error": error
                        }),
                    });
                }
            }
            "item/started" | "item/completed" => {
                if let Some(document_id) = document_id {
                    let item = params.get("item").cloned().unwrap_or(Value::Null);
                    self.upsert_item(&document_id, &item);
                    let _ = self.emit_event(AssistantEventPayload {
                        kind: if method == "item/started" {
                            "item-started".to_string()
                        } else {
                            "item-completed".to_string()
                        },
                        data: json!({
                          "documentId": document_id,
                          "item": item
                        }),
                    });
                }
            }
            "item/agentMessage/delta"
            | "item/plan/delta"
            | "item/reasoning/summaryTextDelta"
            | "item/reasoning/textDelta"
            | "item/commandExecution/outputDelta" => {
                if let Some(document_id) = document_id {
                    let item_id = params
                        .get("itemId")
                        .and_then(Value::as_str)
                        .unwrap_or_default();
                    let delta = params
                        .get("delta")
                        .or_else(|| params.get("text"))
                        .or_else(|| params.get("output"))
                        .and_then(Value::as_str)
                        .unwrap_or_default();
                    let _ = self.emit_event(AssistantEventPayload {
                        kind: "item-delta".to_string(),
                        data: json!({
                          "documentId": document_id,
                          "itemId": item_id,
                          "deltaType": method,
                          "delta": delta
                        }),
                    });
                }
            }
            "serverRequest/resolved" => {
                if let Some(document_id) = document_id {
                    let request_id = params
                        .get("requestId")
                        .and_then(request_id_to_key)
                        .unwrap_or_default();
                    if let Ok(mut docs) = self.inner.documents.lock() {
                        if let Some(session) = docs.get_mut(&document_id) {
                            session.pending_server_requests.remove(&request_id);
                        }
                    }
                    let _ = self.emit_event(AssistantEventPayload {
                        kind: "approval-cleared".to_string(),
                        data: json!({
                          "documentId": document_id,
                          "requestId": request_id
                        }),
                    });
                }
            }
            "error" => {
                let _ = self.emit_event(AssistantEventPayload {
                    kind: "error".to_string(),
                    data: json!({
                      "documentId": document_id,
                      "message": params
                        .get("error")
                        .and_then(|value| value.get("message"))
                        .and_then(Value::as_str)
                        .unwrap_or("Codex App Server error.")
                    }),
                });
            }
            _ => {}
        }
    }

    fn upsert_item(&self, document_id: &str, item: &Value) {
        let Some(item_id) = item.get("id").and_then(Value::as_str) else {
            return;
        };
        if let Ok(mut docs) = self.inner.documents.lock() {
            if let Some(session) = docs.get_mut(document_id) {
                if let Some(index) = session.items.iter().position(|existing| {
                    existing.get("id").and_then(Value::as_str) == Some(item_id)
                }) {
                    session.items[index] = merge_json(session.items[index].clone(), item.clone());
                } else {
                    session.items.push(item.clone());
                }
            }
        }
    }

    fn document_id_from_params(&self, params: &Value) -> Option<String> {
        let thread_id = params
            .get("threadId")
            .or_else(|| params.get("thread").and_then(|value| value.get("id")))
            .and_then(Value::as_str)?;
        let docs = self.inner.documents.lock().ok()?;
        docs.iter()
            .find(|(_, session)| session.thread_id == thread_id)
            .map(|(document_id, _)| document_id.clone())
    }

    fn emit_event(&self, payload: AssistantEventPayload) -> Result<(), String> {
        self.inner
            .app
            .emit(ASSISTANT_EVENT_NAME, payload)
            .map_err(|error| error.to_string())
    }
}

fn normalize_approval_policy_value(value: &str) -> &str {
    match value {
        "onRequest" | "on-request" => "on-request",
        "unlessTrusted" | "untrusted" => "untrusted",
        "onFailure" | "on-failure" => "on-failure",
        "reject" => "reject",
        "never" => "never",
        other => other,
    }
}

fn normalize_approval_decision_value(value: &str) -> &str {
    match value {
        "acceptForSession" | "accept-for-session" => "acceptForSession",
        "accept" => "accept",
        "decline" => "decline",
        "cancel" => "cancel",
        other => other,
    }
}

fn request_id_to_key(value: &Value) -> Option<String> {
    match value {
        Value::String(value) => Some(value.clone()),
        Value::Number(value) => Some(value.to_string()),
        _ => None,
    }
}

fn parse_data_url_base64_image(url: &str) -> Option<String> {
    let (_, right) = url.split_once(',')?;
    if !url[..url.find(',')?].contains(";base64") {
        return None;
    }
    Some(right.to_string())
}

fn extract_dynamic_tool_image_base64(result: &Value) -> Option<String> {
    let items = result.get("contentItems").and_then(Value::as_array)?;
    for item in items {
        let item_type = item.get("type").and_then(Value::as_str).unwrap_or_default();
        if item_type == "image" {
            if let Some(data) = item.get("data").and_then(Value::as_str) {
                return Some(data.to_string());
            }
        }
        if item_type == "inputImage" {
            if let Some(url) = item.get("imageUrl").and_then(Value::as_str) {
                if let Some(base64_data) = parse_data_url_base64_image(url) {
                    return Some(base64_data);
                }
            }
        }
    }
    None
}

fn spawn_stdout_reader(
    state: AssistantState,
    stdout: ChildStdout,
    pending: Arc<Mutex<HashMap<String, Sender<Value>>>>,
) {
    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            let Ok(line) = line else {
                continue;
            };
            let Ok(message) = serde_json::from_str::<Value>(&line) else {
                let _ = state.emit_event(AssistantEventPayload {
          kind: "error".to_string(),
          data: json!({ "message": format!("Failed to parse app-server message: {line}") }),
        });
                continue;
            };
            if message.get("method").is_some() && message.get("id").is_some() {
                state.handle_server_request(message);
            } else if message.get("method").is_some() {
                state.handle_notification(message);
            } else if message.get("id").is_some() {
                state.handle_response(message, &pending);
            }
        }
    });
}

fn spawn_stderr_reader(stderr: ChildStderr) {
    thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            if let Ok(line) = line {
                eprintln!("[codex app-server] {line}");
            }
        }
    });
}

fn summary_from_session(session: &DocumentAssistantSession) -> AssistantThreadSummary {
    AssistantThreadSummary {
        thread_id: session.thread_id.clone(),
        workspace_path: session.workspace_path.to_string_lossy().to_string(),
        figure_path: session.figure_path.to_string_lossy().to_string(),
        preview_path: session.preview_path.to_string_lossy().to_string(),
    }
}

fn resolve_workspace(
    app: &AppHandle,
    document_id: &str,
    provided: Option<&str>,
) -> Result<PathBuf, String> {
    if let Some(path) = provided {
        return Ok(PathBuf::from(path));
    }
    let base = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join("codex-assistant")
        .join(document_id);
    Ok(base)
}

fn write_base64_file(path: &Path, base64_contents: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64_contents)
        .map_err(|error| error.to_string())?;
    fs::write(path, bytes).map_err(|error| error.to_string())
}

fn build_turn_input(
    figure_path: &str,
    preview_path: &str,
    prompt: &str,
    source: &str,
) -> Vec<Value> {
    let mut input = vec![json!({
      "type": "text",
      "text": format!(
        "You are helping edit the current TikZ figure. Edit `{figure_path}` in the current working directory when needed. The current figure source is:\n```tex\n{source}\n```\nUser request: {prompt}"
      )
    })];
    if Path::new(preview_path).exists() {
        input.push(json!({
          "type": "localImage",
          "path": preview_path
        }));
    }
    input
}

fn merge_json(existing: Value, incoming: Value) -> Value {
    match (existing, incoming) {
        (Value::Object(mut left), Value::Object(right)) => {
            for (key, value) in right {
                let merged = match left.remove(&key) {
                    Some(previous) => merge_json(previous, value),
                    None => value,
                };
                left.insert(key, merged);
            }
            Value::Object(left)
        }
        (_, right) => right,
    }
}
