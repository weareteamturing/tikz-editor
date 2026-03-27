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
use std::ffi::OsString;
use std::fs;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::Path;
use std::path::PathBuf;
use std::time::{Duration, Instant};
use std::sync::Mutex;
use tauri::{
    menu::{
        CheckMenuItemBuilder, Menu, MenuItemBuilder, MenuItemKind, PredefinedMenuItem,
        SubmenuBuilder,
    },
    AppHandle, Emitter, Manager,
};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_shell::{
    process::CommandEvent,
    ShellExt,
};
use url::Url;

const MAX_RECENT_FILES: usize = 10;
const LATEX_COMMAND_TIMEOUT_SECS: u64 = 20;
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

#[derive(Clone, Serialize)]
struct LatexAvailabilityStatus {
    available: bool,
    details: String,
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

fn map_unsaved_changes_dialog_result(result: rfd::MessageDialogResult) -> &'static str {
    match result {
        rfd::MessageDialogResult::Custom(label) => {
            let normalized = label.trim().to_ascii_lowercase();
            if normalized == "save" {
                "save"
            } else if normalized == "don't save"
                || normalized == "dont save"
                || normalized == "don’t save"
            {
                "discard"
            } else {
                "cancel"
            }
        }
        rfd::MessageDialogResult::Yes => "save",
        rfd::MessageDialogResult::No => "discard",
        rfd::MessageDialogResult::Ok => "save",
        rfd::MessageDialogResult::Cancel => "cancel",
    }
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

#[cfg(target_os = "windows")]
fn windows_pathexts() -> Vec<String> {
    let default = vec![
        ".COM".to_string(),
        ".EXE".to_string(),
        ".BAT".to_string(),
        ".CMD".to_string(),
    ];
    env::var("PATHEXT")
        .ok()
        .map(|value| {
            value
                .split(';')
                .map(str::trim)
                .filter(|entry| !entry.is_empty())
                .map(|entry| entry.to_ascii_uppercase())
                .collect::<Vec<_>>()
        })
        .filter(|exts| !exts.is_empty())
        .unwrap_or(default)
}

fn executable_in_dir(dir: &Path, name: &str) -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let has_ext = Path::new(name).extension().is_some();
        if has_ext {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
            return None;
        }
        let upper_name = name.to_ascii_uppercase();
        for ext in windows_pathexts() {
            let candidate = dir.join(format!("{upper_name}{ext}"));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
        let direct = dir.join(name);
        if direct.is_file() {
            return Some(direct);
        }
        None
    }
    #[cfg(not(target_os = "windows"))]
    {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
        None
    }
}

fn find_executable_in_path(name: &str) -> Option<PathBuf> {
    env::var_os("PATH").and_then(|raw_path| {
        for dir in env::split_paths(&raw_path) {
            if let Some(path) = executable_in_dir(&dir, name) {
                return Some(path);
            }
        }
        None
    })
}

fn common_bin_dirs() -> Vec<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let mut dirs = Vec::new();
        if let Some(user_profile) = env::var_os("USERPROFILE") {
            dirs.push(
                PathBuf::from(user_profile)
                    .join("AppData")
                    .join("Roaming")
                    .join("npm"),
            );
        }
        if let Some(program_files) = env::var_os("ProgramFiles") {
            dirs.push(PathBuf::from(program_files).join("nodejs"));
        }
        dirs
    }
    #[cfg(not(target_os = "windows"))]
    {
        vec![
            PathBuf::from("/opt/homebrew/bin"),
            PathBuf::from("/usr/local/bin"),
            PathBuf::from("/opt/local/bin"),
            PathBuf::from("/usr/bin"),
            PathBuf::from("/bin"),
        ]
    }
}

fn find_executable_base(name: &str) -> Option<PathBuf> {
    if let Some(path) = find_executable_in_path(name) {
        return Some(path);
    }
    for dir in common_bin_dirs() {
        if let Some(path) = executable_in_dir(&dir, name) {
            return Some(path);
        }
    }
    None
}

fn npm_global_bin_dir(app: Option<&AppHandle>) -> Option<PathBuf> {
    let app = app?;
    let npm = find_executable_base("npm")?;
    let output = tauri::async_runtime::block_on(
        app.shell()
            .command(npm.to_string_lossy().to_string())
            .args(["config", "get", "prefix"])
            .output(),
    )
    .ok()?;
    if !output.status.success() {
        return None;
    }
    let prefix = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if prefix.is_empty() || prefix == "undefined" {
        return None;
    }
    let prefix_path = PathBuf::from(prefix);
    #[cfg(target_os = "windows")]
    {
        Some(prefix_path)
    }
    #[cfg(not(target_os = "windows"))]
    {
        Some(prefix_path.join("bin"))
    }
}

fn find_executable(name: &str, app: Option<&AppHandle>) -> Option<PathBuf> {
    if let Some(path) = find_executable_base(name) {
        return Some(path);
    }
    if name == "codex" {
        if let Some(npm_bin) = npm_global_bin_dir(app) {
            if let Some(path) = executable_in_dir(&npm_bin, name) {
                return Some(path);
            }
        }
    }
    None
}

fn command_exists(name: &str, app: Option<&AppHandle>) -> bool {
    find_executable(name, app).is_some()
}

fn wsl_command_exists(app: &AppHandle, name: &str) -> bool {
    tauri::async_runtime::block_on(
        app.shell()
            .command("wsl")
            .args(["sh", "-lc", &format!("command -v {name} >/dev/null 2>&1")])
            .status(),
    )
    .map(|status| status.success())
    .unwrap_or(false)
}

fn augmented_path(extra_dir: Option<&Path>, app: Option<&AppHandle>) -> Option<OsString> {
    let mut seen = HashSet::new();
    let mut entries = Vec::<PathBuf>::new();
    if let Some(raw) = env::var_os("PATH") {
        for dir in env::split_paths(&raw) {
            if seen.insert(dir.clone()) {
                entries.push(dir);
            }
        }
    }
    if let Some(dir) = extra_dir {
        if seen.insert(dir.to_path_buf()) {
            entries.push(dir.to_path_buf());
        }
    }
    for dir in common_bin_dirs() {
        if seen.insert(dir.clone()) {
            entries.push(dir);
        }
    }
    if let Some(npm_bin) = npm_global_bin_dir(app) {
        if seen.insert(npm_bin.clone()) {
            entries.push(npm_bin);
        }
    }
    env::join_paths(entries).ok()
}

#[derive(Serialize)]
struct CodexStatus {
    installed: bool,
    has_npm: bool,
    has_brew: bool,
    has_wsl: bool,
}

#[tauri::command]
fn desktop_check_codex_status(app: AppHandle) -> CodexStatus {
    let has_wsl = cfg!(target_os = "windows") && command_exists("wsl", Some(&app));
    let installed =
        command_exists("codex", Some(&app)) || (has_wsl && wsl_command_exists(&app, "codex"));
    CodexStatus {
        installed,
        has_npm: command_exists("npm", Some(&app)),
        has_brew: command_exists("brew", Some(&app)),
        has_wsl,
    }
}

#[tauri::command]
async fn desktop_install_codex(method: String, app: AppHandle) -> Result<String, String> {
    let (cmd, args): (String, Vec<&str>) = match method.as_str() {
        "npm" => {
            let npm = find_executable("npm", Some(&app))
                .ok_or_else(|| "npm is not available. Install Node.js/npm first.".to_string())?;
            (
                npm.to_string_lossy().to_string(),
                vec!["install", "-g", "@openai/codex"],
            )
        }
        "brew" => {
            let brew = find_executable("brew", Some(&app))
                .ok_or_else(|| "Homebrew is not available on this machine.".to_string())?;
            (brew.to_string_lossy().to_string(), vec!["install", "codex"])
        }
        "wsl" => {
            if !command_exists("wsl", Some(&app)) {
                return Err("WSL is not available on this machine.".to_string());
            }
            (
                "wsl".to_string(),
                vec!["npm", "install", "-g", "@openai/codex"],
            )
        }
        _ => return Err(format!("Unknown install method: {method}")),
    };
    let mut command = app.shell().command(cmd.clone()).args(args.clone());
    if method != "wsl" {
        if let Some(path) = augmented_path(None, Some(&app)) {
            command = command.env("PATH", path);
        }
    }
    let output = command
        .output()
        .await
        .map_err(|e| format!("Failed to run {cmd}: {e}"))?;
    if output.status.success() {
        let installed_now = command_exists("codex", Some(&app))
            || (cfg!(target_os = "windows")
                && command_exists("wsl", Some(&app))
                && wsl_command_exists(&app, "codex"));
        let mut message = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if message.is_empty() {
            message = "Install completed.".to_string();
        }
        if installed_now {
            message.push_str("\nCodex is now discoverable by the app.");
        } else {
            message.push_str(
                "\nInstall finished, but Codex is not yet discoverable from this process PATH.",
            );
            message.push_str("\nThe app will keep probing common npm/bin locations automatically.");
        }
        Ok(message)
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.is_empty() {
            Err(format!(
                "{cmd} failed with exit code {:?}",
                output.status.code()
            ))
        } else {
            Err(format!("{cmd} failed: {stderr}"))
        }
    }
}

#[tauri::command]
fn desktop_check_latex_available(app: AppHandle) -> LatexAvailabilityStatus {
    let latex_path = find_executable("latex", Some(&app));
    let dvisvgm_path = find_executable("dvisvgm", Some(&app));
    let available = latex_path.is_some() && dvisvgm_path.is_some();
    let latex_cmd = latex_path
        .as_ref()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "latex".to_string());
    let dvisvgm_cmd = dvisvgm_path
        .as_ref()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "dvisvgm".to_string());
    let working_dir = latex_compile_working_dir();
    let details = format!(
        "latex: {latex_cmd}\ndvisvgm: {dvisvgm_cmd}\nworking_dir: {}\nPATH={}\ncompile_timeout_secs={}\nbuild_marker=native-timeout-v2\n\nCommands used by the app:\ncd \"{}\"\n\"{latex_cmd}\" -interaction=batchmode -file-line-error -halt-on-error input.tex\n\"{dvisvgm_cmd}\" --page=1 --bbox=min --exact --font-format=woff2 -o output.svg input.dvi",
        working_dir.to_string_lossy(),
        env::var("PATH").unwrap_or_else(|_| "<unavailable>".to_string()),
        LATEX_COMMAND_TIMEOUT_SECS,
        working_dir.to_string_lossy(),
    );
    LatexAvailabilityStatus { available, details }
}

fn latex_compile_working_dir() -> PathBuf {
    env::temp_dir().join("tikz-editor-native-compile")
}

fn read_text_if_exists(path: &Path) -> String {
    if !path.exists() {
        return String::new();
    }
    fs::read_to_string(path).unwrap_or_default()
}

fn format_command_failure(
    command_label: &str,
    status_code: Option<i32>,
    stdout: &[u8],
    stderr: &[u8],
    log_path: Option<&Path>,
    working_dir: &Path,
) -> String {
    let stdout_text = String::from_utf8_lossy(stdout).trim().to_string();
    let stderr_text = String::from_utf8_lossy(stderr).trim().to_string();
    let log_text = log_path.map(read_text_if_exists).unwrap_or_default();
    let mut out = String::new();
    out.push_str(&format!(
        "{command_label} failed (exit code: {:?})\nworking_dir: {}\n",
        status_code,
        working_dir.to_string_lossy()
    ));
    if !stdout_text.is_empty() {
        out.push_str("\n--- stdout ---\n");
        out.push_str(&stdout_text);
        out.push('\n');
    }
    if !stderr_text.is_empty() {
        out.push_str("\n--- stderr ---\n");
        out.push_str(&stderr_text);
        out.push('\n');
    }
    if !log_text.trim().is_empty() {
        out.push_str("\n--- latex log ---\n");
        out.push_str(&log_text);
        out.push('\n');
    }
    if stdout_text.is_empty() && stderr_text.is_empty() && log_text.trim().is_empty() {
        out.push_str("\n(no command output)\n");
    }
    out
}

struct CommandRunOutput {
    status_code: Option<i32>,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
}

async fn run_shell_command(
    app: &AppHandle,
    command: &str,
    args: &[&str],
    working_dir: &Path,
) -> Result<CommandRunOutput, String> {
    let (mut receiver, child) = app
        .shell()
        .command(command)
        .args(args.to_vec())
        .current_dir(working_dir)
        .spawn()
        .map_err(|e| format!("Failed to spawn `{command}` in {}: {e}", working_dir.to_string_lossy()))?;

    let mut stdout = Vec::<u8>::new();
    let mut stderr = Vec::<u8>::new();
    let mut status_code = None;
    let deadline = Instant::now() + Duration::from_secs(LATEX_COMMAND_TIMEOUT_SECS);

    loop {
        let now = Instant::now();
        if now >= deadline {
            let _ = child.kill();
            let timeout_details = format_command_failure(
                command,
                None,
                &stdout,
                &stderr,
                None,
                working_dir,
            );
            return Err(format!(
                "Command timed out after {}s.\n{}",
                LATEX_COMMAND_TIMEOUT_SECS, timeout_details
            ));
        }
        let remaining = deadline.saturating_duration_since(now);
        let maybe_event = match tokio::time::timeout(remaining, receiver.recv()).await {
            Ok(event) => event,
            Err(_) => {
                let _ = child.kill();
                let timeout_details = format_command_failure(
                    command,
                    None,
                    &stdout,
                    &stderr,
                    None,
                    working_dir,
                );
                return Err(format!(
                    "Command timed out after {}s.\n{}",
                    LATEX_COMMAND_TIMEOUT_SECS, timeout_details
                ));
            }
        };

        let Some(event) = maybe_event else {
            break;
        };

        match event {
            CommandEvent::Stdout(bytes) => stdout.extend(bytes),
            CommandEvent::Stderr(bytes) => stderr.extend(bytes),
            CommandEvent::Terminated(payload) => {
                status_code = payload.code;
                break;
            }
            CommandEvent::Error(error) => {
                return Err(format!(
                    "`{command}` emitted an error in {}: {error}",
                    working_dir.to_string_lossy()
                ));
            }
            _ => {}
        }
    }

    Ok(CommandRunOutput {
        status_code,
        stdout,
        stderr,
    })
}

#[tauri::command]
async fn desktop_compile_tikz(
    latex_document: String,
    app: AppHandle,
) -> Result<String, String> {
    let working_dir = latex_compile_working_dir();
    fs::create_dir_all(&working_dir).map_err(|e| {
        format!(
            "Failed to create working dir {}: {e}",
            working_dir.to_string_lossy()
        )
    })?;
    let _ = fs::remove_file(working_dir.join("output.svg"));
    let _ = fs::remove_file(working_dir.join("input.dvi"));
    let _ = fs::remove_file(working_dir.join("input.log"));
    let tex_path = working_dir.join("input.tex");
    fs::write(&tex_path, &latex_document)
        .map_err(|e| format!("Failed to write .tex in {}: {e}", working_dir.to_string_lossy()))?;

    // Run latex
    let latex_result = run_shell_command(
        &app,
        "latex",
        &[
            "-interaction=batchmode",
            "-file-line-error",
            "-halt-on-error",
            "input.tex",
        ],
        &working_dir,
    )
    .await?;

    if latex_result.status_code != Some(0) {
        let latex_log_path = working_dir.join("input.log");
        return Err(format_command_failure(
            "latex",
            latex_result.status_code,
            &latex_result.stdout,
            &latex_result.stderr,
            Some(&latex_log_path),
            &working_dir,
        ));
    }

    let dvi_path = working_dir.join("input.dvi");
    if !dvi_path.exists() {
        let latex_log_path = working_dir.join("input.log");
        let log = read_text_if_exists(&latex_log_path);
        let mut message = format!(
            "latex succeeded but DVI was not produced.\nworking_dir: {}",
            working_dir.to_string_lossy()
        );
        if !log.trim().is_empty() {
            message.push_str("\n\n--- latex log ---\n");
            message.push_str(&log);
        }
        return Err(message);
    }

    // Run dvisvgm
    let svg_path = working_dir.join("output.svg");
    let dvisvgm_result = run_shell_command(
        &app,
        "dvisvgm",
        &[
            "--page=1",
            "--bbox=min",
            "--exact",
            "--font-format=woff2",
            "-o",
            "output.svg",
            "input.dvi",
        ],
        &working_dir,
    )
    .await?;

    if dvisvgm_result.status_code != Some(0) {
        return Err(format_command_failure(
            "dvisvgm",
            dvisvgm_result.status_code,
            &dvisvgm_result.stdout,
            &dvisvgm_result.stderr,
            None,
            &working_dir,
        ));
    }

    if !svg_path.exists() {
        return Err(format!(
            "dvisvgm succeeded but SVG was not produced.\nworking_dir: {}",
            working_dir.to_string_lossy()
        ));
    }

    fs::read_to_string(&svg_path).map_err(|e| format!("Failed to read SVG: {e}"))
}

#[tauri::command]
fn desktop_read_last_compile_log() -> Result<String, String> {
    let log_path = latex_compile_working_dir().join("input.log");
    if !log_path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(&log_path).map_err(|e| {
        format!(
            "Failed to read {}: {e}",
            log_path.to_string_lossy()
        )
    })
}

#[tauri::command]
fn desktop_open_text(
    path: Option<String>,
    add_to_recent: Option<bool>,
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
    if add_to_recent.unwrap_or(true) {
        add_recent_file(&app, payload.path.clone());
    }
    Ok(Some(payload))
}

#[tauri::command]
fn desktop_open_binary(
    path: Option<String>,
    add_to_recent: Option<bool>,
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
    if add_to_recent.unwrap_or(true) {
        add_recent_file(&app, path.clone());
    }
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
    use rfd::{AsyncMessageDialog, MessageButtons, MessageLevel};

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

    Ok(map_unsaved_changes_dialog_result(result).to_string())
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
fn desktop_take_pending_open_failures(
    app: AppHandle,
) -> Result<Vec<OpenTextFailurePayload>, String> {
    let state = app.state::<PendingOpenRequestsState>();
    let mut pending = state
        .failures
        .lock()
        .map_err(|_| "pending open failures state unavailable".to_string())?;
    Ok(std::mem::take(&mut *pending))
}

#[tauri::command]
fn desktop_open_external(url: String, app: AppHandle) -> Result<bool, String> {
    let sanitized = validate_external_url(&url)?;
    app.opener()
        .open_url(sanitized, None::<&str>)
        .map(|_| true)
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
fn desktop_assistant_warm_up(
    assistant: tauri::State<'_, AssistantState>,
) -> Result<(), String> {
    assistant.warm_up()
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

#[tauri::command]
fn desktop_assistant_read_account(
    assistant: tauri::State<'_, AssistantState>,
) -> Result<serde_json::Value, String> {
    assistant.read_account()
}

#[tauri::command]
fn desktop_assistant_read_rate_limits(
    assistant: tauri::State<'_, AssistantState>,
) -> Result<serde_json::Value, String> {
    assistant.read_rate_limits()
}

#[tauri::command]
#[allow(non_snake_case)]
fn desktop_assistant_login_start(
    loginType: String,
    apiKey: Option<String>,
    assistant: tauri::State<'_, AssistantState>,
) -> Result<serde_json::Value, String> {
    assistant.login_start(&loginType, apiKey.as_deref())
}

#[tauri::command]
#[allow(non_snake_case)]
fn desktop_assistant_login_cancel(
    loginId: String,
    assistant: tauri::State<'_, AssistantState>,
) -> Result<(), String> {
    assistant.login_cancel(&loginId)
}

#[tauri::command]
fn desktop_assistant_logout(
    assistant: tauri::State<'_, AssistantState>,
) -> Result<(), String> {
    assistant.logout()
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
        .plugin(tauri_plugin_clipboard_x::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init());
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
            desktop_check_codex_status,
            desktop_install_codex,
            desktop_check_latex_available,
            desktop_compile_tikz,
            desktop_read_last_compile_log,
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
            desktop_assistant_warm_up,
            desktop_assistant_list_models,
            desktop_assistant_read_account_snapshot,
            desktop_assistant_read_account,
            desktop_assistant_read_rate_limits,
            desktop_assistant_login_start,
            desktop_assistant_login_cancel,
            desktop_assistant_logout
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

            #[cfg(target_os = "macos")]
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_effects(tauri::utils::config::WindowEffectsConfig {
                    effects: vec![tauri::utils::WindowEffect::Sidebar],
                    state: None,
                    radius: None,
                    color: None,
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{
        collect_associated_file_paths, has_supported_association_extension,
        map_unsaved_changes_dialog_result, validate_external_url,
    };
    use rfd::MessageDialogResult;
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
        assert!(has_supported_association_extension(Path::new(
            "/tmp/diagram.tikz"
        )));
        assert!(has_supported_association_extension(Path::new(
            "/tmp/diagram.TEX"
        )));
        assert!(!has_supported_association_extension(Path::new(
            "/tmp/diagram.svg"
        )));
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

    #[test]
    fn maps_unsaved_changes_dialog_results_consistently() {
        assert_eq!(
            map_unsaved_changes_dialog_result(MessageDialogResult::Yes),
            "save"
        );
        assert_eq!(
            map_unsaved_changes_dialog_result(MessageDialogResult::No),
            "discard"
        );
        assert_eq!(
            map_unsaved_changes_dialog_result(MessageDialogResult::Custom("Save".to_string())),
            "save"
        );
        assert_eq!(
            map_unsaved_changes_dialog_result(MessageDialogResult::Custom(
                "Don’t Save".to_string()
            )),
            "discard"
        );
        assert_eq!(
            map_unsaved_changes_dialog_result(MessageDialogResult::Custom("Cancel".to_string())),
            "cancel"
        );
    }
}
