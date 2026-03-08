mod assistant;

use assistant::{AssistantState, AssistantThreadStatePayload, AssistantThreadSummary};
use base64::Engine;
use rfd::FileDialog;
use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

const MAX_RECENT_FILES: usize = 10;
const RECENTS_FILENAME: &str = "recent-files.json";

#[derive(Default)]
struct RecentFilesState {
  files: Mutex<Vec<String>>,
}

#[derive(Default)]
struct WindowCloseState {
  allow_next_close: Mutex<bool>,
}

#[derive(Serialize)]
struct OpenTextPayload {
  source: String,
  path: String,
  name: String,
}

#[derive(Serialize)]
struct SaveTextPayload {
  ok: bool,
  path: Option<String>,
  name: Option<String>,
}

fn recents_file_path(app: &AppHandle) -> Option<PathBuf> {
  app.path().app_config_dir().ok().map(|dir| dir.join(RECENTS_FILENAME))
}

fn load_recent_files_from_disk(app: &AppHandle) -> Vec<String> {
  let Some(path) = recents_file_path(app) else {
    return Vec::new();
  };
  let Ok(raw) = fs::read_to_string(path) else {
    return Vec::new();
  };
  match serde_json::from_str::<Vec<String>>(&raw) {
    Ok(entries) => entries.into_iter().filter(|entry| !entry.trim().is_empty()).collect(),
    Err(_) => Vec::new(),
  }
}

fn save_recent_files_to_disk(app: &AppHandle, files: &[String]) {
  let Some(path) = recents_file_path(app) else {
    return;
  };
  if let Some(parent) = path.parent() {
    let _ = fs::create_dir_all(parent);
  }
  if let Ok(raw) = serde_json::to_string_pretty(files) {
    let _ = fs::write(path, raw);
  }
}

fn normalize_recents(entries: Vec<String>) -> Vec<String> {
  let mut out: Vec<String> = Vec::new();
  for entry in entries {
    if entry.trim().is_empty() {
      continue;
    }
    if out.iter().any(|known| known == &entry) {
      continue;
    }
    out.push(entry);
    if out.len() >= MAX_RECENT_FILES {
      break;
    }
  }
  out
}

fn add_recent_file(app: &AppHandle, path: String) {
  let normalized = {
    let state = app.state::<RecentFilesState>();
    let mut entries = state
      .files
      .lock()
      .expect("recent files mutex poisoned");
    let mut next = vec![path];
    next.extend(entries.iter().cloned());
    let compact = normalize_recents(next);
    *entries = compact.clone();
    compact
  };
  save_recent_files_to_disk(app, &normalized);
}

#[tauri::command]
fn desktop_open_text(path: Option<String>, app: AppHandle) -> Result<Option<OpenTextPayload>, String> {
  let resolved_path = if let Some(raw_path) = path {
    Some(PathBuf::from(raw_path))
  } else {
    FileDialog::new()
      .add_filter("TikZ", &["tex", "tikz", "txt"])
      .pick_file()
  };
  let Some(path_buf) = resolved_path else {
    return Ok(None);
  };
  let source = fs::read_to_string(&path_buf).map_err(|error| error.to_string())?;
  let path = path_buf.to_string_lossy().to_string();
  let name = path_buf
    .file_name()
    .and_then(|name| name.to_str())
    .map(ToOwned::to_owned)
    .unwrap_or_else(|| "document.tex".to_string());
  add_recent_file(&app, path.clone());
  Ok(Some(OpenTextPayload { source, path, name }))
}

#[tauri::command]
fn desktop_save_text(
  text: String,
  suggested_name: Option<String>,
  path: Option<String>,
  force_save_as: bool,
  app: AppHandle,
) -> Result<SaveTextPayload, String> {
  let resolved_path = if !force_save_as {
    path.map(PathBuf::from)
  } else {
    None
  }
  .or_else(|| {
    let mut dialog = FileDialog::new();
    if let Some(name) = suggested_name.as_ref() {
      dialog = dialog.set_file_name(name);
    }
    dialog.save_file()
  });

  let Some(path_buf) = resolved_path else {
    return Ok(SaveTextPayload {
      ok: false,
      path: None,
      name: None,
    });
  };

  fs::write(&path_buf, text).map_err(|error| error.to_string())?;
  let path = path_buf.to_string_lossy().to_string();
  let name = path_buf
    .file_name()
    .and_then(|name| name.to_str())
    .map(ToOwned::to_owned)
    .unwrap_or_else(|| suggested_name.unwrap_or_else(|| "tikz-document.tex".to_string()));
  add_recent_file(&app, path.clone());
  Ok(SaveTextPayload {
    ok: true,
    path: Some(path),
    name: Some(name),
  })
}

#[tauri::command]
fn desktop_export_file(
  file_name: String,
  _mime_type: String,
  bytes_base64: String,
) -> Result<bool, String> {
  let target = FileDialog::new().set_file_name(&file_name).save_file();
  let Some(path_buf) = target else {
    return Ok(false);
  };
  let bytes = base64::engine::general_purpose::STANDARD
    .decode(bytes_base64)
    .map_err(|error| error.to_string())?;
  fs::write(path_buf, bytes).map_err(|error| error.to_string())?;
  Ok(true)
}

#[tauri::command]
fn desktop_confirm_window_close(app: AppHandle) -> Result<(), String> {
  {
    let state = app.state::<WindowCloseState>();
    let mut allow = state
      .allow_next_close
      .lock()
      .map_err(|_| "close state unavailable".to_string())?;
    *allow = true;
  }
  let window = app
    .get_webview_window("main")
    .ok_or_else(|| "main window not found".to_string())?;
  window.close().map_err(|error| error.to_string())
}

#[tauri::command]
fn desktop_list_recent_files(app: AppHandle) -> Result<Vec<String>, String> {
  let state = app.state::<RecentFilesState>();
  let entries = state
    .files
    .lock()
    .map_err(|_| "recent files state unavailable".to_string())?;
  Ok(entries.clone())
}

#[tauri::command]
fn desktop_open_external(url: String) -> Result<bool, String> {
  #[cfg(target_os = "macos")]
  let mut cmd = {
    let mut command = Command::new("open");
    command.arg(&url);
    command
  };

  #[cfg(target_os = "windows")]
  let mut cmd = {
    let mut command = Command::new("cmd");
    command.args(["/C", "start", "", &url]);
    command
  };

  #[cfg(all(unix, not(target_os = "macos")))]
  let mut cmd = {
    let mut command = Command::new("xdg-open");
    command.arg(&url);
    command
  };

  cmd.status()
    .map(|status| status.success())
    .map_err(|error| error.to_string())
}

#[tauri::command]
#[allow(non_snake_case)]
fn desktop_assistant_ensure_document_thread(
  documentId: String,
  source: String,
  threadId: Option<String>,
  workspacePath: Option<String>,
  figurePath: Option<String>,
  previewPath: Option<String>,
  assistant: tauri::State<'_, AssistantState>,
) -> Result<AssistantThreadSummary, String> {
  assistant.ensure_document_thread(documentId, source, threadId, workspacePath, figurePath, previewPath)
}

#[tauri::command]
#[allow(non_snake_case)]
fn desktop_assistant_start_turn(
  documentId: String,
  prompt: String,
  source: String,
  pngBase64: Option<String>,
  assistant: tauri::State<'_, AssistantState>,
) -> Result<serde_json::Value, String> {
  let turn_id = assistant.start_turn(documentId, prompt, source, pngBase64)?;
  Ok(serde_json::json!({ "turnId": turn_id }))
}

#[tauri::command]
#[allow(non_snake_case)]
fn desktop_assistant_interrupt_turn(
  documentId: String,
  assistant: tauri::State<'_, AssistantState>,
) -> Result<(), String> {
  assistant.interrupt_turn(documentId)
}

#[tauri::command]
#[allow(non_snake_case)]
fn desktop_assistant_sync_source(
  documentId: String,
  source: String,
  assistant: tauri::State<'_, AssistantState>,
) -> Result<(), String> {
  assistant.sync_source(documentId, source)
}

#[tauri::command]
#[allow(non_snake_case)]
fn desktop_assistant_respond_to_approval(
  documentId: String,
  requestId: String,
  decision: String,
  assistant: tauri::State<'_, AssistantState>,
) -> Result<(), String> {
  assistant.respond_to_approval(documentId, requestId, decision)
}

#[tauri::command]
#[allow(non_snake_case)]
fn desktop_assistant_respond_to_dynamic_tool_call(
  documentId: String,
  requestId: String,
  result: Value,
  assistant: tauri::State<'_, AssistantState>,
) -> Result<(), String> {
  assistant.respond_to_dynamic_tool_call(documentId, requestId, result)
}

#[tauri::command]
#[allow(non_snake_case)]
fn desktop_assistant_load_thread_state(
  documentId: String,
  assistant: tauri::State<'_, AssistantState>,
) -> Result<Option<AssistantThreadStatePayload>, String> {
  assistant.load_thread_state(documentId)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_clipboard_manager::init())
    .manage(RecentFilesState::default())
    .manage(WindowCloseState::default())
    .on_window_event(|window, event| {
      if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        let allow_close = {
          let state = window.state::<WindowCloseState>();
          let decision = match state.allow_next_close.lock() {
            Ok(mut allow) => {
              if *allow {
                *allow = false;
                true
              } else {
                false
              }
            }
            Err(_) => false,
          };
          decision
        };
        if allow_close {
          return;
        }
        api.prevent_close();
        let _ = window.emit("desktop-window-close-request", ());
      }
    })
    .invoke_handler(tauri::generate_handler![
      desktop_open_text,
      desktop_save_text,
      desktop_export_file,
      desktop_confirm_window_close,
      desktop_list_recent_files,
      desktop_open_external,
      desktop_assistant_ensure_document_thread,
      desktop_assistant_start_turn,
      desktop_assistant_interrupt_turn,
      desktop_assistant_sync_source,
      desktop_assistant_respond_to_approval,
      desktop_assistant_respond_to_dynamic_tool_call,
      desktop_assistant_load_thread_state
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      let loaded = normalize_recents(load_recent_files_from_disk(&app.handle()));
      if let Ok(mut entries) = app.state::<RecentFilesState>().files.lock() {
        *entries = loaded.clone();
      }
      save_recent_files_to_disk(&app.handle(), &loaded);
      app.manage(AssistantState::new(app.handle().clone()));
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
