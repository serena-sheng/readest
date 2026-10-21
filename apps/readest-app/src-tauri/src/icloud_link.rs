//! Symbolic links for the iCloud-backed library (macOS only).
//!
//! The app's own `Books/` directory is replaced by a symlink to
//! `<iCloud Drive>/Readest/Books`, so every read/write of the library lands
//! in iCloud Drive and no second copy is kept on disk. Tauri's fs plugin has
//! no symlink command, hence this minimal one.
//!
//! Idempotent: re-running with an existing correct link succeeds; a path that
//! exists as anything other than a link is refused rather than replaced.

use std::path::Path;

#[tauri::command]
pub async fn ensure_symlink(target: String, link: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || ensure_symlink_blocking(&target, &link))
        .await
        .map_err(|e| e.to_string())?
}

fn ensure_symlink_blocking(target: &str, link: &str) -> Result<(), String> {
    let target_path = Path::new(target);
    let link_path = Path::new(link);

    match std::fs::symlink_metadata(link_path) {
        Ok(metadata) => {
            if !metadata.file_type().is_symlink() {
                return Err(format!(
                    "{} exists and is not a symbolic link",
                    link_path.display()
                ));
            }
            let existing = std::fs::read_link(link_path).map_err(|e| e.to_string())?;
            if existing == target_path {
                return Ok(());
            }
            return Err(format!(
                "{} points at {}, not {}",
                link_path.display(),
                existing.display(),
                target_path.display()
            ));
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.to_string()),
    }

    if let Some(parent) = link_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::os::unix::fs::symlink(target_path, link_path).map_err(|e| e.to_string())
}
