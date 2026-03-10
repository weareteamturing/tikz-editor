mod assistant;

use assistant::{
    AssistantAccountSnapshot, AssistantModelOption, AssistantState, AssistantThreadStatePayload,
    AssistantThreadSummary,
};
use base64::Engine;
use rfd::FileDialog;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{
    menu::{CheckMenuItemBuilder, Menu, MenuItemBuilder, MenuItemKind, PredefinedMenuItem, SubmenuBuilder},
    AppHandle, Emitter, Manager,
};

const MAX_RECENT_FILES: usize = 10;
const RECENTS_FILENAME: &str = "recent-files.json";
const CONTEXT_MENU_EVENT_PREFIX: &str = "ctx::";
const CONTEXT_MENU_OVERLAP_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Default)]
struct RecentFilesState {
    files: Mutex<Vec<String>>,
}

#[derive(Default)]
struct WindowCloseState {
    allow_next_close: Mutex<bool>,
}

struct ContextMenuInFlight {
    request_id: String,
    started_at: Instant,
}

#[derive(Default)]
struct ContextMenuState {
    in_flight: Mutex<Option<ContextMenuInFlight>>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind")]
enum DesktopContextMenuItemPayload {
    #[serde(rename = "separator")]
    Separator,
    #[serde(rename = "command")]
    Command {
        #[serde(rename = "commandId")]
        command_id: String,
        label: String,
        enabled: bool,
        #[serde(default)]
        checked: Option<bool>,
        #[serde(default)]
        accelerator: Option<String>,
    },
    #[serde(rename = "submenu")]
    Submenu {
        label: String,
        items: Vec<DesktopContextMenuItemPayload>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct DesktopContextMenuPayload {
    #[serde(rename = "requestId")]
    request_id: String,
    target: String,
    items: Vec<DesktopContextMenuItemPayload>,
    position: DesktopContextMenuPosition,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct DesktopContextMenuPosition {
    x: f64,
    y: f64,
}

#[derive(Debug, Clone, Serialize)]
struct DesktopContextMenuCommandEvent {
    #[serde(rename = "requestId")]
    request_id: String,
    #[serde(rename = "commandId")]
    command_id: String,
}

#[derive(Debug, Clone, Serialize)]
struct DesktopContextMenuDebugEvent {
    #[serde(rename = "requestId")]
    request_id: String,
    phase: String,
    target: Option<String>,
    x: Option<f64>,
    y: Option<f64>,
    reason: Option<String>,
    error: Option<String>,
}

fn recents_file_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join(RECENTS_FILENAME))
}

fn load_recent_files_from_disk(app: &AppHandle) -> Vec<String> {
    let Some(path) = recents_file_path(app) else {
        return Vec::new();
    };
    let Ok(raw) = fs::read_to_string(path) else {
        return Vec::new();
    };
    match serde_json::from_str::<Vec<String>>(&raw) {
        Ok(entries) => entries
            .into_iter()
            .filter(|entry| !entry.trim().is_empty())
            .collect(),
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
        let mut entries = state.files.lock().expect("recent files mutex poisoned");
        let mut next = vec![path];
        next.extend(entries.iter().cloned());
        let compact = normalize_recents(next);
        *entries = compact.clone();
        compact
    };
    save_recent_files_to_disk(app, &normalized);
}

fn emit_context_menu_debug(
    app: &AppHandle,
    request_id: &str,
    phase: &str,
    target: Option<&str>,
    position: Option<&DesktopContextMenuPosition>,
    reason: Option<String>,
    error: Option<String>,
) {
    let payload = DesktopContextMenuDebugEvent {
        request_id: request_id.to_string(),
        phase: phase.to_string(),
        target: target.map(ToOwned::to_owned),
        x: position.map(|p| p.x),
        y: position.map(|p| p.y),
        reason,
        error,
    };
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit("desktop-context-menu-debug", payload);
    }
}

fn context_menu_item_id(request_id: &str, command_id: &str) -> String {
    format!("{CONTEXT_MENU_EVENT_PREFIX}{request_id}::{command_id}")
}

fn parse_context_menu_item_id(raw_id: &str) -> Option<(String, String)> {
    let remainder = raw_id.strip_prefix(CONTEXT_MENU_EVENT_PREFIX)?;
    let (request_id, command_id) = remainder.split_once("::")?;
    Some((request_id.to_string(), command_id.to_string()))
}

fn native_clipboard_role(command_id: &str) -> Option<&'static str> {
    match command_id {
        "edit.cut" => Some("cut"),
        "edit.copy" => Some("copy"),
        "edit.paste" => Some("paste"),
        _ => None,
    }
}

fn build_context_menu_item<R: tauri::Runtime>(
    manager: &impl Manager<R>,
    request_id: &str,
    item: &DesktopContextMenuItemPayload,
) -> Result<MenuItemKind<R>, String> {
    match item {
        DesktopContextMenuItemPayload::Separator => {
            PredefinedMenuItem::separator(manager)
                .map(MenuItemKind::Predefined)
                .map_err(|error| error.to_string())
        }
        DesktopContextMenuItemPayload::Submenu { label, items } => {
            let submenu = SubmenuBuilder::new(manager, label)
                .build()
                .map_err(|error| error.to_string())?;
            for child in items {
                let built = build_context_menu_item(manager, request_id, child)?;
                submenu.append(&built).map_err(|error| error.to_string())?;
            }
            Ok(MenuItemKind::Submenu(submenu))
        }
        DesktopContextMenuItemPayload::Command {
            command_id,
            label,
            enabled,
            checked,
            accelerator,
        } => {
            if *enabled {
                if let Some(role) = native_clipboard_role(command_id) {
                    let predefined = match role {
                        "cut" => PredefinedMenuItem::cut(manager, Some(label)),
                        "copy" => PredefinedMenuItem::copy(manager, Some(label)),
                        "paste" => PredefinedMenuItem::paste(manager, Some(label)),
                        _ => unreachable!(),
                    }
                    .map_err(|error| error.to_string())?;
                    return Ok(MenuItemKind::Predefined(predefined));
                }
            }

            if let Some(checked) = checked {
                let mut builder =
                    CheckMenuItemBuilder::with_id(context_menu_item_id(request_id, command_id), label)
                        .enabled(*enabled)
                        .checked(*checked);
                if let Some(accelerator) = accelerator {
                    builder = builder.accelerator(accelerator);
                }
                return builder
                    .build(manager)
                    .map(MenuItemKind::Check)
                    .map_err(|error| error.to_string());
            }

            let mut builder =
                MenuItemBuilder::with_id(context_menu_item_id(request_id, command_id), label)
                    .enabled(*enabled);
            if let Some(accelerator) = accelerator {
                builder = builder.accelerator(accelerator);
            }
            builder
                .build(manager)
                .map(MenuItemKind::MenuItem)
                .map_err(|error| error.to_string())
        }
    }
}

fn build_context_menu<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
    payload: &DesktopContextMenuPayload,
) -> Result<Menu<R>, String> {
    let menu = Menu::new(window).map_err(|error| error.to_string())?;
    for item in &payload.items {
        let built = build_context_menu_item(window, &payload.request_id, item)?;
        menu.append(&built).map_err(|error| error.to_string())?;
    }
    Ok(menu)
}

#[tauri::command]
fn desktop_open_text(
    path: Option<String>,
    app: AppHandle,
) -> Result<Option<OpenTextPayload>, String> {
    let resolved_path = if let Some(raw_path) = path {
        Some(PathBuf::from(raw_path))
    } else {
        FileDialog::new()
            .add_filter("TikZ/SVG", &["tex", "tikz", "txt", "svg"])
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
fn desktop_show_context_menu(
    payload: DesktopContextMenuPayload,
    app: AppHandle,
) -> Result<(), String> {
    emit_context_menu_debug(
        &app,
        &payload.request_id,
        "requested",
        Some(&payload.target),
        Some(&payload.position),
        None,
        None,
    );

    {
        let state = app.state::<ContextMenuState>();
        let mut in_flight = state
            .in_flight
            .lock()
            .map_err(|_| "context menu state unavailable".to_string())?;
        if let Some(existing) = in_flight.as_ref() {
            if existing.started_at.elapsed() < CONTEXT_MENU_OVERLAP_TIMEOUT {
                emit_context_menu_debug(
                    &app,
                    &payload.request_id,
                    "rejected-overlap",
                    Some(&payload.target),
                    Some(&payload.position),
                    Some(format!("in-flight request {}", existing.request_id)),
                    None,
                );
                return Ok(());
            }

            emit_context_menu_debug(
                &app,
                &payload.request_id,
                "expired-stale",
                Some(&payload.target),
                Some(&payload.position),
                Some(format!("replacing stale request {}", existing.request_id)),
                None,
            );
        }

        *in_flight = Some(ContextMenuInFlight {
            request_id: payload.request_id.clone(),
            started_at: Instant::now(),
        });
    }

    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;

    emit_context_menu_debug(
        &app,
        &payload.request_id,
        "building",
        Some(&payload.target),
        Some(&payload.position),
        None,
        None,
    );

    let menu = match build_context_menu(&window, &payload) {
        Ok(menu) => menu,
        Err(error) => {
            if let Ok(mut in_flight) = app.state::<ContextMenuState>().in_flight.lock() {
                if in_flight
                    .as_ref()
                    .map(|current| current.request_id == payload.request_id)
                    .unwrap_or(false)
                {
                    *in_flight = None;
                }
            }
            emit_context_menu_debug(
                &app,
                &payload.request_id,
                "failed",
                Some(&payload.target),
                Some(&payload.position),
                Some("build".to_string()),
                Some(error.clone()),
            );
            return Err(error);
        }
    };

    emit_context_menu_debug(
        &app,
        &payload.request_id,
        "popup-start",
        Some(&payload.target),
        Some(&payload.position),
        None,
        None,
    );

    let result = window
        .popup_menu(&menu)
        .map_err(|error| error.to_string());

    if let Ok(mut in_flight) = app.state::<ContextMenuState>().in_flight.lock() {
        if in_flight
            .as_ref()
            .map(|current| current.request_id == payload.request_id)
            .unwrap_or(false)
        {
            *in_flight = None;
        }
    }

    match result {
        Ok(()) => {
            emit_context_menu_debug(
                &app,
                &payload.request_id,
                "popup-returned",
                Some(&payload.target),
                Some(&payload.position),
                None,
                None,
            );
            Ok(())
        }
        Err(error) => {
            emit_context_menu_debug(
                &app,
                &payload.request_id,
                "failed",
                Some(&payload.target),
                Some(&payload.position),
                Some("popup".to_string()),
                Some(error.clone()),
            );
            Err(error)
        }
    }
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
    assistant.ensure_document_thread(
        documentId,
        source,
        threadId,
        workspacePath,
        figurePath,
        previewPath,
    )
}

#[tauri::command]
#[allow(non_snake_case)]
fn desktop_assistant_start_turn(
    documentId: String,
    prompt: String,
    source: String,
    pngBase64: Option<String>,
    threadId: Option<String>,
    workspacePath: Option<String>,
    figurePath: Option<String>,
    previewPath: Option<String>,
    model: Option<String>,
    assistant: tauri::State<'_, AssistantState>,
) -> Result<serde_json::Value, String> {
    let turn_id = assistant.start_turn(
        documentId,
        prompt,
        source,
        pngBase64,
        threadId,
        workspacePath,
        figurePath,
        previewPath,
        model,
    )?;
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

#[tauri::command]
fn desktop_assistant_list_models(
    assistant: tauri::State<'_, AssistantState>,
) -> Result<Vec<AssistantModelOption>, String> {
    assistant.list_models()
}

#[tauri::command]
fn desktop_assistant_read_account_snapshot(
    assistant: tauri::State<'_, AssistantState>,
) -> Result<AssistantAccountSnapshot, String> {
    assistant.read_account_snapshot()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(RecentFilesState::default())
        .manage(WindowCloseState::default())
        .manage(ContextMenuState::default())
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
            desktop_show_context_menu,
            desktop_assistant_ensure_document_thread,
            desktop_assistant_start_turn,
            desktop_assistant_interrupt_turn,
            desktop_assistant_sync_source,
            desktop_assistant_respond_to_approval,
            desktop_assistant_respond_to_dynamic_tool_call,
            desktop_assistant_load_thread_state,
            desktop_assistant_list_models,
            desktop_assistant_read_account_snapshot
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            app.on_menu_event(move |_app, event| {
                let raw_id = event.id().0.as_ref();
                let Some((request_id, command_id)) = parse_context_menu_item_id(raw_id) else {
                    return;
                };

                if let Ok(mut in_flight) = handle.state::<ContextMenuState>().in_flight.lock() {
                    if in_flight
                        .as_ref()
                        .map(|current| current.request_id == request_id)
                        .unwrap_or(false)
                    {
                        *in_flight = None;
                    }
                }

                emit_context_menu_debug(
                    &handle,
                    &request_id,
                    "menu-command",
                    None,
                    None,
                    Some(command_id.clone()),
                    None,
                );

                if let Some(window) = handle.get_webview_window("main") {
                    let _ = window.emit(
                        "desktop-context-menu-command",
                        DesktopContextMenuCommandEvent {
                            request_id,
                            command_id,
                        },
                    );
                }
            });

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
