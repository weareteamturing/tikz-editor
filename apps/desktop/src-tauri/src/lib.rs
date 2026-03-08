use base64::Engine;
use rfd::FileDialog;
use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::menu::{MenuBuilder, MenuId, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager};

const MAX_RECENT_FILES: usize = 10;
const RECENTS_FILENAME: &str = "recent-files.json";

const CMD_NEW_DOCUMENT: &str = "file.new-document";
const CMD_OPEN_DOCUMENT: &str = "file.open-document";
const CMD_SAVE_DOCUMENT: &str = "file.save-document";
const CMD_SAVE_DOCUMENT_AS: &str = "file.save-document-as";
const CMD_CLOSE_DOCUMENT: &str = "file.close-document";
const CMD_CLOSE_ALL_DOCUMENTS: &str = "file.close-all-documents";
const CMD_EXPORT_SVG: &str = "file.export-svg-download";
const CMD_EXPORT_PNG: &str = "file.export-png-download";
const CMD_EXPORT_PDF: &str = "file.export-pdf-download";
const CMD_EXPORT_TEX: &str = "file.export-standalone-latex-download";
const CMD_UNDO: &str = "edit.undo";
const CMD_REDO: &str = "edit.redo";
const CMD_CUT: &str = "edit.cut";
const CMD_COPY: &str = "edit.copy";
const CMD_PASTE: &str = "edit.paste";

#[derive(Default)]
struct RecentFilesState {
  files: Mutex<Vec<String>>,
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

fn build_app_menu(app: &AppHandle, recents: &[String]) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
  let mut open_recent_menu = SubmenuBuilder::new(app, "Open Recent");
  if recents.is_empty() {
    let disabled = MenuItemBuilder::with_id("file.open-recent.empty", "No Recent Files")
      .enabled(false)
      .build(app)?;
    open_recent_menu = open_recent_menu.item(&disabled);
  } else {
    for (idx, path) in recents.iter().enumerate() {
      let label = PathBuf::from(path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(path)
        .to_string();
      let item = MenuItemBuilder::with_id(format!("file.open-recent.{idx}"), label).build(app)?;
      open_recent_menu = open_recent_menu.item(&item);
    }
  }

  let file_menu = SubmenuBuilder::new(app, "File")
    .item(&MenuItemBuilder::with_id(CMD_NEW_DOCUMENT, "New").accelerator("CmdOrCtrl+N").build(app)?)
    .item(&MenuItemBuilder::with_id(CMD_OPEN_DOCUMENT, "Open...").accelerator("CmdOrCtrl+O").build(app)?)
    .item(&open_recent_menu.build()?)
    .separator()
    .item(&MenuItemBuilder::with_id(CMD_SAVE_DOCUMENT, "Save").accelerator("CmdOrCtrl+S").build(app)?)
    .item(&MenuItemBuilder::with_id(CMD_SAVE_DOCUMENT_AS, "Save As...").build(app)?)
    .separator()
    .item(&MenuItemBuilder::with_id(CMD_CLOSE_DOCUMENT, "Close Tab").accelerator("CmdOrCtrl+W").build(app)?)
    .item(&MenuItemBuilder::with_id(CMD_CLOSE_ALL_DOCUMENTS, "Close All Tabs").build(app)?)
    .separator()
    .item(&MenuItemBuilder::with_id(CMD_EXPORT_SVG, "Export SVG...").build(app)?)
    .item(&MenuItemBuilder::with_id(CMD_EXPORT_PNG, "Export PNG...").build(app)?)
    .item(&MenuItemBuilder::with_id(CMD_EXPORT_PDF, "Export PDF...").build(app)?)
    .item(&MenuItemBuilder::with_id(CMD_EXPORT_TEX, "Export LaTeX...").build(app)?)
    .build()?;

  let edit_menu = SubmenuBuilder::new(app, "Edit")
    .item(&MenuItemBuilder::with_id(CMD_UNDO, "Undo").accelerator("CmdOrCtrl+Z").build(app)?)
    .item(&MenuItemBuilder::with_id(CMD_REDO, "Redo").accelerator("CmdOrCtrl+Shift+Z").build(app)?)
    .separator()
    .item(&MenuItemBuilder::with_id(CMD_CUT, "Cut").accelerator("CmdOrCtrl+X").build(app)?)
    .item(&MenuItemBuilder::with_id(CMD_COPY, "Copy").accelerator("CmdOrCtrl+C").build(app)?)
    .item(&MenuItemBuilder::with_id(CMD_PASTE, "Paste").accelerator("CmdOrCtrl+V").build(app)?)
    .build()?;

  MenuBuilder::new(app)
    .item(&file_menu)
    .item(&edit_menu)
    .build()
}

fn refresh_menu(app: &AppHandle) -> tauri::Result<()> {
  let current = app
    .state::<RecentFilesState>()
    .files
    .lock()
    .map(|guard| guard.clone())
    .unwrap_or_default();
  let menu = build_app_menu(app, &current)?;
  app.set_menu(menu)?;
  Ok(())
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
  let _ = refresh_menu(app);
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

fn handle_menu_event(app: &AppHandle, id: &MenuId) {
  let event_id = id.0.as_str();
  if let Some(index_raw) = event_id.strip_prefix("file.open-recent.") {
    if let Ok(index) = index_raw.parse::<usize>() {
      let maybe_path = app
        .state::<RecentFilesState>()
        .files
        .lock()
        .ok()
        .and_then(|entries| entries.get(index).cloned());
      if let Some(path) = maybe_path {
        let _ = app.emit("desktop-open-recent", path);
      }
    }
    return;
  }

  let supported = matches!(
    event_id,
    CMD_NEW_DOCUMENT
      | CMD_OPEN_DOCUMENT
      | CMD_SAVE_DOCUMENT
      | CMD_SAVE_DOCUMENT_AS
      | CMD_CLOSE_DOCUMENT
      | CMD_CLOSE_ALL_DOCUMENTS
      | CMD_EXPORT_SVG
      | CMD_EXPORT_PNG
      | CMD_EXPORT_PDF
      | CMD_EXPORT_TEX
      | CMD_UNDO
      | CMD_REDO
      | CMD_CUT
      | CMD_COPY
      | CMD_PASTE
  );
  if supported {
    let _ = app.emit("desktop-menu-command", event_id.to_string());
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_clipboard_manager::init())
    .manage(RecentFilesState::default())
    .on_menu_event(|app, event| handle_menu_event(app, event.id()))
    .invoke_handler(tauri::generate_handler![
      desktop_open_text,
      desktop_save_text,
      desktop_export_file
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
      refresh_menu(&app.handle())?;
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
