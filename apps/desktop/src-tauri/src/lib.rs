mod assistant;

use assistant::{
    AssistantAccountSnapshot, AssistantModelOption, AssistantState, AssistantThreadStatePayload,
    AssistantThreadSummary,
};
use base64::Engine;
use clipboard_rs::{Clipboard, ClipboardContent, ClipboardContext};
use rfd::FileDialog;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::env;
use std::fs;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::Path;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;
use tauri::{
    menu::{
        CheckMenuItemBuilder, Menu, MenuItemBuilder, MenuItemKind, PredefinedMenuItem,
        SubmenuBuilder,
    },
    AppHandle, Emitter, Manager,
};
use url::Url;

const MAX_RECENT_FILES: usize = 10;
const RECENTS_FILENAME: &str = "recent-files.json";
const CONTEXT_MENU_EVENT_PREFIX: &str = "ctx::";
const DESKTOP_OPEN_REQUESTS_CHANGED_EVENT: &str = "desktop-open-requests-changed";
#[cfg(target_os = "macos")]
const DESKTOP_SVG_CLIPBOARD_FORMATS: [&str; 2] =
    ["public.svg-image", "com.microsoft.image-svg-xml"];
#[cfg(not(target_os = "macos"))]
const DESKTOP_SVG_CLIPBOARD_FORMATS: [&str; 3] = [
    "image/svg+xml",
    "public.svg-image",
    "com.microsoft.image-svg-xml",
];
#[cfg(target_os = "macos")]
const TIKZ_CUSTOM_CLIPBOARD_FORMATS: [&str; 1] = ["com.tikzeditor.tikz-json"];
#[cfg(not(target_os = "macos"))]
const TIKZ_CUSTOM_CLIPBOARD_FORMATS: [&str; 2] = [
    "web application/x-tikz-editor+json",
    "application/x-tikz-editor+json",
];

#[derive(Default)]
struct RecentFilesState {
    files: Mutex<Vec<String>>,
}

#[derive(Default)]
struct WindowCloseState {
    allow_next_close: Mutex<bool>,
}

#[derive(Default)]
struct PendingOpenRequestsState {
    requests: Mutex<Vec<OpenTextPayload>>,
    failures: Mutex<Vec<OpenTextFailurePayload>>,
}

#[derive(Serialize)]
struct OpenTextPayload {
    source: String,
    path: String,
    name: String,
}

#[derive(Serialize)]
struct OpenBinaryPayload {
    #[serde(rename = "bytesBase64")]
    bytes_base64: String,
    path: String,
    name: String,
}

#[derive(Debug, Clone, Serialize)]
struct OpenTextFailurePayload {
    path: String,
    message: String,
}

#[derive(Serialize)]
struct SaveTextPayload {
    ok: bool,
    path: Option<String>,
    name: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct DesktopCustomClipboardTextPayload {
    format: String,
    text: String,
}

#[derive(Debug, Clone, Serialize)]
struct DesktopCustomClipboardBytesPayload {
    format: String,
    #[serde(rename = "bytesBase64")]
    bytes_base64: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopClipboardWriteBundlePayload {
    plain_text: String,
    tikz_json: Option<String>,
    svg_text: Option<String>,
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
    items: Vec<DesktopContextMenuItemPayload>,
}

#[derive(Debug, Clone, Serialize)]
struct DesktopContextMenuCommandEvent {
    #[serde(rename = "requestId")]
    request_id: String,
    #[serde(rename = "commandId")]
    command_id: String,
}

fn panic_to_string(panic_payload: Box<dyn std::any::Any + Send>) -> String {
    if let Some(message) = panic_payload.downcast_ref::<&str>() {
        return (*message).to_string();
    }
    if let Some(message) = panic_payload.downcast_ref::<String>() {
        return message.clone();
    }
    "unknown panic".to_string()
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

fn context_menu_item_id(request_id: &str, command_id: &str) -> String {
    format!("{CONTEXT_MENU_EVENT_PREFIX}{request_id}::{command_id}")
}

fn parse_context_menu_item_id(raw_id: &str) -> Option<(String, String)> {
    let remainder = raw_id.strip_prefix(CONTEXT_MENU_EVENT_PREFIX)?;
    let (request_id, command_id) = remainder.split_once("::")?;
    Some((request_id.to_string(), command_id.to_string()))
}

fn has_supported_association_extension(path: &Path) -> bool {
    let Some(ext) = path.extension().and_then(|value| value.to_str()) else {
        return false;
    };
    matches!(ext.to_ascii_lowercase().as_str(), "tikz" | "tex")
}

fn collect_associated_file_paths(args: &[String], cwd: Option<&str>) -> Vec<PathBuf> {
    let base_dir = cwd.map(PathBuf::from);
    let mut seen: HashSet<String> = HashSet::new();
    let mut out: Vec<PathBuf> = Vec::new();

    for arg in args.iter().skip(1) {
        let trimmed = arg.trim();
        if trimmed.is_empty() {
            continue;
        }

        let raw = PathBuf::from(trimmed);
        let resolved = if raw.is_absolute() {
            raw
        } else if let Some(base) = base_dir.as_ref() {
            base.join(raw)
        } else {
            raw
        };

        if !has_supported_association_extension(&resolved) {
            continue;
        }

        let key = resolved.to_string_lossy().to_string();
        if !seen.insert(key) {
            continue;
        }
        out.push(resolved);
    }

    out
}

fn read_open_text_payload_from_path(path: &Path) -> Result<OpenTextPayload, String> {
    let source = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let path_string = path.to_string_lossy().to_string();
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| "document.tex".to_string());
    Ok(OpenTextPayload {
        source,
        path: path_string,
        name,
    })
}

fn enqueue_pending_open_results(
    app: &AppHandle,
    requests: Vec<OpenTextPayload>,
    failures: Vec<OpenTextFailurePayload>,
) {
    if requests.is_empty() && failures.is_empty() {
        return;
    }

    let state = app.state::<PendingOpenRequestsState>();
    if let Ok(mut pending) = state.requests.lock() {
        pending.extend(requests);
    }
    if let Ok(mut pending_failures) = state.failures.lock() {
        pending_failures.extend(failures);
    }

    let _ = app.emit(DESKTOP_OPEN_REQUESTS_CHANGED_EVENT, ());
}

fn process_associated_open_requests(app: &AppHandle, args: &[String], cwd: Option<&str>) {
    let candidates = collect_associated_file_paths(args, cwd);
    if candidates.is_empty() {
        return;
    }

    let mut successes: Vec<OpenTextPayload> = Vec::new();
    let mut failures: Vec<OpenTextFailurePayload> = Vec::new();

    for path in candidates {
        match read_open_text_payload_from_path(&path) {
            Ok(payload) => {
                add_recent_file(app, payload.path.clone());
                successes.push(payload);
            }
            Err(message) => failures.push(OpenTextFailurePayload {
                path: path.to_string_lossy().to_string(),
                message,
            }),
        }
    }

    enqueue_pending_open_results(app, successes, failures);
}

fn native_clipboard_role(command_id: &str) -> Option<&'static str> {
    match command_id {
        "edit.cut" => Some("cut"),
        "edit.copy" => Some("copy"),
        "edit.paste" => Some("paste"),
        _ => None,
    }
}

fn validate_external_url(url: &str) -> Result<String, String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("URL must not be empty".to_string());
    }
    let parsed = Url::parse(trimmed).map_err(|error| format!("Malformed URL: {error}"))?;
    let scheme = parsed.scheme().to_ascii_lowercase();
    let is_supported_scheme = matches!(scheme.as_str(), "http" | "https" | "mailto");
    if !is_supported_scheme {
        return Err(format!(
            "Unsupported URL scheme '{scheme}'. Allowed: http, https, mailto."
        ));
    }
    if matches!(scheme.as_str(), "http" | "https") && parsed.host_str().is_none() {
        return Err("HTTP(S) URLs must include a host".to_string());
    }
    Ok(trimmed.to_string())
}

fn build_context_menu_item<R: tauri::Runtime>(
    manager: &impl Manager<R>,
    request_id: &str,
    item: &DesktopContextMenuItemPayload,
) -> Result<MenuItemKind<R>, String> {
    match item {
        DesktopContextMenuItemPayload::Separator => PredefinedMenuItem::separator(manager)
            .map(MenuItemKind::Predefined)
            .map_err(|error| error.to_string()),
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
                let mut builder = CheckMenuItemBuilder::with_id(
                    context_menu_item_id(request_id, command_id),
                    label,
                )
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
    let payload = read_open_text_payload_from_path(&path_buf)?;
    add_recent_file(&app, payload.path.clone());
    Ok(Some(payload))
}

#[tauri::command]
fn desktop_open_binary(
    path: Option<String>,
    app: AppHandle,
) -> Result<Option<OpenBinaryPayload>, String> {
    let resolved_path = if let Some(raw_path) = path {
        Some(PathBuf::from(raw_path))
    } else {
        FileDialog::new()
            .add_filter("PowerPoint", &["pptx"])
            .pick_file()
    };
    let Some(path_buf) = resolved_path else {
        return Ok(None);
    };
    let bytes = fs::read(&path_buf).map_err(|error| error.to_string())?;
    let path = path_buf.to_string_lossy().to_string();
    let name = path_buf
        .file_name()
        .and_then(|name| name.to_str())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| "imported.pptx".to_string());
    add_recent_file(&app, path.clone());
    Ok(Some(OpenBinaryPayload {
        bytes_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
        path,
        name,
    }))
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
async fn desktop_confirm_unsaved_changes(message: String) -> Result<String, String> {
    use rfd::{AsyncMessageDialog, MessageButtons, MessageDialogResult, MessageLevel};

    let result = AsyncMessageDialog::new()
        .set_level(MessageLevel::Warning)
        .set_title("Unsaved Changes")
        .set_description(&message)
        .set_buttons(MessageButtons::YesNoCancelCustom(
            "Save".to_string(),
            "Don\u{2019}t Save".to_string(),
            "Cancel".to_string(),
        ))
        .show()
        .await;

    let decision = match result {
        MessageDialogResult::Custom(s) => {
            if s == "Save" {
                "save"
            } else {
                "discard"
            }
        }
        _ => "cancel",
    };
    Ok(decision.to_string())
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
fn desktop_clear_recent_files(app: AppHandle) -> Result<(), String> {
    {
        let state = app.state::<RecentFilesState>();
        let mut entries = state
            .files
            .lock()
            .map_err(|_| "recent files state unavailable".to_string())?;
        entries.clear();
    }
    save_recent_files_to_disk(&app, &[]);
    Ok(())
}

#[tauri::command]
fn desktop_take_pending_open_requests(app: AppHandle) -> Result<Vec<OpenTextPayload>, String> {
    let state = app.state::<PendingOpenRequestsState>();
    let mut pending = state
        .requests
        .lock()
        .map_err(|_| "pending open requests state unavailable".to_string())?;
    Ok(std::mem::take(&mut *pending))
}

#[tauri::command]
fn desktop_take_pending_open_failures(app: AppHandle) -> Result<Vec<OpenTextFailurePayload>, String> {
    let state = app.state::<PendingOpenRequestsState>();
    let mut pending = state
        .failures
        .lock()
        .map_err(|_| "pending open failures state unavailable".to_string())?;
    Ok(std::mem::take(&mut *pending))
}

#[tauri::command]
fn desktop_open_external(url: String) -> Result<bool, String> {
    let sanitized = validate_external_url(&url)?;

    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut command = Command::new("open");
        command.arg(&sanitized);
        command
    };

    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut command = Command::new("rundll32");
        command.args(["url.dll,FileProtocolHandler", &sanitized]);
        command
    };

    #[cfg(all(unix, not(target_os = "macos")))]
    let mut cmd = {
        let mut command = Command::new("xdg-open");
        command.arg(&sanitized);
        command
    };

    cmd.status()
        .map(|status| status.success())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn desktop_perform_snap_haptic() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use tauri_macos_haptics::haptics::{HapticFeedbackManager, HapticPattern, PerformanceTime};

        HapticFeedbackManager::default_performer()
            .perform(HapticPattern::Alignment, Some(PerformanceTime::Now))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn desktop_read_custom_clipboard_text(
    formats: Vec<String>,
) -> Result<Option<DesktopCustomClipboardTextPayload>, String> {
    catch_unwind(AssertUnwindSafe(|| {
        if formats.is_empty() {
            return Ok(None);
        }
        let ctx = ClipboardContext::new().map_err(|error| error.to_string())?;
        for format in formats {
            let trimmed = format.trim().to_string();
            if trimmed.is_empty() {
                continue;
            }
            let Ok(buffer) = ctx.get_buffer(&trimmed) else {
                continue;
            };
            let Ok(text) = String::from_utf8(buffer) else {
                continue;
            };
            if text.trim().is_empty() {
                continue;
            }
            return Ok(Some(DesktopCustomClipboardTextPayload {
                format: trimmed,
                text,
            }));
        }
        Ok(None)
    }))
    .map_err(|panic_payload| {
        format!("Clipboard native panic: {}", panic_to_string(panic_payload))
    })?
}

#[tauri::command]
fn desktop_read_custom_clipboard_bytes(
    formats: Vec<String>,
) -> Result<Option<DesktopCustomClipboardBytesPayload>, String> {
    catch_unwind(AssertUnwindSafe(|| {
        if formats.is_empty() {
            return Ok(None);
        }
        let ctx = ClipboardContext::new().map_err(|error| error.to_string())?;
        for format in formats {
            let trimmed = format.trim().to_string();
            if trimmed.is_empty() {
                continue;
            }
            let Ok(buffer) = ctx.get_buffer(&trimmed) else {
                continue;
            };
            if buffer.is_empty() {
                continue;
            }
            return Ok(Some(DesktopCustomClipboardBytesPayload {
                format: trimmed,
                bytes_base64: base64::engine::general_purpose::STANDARD.encode(buffer),
            }));
        }
        Ok(None)
    }))
    .map_err(|panic_payload| {
        format!("Clipboard native panic: {}", panic_to_string(panic_payload))
    })?
}

#[tauri::command]
fn desktop_write_clipboard_bundle(
    payload: DesktopClipboardWriteBundlePayload,
) -> Result<(), String> {
    catch_unwind(AssertUnwindSafe(|| {
        let mut contents: Vec<ClipboardContent> = vec![ClipboardContent::Text(payload.plain_text)];
        if let Some(tikz_json) = payload.tikz_json {
            if !tikz_json.trim().is_empty() {
                for format in TIKZ_CUSTOM_CLIPBOARD_FORMATS {
                    contents.push(ClipboardContent::Other(
                        format.to_string(),
                        tikz_json.clone().into_bytes(),
                    ));
                }
            }
        }
        if let Some(svg_text) = payload.svg_text {
            if !svg_text.trim().is_empty() {
                let bytes = svg_text.into_bytes();
                for format in DESKTOP_SVG_CLIPBOARD_FORMATS {
                    contents.push(ClipboardContent::Other(format.to_string(), bytes.clone()));
                }
            }
        }
        let ctx = ClipboardContext::new().map_err(|error| error.to_string())?;
        ctx.set(contents).map_err(|error| error.to_string())
    }))
    .map_err(|panic_payload| {
        format!("Clipboard native panic: {}", panic_to_string(panic_payload))
    })?
}

#[tauri::command]
fn desktop_show_context_menu(
    payload: DesktopContextMenuPayload,
    app: AppHandle,
) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;

    let menu = match build_context_menu(&window, &payload) {
        Ok(menu) => menu,
        Err(error) => return Err(error),
    };

    window.popup_menu(&menu).map_err(|error| error.to_string())
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
    pastedImages: Option<Vec<assistant::AssistantPastedImageInput>>,
    threadId: Option<String>,
    workspacePath: Option<String>,
    figurePath: Option<String>,
    previewPath: Option<String>,
    model: Option<String>,
    figureContext: Option<String>,
    diagnosticsText: Option<String>,
    assistant: tauri::State<'_, AssistantState>,
) -> Result<serde_json::Value, String> {
    let turn_id = assistant.start_turn(
        documentId,
        prompt,
        source,
        pngBase64,
        pastedImages,
        threadId,
        workspacePath,
        figurePath,
        previewPath,
        model,
        figureContext,
        diagnosticsText,
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
    let mut builder = tauri::Builder::default();
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            process_associated_open_requests(app, &args, Some(cwd.as_str()));
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }));
    }

    builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_clipboard_x::init());
    #[cfg(target_os = "macos")]
    {
        builder = builder.plugin(tauri_macos_haptics::init());
    }

    builder
        .manage(RecentFilesState::default())
        .manage(WindowCloseState::default())
        .manage(PendingOpenRequestsState::default())
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
            desktop_open_binary,
            desktop_save_text,
            desktop_export_file,
            desktop_confirm_unsaved_changes,
            desktop_confirm_window_close,
            desktop_list_recent_files,
            desktop_clear_recent_files,
            desktop_take_pending_open_requests,
            desktop_take_pending_open_failures,
            desktop_open_external,
            desktop_perform_snap_haptic,
            desktop_read_custom_clipboard_text,
            desktop_read_custom_clipboard_bytes,
            desktop_write_clipboard_bundle,
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

            let startup_args: Vec<String> = env::args().collect();
            let startup_cwd = env::current_dir()
                .ok()
                .and_then(|path| path.to_str().map(ToOwned::to_owned));
            process_associated_open_requests(&app.handle(), &startup_args, startup_cwd.as_deref());

            app.manage(AssistantState::new(app.handle().clone()));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{
        collect_associated_file_paths, has_supported_association_extension, validate_external_url,
    };
    use std::path::Path;

    #[test]
    fn validates_supported_external_urls() {
        let https = validate_external_url("https://tauri.app");
        assert!(https.is_ok());

        let mailto = validate_external_url("mailto:hello@example.com");
        assert!(mailto.is_ok());
    }

    #[test]
    fn rejects_invalid_external_urls() {
        let malformed = validate_external_url("not a url");
        assert!(malformed.is_err());

        let empty = validate_external_url("   ");
        assert!(empty.is_err());

        let unsupported = validate_external_url("file:///tmp/test.txt");
        assert!(unsupported.is_err());

        let hostless_http = validate_external_url("https://");
        assert!(hostless_http.is_err());
    }

    #[test]
    fn association_extension_filter_is_case_insensitive() {
        assert!(has_supported_association_extension(Path::new("/tmp/diagram.tikz")));
        assert!(has_supported_association_extension(Path::new("/tmp/diagram.TEX")));
        assert!(!has_supported_association_extension(Path::new("/tmp/diagram.svg")));
    }

    #[test]
    fn collects_associated_paths_from_args() {
        let args = vec![
            "tikz-editor".to_string(),
            "first.tikz".to_string(),
            "second.tex".to_string(),
            "third.txt".to_string(),
            "first.tikz".to_string(),
        ];

        let collected = collect_associated_file_paths(&args, Some("/tmp/work"));
        let rendered: Vec<String> = collected
            .iter()
            .map(|path| path.to_string_lossy().to_string())
            .collect();
        assert_eq!(
            rendered,
            vec![
                "/tmp/work/first.tikz".to_string(),
                "/tmp/work/second.tex".to_string()
            ]
        );
    }
}
