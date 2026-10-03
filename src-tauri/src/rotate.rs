//! Saving a quarter turn into the image file itself. The page shows the turn
//! at once; this keeps it after the window closes. One lock covers every read
//! and write of an image file, so a read never sees a half-written file or
//! the state from before a turn that is still being saved.

use std::fs::{self, OpenOptions};
use std::io::{Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use crate::{exif, mime_for, png_rotate};

pub const READ_ONLY: &str = "read-only";
pub const ACCESS_DENIED: &str = "access denied";
pub const UNSUPPORTED: &str = "unsupported file type";

static FILE_LOCK: Mutex<()> = Mutex::new(());

/// The image-file lock. A panic while holding it must not lock files forever.
pub fn lock() -> MutexGuard<'static, ()> {
    FILE_LOCK.lock().unwrap_or_else(|e| e.into_inner())
}

fn io_err(e: std::io::Error) -> String {
    if e.kind() == std::io::ErrorKind::PermissionDenied {
        ACCESS_DENIED.into()
    } else {
        e.to_string()
    }
}

/// Turns the image in `path` by `quarter_turns` × 90° clockwise (negative =
/// counter-clockwise). Turns add up, so concurrent calls may run in any
/// order. On any error the file is left as it was.
pub fn rotate_file(path: &Path, quarter_turns: i32) -> Result<(), String> {
    let mime = mime_for(path).ok_or(UNSUPPORTED)?;
    if quarter_turns.rem_euclid(4) == 0 {
        return Ok(());
    }
    let _guard = lock();
    // checked first: otherwise an in-place write fails with a vague "access denied"
    if fs::metadata(path).map_err(io_err)?.permissions().readonly() {
        return Err(READ_ONLY.into());
    }
    let data = fs::read(path).map_err(io_err)?;
    if mime == "image/jpeg" {
        match exif::rotate_edit(&data, quarter_turns)? {
            exif::Edit::InPlace { offset, bytes } => write_at(path, offset, &bytes),
            exif::Edit::Rewrite(new) => replace(path, &new),
        }
    } else {
        replace(path, &png_rotate::rotate_png(&data, quarter_turns)?)
    }
}

fn write_at(path: &Path, offset: usize, bytes: &[u8]) -> Result<(), String> {
    let mut f = OpenOptions::new().write(true).open(path).map_err(io_err)?;
    f.seek(SeekFrom::Start(offset as u64)).map_err(io_err)?;
    f.write_all(bytes).map_err(io_err)
}

/// Writes the new bytes next to the file, then swaps them in, so the file is
/// never half-written. If the swap fails, `recover` puts the original back;
/// the last copy of the image is never deleted.
fn replace(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = temp_path(path, "pcc-tmp");
    let bak = temp_path(path, "pcc-bak");
    if let Err(e) = fs::write(&tmp, bytes) {
        let _ = fs::remove_file(&tmp); // the original was not touched yet
        return Err(io_err(e));
    }
    match swap_in(&tmp, path, &bak) {
        Ok(()) => {
            let _ = fs::remove_file(&bak); // the turn is saved; a stray backup is harmless
            Ok(())
        }
        Err(e) => {
            recover(path, &tmp, &bak);
            Err(e)
        }
    }
}

/// After a failed swap: make sure `path` holds an image again, then clean up.
/// Prefers the untouched original (backup), then the new file, over nothing.
fn recover(path: &Path, tmp: &Path, bak: &Path) {
    if !path.exists() {
        if bak.exists() {
            let _ = fs::rename(bak, path);
        } else if tmp.exists() {
            let _ = fs::rename(tmp, path);
        }
    }
    if path.exists() {
        let _ = fs::remove_file(tmp);
        let _ = fs::remove_file(bak);
    }
}

fn temp_path(path: &Path, ext: &str) -> PathBuf {
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    path.with_file_name(format!(".{name}.{ext}"))
}

/// ReplaceFileW keeps the original's creation date, attributes, ACL and
/// alternate streams (Zone.Identifier); a plain rename would not. The backup
/// name makes a half-done swap recoverable.
#[cfg(windows)]
fn swap_in(tmp: &Path, path: &Path, bak: &Path) -> Result<(), String> {
    use windows::core::{HSTRING, PCWSTR};
    use windows::Win32::Foundation::E_ACCESSDENIED;
    use windows::Win32::Storage::FileSystem::{ReplaceFileW, REPLACE_FILE_FLAGS};

    let bak = HSTRING::from(bak.as_os_str());
    unsafe {
        ReplaceFileW(
            &HSTRING::from(path.as_os_str()),
            &HSTRING::from(tmp.as_os_str()),
            PCWSTR(bak.as_ptr()),
            REPLACE_FILE_FLAGS(0),
            None,
            None,
        )
    }
    .map_err(|e| if e.code() == E_ACCESSDENIED { ACCESS_DENIED.into() } else { e.message().to_string() })
}

#[cfg(not(windows))]
fn swap_in(tmp: &Path, path: &Path, _bak: &Path) -> Result<(), String> {
    fs::rename(tmp, path).map_err(io_err)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::exif::fixture::{app0, exif as exif_app1, jpeg};
    use crate::exif::Order;
    use std::time::Duration;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("pic-chop-crop-rotate-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn orientation_of(path: &Path) -> Option<u16> {
        exif::orientation(&fs::read(path).unwrap()).unwrap()
    }

    fn tagged_jpeg(value: u16) -> Vec<u8> {
        let b = Order::Little.bytes16(value);
        jpeg(&[app0(), exif_app1(Order::Little, &[(0x0112, 3, 1, [b[0], b[1], 0, 0])], false, &[])])
    }

    #[test]
    fn a_tagged_jpeg_is_patched_in_place() {
        let dir = temp_dir("inplace");
        let p = dir.join("a.jpg");
        fs::write(&p, tagged_jpeg(1)).unwrap();
        let len = fs::metadata(&p).unwrap().len();
        rotate_file(&p, 1).unwrap();
        assert_eq!(orientation_of(&p), Some(6));
        assert_eq!(fs::metadata(&p).unwrap().len(), len);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn an_untagged_jpeg_is_replaced_and_leaves_no_temp_file() {
        let dir = temp_dir("replace");
        let p = dir.join("снимок & co.JPG"); // Cyrillic and & as in real user folders
        fs::write(&p, jpeg(&[app0()])).unwrap();
        rotate_file(&p, -1).unwrap();
        assert_eq!(orientation_of(&p), Some(8));
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_png_is_turned() {
        let dir = temp_dir("png");
        let p = dir.join("a.png");
        let mut file = Vec::new();
        {
            let mut enc = png::Encoder::new(&mut file, 3, 2);
            enc.set_color(png::ColorType::Rgb);
            let mut w = enc.write_header().unwrap();
            w.write_image_data(&[0; 18]).unwrap();
            w.finish().unwrap();
        }
        fs::write(&p, &file).unwrap();
        rotate_file(&p, 1).unwrap();
        let data = fs::read(&p).unwrap();
        let reader = png::Decoder::new(&data[..]).read_info().unwrap();
        assert_eq!((reader.info().width, reader.info().height), (2, 3));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_read_only_file_is_left_alone() {
        let dir = temp_dir("readonly");
        let p = dir.join("a.jpg");
        fs::write(&p, jpeg(&[app0()])).unwrap();
        let before = fs::read(&p).unwrap();
        let mut perm = fs::metadata(&p).unwrap().permissions();
        perm.set_readonly(true);
        fs::set_permissions(&p, perm.clone()).unwrap();

        assert_eq!(rotate_file(&p, 1), Err(READ_ONLY.to_string()));
        assert_eq!(fs::read(&p).unwrap(), before);
        assert!(fs::metadata(&p).unwrap().permissions().readonly());
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);

        #[allow(clippy::permissions_set_readonly_false)]
        perm.set_readonly(false);
        fs::set_permissions(&p, perm).unwrap();
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn other_types_are_refused_and_turns_wrap_around() {
        let dir = temp_dir("types");
        let webp = dir.join("a.webp");
        fs::write(&webp, b"x").unwrap();
        assert_eq!(rotate_file(&webp, 1), Err(UNSUPPORTED.to_string()));

        let p = dir.join("a.jpg");
        let j = jpeg(&[app0()]);
        fs::write(&p, &j).unwrap();
        for q in [0, 4, -4] {
            rotate_file(&p, q).unwrap();
        }
        assert_eq!(fs::read(&p).unwrap(), j); // nothing written
        rotate_file(&p, 5).unwrap();
        assert_eq!(orientation_of(&p), Some(6));
        rotate_file(&p, -1).unwrap();
        assert_eq!(orientation_of(&p), Some(1));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn concurrent_turns_all_land() {
        let dir = temp_dir("concurrent");
        let p = dir.join("a.jpg");
        fs::write(&p, jpeg(&[app0()])).unwrap();
        let handles: Vec<_> = (0..8)
            .map(|_| {
                let p = p.clone();
                std::thread::spawn(move || rotate_file(&p, 1))
            })
            .collect();
        for h in handles {
            h.join().unwrap().unwrap();
        }
        assert_eq!(orientation_of(&p), Some(1)); // 8 quarter turns = 2 full turns
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn reads_wait_for_a_turn_in_progress() {
        let dir = temp_dir("lock");
        let p = dir.join("a.jpg");
        fs::write(&p, b"x").unwrap();
        let guard = lock();
        let path = p.to_string_lossy().into_owned();
        let reader = std::thread::spawn(move || crate::read_image(&path));
        std::thread::sleep(Duration::from_millis(150));
        assert!(!reader.is_finished(), "read_image must wait for the file lock");
        drop(guard);
        assert_eq!(reader.join().unwrap().unwrap(), b"x");
        fs::remove_dir_all(dir).unwrap();
    }

    fn names(dir: &Path) -> Vec<String> {
        fs::read_dir(dir).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect()
    }

    #[test]
    fn recover_keeps_an_intact_original_and_drops_the_temp_file() {
        let dir = temp_dir("rec-intact");
        let (p, t, b) = (dir.join("a.jpg"), temp_path(&dir.join("a.jpg"), "pcc-tmp"), temp_path(&dir.join("a.jpg"), "pcc-bak"));
        fs::write(&p, b"orig").unwrap();
        fs::write(&t, b"new").unwrap();
        recover(&p, &t, &b);
        assert_eq!(fs::read(&p).unwrap(), b"orig");
        assert_eq!(names(&dir), vec!["a.jpg"]);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn recover_restores_the_original_from_the_backup() {
        let dir = temp_dir("rec-bak");
        let (p, t, b) = (dir.join("a.jpg"), temp_path(&dir.join("a.jpg"), "pcc-tmp"), temp_path(&dir.join("a.jpg"), "pcc-bak"));
        fs::write(&b, b"orig").unwrap();
        fs::write(&t, b"new").unwrap();
        recover(&p, &t, &b);
        assert_eq!(fs::read(&p).unwrap(), b"orig");
        assert_eq!(names(&dir), vec!["a.jpg"]);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn recover_keeps_the_new_file_when_it_is_the_only_copy() {
        let dir = temp_dir("rec-tmp");
        let (p, t, b) = (dir.join("a.jpg"), temp_path(&dir.join("a.jpg"), "pcc-tmp"), temp_path(&dir.join("a.jpg"), "pcc-bak"));
        fs::write(&t, b"new").unwrap();
        recover(&p, &t, &b);
        assert_eq!(fs::read(&p).unwrap(), b"new");
        assert_eq!(names(&dir), vec!["a.jpg"]);
        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn a_failed_swap_leaves_the_original_and_no_leftovers() {
        use std::os::windows::fs::OpenOptionsExt;
        let dir = temp_dir("swapfail");
        let p = dir.join("a.jpg");
        let j = jpeg(&[app0()]); // untagged: takes the replace path
        fs::write(&p, &j).unwrap();
        // open without FILE_SHARE_DELETE so ReplaceFileW cannot move the file
        let _held = OpenOptions::new().read(true).share_mode(1).open(&p).unwrap();
        assert!(rotate_file(&p, 1).is_err());
        assert_eq!(fs::read(&p).unwrap(), j);
        assert_eq!(names(&dir), vec!["a.jpg"]);
        drop(_held);
        fs::remove_dir_all(dir).unwrap();
    }
}
