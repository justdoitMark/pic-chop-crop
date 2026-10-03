// Pic Chop Crop — desktop shell.
// Frontend (frontend/index.html) does all the cropping/resampling work on
// a <canvas>, same as the web version. Rust's only job here is the stuff a
// browser can't do: read the file the OS handed us on launch, list its
// siblings for Prev/Next, write the exported image, and save a quarter turn into the original
// (rotate.rs).
//
// Starting WebView2 costs ~0.6 s, so the app stays resident: closing the
// window only hides it (tray menu → "Выход" quits), and a second launch from
// "Open with" hands its file to the running instance, which reloads the page
// while hidden and shows the window once the image is on it.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::cmp::Ordering;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver};
use std::sync::Mutex;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use tauri::ipc::Response;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, State, WebviewWindow, WindowEvent};

mod exif;
mod png_rotate;
mod rotate;

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

fn read_image(path: &str) -> Result<Vec<u8>, String> {
    let p = Path::new(path);
    mime_for(p).ok_or_else(|| "unsupported file type".to_string())?;
    let _guard = rotate::lock(); // a turn being saved finishes first
    fs::read(p).map_err(|e| e.to_string())
}

/// The file a launch asked for: argv[1] (argv[0] is our own exe), resolved
/// against the launching process's working directory. Explorer passes an
/// absolute path, which `join` returns unchanged.
fn file_arg(args: &[String], cwd: &Path) -> Option<String> {
    let path = cwd.join(args.get(1)?);
    path.is_file().then(|| path.to_string_lossy().into_owned())
}

/// What the page should do on its next load: which file to open, and whether
/// to show the window once it's ready (false for the reload that clears a
/// just-closed window). The file's bytes are read on a background thread
/// meanwhile, in parallel with WebView2 start-up or the page reload.
#[derive(Default)]
struct Launch {
    next: Mutex<(Option<String>, bool)>,
    prefetch: Mutex<Option<(String, Receiver<Result<Vec<u8>, String>>)>>,
}

impl Launch {
    fn set(&self, file: Option<String>, show: bool) {
        *self.prefetch.lock().unwrap() = file.as_ref().map(|path| {
            let (tx, rx) = mpsc::channel();
            let p = path.clone();
            std::thread::spawn(move || tx.send(read_image(&p)));
            (path.clone(), rx)
        });
        *self.next.lock().unwrap() = (file, show);
    }

    /// Peeks rather than takes: when two reloads overlap (close, then an
    /// immediate "Open with"), the later page must still get the file.
    fn file(&self) -> Option<String> {
        self.next.lock().unwrap().0.clone()
    }

    /// The launch is handled once its page is drawn: clears it and says
    /// whether to show the window.
    fn finish(&self) -> bool {
        std::mem::take(&mut *self.next.lock().unwrap()).1
    }

    fn read(&self, path: &str) -> Result<Vec<u8>, String> {
        let prefetched = {
            let mut slot = self.prefetch.lock().unwrap();
            match slot.as_ref() {
                Some((p, _)) if p == path => slot.take(),
                _ => None,
            }
        };
        match prefetched {
            Some((_, rx)) => rx.recv().unwrap_or_else(|_| read_image(path)),
            None => read_image(path),
        }
    }
}

/// The file this launch should open, if any. app_ready clears it, so a
/// later page reload (e.g. after closing the window) starts empty.
#[tauri::command]
fn get_initial_file(launch: State<'_, Launch>) -> Option<String> {
    launch.file()
}

/// Raw file bytes; the frontend receives them as an ArrayBuffer. A JSON or
/// base64 payload would cost a multi-MB string encode + decode per image.
/// Async commands run off the main thread, so reads don't queue behind it.
#[tauri::command]
async fn read_file_bytes(path: String, launch: State<'_, Launch>) -> Result<Response, String> {
    launch.read(&path).map(Response::new)
}

/// Called by the page once the launch image (or the start screen) is drawn:
/// the window appears already showing it instead of an empty frame.
#[tauri::command]
fn app_ready(window: WebviewWindow, launch: State<'_, Launch>) {
    if launch.finish() {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// All jpg/jpeg/png files in the same folder as `path`, natural-sorted, so
/// the frontend can step Prev/Next through them.
#[tauri::command]
async fn list_siblings(path: String) -> Result<Vec<String>, String> {
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
    let _guard = rotate::lock(); // the user may save over the file being turned
    fs::write(&path, bytes).map_err(|e| e.to_string())
}

/// Saves a quarter turn into the file: EXIF Orientation for JPEG (the image
/// data is not touched), a lossless pixel turn for PNG. Runs to the end even
/// if the window closes and the page reloads meanwhile.
#[tauri::command]
async fn rotate_image(path: String, quarter_turns: i32) -> Result<(), String> {
    rotate::rotate_file(Path::new(&path), quarter_turns)
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

    fn block_on<F: std::future::Future>(f: F) -> F::Output {
        tauri::async_runtime::block_on(f)
    }

    fn args(file: &str) -> Vec<String> {
        vec!["pic-chop-crop.exe".into(), file.into()]
    }

    #[test]
    fn file_arg_accepts_an_existing_file_only() {
        let dir = temp_dir("filearg");
        fs::write(dir.join("a.png"), b"x").unwrap();
        let abs = dir.join("a.png").to_string_lossy().into_owned();
        assert_eq!(file_arg(&args(&abs), Path::new("C:\\elsewhere")), Some(abs.clone()));
        assert_eq!(file_arg(&args("a.png"), &dir), Some(abs));
        assert_eq!(file_arg(&args("missing.png"), &dir), None);
        assert_eq!(file_arg(&args("."), &dir), None); // a directory
        assert_eq!(file_arg(&["pic-chop-crop.exe".to_string()], &dir), None);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn launch_file_stays_until_the_page_is_ready() {
        let launch = Launch::default();
        launch.set(Some("C:\\x.png".into()), true);
        assert_eq!(launch.file(), Some("C:\\x.png".into()));
        assert_eq!(launch.file(), Some("C:\\x.png".into())); // an overlapping reload still gets it
        assert!(launch.finish());
        assert_eq!(launch.file(), None);
        assert!(!launch.finish());
    }

    #[test]
    fn launch_hidden_reload_does_not_show_the_window() {
        let launch = Launch::default();
        launch.set(None, false);
        assert!(!launch.finish());
    }

    #[test]
    fn launch_read_returns_prefetched_bytes_and_falls_back_for_other_paths() {
        let dir = temp_dir("prefetch");
        let a = dir.join("a.png").to_string_lossy().into_owned();
        let b = dir.join("b.png").to_string_lossy().into_owned();
        fs::write(&a, b"aaa").unwrap();
        fs::write(&b, b"bbb").unwrap();
        let launch = Launch::default();
        launch.set(Some(a.clone()), true);
        assert_eq!(launch.read(&a).unwrap(), b"aaa");
        assert_eq!(launch.read(&b).unwrap(), b"bbb");
        fs::write(&a, b"new").unwrap();
        assert_eq!(launch.read(&a).unwrap(), b"new"); // prefetch is used once, then fresh reads
        fs::remove_dir_all(dir).unwrap();
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
        let names: Vec<String> = block_on(list_siblings(start)).unwrap().iter().map(|p| file_name(p)).collect();
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
        assert!(block_on(list_siblings(start.clone())).unwrap().contains(&start));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn write_then_read_round_trips_bytes() {
        let dir = temp_dir("roundtrip");
        let path = dir.join("out.png").to_string_lossy().into_owned();
        let bytes: &[u8] = b"\x89PNG\r\n\x1a\nnot really a png";

        write_file_bytes(path.clone(), STANDARD.encode(bytes)).unwrap();
        assert_eq!(read_image(&path).unwrap(), bytes);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn read_file_bytes_rejects_unsupported_types() {
        let dir = temp_dir("unsupported");
        let path = dir.join("pic.webp");
        fs::write(&path, b"x").unwrap();
        assert!(read_image(&path.to_string_lossy()).is_err());
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

/// Windows lists every file opened through the file association under
/// "Recent" in the taskbar icon's Jump List. Publishing our own empty Jump
/// List (without the Recent category) hides it, and RemoveAllDestinations
/// wipes the history Windows has already recorded for the app. Runs on its
/// own thread: COM set-up there can't interfere with WebView2's main thread.
#[cfg(windows)]
fn clear_recent_files() {
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED};
    use windows::Win32::UI::Shell::Common::IObjectArray;
    use windows::Win32::UI::Shell::{ApplicationDestinations, DestinationList, IApplicationDestinations, ICustomDestinationList};

    std::thread::spawn(|| unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        if let Ok(history) = CoCreateInstance::<_, IApplicationDestinations>(&ApplicationDestinations, None, CLSCTX_INPROC_SERVER) {
            let _ = history.RemoveAllDestinations();
        }
        if let Ok(list) = CoCreateInstance::<_, ICustomDestinationList>(&DestinationList, None, CLSCTX_INPROC_SERVER) {
            let mut min_slots = 0u32;
            if list.BeginList::<IObjectArray>(&mut min_slots).is_ok() {
                let _ = list.CommitList();
            }
        }
    });
}

#[cfg(not(windows))]
fn clear_recent_files() {}

/// Another launch (a second "Open with", or the tray): open its file in the
/// already-running window. The page reloads for a clean state and calls
/// app_ready once the image is drawn, which shows the window.
fn activate(app: &AppHandle, file: Option<String>) {
    // Explorer records every "Open with" again, so clear it on each one.
    clear_recent_files();
    let Some(window) = app.get_webview_window("main") else { return };
    if file.is_none() && window.is_visible().unwrap_or(false) {
        let _ = window.unminimize();
        let _ = window.set_focus();
        return;
    }
    app.state::<Launch>().set(file, true);
    let _ = window.eval("location.reload()");
}

/// Hides instead of closing, and reloads the page empty so the closed
/// image doesn't stay in memory.
fn hide_window(window: &tauri::Window) {
    let _ = window.hide();
    window.state::<Launch>().set(None, false);
    if let Some(webview) = window.get_webview_window(window.label()) {
        let _ = webview.eval("location.reload()");
    }
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Открыть", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;
    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("Pic Chop Crop")
        .menu(&Menu::with_items(app, &[&open, &quit])?)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => activate(app, None),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                activate(tray.app_handle(), None);
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

fn main() {
    let launch = Launch::default();
    let args: Vec<String> = std::env::args().collect();
    launch.set(file_arg(&args, &std::env::current_dir().unwrap_or_default()), true);

    tauri::Builder::default()
        // Must be the first plugin: a second instance exits right here.
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            activate(app, file_arg(&args, Path::new(&cwd)));
        }))
        .plugin(tauri_plugin_dialog::init())
        .manage(launch)
        .setup(|app| {
            clear_recent_files();
            Ok(build_tray(app)?)
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                hide_window(window);
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_initial_file,
            read_file_bytes,
            app_ready,
            list_siblings,
            write_file_bytes,
            rotate_image
        ])
        .run(tauri::generate_context!())
        .expect("error while running Pic Chop Crop");
}
