// Pic Chop Crop — desktop shell.
// Frontend (frontend/index.html) does all the cropping/resampling work on
// a <canvas>, same as the web version. Rust's only job here is the stuff a
// browser can't do: read the file the OS handed us on launch, list its
// siblings for Prev/Next, and write the exported image back to disk.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::cmp::Ordering;
use std::fs;
use std::path::{Path, PathBuf};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;

#[derive(Serialize)]
struct FileData {
    base64: String,
    mime: String,
}

fn mime_for(path: &Path) -> Option<&'static str> {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .as_deref()
    {
        Some("jpg") | Some("jpeg") => Some("image/jpeg"),
        Some("png") => Some("image/png"),
        _ => None,
    }
}

/// Natural sort key so "img2.jpg" sorts before "img10.jpg", matching
/// Windows Explorer's default ordering instead of plain lexical sort.
fn natural_key(s: &str) -> Vec<(bool, String, u128)> {
    let mut parts = Vec::new();
    let mut chars = s.chars().peekable();
    while let Some(&c) = chars.peek() {
        if c.is_ascii_digit() {
            let mut num = String::new();
            while let Some(&d) = chars.peek() {
                if d.is_ascii_digit() {
                    num.push(d);
                    chars.next();
                } else {
                    break;
                }
            }
            let value: u128 = num.parse().unwrap_or(0);
            parts.push((true, String::new(), value));
        } else {
            let mut word = String::new();
            while let Some(&d) = chars.peek() {
                if !d.is_ascii_digit() {
                    word.push(d.to_ascii_lowercase());
                    chars.next();
                } else {
                    break;
                }
            }
            parts.push((false, word, 0));
        }
    }
    parts
}

fn natural_cmp(a: &str, b: &str) -> Ordering {
    natural_key(a).cmp(&natural_key(b))
}

/// The file path Windows passed us when the app was launched via a file
/// association double-click. argv[0] is our own exe path, so the file (if
/// any) is argv[1].
#[tauri::command]
fn get_initial_file() -> Option<String> {
    std::env::args()
        .nth(1)
        .filter(|p| Path::new(p).is_file())
}

#[tauri::command]
fn read_file_bytes(path: String) -> Result<FileData, String> {
    let p = Path::new(&path);
    let mime = mime_for(p).ok_or_else(|| "unsupported file type".to_string())?;
    let bytes = fs::read(p).map_err(|e| e.to_string())?;
    Ok(FileData {
        base64: STANDARD.encode(bytes),
        mime: mime.to_string(),
    })
}

/// All jpg/jpeg/png files in the same folder as `path`, natural-sorted, so
/// the frontend can step Prev/Next through them.
#[tauri::command]
fn list_siblings(path: String) -> Result<Vec<String>, String> {
    let p = PathBuf::from(&path);
    let dir = p.parent().ok_or_else(|| "no parent directory".to_string())?;
    let mut entries: Vec<String> = fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|p| p.is_file() && mime_for(p).is_some())
        .filter_map(|p| p.to_str().map(|s| s.to_string()))
        .collect();
    entries.sort_by(|a, b| natural_cmp(a, b));
    Ok(entries)
}

#[tauri::command]
fn write_file_bytes(path: String, data_base64: String) -> Result<(), String> {
    let bytes = STANDARD.decode(data_base64).map_err(|e| e.to_string())?;
    fs::write(&path, bytes).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Fresh empty directory under the system temp dir, unique per test.
    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("pic-chop-crop-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn file_name(path: &str) -> String {
        Path::new(path).file_name().unwrap().to_string_lossy().into_owned()
    }

    #[test]
    fn natural_sort_orders_numbers_by_value() {
        let mut names = vec!["img10.jpg", "img2.jpg", "img1.jpg", "img02b.jpg"];
        names.sort_by(|a, b| natural_cmp(a, b));
        assert_eq!(names, ["img1.jpg", "img2.jpg", "img02b.jpg", "img10.jpg"]);
    }

    #[test]
    fn natural_sort_ignores_case() {
        assert_eq!(natural_cmp("B.png", "a.png"), Ordering::Greater);
        assert_eq!(natural_cmp("a.png", "A.png"), Ordering::Equal);
    }

    #[test]
    fn mime_for_accepts_only_jpeg_and_png() {
        assert_eq!(mime_for(Path::new("x.JPG")), Some("image/jpeg"));
        assert_eq!(mime_for(Path::new("x.jpeg")), Some("image/jpeg"));
        assert_eq!(mime_for(Path::new("x.Png")), Some("image/png"));
        assert_eq!(mime_for(Path::new("x.webp")), None);
        assert_eq!(mime_for(Path::new("noext")), None);
    }

    #[test]
    fn list_siblings_returns_only_images_in_natural_order() {
        let dir = temp_dir("siblings");
        for name in ["img10.png", "img2.jpg", "notes.txt", "IMG1.JPEG"] {
            fs::write(dir.join(name), b"x").unwrap();
        }
        fs::create_dir(dir.join("folder.png")).unwrap(); // a directory, not a file

        let start = dir.join("img2.jpg").to_string_lossy().into_owned();
        let names: Vec<String> = list_siblings(start).unwrap().iter().map(|p| file_name(p)).collect();
        assert_eq!(names, ["IMG1.JPEG", "img2.jpg", "img10.png"]);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn list_siblings_paths_match_the_input_path_format() {
        // The frontend finds the current file with siblings.indexOf(path), so
        // the returned path for the start file must be byte-identical to it.
        let dir = temp_dir("indexof");
        fs::write(dir.join("a.png"), b"x").unwrap();
        fs::write(dir.join("b.png"), b"x").unwrap();
        let start = dir.join("b.png").to_string_lossy().into_owned();
        assert!(list_siblings(start.clone()).unwrap().contains(&start));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn write_then_read_round_trips_bytes() {
        let dir = temp_dir("roundtrip");
        let path = dir.join("out.png").to_string_lossy().into_owned();
        let bytes: &[u8] = b"\x89PNG\r\n\x1a\nnot really a png";

        write_file_bytes(path.clone(), STANDARD.encode(bytes)).unwrap();
        let data = read_file_bytes(path).unwrap();
        assert_eq!(data.mime, "image/png");
        assert_eq!(STANDARD.decode(data.base64).unwrap(), bytes);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn read_file_bytes_rejects_unsupported_types() {
        let dir = temp_dir("unsupported");
        let path = dir.join("pic.webp");
        fs::write(&path, b"x").unwrap();
        assert!(read_file_bytes(path.to_string_lossy().into_owned()).is_err());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn write_file_bytes_rejects_invalid_base64() {
        let dir = temp_dir("badbase64");
        let path = dir.join("out.png");
        assert!(write_file_bytes(path.to_string_lossy().into_owned(), "%%%".into()).is_err());
        assert!(!path.exists());
        fs::remove_dir_all(dir).unwrap();
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_initial_file,
            read_file_bytes,
            list_siblings,
            write_file_bytes
        ])
        .run(tauri::generate_context!())
        .expect("error while running Pic Chop Crop");
}
