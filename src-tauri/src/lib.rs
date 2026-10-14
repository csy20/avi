mod media_server;

use std::path::{Path, PathBuf};
use std::process::Command;

use media_server::MediaServer;
use tauri::Manager;

#[derive(serde::Serialize)]
struct MediaTools {
    ffmpeg: bool,
}

#[derive(serde::Serialize)]
struct LocalFileInfo {
    size: u64,
}

fn command_exists(name: &str) -> bool {
    Command::new(name)
        .arg("-version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn valid_asset_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 80
        && id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-' || character == '_')
}

fn allow_asset_file<R: tauri::Runtime>(app: &tauri::AppHandle<R>, path: &Path) -> Result<(), String> {
    app.asset_protocol_scope()
        .allow_file(path)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn media_tools() -> MediaTools {
    MediaTools {
        ffmpeg: command_exists("ffmpeg"),
    }
}

#[tauri::command]
fn local_file_info(path: String) -> Result<LocalFileInfo, String> {
    let candidate = PathBuf::from(&path);
    let metadata = std::fs::metadata(&candidate).map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err("media path is not a file".into());
    }

    Ok(LocalFileInfo {
        size: metadata.len(),
    })
}

#[tauri::command]
fn media_base_url(server: tauri::State<MediaServer>) -> String {
    server.base_url()
}

#[tauri::command]
fn allow_media_path(
    app: tauri::AppHandle,
    server: tauri::State<MediaServer>,
    path: String,
) -> Result<(), String> {
    let candidate = PathBuf::from(&path);
    if !candidate.is_file() {
        return Err("media path is not a file".into());
    }

    server.allow(&candidate)?;
    allow_asset_file(&app, &candidate)
}

fn render_proxy(source: &Path, destination: &Path) -> Result<(), String> {
    let source_arg = source.to_string_lossy().into_owned();
    let destination_arg = destination.to_string_lossy().into_owned();
    let status = Command::new("ffmpeg")
        .args([
            "-y",
            "-i",
            source_arg.as_str(),
            "-map",
            "0:v:0",
            "-map",
            "0:a:0?",
            "-vf",
            "scale=-2:720",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "28",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            destination_arg.as_str(),
        ])
        .status()
        .map_err(|error| format!("ffmpeg failed to start: {error}"))?;

    if !status.success() {
        return Err(format!("ffmpeg exited with {status}"));
    }

    Ok(())
}

#[tauri::command]
async fn generate_proxy(app: tauri::AppHandle, source: String, asset_id: String) -> Result<String, String> {
    if !valid_asset_id(&asset_id) {
        return Err("invalid asset id".into());
    }
    if !command_exists("ffmpeg") {
        return Err("ffmpeg is not installed".into());
    }

    let source_path = PathBuf::from(&source);
    if !source_path.is_file() {
        return Err("source media is not a file".into());
    }

    let cache = app.path().app_cache_dir().map_err(|error| error.to_string())?;
    let proxy_dir = cache.join("proxies");
    std::fs::create_dir_all(&proxy_dir).map_err(|error| error.to_string())?;
    let destination = proxy_dir.join(format!("{asset_id}.mp4"));

    let source_for_task = source_path.clone();
    let destination_for_task = destination.clone();
    tauri::async_runtime::spawn_blocking(move || render_proxy(&source_for_task, &destination_for_task))
        .await
        .map_err(|error| error.to_string())??;

    app.state::<MediaServer>().allow(&destination)?;
    allow_asset_file(&app, &destination)?;
    destination
        .to_str()
        .map(ToOwned::to_owned)
        .ok_or_else(|| "proxy path is not valid unicode".into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            app.manage(MediaServer::start()?);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            media_tools,
            local_file_info,
            media_base_url,
            allow_media_path,
            generate_proxy
        ])
        .run(tauri::generate_context!())
        .expect("error while running avi");
}
