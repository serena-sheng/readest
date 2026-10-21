//! Whole-disk-shaped discovery for the library's "scan and suggest" flow.
//!
//! This command only walks directory metadata: it never opens a book, so it
//! needs no fs read capability and stays cheap on large user roots. The TS
//! layer (`src/services/library/discovery.ts`) decides what to do with the
//! hits — scoring, duplicate detection, and which of them to import.

use std::path::{Path, PathBuf};

use walkdir::WalkDir;

/// Book-shaped extensions a hit may carry. `zip` is included as a candidate:
/// only the TS layer knows whether an archive is a manga CBZ in disguise.
const BOOK_EXTENSIONS: &[&str] = &[
    "epub", "cbz", "zip", "pdf", "mobi", "azw", "azw3", "fb2", "fbz",
];

/// Hard cap so a scan over `/Volumes` cannot return tens of thousands of rows.
const MAX_HITS: usize = 5000;

const DEFAULT_MAX_DEPTH: u32 = 6;

#[derive(serde::Serialize)]
pub struct ScanHit {
    pub path: String,
    pub size: u64,
    /// Unix milliseconds. `0` when the platform cannot report a mtime.
    pub modified: u64,
    pub kind: String,
    /// Repeated on every hit; true when {@link MAX_HITS} ended the walk early.
    pub truncated: bool,
}

#[tauri::command]
pub async fn scan_importable(
    roots: Vec<String>,
    max_depth: Option<u32>,
) -> Result<Vec<ScanHit>, String> {
    // Statting a whole home directory is thousands of syscalls; keep them off
    // the IPC dispatch thread (same reasoning as `dir_scanner::read_dir`).
    tauri::async_runtime::spawn_blocking(move || scan_roots(&roots, max_depth))
        .await
        .map_err(|e| format!("join error: {e}"))?
}

fn scan_roots(roots: &[String], max_depth: Option<u32>) -> Result<Vec<ScanHit>, String> {
    let depth = max_depth.unwrap_or(DEFAULT_MAX_DEPTH);
    let mut hits: Vec<ScanHit> = Vec::new();
    let mut truncated = false;

    'roots: for root in roots {
        let root = expand_home(root);
        if !root.is_dir() {
            log::warn!("RUST: scan_importable skipping missing root {}", root.display());
            continue;
        }

        let walker = WalkDir::new(&root)
            .max_depth(depth as usize)
            .follow_links(false)
            .into_iter()
            .filter_entry(|entry| entry.depth() == 0 || !is_skipped_dir(entry));

        for entry in walker {
            let entry = match entry {
                Ok(entry) => entry,
                Err(err) => {
                    log::warn!("RUST: scan_importable skipping entry: {}", err);
                    continue;
                }
            };
            if !entry.file_type().is_file() {
                continue;
            }
            let Some(kind) = book_extension(entry.path()) else {
                continue;
            };
            let Ok(metadata) = entry.metadata() else {
                continue;
            };

            hits.push(ScanHit {
                path: entry.path().to_string_lossy().into_owned(),
                size: metadata.len(),
                modified: modified_millis(&metadata),
                kind,
                truncated: false,
            });

            if hits.len() >= MAX_HITS {
                truncated = true;
                log::warn!(
                    "RUST: scan_importable hit the {} file cap; results truncated",
                    MAX_HITS
                );
                break 'roots;
            }
        }
    }

    if truncated {
        for hit in &mut hits {
            hit.truncated = true;
        }
    }

    // Largest first: a big CBZ is more likely to be a real work than a
    // stray one-page sample.
    hits.sort_by(|a, b| b.size.cmp(&a.size).then_with(|| a.path.cmp(&b.path)));
    Ok(hits)
}

fn is_skipped_dir(entry: &walkdir::DirEntry) -> bool {
    if !entry.file_type().is_dir() {
        return false;
    }
    let name = entry.file_name().to_string_lossy();
    if name.starts_with('.') {
        // Hidden directories: `.git`, `.Trash`, caches, app support internals.
        return true;
    }
    if name == "node_modules" || name.ends_with(".app") {
        return true;
    }
    // `~/Library/Caches` (and its siblings under any Library) holds app caches,
    // never books. Match the pair rather than every directory named Caches.
    if name == "Caches" {
        return entry
            .path()
            .parent()
            .and_then(Path::file_name)
            .map_or(false, |parent| parent.to_string_lossy() == "Library");
    }
    false
}

fn book_extension(path: &Path) -> Option<String> {
    let ext = path.extension()?.to_string_lossy().to_lowercase();
    BOOK_EXTENSIONS
        .contains(&ext.as_str())
        .then_some(ext)
}

fn modified_millis(metadata: &std::fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

/// Expands a leading `~` so callers can pass `~/Downloads` without asking the
/// webview for the home directory first.
fn expand_home(path: &str) -> PathBuf {
    if path == "~" {
        if let Some(home) = home_dir() {
            return home;
        }
    } else if let Some(rest) = path.strip_prefix("~/") {
        if let Some(home) = home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(path)
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("USERPROFILE")
                .filter(|value| !value.is_empty())
                .map(PathBuf::from)
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn book_extension_is_case_insensitive_and_whitelisted() {
        assert_eq!(book_extension(Path::new("/a/B.EPUB")), Some("epub".into()));
        assert_eq!(book_extension(Path::new("/a/notes.txt")), None);
    }

    #[test]
    fn expand_home_only_touches_a_leading_tilde() {
        let home = home_dir().unwrap();
        assert_eq!(expand_home("~/Downloads"), home.join("Downloads"));
        assert_eq!(expand_home("/tmp/~/x"), PathBuf::from("/tmp/~/x"));
    }
}
