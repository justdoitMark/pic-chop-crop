# Поворот на 90° с автосохранением и наклон — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** кнопки ⟲ ⟳ поворачивают картинку на 90° и сразу сохраняют поворот в исходный файл (JPEG — тег EXIF Orientation, PNG — поворот пикселей без потерь); наклон ±45° с шагом 1° (кнопка угла + линейка) влияет только на сохраняемую обрезку.

**Architecture:** Страница показывает поворот и наклон CSS-трансформацией `<img>` и считает рамку через чистые функции `frontend/geometry.js`; экспорт рисует оригинал на canvas одним преобразованием. Каждый поворот сразу уходит в новую Rust-команду `rotate_image`; Rust пишет файл под общей блокировкой, через которую идёт и любое чтение изображения.

**Tech Stack:** Tauri v2, Rust ≥ 1.77 (крейты `png 0.17`, `crc32fast 1`, `windows 0.61`), одна HTML-страница на ES5 без сборщика, Playwright в headless Edge.

**Spec:** `docs/superpowers/specs/2026-10-03-rotate-and-tilt-design.md`

## Global Constraints

- Фронтенд — ES5: `var`, `function`, без стрелочных функций, `let/const`, классов, модулей; без сборщика. `geometry.js` подключается обычным `<script src>`.
- Двойной режим: каждая десктопная ветка проверяет `tauri` и имеет браузерный путь (`var tauri = window.__TAURI__ || null`).
- Команды Tauri регистрируются в `generate_handler!`; JS-аргументы в camelCase (`quarterTurns`) → Rust snake_case (`quarter_turns`).
- Новые зависимости только: `png = "0.17"`, `crc32fast = "1"` (обе уже в Cargo.lock через Tauri), фичи `Win32_Foundation` и `Win32_Storage_FileSystem` у `windows`; dev: `miniz_oxide = "0.8"`.
- Коды ошибок Rust ровно: `read-only`, `access denied`, `corrupt EXIF`, `animated PNG`, `unsupported file type`, `corrupt PNG`, `EXIF too large`.
- Тексты интерфейса — дословно из спека (таблица «Сообщения», подсказки кнопок). Минус в числах — `−` (U+2212).
- Диапазон наклона −45…45, шаг 1°; 8 px линейки на 1°.
- Цвета только через токены (`--cyan`, `--line`, `--muted`, …); голубой = геометрия.
- Работа в ветке `feat/rotate-tilt`; коммиты в формате conventional commits, каждый заканчивается строкой `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- После каждой задачи весь набор тестов зелёный: `npm test` и `cargo test --manifest-path src-tauri/Cargo.toml`.

## Review Focus

1. **JPEG, где первым идёт APP1 с XMP, а EXIF — вторым APP1** (Lightroom, Photoshop): поворот должен найти именно EXIF-блок, а не испортить XMP. Тест — Task 1 `the_exif_app1_is_found_after_an_xmp_app1`.
2. **Путь с кириллицей и `&`** («C:\Фото\снимок & co.JPG», как у самого пользователя): временный файл и `ReplaceFileW` должны работать. Тест — Task 3 `an_untagged_jpeg_is_replaced_and_leaves_no_temp_file`.
3. **Поворот, нажатый пока грузится следующий файл** (Prev/Next с задержкой): поворот должен уйти в файл, который на экране. Тест — Task 6 `a turn during a slow Next load goes to the file on screen`.
4. **Наклон + зум колесом + изменение размера окна**: рамка остаётся внутри наклонённой картинки. Тест — Task 7 `zoom and window resize keep the frame inside`.
5. **Фото с телефона, у которого уже Orientation = 6**: поворот считается от того, что на экране, и на экспорте верный угол. Тест — Task 11 `a phone photo (Orientation 6) turns from what is on screen`.

---

## Файлы

| Файл | Что делает |
|---|---|
| `src-tauri/src/exif.rs` (новый) | Разбор маркеров JPEG до SOS, чтение/запись тега Orientation; тестовые построители JPEG |
| `src-tauri/src/png_rotate.rs` (новый) | Поворот PNG без потерь с сохранением всех чанков |
| `src-tauri/src/rotate.rs` (новый) | Блокировка файлов, `rotate_file`, запись на месте и через `ReplaceFileW` |
| `src-tauri/src/main.rs` | `mod`-объявления, команда `rotate_image`, блокировка в `read_image`/`write_file_bytes` |
| `src-tauri/Cargo.toml` | зависимости и фичи |
| `frontend/geometry.js` (новый) | Чистая геометрия: габариты, рамка внутри наклонённого прямоугольника |
| `frontend/index.html` | Кнопки, линейка, состояние поворота/наклона, экспорт, клавиши, касание, Ctrl+O |
| `tests/e2e/helpers.mjs` | Мок `rotate_image`/`dialog.open`, цвета квадрантов, чтение пикселей экспорта, вставка EXIF |
| `tests/e2e/geometry.spec.mjs` (новый) | Геометрия в Node |
| `tests/e2e/rotate.spec.mjs` (новый) | Поворот, автосохранение, Ctrl+O |
| `tests/e2e/tilt.spec.mjs` (новый) | Наклон, линейка, касание |
| `tests/e2e/exif.spec.mjs` (новый) | Движок Edge/WebView2 читает наш тег |
| `tests/e2e/browser.spec.mjs`, `layout.spec.mjs` | Поворот без Tauri; вёрстка с новыми кнопками |
| `README.md`, `CLAUDE.md`, версии | Документация, 0.1.6 |

---

### Task 0: Ветка

- [ ] **Step 1: Создать ветку**

```bash
git checkout -b feat/rotate-tilt
```

---

### Task 1: EXIF Orientation в JPEG (Rust)

**Files:**
- Create: `src-tauri/src/exif.rs`
- Modify: `src-tauri/src/main.rs` (строка `mod exif;` после `use`-блока)

**Interfaces:**
- Produces: `exif::rotate(orientation: u16, quarter_turns: i32) -> u16`; `exif::orientation(jpeg: &[u8]) -> Result<Option<u16>, String>`; `exif::rotate_edit(jpeg: &[u8], quarter_turns: i32) -> Result<exif::Edit, String>`; `enum Edit { InPlace { offset: usize, bytes: [u8; 2] }, Rewrite(Vec<u8>) }`; `exif::CORRUPT`; `pub enum Order { Little, Big }` с `u16/u32/bytes16/bytes32`; `#[cfg(test)] pub mod fixture { segment, app0, jpeg, exif, scan_start }` — используется в Task 3.

- [ ] **Step 1: Написать модуль с тестами (реализация функций пока `todo!()`)**

Создать `src-tauri/src/exif.rs` целиком — тесты и тестовые построители окончательные, тела `rotate`, `parse`, `parse_exif`, `insert_app1`, `add_to_ifd0` на этом шаге — `todo!()`:

```rust
//! EXIF Orientation in JPEG files. A quarter turn rewrites only this tag (or
//! adds it), so the compressed image data is never touched: rotating is
//! instant and loses nothing. WebView2, Explorer and phones apply the tag
//! when they show the photo.

pub const CORRUPT: &str = "corrupt EXIF";
const ORIENTATION: u16 = 0x0112;
const SHORT: u16 = 3;

/// Orientation after turning the displayed image `quarter_turns` times
/// clockwise (negative = counter-clockwise). Values outside 1…8 count as 1,
/// as in Chromium.
pub fn rotate(orientation: u16, quarter_turns: i32) -> u16 {
    todo!()
}

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Order {
    Little,
    Big,
}

impl Order {
    pub fn u16(self, b: &[u8], at: usize) -> Option<u16> {
        let s = b.get(at..at + 2)?;
        Some(match self {
            Order::Little => u16::from_le_bytes([s[0], s[1]]),
            Order::Big => u16::from_be_bytes([s[0], s[1]]),
        })
    }

    pub fn u32(self, b: &[u8], at: usize) -> Option<u32> {
        let s = b.get(at..at + 4)?;
        let a = [s[0], s[1], s[2], s[3]];
        Some(match self {
            Order::Little => u32::from_le_bytes(a),
            Order::Big => u32::from_be_bytes(a),
        })
    }

    pub fn bytes16(self, v: u16) -> [u8; 2] {
        match self {
            Order::Little => v.to_le_bytes(),
            Order::Big => v.to_be_bytes(),
        }
    }

    pub fn bytes32(self, v: u32) -> [u8; 4] {
        match self {
            Order::Little => v.to_le_bytes(),
            Order::Big => v.to_be_bytes(),
        }
    }
}

/// How to store a new orientation.
#[derive(Debug, PartialEq)]
pub enum Edit {
    /// The tag exists: overwrite 2 bytes at this file offset.
    InPlace { offset: usize, bytes: [u8; 2] },
    /// The tag had to be added: the whole new file.
    Rewrite(Vec<u8>),
}

/// Where the EXIF block is and what IFD0 holds.
struct Exif {
    seg_start: usize,  // the APP1 marker (0xFF 0xE1)
    seg_end: usize,    // one past the segment
    tiff_start: usize, // TIFF header, right after "Exif\0\0"
    order: Order,
    ifd0: usize,       // IFD0 offset, relative to tiff_start
    count: usize,      // IFD0 entries
    /// Absolute file offset of the Orientation value, and the value.
    orientation: Option<(usize, u16)>,
}

struct Jpeg {
    /// Where a new APP1 goes: after SOI and any JFIF APP0 right behind it.
    insert_at: usize,
    exif: Option<Exif>,
}

fn be16(b: &[u8], at: usize) -> Option<usize> {
    b.get(at..at + 2).map(|s| u16::from_be_bytes([s[0], s[1]]) as usize)
}

fn parse(jpeg: &[u8]) -> Result<Jpeg, String> {
    todo!()
}

fn parse_exif(jpeg: &[u8], seg_start: usize, seg_end: usize) -> Result<Exif, String> {
    todo!()
}

/// The orientation stored in the file (None: no EXIF or no tag).
pub fn orientation(jpeg: &[u8]) -> Result<Option<u16>, String> {
    Ok(parse(jpeg)?.exif.and_then(|e| e.orientation).map(|(_, v)| v))
}

/// What to write so the file shows `quarter_turns` more clockwise turns.
pub fn rotate_edit(jpeg: &[u8], quarter_turns: i32) -> Result<Edit, String> {
    let parsed = parse(jpeg)?;
    match parsed.exif {
        Some(Exif { orientation: Some((offset, value)), order, .. }) => Ok(Edit::InPlace {
            offset,
            bytes: order.bytes16(rotate(value, quarter_turns)),
        }),
        Some(exif) => add_to_ifd0(jpeg, &exif, rotate(1, quarter_turns)).map(Edit::Rewrite),
        None => Ok(Edit::Rewrite(insert_app1(jpeg, parsed.insert_at, rotate(1, quarter_turns)))),
    }
}

fn entry(o: Order, tag: u16, value: u16) -> [u8; 12] {
    let mut e = [0u8; 12];
    e[0..2].copy_from_slice(&o.bytes16(tag));
    e[2..4].copy_from_slice(&o.bytes16(SHORT));
    e[4..8].copy_from_slice(&o.bytes32(1));
    e[8..10].copy_from_slice(&o.bytes16(value));
    e
}

fn app1(tiff: &[u8]) -> Result<Vec<u8>, String> {
    let len = 2 + 6 + tiff.len();
    if len > 0xFFFF {
        return Err("EXIF too large".into());
    }
    let mut seg = vec![0xFF, 0xE1];
    seg.extend_from_slice(&(len as u16).to_be_bytes());
    seg.extend_from_slice(b"Exif\0\0");
    seg.extend_from_slice(tiff);
    Ok(seg)
}

fn insert_app1(jpeg: &[u8], at: usize, value: u16) -> Vec<u8> {
    todo!()
}

fn add_to_ifd0(jpeg: &[u8], exif: &Exif, value: u16) -> Result<Vec<u8>, String> {
    todo!()
}

/// Synthetic JPEGs for tests. Nothing here decodes the scan, so a few
/// arbitrary bytes stand in for the compressed image.
#[cfg(test)]
pub mod fixture {
    use super::Order;

    pub fn segment(marker: u8, payload: &[u8]) -> Vec<u8> {
        let mut s = vec![0xFF, marker];
        s.extend_from_slice(&((payload.len() + 2) as u16).to_be_bytes());
        s.extend_from_slice(payload);
        s
    }

    pub fn app0() -> Vec<u8> {
        segment(0xE0, b"JFIF\0\x01\x01\0\0\x01\0\x01\0\0")
    }

    /// SOI, the given segments, DQT, SOS, fake scan data, EOI.
    pub fn jpeg(segments: &[Vec<u8>]) -> Vec<u8> {
        let mut j = vec![0xFF, 0xD8];
        for s in segments {
            j.extend_from_slice(s);
        }
        j.extend_from_slice(&segment(0xDB, &[0; 65]));
        j.extend_from_slice(&segment(0xDA, &[1, 1, 0, 0, 63, 0]));
        j.extend_from_slice(&[0x12, 0x34, 0xFF, 0x00, 0x56, 0x78]);
        j.extend_from_slice(&[0xFF, 0xD9]);
        j
    }

    /// APP1 "Exif" with IFD0 `entries` (tag, type, count, 4 value bytes); with
    /// `ifd1`, IFD0 points to a one-entry IFD1 (Compression = 6) right after
    /// it. `tail` follows: data that entries point into.
    pub fn exif(order: Order, entries: &[(u16, u16, u32, [u8; 4])], ifd1: bool, tail: &[u8]) -> Vec<u8> {
        let mut t = match order {
            Order::Little => b"II".to_vec(),
            Order::Big => b"MM".to_vec(),
        };
        t.extend_from_slice(&order.bytes16(42));
        t.extend_from_slice(&order.bytes32(8));
        t.extend_from_slice(&order.bytes16(entries.len() as u16));
        for &(tag, typ, count, value) in entries {
            t.extend_from_slice(&order.bytes16(tag));
            t.extend_from_slice(&order.bytes16(typ));
            t.extend_from_slice(&order.bytes32(count));
            t.extend_from_slice(&value);
        }
        let ifd1_at = (t.len() + 4) as u32;
        t.extend_from_slice(&order.bytes32(if ifd1 { ifd1_at } else { 0 }));
        if ifd1 {
            t.extend_from_slice(&order.bytes16(1));
            t.extend_from_slice(&order.bytes16(0x0103));
            t.extend_from_slice(&order.bytes16(3));
            t.extend_from_slice(&order.bytes32(1));
            t.extend_from_slice(&order.bytes16(6));
            t.extend_from_slice(&[0, 0, 0, 0, 0, 0]);
        }
        t.extend_from_slice(tail);
        let mut payload = b"Exif\0\0".to_vec();
        payload.extend_from_slice(&t);
        segment(0xE1, &payload)
    }

    /// Offset of the SOS marker: everything from here on is the image data.
    pub fn scan_start(j: &[u8]) -> usize {
        j.windows(2).position(|w| w == [0xFF, 0xDA]).unwrap()
    }
}

#[cfg(test)]
mod tests {
    use super::fixture::*;
    use super::*;

    fn orient_entry(order: Order, v: u16) -> (u16, u16, u32, [u8; 4]) {
        let b = order.bytes16(v);
        (ORIENTATION, SHORT, 1, [b[0], b[1], 0, 0])
    }

    fn apply(jpeg: &[u8], edit: Edit) -> Vec<u8> {
        match edit {
            Edit::InPlace { offset, bytes } => {
                let mut j = jpeg.to_vec();
                j[offset..offset + 2].copy_from_slice(&bytes);
                j
            }
            Edit::Rewrite(j) => j,
        }
    }

    #[test]
    fn quarter_turns_follow_the_exif_table() {
        let cw = [(1, 6), (6, 3), (3, 8), (8, 1), (2, 7), (7, 4), (4, 5), (5, 2)];
        for (from, to) in cw {
            assert_eq!(rotate(from, 1), to, "clockwise from {from}");
            assert_eq!(rotate(to, -1), from, "counter-clockwise from {to}");
        }
    }

    #[test]
    fn four_turns_and_a_turn_back_change_nothing() {
        for o in 1..=8 {
            assert_eq!(rotate(o, 4), o);
            assert_eq!(rotate(rotate(o, 1), -1), o);
            assert_eq!(rotate(o, 5), rotate(o, 1));
            assert_eq!(rotate(o, -1), rotate(o, 3));
        }
    }

    #[test]
    fn values_outside_1_to_8_count_as_1() {
        assert_eq!(rotate(0, 1), 6);
        assert_eq!(rotate(9, 1), 6);
    }

    #[test]
    fn existing_tag_is_rewritten_in_place_in_both_byte_orders() {
        for order in [Order::Little, Order::Big] {
            let j = jpeg(&[app0(), exif(order, &[orient_entry(order, 1)], true, &[])]);
            let edit = rotate_edit(&j, 1).unwrap();
            let Edit::InPlace { offset, .. } = edit else { panic!("{order:?}: expected an in-place edit") };
            let out = apply(&j, edit);
            assert_eq!(out.len(), j.len());
            assert!(j.iter().zip(&out).enumerate().all(|(i, (a, b))| a == b || (offset..offset + 2).contains(&i)));
            assert_eq!(orientation(&out).unwrap(), Some(6), "{order:?}");
        }
    }

    #[test]
    fn missing_exif_is_added_after_jfif_and_the_scan_is_untouched() {
        let j = jpeg(&[app0()]);
        let out = apply(&j, rotate_edit(&j, 1).unwrap());
        assert_eq!(orientation(&out).unwrap(), Some(6));
        let head = 2 + app0().len();
        assert_eq!(&out[..head], &j[..head]); // SOI + JFIF unchanged
        assert_eq!(&out[head..head + 4], &[0xFF, 0xE1, 0, 34]); // our APP1: 2 + 6 + 26 bytes
        assert_eq!(&out[scan_start(&out)..], &j[scan_start(&j)..]);
    }

    #[test]
    fn a_jpeg_without_jfif_gets_exif_right_after_soi() {
        let j = jpeg(&[]);
        let out = apply(&j, rotate_edit(&j, -1).unwrap());
        assert_eq!(&out[2..4], &[0xFF, 0xE1]);
        assert_eq!(orientation(&out).unwrap(), Some(8));
    }

    #[test]
    fn exif_without_the_tag_gets_it_and_keeps_every_other_offset() {
        for order in [Order::Little, Order::Big] {
            // IFD0 (8..26): Make → "Canon\0" at 44, after IFD1 (26..44)
            let make = (0x010F, 2, 6, order.bytes32(44));
            let j = jpeg(&[app0(), exif(order, &[make], true, b"Canon\0")]);
            let out = apply(&j, rotate_edit(&j, 1).unwrap());
            assert_eq!(orientation(&out).unwrap(), Some(6), "{order:?}");
            let e = parse(&out).unwrap().exif.unwrap();
            let tiff = &out[e.tiff_start..e.seg_end];
            assert_eq!(e.count, 2);
            assert_eq!(e.ifd0 % 2, 0);
            assert_eq!(order.u16(tiff, e.ifd0 + 2), Some(0x010F)); // sorted: Make before Orientation
            assert_eq!(&tiff[44..50], b"Canon\0");
            let ifd1 = order.u32(tiff, e.ifd0 + 2 + 24).unwrap() as usize;
            assert_eq!(order.u16(tiff, ifd1 + 2), Some(0x0103)); // still leads to the thumbnail IFD
            assert_eq!(&out[scan_start(&out)..], &j[scan_start(&j)..]);
        }
    }

    #[test]
    fn the_exif_app1_is_found_after_an_xmp_app1() {
        let xmp = segment(0xE1, b"http://ns.adobe.com/xap/1.0/\0<x:xmpmeta/>");
        let j = jpeg(&[xmp.clone(), exif(Order::Little, &[orient_entry(Order::Little, 3)], false, &[])]);
        assert_eq!(orientation(&j).unwrap(), Some(3));
        let out = apply(&j, rotate_edit(&j, 1).unwrap());
        assert_eq!(orientation(&out).unwrap(), Some(8));
        assert_eq!(&out[2..2 + xmp.len()], &xmp[..]); // XMP untouched
    }

    #[test]
    fn broken_exif_is_an_error_not_a_guess() {
        let mut bad = exif(Order::Little, &[orient_entry(Order::Little, 1)], false, &[]);
        bad[14..18].copy_from_slice(&5000u32.to_le_bytes()); // IFD0 offset far past the block
        assert_eq!(rotate_edit(&jpeg(&[bad]), 1), Err(CORRUPT.to_string()));
        assert_eq!(rotate_edit(b"not a jpeg", 1), Err(CORRUPT.to_string()));
    }

    #[test]
    fn a_wrongly_typed_orientation_tag_is_corrupt() {
        let j = jpeg(&[exif(Order::Little, &[(ORIENTATION, 4, 1, [1, 0, 0, 0])], false, &[])]);
        assert_eq!(rotate_edit(&j, 1), Err(CORRUPT.to_string()));
    }
}
```

В `src-tauri/src/main.rs` после строки `use tauri::{AppHandle, Manager, State, WebviewWindow, WindowEvent};` добавить:

```rust

mod exif;
```

- [ ] **Step 2: Запустить тесты — должны упасть**

Run: `cargo test --manifest-path src-tauri/Cargo.toml exif`
Expected: FAIL — паника `not yet implemented` в каждом тесте модуля `exif` (компилятор может предупредить о неиспользуемом коде — это нормально до Task 3).

- [ ] **Step 3: Реализовать функции**

Заменить тела `todo!()`:

```rust
pub fn rotate(orientation: u16, quarter_turns: i32) -> u16 {
    let mut o = if (1..=8).contains(&orientation) { orientation } else { 1 };
    for _ in 0..quarter_turns.rem_euclid(4) {
        o = match o {
            1 => 6,
            6 => 3,
            3 => 8,
            8 => 1,
            2 => 7,
            7 => 4,
            4 => 5,
            _ => 2, // 5
        };
    }
    o
}
```

```rust
fn parse(jpeg: &[u8]) -> Result<Jpeg, String> {
    if jpeg.get(..2) != Some(&[0xFF, 0xD8][..]) {
        return Err(CORRUPT.into());
    }
    let mut pos = 2;
    let mut insert_at = 2;
    let mut exif = None;
    loop {
        if jpeg.get(pos) != Some(&0xFF) {
            return Err(CORRUPT.into());
        }
        let marker = *jpeg.get(pos + 1).ok_or(CORRUPT)?;
        match marker {
            0xFF => {
                pos += 1; // fill byte
                continue;
            }
            0xDA | 0xD9 => break, // start of scan / end of image: no more metadata
            0x01 | 0xD0..=0xD7 => {
                pos += 2; // markers without a length
                continue;
            }
            _ => {}
        }
        let len = be16(jpeg, pos + 2).ok_or(CORRUPT)?;
        let end = pos + 2 + len;
        if len < 2 || end > jpeg.len() {
            return Err(CORRUPT.into());
        }
        if marker == 0xE0 && pos == insert_at {
            insert_at = end;
        }
        if marker == 0xE1 && exif.is_none() && jpeg[pos + 4..end].starts_with(b"Exif\0\0") {
            exif = Some(parse_exif(jpeg, pos, end)?);
        }
        pos = end;
    }
    Ok(Jpeg { insert_at, exif })
}

fn parse_exif(jpeg: &[u8], seg_start: usize, seg_end: usize) -> Result<Exif, String> {
    let tiff_start = seg_start + 10; // FF E1, length, "Exif\0\0"
    let tiff = &jpeg[tiff_start..seg_end];
    let order = match tiff.get(..2) {
        Some([b'I', b'I']) => Order::Little,
        Some([b'M', b'M']) => Order::Big,
        _ => return Err(CORRUPT.into()),
    };
    if order.u16(tiff, 2) != Some(42) {
        return Err(CORRUPT.into());
    }
    let ifd0 = order.u32(tiff, 4).ok_or(CORRUPT)? as usize;
    let count = order.u16(tiff, ifd0).ok_or(CORRUPT)? as usize;
    // the entries and the 4-byte pointer to the next IFD must be inside the block
    if ifd0 + 2 + count * 12 + 4 > tiff.len() {
        return Err(CORRUPT.into());
    }
    let mut orientation = None;
    for i in 0..count {
        let e = ifd0 + 2 + i * 12;
        if order.u16(tiff, e) == Some(ORIENTATION) {
            if order.u16(tiff, e + 2) != Some(SHORT) || order.u32(tiff, e + 4) != Some(1) {
                return Err(CORRUPT.into());
            }
            orientation = Some((tiff_start + e + 8, order.u16(tiff, e + 8).ok_or(CORRUPT)?));
        }
    }
    Ok(Exif { seg_start, seg_end, tiff_start, order, ifd0, count, orientation })
}
```

```rust
/// A minimal EXIF block: little-endian TIFF, IFD0 with one entry, Orientation.
fn insert_app1(jpeg: &[u8], at: usize, value: u16) -> Vec<u8> {
    let o = Order::Little;
    let mut tiff = b"II\x2A\x00\x08\x00\x00\x00".to_vec(); // header, IFD0 at 8
    tiff.extend_from_slice(&o.bytes16(1));
    tiff.extend_from_slice(&entry(o, ORIENTATION, value));
    tiff.extend_from_slice(&[0, 0, 0, 0]); // no next IFD
    let seg = app1(&tiff).expect("a 26-byte block fits");
    [&jpeg[..at], &seg[..], &jpeg[at..]].concat()
}

/// EXIF without an Orientation tag. IFD0 can't grow in place without moving
/// what follows it, so a copy of IFD0 with the new entry goes to the end of
/// the block and the header points at the copy. Nothing else moves, so every
/// offset in the block (sub-IFDs, maker notes, the thumbnail) stays valid.
fn add_to_ifd0(jpeg: &[u8], exif: &Exif, value: u16) -> Result<Vec<u8>, String> {
    let o = exif.order;
    let tiff = &jpeg[exif.tiff_start..exif.seg_end];
    let first = exif.ifd0 + 2;
    let entries = &tiff[first..first + exif.count * 12];
    let next = &tiff[first + exif.count * 12..first + exif.count * 12 + 4];
    let mut out = tiff.to_vec();
    if out.len() % 2 == 1 {
        out.push(0); // IFDs start on a word boundary
    }
    let new_ifd0 = out.len() as u32;
    out.extend_from_slice(&o.bytes16(exif.count as u16 + 1));
    let new = entry(o, ORIENTATION, value);
    let mut placed = false;
    for e in entries.chunks(12) {
        if !placed && o.u16(e, 0).unwrap_or(0) > ORIENTATION {
            out.extend_from_slice(&new);
            placed = true;
        }
        out.extend_from_slice(e);
    }
    if !placed {
        out.extend_from_slice(&new);
    }
    out.extend_from_slice(next);
    out[4..8].copy_from_slice(&o.bytes32(new_ifd0));
    let seg = app1(&out)?;
    Ok([&jpeg[..exif.seg_start], &seg[..], &jpeg[exif.seg_end..]].concat())
}
```

- [ ] **Step 4: Запустить тесты — должны пройти**

Run: `cargo test --manifest-path src-tauri/Cargo.toml exif`
Expected: PASS, 10 тестов.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/exif.rs src-tauri/src/main.rs
git commit -m "feat: read and rewrite the JPEG EXIF Orientation tag

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Поворот PNG без потерь (Rust)

**Files:**
- Create: `src-tauri/src/png_rotate.rs`
- Modify: `src-tauri/Cargo.toml`, `src-tauri/src/main.rs` (`mod png_rotate;`)

**Interfaces:**
- Produces: `png_rotate::rotate_png(bytes: &[u8], quarter_turns: i32) -> Result<Vec<u8>, String>`; константы `png_rotate::ANIMATED`, `png_rotate::CORRUPT`.

- [ ] **Step 1: Зависимости**

В `src-tauri/Cargo.toml` в `[dependencies]` (после `tauri-plugin-single-instance = "2"`):

```toml
png = "0.17"
crc32fast = "1"
```

и в конец файла перед `[profile.release]`:

```toml
[dev-dependencies]
miniz_oxide = "0.8"
```

- [ ] **Step 2: Написать модуль с тестами (`rotate_png`, `turn` — `todo!()`)**

Создать `src-tauri/src/png_rotate.rs`:

```rust
//! Lossless quarter turns for PNG. Browsers ignore EXIF orientation in PNG,
//! so the pixels themselves are turned. Only IHDR, pHYs and the image data
//! change; every other chunk (palette, transparency, colour profile, text,
//! unknown ones) is copied byte for byte.

const SIGNATURE: &[u8; 8] = b"\x89PNG\r\n\x1a\n";
pub const ANIMATED: &str = "animated PNG";
pub const CORRUPT: &str = "corrupt PNG";

/// One chunk: its type, its data, and the whole stored run (length, type,
/// data, CRC) for copying as is.
struct Chunk<'a> {
    kind: [u8; 4],
    data: &'a [u8],
    raw: &'a [u8],
}

fn chunks(bytes: &[u8]) -> Result<Vec<Chunk<'_>>, String> {
    if bytes.get(..8) != Some(&SIGNATURE[..]) {
        return Err(CORRUPT.into());
    }
    let mut out = Vec::new();
    let mut pos = 8;
    while pos < bytes.len() {
        let len = bytes.get(pos..pos + 4).ok_or(CORRUPT)?;
        let len = u32::from_be_bytes([len[0], len[1], len[2], len[3]]) as usize;
        let end = pos + 12 + len;
        if end > bytes.len() {
            return Err(CORRUPT.into());
        }
        let kind = [bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]];
        out.push(Chunk { kind, data: &bytes[pos + 8..pos + 8 + len], raw: &bytes[pos..end] });
        pos = end;
        if &kind == b"IEND" {
            break;
        }
    }
    Ok(out)
}

fn chunk(kind: &[u8; 4], data: &[u8]) -> Vec<u8> {
    let mut c = Vec::with_capacity(data.len() + 12);
    c.extend_from_slice(&(data.len() as u32).to_be_bytes());
    c.extend_from_slice(kind);
    c.extend_from_slice(data);
    let mut crc = crc32fast::Hasher::new();
    crc.update(kind);
    crc.update(data);
    c.extend_from_slice(&crc.finalize().to_be_bytes());
    c
}

struct Image {
    width: u32,
    height: u32,
    color: png::ColorType,
    depth: png::BitDepth,
    palette: Option<Vec<u8>>,
}

/// Raw rows exactly as stored (palette indices, 1…16 bits, big-endian
/// samples), deinterlaced.
fn decode(bytes: &[u8]) -> Result<(Vec<u8>, Image), String> {
    let mut decoder = png::Decoder::new(bytes);
    decoder.set_transformations(png::Transformations::IDENTITY);
    let mut reader = decoder.read_info().map_err(|e| e.to_string())?;
    let mut buf = vec![0; reader.output_buffer_size()];
    let frame = reader.next_frame(&mut buf).map_err(|e| e.to_string())?;
    buf.truncate(frame.buffer_size());
    let palette = reader.info().palette.as_ref().map(|p| p.to_vec());
    Ok((buf, Image { width: frame.width, height: frame.height, color: frame.color_type, depth: frame.bit_depth, palette }))
}

/// Compresses turned rows; only the IDAT chunks are kept, the rest of the
/// file comes from the original.
fn encode(pixels: &[u8], width: u32, height: u32, img: &Image) -> Result<Vec<u8>, String> {
    let mut file = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut file, width, height);
        enc.set_color(img.color);
        enc.set_depth(img.depth);
        if let Some(p) = &img.palette {
            enc.set_palette(p.clone());
        }
        enc.set_adaptive_filter(png::AdaptiveFilterType::Adaptive);
        let mut writer = enc.write_header().map_err(|e| e.to_string())?;
        writer.write_image_data(pixels).map_err(|e| e.to_string())?;
        writer.finish().map_err(|e| e.to_string())?;
    }
    Ok(chunks(&file)?.iter().filter(|c| &c.kind == b"IDAT").flat_map(|c| c.raw.to_vec()).collect())
}

/// Turns packed rows (each row padded to whole bytes, as PNG stores them)
/// `q` quarter turns clockwise. Returns the rows and the new size.
fn turn(src: &[u8], w: usize, h: usize, bits: usize, q: u32) -> (Vec<u8>, usize, usize) {
    todo!()
}

pub fn rotate_png(bytes: &[u8], quarter_turns: i32) -> Result<Vec<u8>, String> {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;
    use png::{BitDepth, ColorType};

    /// A PNG from packed rows; `extra` chunks go between IHDR/PLTE and IDAT.
    fn make(w: u32, h: u32, color: ColorType, depth: BitDepth, data: &[u8], palette: Option<&[u8]>, extra: &[(&[u8; 4], &[u8])]) -> Vec<u8> {
        let mut file = Vec::new();
        {
            let mut enc = png::Encoder::new(&mut file, w, h);
            enc.set_color(color);
            enc.set_depth(depth);
            if let Some(p) = palette {
                enc.set_palette(p.to_vec());
            }
            let mut wr = enc.write_header().unwrap();
            for (kind, body) in extra {
                wr.write_chunk(png::chunk::ChunkType(**kind), body).unwrap();
            }
            wr.write_image_data(data).unwrap();
            wr.finish().unwrap();
        }
        file
    }

    fn pack(w: usize, h: usize, bits: usize, f: impl Fn(usize, usize) -> Vec<u8>) -> Vec<u8> {
        let row = (w * bits + 7) / 8;
        let mut buf = vec![0u8; row * h];
        for y in 0..h {
            for x in 0..w {
                let v = f(x, y);
                if bits >= 8 {
                    buf[y * row + x * bits / 8..][..bits / 8].copy_from_slice(&v);
                } else {
                    buf[y * row + x * bits / 8] |= v[0] << (8 - bits - x * bits % 8);
                }
            }
        }
        buf
    }

    fn pixel(buf: &[u8], w: usize, bits: usize, x: usize, y: usize) -> Vec<u8> {
        let row = (w * bits + 7) / 8;
        if bits >= 8 {
            buf[y * row + x * bits / 8..][..bits / 8].to_vec()
        } else {
            vec![(buf[y * row + x * bits / 8] >> (8 - bits - x * bits % 8)) & ((1u8 << bits) - 1)]
        }
    }

    /// Each pixel of `after` must be the source pixel a turn of `q` puts there.
    fn assert_turned(before: &[u8], after: &[u8], q: i32) {
        let (a, ai) = decode(before).unwrap();
        let (b, bi) = decode(after).unwrap();
        let (w, h) = (ai.width as usize, ai.height as usize);
        let bits = ai.color.samples() * ai.depth as usize;
        assert_eq!((bi.color, bi.depth), (ai.color, ai.depth));
        let q = q.rem_euclid(4) as u32;
        let (nw, nh) = if q % 2 == 1 { (h, w) } else { (w, h) };
        assert_eq!((bi.width as usize, bi.height as usize), (nw, nh));
        for ny in 0..nh {
            for nx in 0..nw {
                let (x, y) = match q {
                    1 => (ny, h - 1 - nx),
                    2 => (w - 1 - nx, h - 1 - ny),
                    _ => (w - 1 - ny, nx),
                };
                assert_eq!(pixel(&b, nw, bits, nx, ny), pixel(&a, w, bits, x, y), "({nx},{ny}) after {q} turns of {:?}", ai.color);
            }
        }
    }

    #[test]
    fn clockwise_moves_the_bottom_left_corner_to_the_top_left() {
        let colors = |x: usize, y: usize| match (x, y) {
            (0, 0) => vec![255, 0, 0, 255],
            (2, 0) => vec![0, 255, 0, 255],
            (0, 1) => vec![0, 0, 255, 255],
            (2, 1) => vec![255, 255, 0, 255],
            _ => vec![9, 9, 9, 255],
        };
        let src = make(3, 2, ColorType::Rgba, BitDepth::Eight, &pack(3, 2, 32, colors), None, &[]);
        let (out, info) = decode(&rotate_png(&src, 1).unwrap()).unwrap();
        assert_eq!((info.width, info.height), (2, 3));
        assert_eq!(pixel(&out, 2, 32, 0, 0), [0, 0, 255, 255]); // was bottom-left
        assert_eq!(pixel(&out, 2, 32, 1, 0), [255, 0, 0, 255]); // was top-left
        assert_eq!(pixel(&out, 2, 32, 1, 2), [0, 255, 0, 255]); // was top-right
        assert_eq!(pixel(&out, 2, 32, 0, 2), [255, 255, 0, 255]); // was bottom-right
    }

    #[test]
    fn every_pixel_format_turns_both_ways() {
        let palette: Vec<u8> = (0..48).collect();
        let cases = [
            (ColorType::Rgba, BitDepth::Eight, 3, 2, None),
            (ColorType::Rgb, BitDepth::Sixteen, 3, 2, None),
            (ColorType::Grayscale, BitDepth::One, 5, 3, None), // 5 px: rows end mid-byte
            (ColorType::Indexed, BitDepth::Four, 3, 3, Some(&palette[..])),
            (ColorType::GrayscaleAlpha, BitDepth::Eight, 2, 3, None),
        ];
        for (color, depth, w, h, pal) in cases {
            let bits = color.samples() * depth as usize;
            let data = pack(w, h, bits, |x, y| {
                if bits >= 8 {
                    (0..bits / 8).map(|i| (x * 31 + y * 7 + i * 3) as u8).collect()
                } else {
                    vec![((x + 3 * y + x * y) % (1 << bits)) as u8]
                }
            });
            let extra: Vec<(&[u8; 4], &[u8])> = if pal.is_some() { vec![(b"tRNS", &[0, 128])] } else { vec![] };
            let src = make(w as u32, h as u32, color, depth, &data, pal, &extra);
            for q in [1, -1, 2] {
                assert_turned(&src, &rotate_png(&src, q).unwrap(), q);
            }
        }
    }

    #[test]
    fn four_turns_give_back_the_same_pixels() {
        let src = make(3, 2, ColorType::Rgb, BitDepth::Eight, &pack(3, 2, 24, |x, y| vec![x as u8, y as u8, 7]), None, &[]);
        let mut cur = src.clone();
        for _ in 0..4 {
            cur = rotate_png(&cur, 1).unwrap();
        }
        assert_eq!(decode(&cur).unwrap().0, decode(&src).unwrap().0);
    }

    #[test]
    fn other_chunks_are_copied_byte_for_byte_and_phys_swaps_axes() {
        let mut phys = 100u32.to_be_bytes().to_vec();
        phys.extend_from_slice(&200u32.to_be_bytes());
        phys.push(1);
        let extra: [(&[u8; 4], &[u8]); 4] = [(b"sRGB", &[0]), (b"tEXt", b"Comment\0hello"), (b"teSt", b"private"), (b"pHYs", &phys)];
        let src = make(3, 2, ColorType::Rgb, BitDepth::Eight, &[0; 18], None, &extra);
        let out = rotate_png(&src, 1).unwrap();
        let raw = |bytes: &[u8], kind: &[u8; 4]| chunks(bytes).unwrap().into_iter().find(|c| &c.kind == kind).map(|c| c.raw.to_vec());
        for kind in [b"sRGB", b"tEXt", b"teSt"] {
            assert_eq!(raw(&out, kind), raw(&src, kind), "{}", String::from_utf8_lossy(kind));
        }
        let p = chunks(&out).unwrap().into_iter().find(|c| &c.kind == b"pHYs").unwrap().data.to_vec();
        assert_eq!(&p[..4], &200u32.to_be_bytes());
        assert_eq!(&p[4..8], &100u32.to_be_bytes());
    }

    #[test]
    fn interlaced_png_is_turned_and_written_plain() {
        // 2×2 grey, Adam7: pass 1 holds (0,0), pass 6 holds (1,0), pass 7 the bottom row
        let raw = [0, 10, 0, 20, 0, 30, 40];
        let idat = miniz_oxide::deflate::compress_to_vec_zlib(&raw, 6);
        let mut ihdr = 2u32.to_be_bytes().to_vec();
        ihdr.extend_from_slice(&2u32.to_be_bytes());
        ihdr.extend_from_slice(&[8, 0, 0, 0, 1]); // 8-bit grey, interlaced
        let src = [SIGNATURE.to_vec(), chunk(b"IHDR", &ihdr), chunk(b"IDAT", &idat), chunk(b"IEND", &[])].concat();
        assert_eq!(decode(&src).unwrap().0, [10, 20, 30, 40]);
        let out = rotate_png(&src, 1).unwrap();
        assert_eq!(chunks(&out).unwrap()[0].data[12], 0);
        assert_eq!(decode(&out).unwrap().0, [30, 10, 40, 20]);
    }

    #[test]
    fn animated_png_is_refused_and_bad_bytes_are_corrupt() {
        let src = make(1, 1, ColorType::Rgb, BitDepth::Eight, &[1, 2, 3], None, &[(b"acTL", &[0, 0, 0, 1, 0, 0, 0, 0])]);
        assert_eq!(rotate_png(&src, 1), Err(ANIMATED.to_string()));
        assert_eq!(rotate_png(b"not a png", 1), Err(CORRUPT.to_string()));
    }

    #[test]
    fn zero_turns_return_the_file_unchanged() {
        let src = make(3, 2, ColorType::Rgb, BitDepth::Eight, &[5; 18], None, &[]);
        assert_eq!(rotate_png(&src, 4).unwrap(), src);
    }
}
```

В `main.rs` после `mod exif;` добавить `mod png_rotate;`.

- [ ] **Step 3: Запустить — должны упасть**

Run: `cargo test --manifest-path src-tauri/Cargo.toml png_rotate`
Expected: FAIL (`not yet implemented`) во всех тестах, кроме зависящих только от `chunks`/`decode`.

- [ ] **Step 4: Реализовать `turn` и `rotate_png`**

```rust
fn turn(src: &[u8], w: usize, h: usize, bits: usize, q: u32) -> (Vec<u8>, usize, usize) {
    let (nw, nh) = if q % 2 == 1 { (h, w) } else { (w, h) };
    let src_row = (w * bits + 7) / 8;
    let dst_row = (nw * bits + 7) / 8;
    let mut dst = vec![0u8; dst_row * nh];
    for ny in 0..nh {
        for nx in 0..nw {
            // the source pixel that lands on (nx, ny)
            let (x, y) = match q {
                1 => (ny, h - 1 - nx),
                2 => (w - 1 - nx, h - 1 - ny),
                _ => (w - 1 - ny, nx),
            };
            if bits >= 8 {
                let n = bits / 8;
                let s = y * src_row + x * n;
                let d = ny * dst_row + nx * n;
                dst[d..d + n].copy_from_slice(&src[s..s + n]);
            } else {
                let mask = (1u8 << bits) - 1;
                let v = (src[y * src_row + x * bits / 8] >> (8 - bits - x * bits % 8)) & mask;
                dst[ny * dst_row + nx * bits / 8] |= v << (8 - bits - nx * bits % 8);
            }
        }
    }
    (dst, nw, nh)
}

pub fn rotate_png(bytes: &[u8], quarter_turns: i32) -> Result<Vec<u8>, String> {
    let q = quarter_turns.rem_euclid(4) as u32;
    let parts = chunks(bytes)?;
    if parts.iter().any(|c| &c.kind == b"acTL") {
        return Err(ANIMATED.into());
    }
    if q == 0 {
        return Ok(bytes.to_vec());
    }
    let (pixels, img) = decode(bytes)?;
    let bits = img.color.samples() * img.depth as usize;
    let (turned, nw, nh) = turn(&pixels, img.width as usize, img.height as usize, bits, q);
    let idat = encode(&turned, nw as u32, nh as u32, &img)?;

    let mut out = SIGNATURE.to_vec();
    let mut idat_written = false;
    for c in &parts {
        match &c.kind {
            b"IHDR" => {
                if c.data.len() != 13 {
                    return Err(CORRUPT.into());
                }
                let mut d = c.data.to_vec();
                d[0..4].copy_from_slice(&(nw as u32).to_be_bytes());
                d[4..8].copy_from_slice(&(nh as u32).to_be_bytes());
                d[12] = 0; // the new data is written without interlacing
                out.extend_from_slice(&chunk(b"IHDR", &d));
            }
            b"pHYs" if q % 2 == 1 && c.data.len() == 9 => {
                let mut d = c.data.to_vec();
                d[..8].rotate_left(4); // pixels per unit: x and y swap
                out.extend_from_slice(&chunk(b"pHYs", &d));
            }
            b"IDAT" => {
                if !idat_written {
                    out.extend_from_slice(&idat);
                    idat_written = true;
                }
            }
            _ => out.extend_from_slice(c.raw),
        }
    }
    Ok(out)
}
```

- [ ] **Step 5: Запустить — должны пройти**

Run: `cargo test --manifest-path src-tauri/Cargo.toml png_rotate`
Expected: PASS, 7 тестов. Если `png 0.17` назовёт метод иначе (`set_adaptive_filter`, `output_buffer_size`, `buffer_size`), свериться с docs.rs/png/0.17 и поправить имя, не логику.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/png_rotate.rs src-tauri/src/main.rs
git commit -m "feat: turn PNG pixels losslessly, keeping every other chunk

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Запись поворота в файл и команда `rotate_image` (Rust)

**Files:**
- Create: `src-tauri/src/rotate.rs`
- Modify: `src-tauri/src/main.rs:76-80` (`read_image`), `:181-185` (`write_file_bytes`), `:441-447` (`generate_handler!`), `src-tauri/Cargo.toml` (фичи `windows`)

**Interfaces:**
- Consumes: `exif::rotate_edit`, `exif::Edit`, `png_rotate::rotate_png`, `crate::mime_for`, `crate::read_image`.
- Produces: команда `rotate_image(path: String, quarter_turns: i32) -> Result<(), String>`; `rotate::lock() -> MutexGuard<'static, ()>`; `rotate::rotate_file(path: &Path, quarter_turns: i32) -> Result<(), String>`; коды `rotate::READ_ONLY`, `rotate::ACCESS_DENIED`, `rotate::UNSUPPORTED`.

- [ ] **Step 1: Фичи `windows`**

В `src-tauri/Cargo.toml` строку `windows = …` заменить на:

```toml
windows = { version = "0.61", features = ["Win32_Foundation", "Win32_Storage_FileSystem", "Win32_System_Com", "Win32_UI_Shell", "Win32_UI_Shell_Common"] }
```

- [ ] **Step 2: Модуль с тестами (`rotate_file` — `todo!()`)**

Создать `src-tauri/src/rotate.rs`:

```rust
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
    todo!()
}

fn write_at(path: &Path, offset: usize, bytes: &[u8]) -> Result<(), String> {
    let mut f = OpenOptions::new().write(true).open(path).map_err(io_err)?;
    f.seek(SeekFrom::Start(offset as u64)).map_err(io_err)?;
    f.write_all(bytes).map_err(io_err)
}

/// Writes the new bytes next to the file, then swaps them in, so the file is
/// never half-written.
fn replace(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = temp_path(path);
    let result = fs::write(&tmp, bytes).map_err(io_err).and_then(|_| swap_in(&tmp, path));
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

fn temp_path(path: &Path) -> PathBuf {
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    path.with_file_name(format!(".{name}.pcc-tmp"))
}

/// ReplaceFileW keeps the original's creation date, attributes, ACL and
/// alternate streams (Zone.Identifier); a plain rename would not.
#[cfg(windows)]
fn swap_in(tmp: &Path, path: &Path) -> Result<(), String> {
    use windows::core::{HSTRING, PCWSTR};
    use windows::Win32::Foundation::E_ACCESSDENIED;
    use windows::Win32::Storage::FileSystem::{ReplaceFileW, REPLACE_FILE_FLAGS};

    unsafe {
        ReplaceFileW(
            &HSTRING::from(path.as_os_str()),
            &HSTRING::from(tmp.as_os_str()),
            PCWSTR::null(),
            REPLACE_FILE_FLAGS(0),
            None,
            None,
        )
    }
    .map_err(|e| if e.code() == E_ACCESSDENIED { ACCESS_DENIED.into() } else { e.message().to_string() })
}

#[cfg(not(windows))]
fn swap_in(tmp: &Path, path: &Path) -> Result<(), String> {
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
}
```

В `main.rs` после `mod png_rotate;` добавить `mod rotate;`.

- [ ] **Step 3: Запустить — должны упасть**

Run: `cargo test --manifest-path src-tauri/Cargo.toml rotate::`
Expected: FAIL: `not yet implemented` и `reads_wait_for_a_turn_in_progress` («read_image must wait for the file lock»).

- [ ] **Step 4: Реализовать `rotate_file`, блокировку чтения и команду**

В `rotate.rs`:

```rust
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
```

В `main.rs` заменить `read_image` и `write_file_bytes`:

```rust
fn read_image(path: &str) -> Result<Vec<u8>, String> {
    let p = Path::new(path);
    mime_for(p).ok_or_else(|| "unsupported file type".to_string())?;
    let _guard = rotate::lock(); // a turn being saved finishes first
    fs::read(p).map_err(|e| e.to_string())
}
```

```rust
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
```

В `generate_handler!` добавить `rotate_image` последним элементом (после `write_file_bytes,`). Обновить первый комментарий файла (строки 3-5): «…list its siblings for Prev/Next, write the exported image, and save a quarter turn into the original (rotate.rs).»

- [ ] **Step 5: Запустить все Rust-тесты**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS — все старые тесты и 7 новых в `rotate::tests`. Если `ReplaceFileW` в `windows 0.61` имеет другие типы параметров, свериться с docs.rs/windows/0.61 (`Win32::Storage::FileSystem::ReplaceFileW`) и поправить вызов.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/rotate.rs src-tauri/src/main.rs
git commit -m "feat: rotate_image saves a quarter turn into the file under a file lock

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Геометрия поворота и наклона (`geometry.js`)

**Files:**
- Create: `frontend/geometry.js`, `tests/e2e/geometry.spec.mjs`

**Interfaces:**
- Produces: `window.PccGeometry` / `module.exports` с функциями (все прямоугольники в px stage; `rect = {cx, cy, w, h, deg}` — картинка w×h с центром (cx, cy), повёрнутая на `deg` по часовой; `box = {x, y, w, h}`):
  - `cosSin(deg) -> {c, s}` — точные значения для кратных 90°
  - `orientedSize(w, h, quarterTurns) -> {w, h}`
  - `boundingSize(w, h, deg) -> {w, h}`
  - `isBoxInside(box, rect) -> boolean`
  - `clampBoxCenter(box, rect) -> box`
  - `maxBoxSize(aspect, rect) -> {w, h}`
  - `maxWidthFromAnchor(ax, ay, growX, growY, aspect, rect) -> number`
  - `fitInside(box, rect) -> box` — уменьшить (сохранив центр), если не помещается, затем `clampBoxCenter`

- [ ] **Step 1: Тест**

Создать `tests/e2e/geometry.spec.mjs`:

```js
// Pure geometry behind rotation and tilt (frontend/geometry.js), run in Node.
import { test, expect } from "@playwright/test";
import { createRequire } from "node:module";

const G = createRequire(import.meta.url)("../../frontend/geometry.js");

// Small seeded PRNG (mulberry32) so failures reproduce.
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rect = (deg) => ({ cx: 300, cy: 250, w: 400, h: 300, deg });

test("quarter turns are exact", () => {
  expect(G.cosSin(90)).toEqual({ c: 0, s: 1 });
  expect(G.cosSin(-90)).toEqual({ c: 0, s: -1 });
  expect(G.orientedSize(400, 300, 1)).toEqual({ w: 300, h: 400 });
  expect(G.orientedSize(400, 300, 2)).toEqual({ w: 400, h: 300 });
  expect(G.boundingSize(400, 300, 90)).toEqual({ w: 300, h: 400 });
  const b = G.boundingSize(100, 100, 45);
  expect(b.w).toBeCloseTo(141.421, 2);
  expect(b.h).toBeCloseTo(141.421, 2);
});

test("at 0° the frame is clamped to the image edges exactly as before", () => {
  const r = { cx: 200, cy: 150, w: 400, h: 300, deg: 0 };
  expect(G.clampBoxCenter({ x: -50, y: 280, w: 100, h: 50 }, r)).toEqual({ x: 0, y: 250, w: 100, h: 50 });
  expect(G.maxBoxSize(16 / 9, r)).toEqual({ w: 400, h: 225 });
  expect(G.maxWidthFromAnchor(100, 100, 1, 1, 1, r)).toBeCloseTo(200, 6); // right edge at 400, bottom at 300
});

for (const deg of [10, 30, 45, -20]) {
  test(`at ${deg}° clamped frames are always inside and inside frames stay put`, () => {
    const r = rect(deg), next = rng(deg + 100);
    for (let i = 0; i < 1000; i++) {
      const aspect = 0.3 + next() * 3;
      const max = G.maxBoxSize(aspect, r);
      const k = 0.05 + next() * 0.95;
      const box = { x: next() * 800 - 200, y: next() * 700 - 200, w: max.w * k, h: max.h * k };
      const c = G.clampBoxCenter(box, r);
      expect(G.isBoxInside(c, r)).toBe(true);
      const again = G.clampBoxCenter(c, r);
      expect(again.x).toBeCloseTo(c.x, 9);
      expect(again.y).toBeCloseTo(c.y, 9);
    }
  });
}

test("maxBoxSize is the largest frame that fits", () => {
  for (const deg of [0, 10, 45]) {
    const r = rect(deg), m = G.maxBoxSize(16 / 9, r);
    const centred = (k) => ({ x: r.cx - (m.w * k) / 2, y: r.cy - (m.h * k) / 2, w: m.w * k, h: m.h * k });
    expect(G.isBoxInside(centred(1), r)).toBe(true);
    expect(G.isBoxInside(centred(1.01), r)).toBe(false);
  }
});

test("maxWidthFromAnchor stops at the tilted edge for every corner", () => {
  const r = rect(20);
  for (const [gx, gy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const w = G.maxWidthFromAnchor(r.cx, r.cy, gx, gy, 1.5, r);
    const box = (w) => ({ x: gx > 0 ? r.cx : r.cx - w, y: gy > 0 ? r.cy : r.cy - w / 1.5, w, h: w / 1.5 });
    expect(w).toBeGreaterThan(10);
    expect(G.isBoxInside(box(w), r)).toBe(true);
    expect(G.isBoxInside(box(w + 0.5), r)).toBe(false);
  }
  expect(G.maxWidthFromAnchor(0, 0, 1, 1, 1, r)).toBe(0); // anchor outside the image
});

test("fitInside shrinks an oversized frame around its centre, then clamps it", () => {
  const r = rect(30);
  const out = G.fitInside({ x: 0, y: 0, w: 800, h: 450 }, r);
  expect(G.isBoxInside(out, r)).toBe(true);
  expect(out.w / out.h).toBeCloseTo(800 / 450, 9);
  expect(out.w).toBeCloseTo(G.maxBoxSize(800 / 450, r).w, 6);
});
```

- [ ] **Step 2: Запустить — должен упасть**

Run: `npx playwright test geometry`
Expected: FAIL — `Cannot find module '../../frontend/geometry.js'`.

- [ ] **Step 3: Реализация**

Создать `frontend/geometry.js`:

```js
// Геометрия поворота и наклона: чистые функции без DOM. Страница берёт их из
// window.PccGeometry, тесты — через require (module.exports).
// Все прямоугольники — в px #stage. Картинка: rect = {cx, cy, w, h, deg} —
// прямоугольник w×h с центром (cx, cy), повёрнутый на deg по часовой.
// Рамка: box = {x, y, w, h}, всегда без поворота.
(function(root){
  "use strict";

  var EPS = 1e-6;

  function clampNum(v, min, max){ return Math.min(Math.max(v, min), max); }

  // Для кратных 90° — точные значения: иначе cos(90°) = 6e-17, и поворот на
  // четверть при экспорте размывал бы пиксели.
  function cosSin(deg){
    var d = ((deg % 360) + 360) % 360;
    if (d === 0) return { c: 1, s: 0 };
    if (d === 90) return { c: 0, s: 1 };
    if (d === 180) return { c: -1, s: 0 };
    if (d === 270) return { c: 0, s: -1 };
    var r = deg * Math.PI / 180;
    return { c: Math.cos(r), s: Math.sin(r) };
  }

  function orientedSize(w, h, quarterTurns){
    return Math.abs(quarterTurns) % 2 ? { w: h, h: w } : { w: w, h: h };
  }

  function boundingSize(w, h, deg){
    var t = cosSin(deg), c = Math.abs(t.c), s = Math.abs(t.s);
    return { w: w * c + h * s, h: w * s + h * c };
  }

  // Точка экрана → смещения вдоль собственных осей картинки от её центра.
  function toImage(px, py, rect){
    var t = cosSin(rect.deg), dx = px - rect.cx, dy = py - rect.cy;
    return { u: dx * t.c + dy * t.s, v: -dx * t.s + dy * t.c };
  }

  function isBoxInside(box, rect){
    var xs = [box.x, box.x + box.w], ys = [box.y, box.y + box.h];
    for (var i = 0; i < 2; i++){
      for (var j = 0; j < 2; j++){
        var p = toImage(xs[i], ys[j], rect);
        if (Math.abs(p.u) > rect.w / 2 + EPS || Math.abs(p.v) > rect.h / 2 + EPS) return false;
      }
    }
    return true;
  }

  // Ближайшее положение рамки того же размера, при котором она вся на картинке.
  // Допустимые центры — тот же наклонённый прямоугольник, уменьшенный на
  // полуразмах рамки вдоль осей картинки, поэтому зажимаем центр по каждой оси
  // в системе координат картинки. Рамку, которая не помещается вовсе, сначала
  // уменьшает fitInside.
  function clampBoxCenter(box, rect){
    var t = cosSin(rect.deg), c = Math.abs(t.c), s = Math.abs(t.s);
    var mu = Math.max(0, rect.w / 2 - (box.w * c + box.h * s) / 2);
    var mv = Math.max(0, rect.h / 2 - (box.w * s + box.h * c) / 2);
    var p = toImage(box.x + box.w / 2, box.y + box.h / 2, rect);
    var u = clampNum(p.u, -mu, mu), v = clampNum(p.v, -mv, mv);
    var cx = rect.cx + u * t.c - v * t.s, cy = rect.cy + u * t.s + v * t.c;
    return { x: cx - box.w / 2, y: cy - box.h / 2, w: box.w, h: box.h };
  }

  // Наибольшая рамка с соотношением aspect (w/h), которая помещается в картинку.
  function maxBoxSize(aspect, rect){
    var t = cosSin(rect.deg), c = Math.abs(t.c), s = Math.abs(t.s);
    var h = Math.min(rect.w / (aspect * c + s), rect.h / (aspect * s + c));
    return { w: h * aspect, h: h };
  }

  // Наибольшая ширина рамки, растягиваемой из неподвижного угла (ax, ay) в
  // сторону growX/growY (±1). Бинарный поиск: при наклоне край картинки не
  // параллелен рамке, и формула зависит от того, какой угол упрётся первым.
  function maxWidthFromAnchor(ax, ay, growX, growY, aspect, rect){
    function boxOf(w){
      var h = w / aspect;
      return { x: growX > 0 ? ax : ax - w, y: growY > 0 ? ay : ay - h, w: w, h: h };
    }
    if (!isBoxInside(boxOf(0), rect)) return 0;
    var lo = 0, hi = rect.w + rect.h;
    for (var i = 0; i < 40; i++){
      var mid = (lo + hi) / 2;
      if (isBoxInside(boxOf(mid), rect)) lo = mid; else hi = mid;
    }
    return lo;
  }

  function fitInside(box, rect){
    var m = maxBoxSize(box.w / box.h, rect);
    if (box.w > m.w){
      var cx = box.x + box.w / 2, cy = box.y + box.h / 2;
      box = { x: cx - m.w / 2, y: cy - m.h / 2, w: m.w, h: m.h };
    }
    return clampBoxCenter(box, rect);
  }

  var api = {
    cosSin: cosSin, orientedSize: orientedSize, boundingSize: boundingSize,
    isBoxInside: isBoxInside, clampBoxCenter: clampBoxCenter, maxBoxSize: maxBoxSize,
    maxWidthFromAnchor: maxWidthFromAnchor, fitInside: fitInside
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PccGeometry = api;
})(this);
```

- [ ] **Step 4: Запустить — должен пройти**

Run: `npx playwright test geometry`
Expected: PASS, 9 тестов.

- [ ] **Step 5: Commit**

```bash
git add frontend/geometry.js tests/e2e/geometry.spec.mjs
git commit -m "feat: geometry for keeping the crop frame inside a tilted image

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Тестовая инфраструктура (мок и помощники)

**Files:**
- Modify: `tests/e2e/helpers.mjs`

**Interfaces:**
- Produces (для Task 6–11): `RED, GREEN, BLUE, YELLOW` (`[r,g,b,255]`); `QUADRANTS(w, h)`; `rotatePixels(width, height, rgba, quarterTurns) -> {width, height, rgba}`; `pixelsInPage(page, base64, mime, points)`; `exportPixels(page, points, size?)`; `expectColors(actual, expected, tolerance = 8)`; `withOrientation(jpeg: Buffer, value) -> Buffer`. Мок: команда `rotate_image` (лог `__mockLog.rotations`, опция `rotateError`, повороты в `sessionStorage`, `read_file_bytes` отдаёт повёрнутый PNG), `dialog.open` (лог `__mockLog.opens`, опция `openResult`).

- [ ] **Step 1: Помощники**

В начало `helpers.mjs` добавить импорт `expect`:

```js
import { expect } from "@playwright/test";
```

После `pngSize` добавить:

```js
export const RED = [220, 40, 40, 255];
export const GREEN = [40, 200, 60, 255];
export const BLUE = [40, 80, 220, 255];
export const YELLOW = [230, 210, 40, 255];

/** Four solid quadrants: red top-left, green top-right, blue bottom-left, yellow bottom-right. */
export const QUADRANTS = (w, h) => (x, y) =>
  y < h / 2 ? (x < w / 2 ? RED : GREEN) : x < w / 2 ? BLUE : YELLOW;

/** The same picture turned clockwise quarterTurns times: new (x, y) shows old (y, h-1-x). */
export function rotatePixels(width, height, rgba, quarterTurns) {
  let w = width, h = height;
  let at = typeof rgba === "function" ? rgba : () => rgba;
  for (let i = 0; i < ((quarterTurns % 4) + 4) % 4; i++) {
    const prev = at, ph = h;
    at = (x, y) => prev(y, ph - 1 - x);
    [w, h] = [h, w];
  }
  return { width: w, height: h, rgba: at };
}

/** RGBA at each [fx, fy] point (fractions of the size) of an encoded image. */
export async function pixelsInPage(page, base64, mime, points) {
  return page.evaluate(async ({ base64, mime, points }) => {
    const img = new Image();
    img.src = `data:${mime};base64,${base64}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    return points.map(([fx, fy]) => {
      const x = Math.min(c.width - 1, Math.floor(fx * c.width));
      const y = Math.min(c.height - 1, Math.floor(fy * c.height));
      return Array.from(ctx.getImageData(x, y, 1, 1).data);
    });
  }, { base64, mime, points });
}

/**
 * Saves the current crop as PNG (optionally setting W×H first) and returns
 * the RGBA at each point. The pill must be visible (not in focus mode).
 */
export async function exportPixels(page, points, size) {
  if (size) {
    await page.fill("#inputW", String(size.w));
    await page.fill("#inputH", String(size.h));
    await page.locator("#inputH").blur();
  }
  const n = await page.evaluate(() => window.__mockLog.writes.length);
  await page.click("#downloadBtn");
  await page.waitForFunction((n) => window.__mockLog.writes.length > n, n);
  const { dataBase64 } = await page.evaluate(() => window.__mockLog.writes.at(-1));
  return pixelsInPage(page, dataBase64, "image/png", points);
}

export function expectColors(actual, expected, tolerance = 8) {
  actual.forEach((px, i) => {
    px.forEach((v, ch) => {
      expect(Math.abs(v - expected[i][ch]), `point ${i} channel ${ch}: got ${px}, want ${expected[i]}`).toBeLessThanOrEqual(tolerance);
    });
  });
}

/**
 * Adds an EXIF block with this Orientation right after SOI and JFIF, with the
 * same byte layout as the Rust side (exif::insert_app1).
 */
export function withOrientation(jpeg, value) {
  let at = 2;
  if (jpeg[2] === 0xff && jpeg[3] === 0xe0) at = 4 + jpeg.readUInt16BE(4);
  const tiff = Buffer.from([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, value, 0, 0, 0, 0, 0, 0, 0]);
  const payload = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  const len = Buffer.alloc(2);
  len.writeUInt16BE(payload.length + 2);
  return Buffer.concat([jpeg.subarray(0, at), Buffer.from([0xff, 0xe1]), len, payload, jpeg.subarray(at)]);
}
```

- [ ] **Step 2: Мок**

В JSDoc `installTauriMock` добавить строки:

```js
 * rotateError: if set, rotate_image rejects with it
 * openResult: path the "Open" dialog returns (default null = cancelled)
 *
 * rotate_image keeps each file's turns in sessionStorage (it survives the
 * reload that closing the window does), and read_file_bytes then serves the
 * turned picture — like the real file after a saved turn.
```

Заменить построение `files`:

```js
  const files = {};
  for (const [path, f] of Object.entries(opts.files || {})) {
    // raw bytes are served as they are; generated pictures in all four turns
    const versions = f.raw
      ? [f.raw]
      : [0, 1, 2, 3].map((q) => {
          const r = rotatePixels(f.width, f.height, f.rgba, q);
          return makePng(r.width, r.height, r.rgba);
        });
    files[path] = { base64: versions.map((b) => b.toString("base64")), delayMs: f.delayMs || 0 };
  }
```

В `cfg` добавить:

```js
    rotateError: opts.rotateError ?? null,
    openResult: opts.openResult ?? null,
```

Лог: `const log = { invokes: [], resolvedReads: [], saves: [], writes: [], rotations: [], opens: [] };`

Добавить внутри init-скрипта перед `window.__TAURI__ = {`:

```js
    const turnsOf = (path) => Number(sessionStorage.getItem("__mockTurns:" + path) || 0);
```

В `read_file_bytes` заменить `const bin = atob(f.base64);` на:

```js
                const bin = atob(f.base64[turnsOf(args.path) % f.base64.length]);
```

Добавить ветку перед `default:`:

```js
            case "rotate_image": {
              log.rotations.push({ path: args.path, quarterTurns: args.quarterTurns });
              if (cfg.rotateError) return Promise.reject(cfg.rotateError);
              const t = (((turnsOf(args.path) + args.quarterTurns) % 4) + 4) % 4;
              sessionStorage.setItem("__mockTurns:" + args.path, String(t));
              return Promise.resolve(null);
            }
```

В `dialog` добавить метод:

```js
        open(options) {
          log.opens.push(options);
          return Promise.resolve(cfg.openResult);
        },
```

- [ ] **Step 3: Старые тесты не сломались**

Run: `npm test`
Expected: PASS — все существующие тесты (75 + 9 геометрии).

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/helpers.mjs
git commit -m "test: mock rotate_image and dialog.open, add pixel helpers

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Поворот на 90° на странице и автосохранение

**Files:**
- Modify: `frontend/index.html` (CSS, разметка `.tools`, справка, скрипт)
- Create: `tests/e2e/rotate.spec.mjs`
- Modify: `tests/e2e/browser.spec.mjs`

**Interfaces:**
- Consumes: `PccGeometry.*` (Task 4); мок (Task 5).
- Produces (для Task 7–11): переменные `raw`, `quarterTurns`, `viewTurns`, `tilt` (пока всегда 0), `G`; функции `imageRect()`, `resetView()`, `rotateBy(delta)`, `onceHint(key, text)`, `updateNatural()`; элементы `#rotateLeftBtn`, `#rotateRightBtn`, `.barDiv`.

- [ ] **Step 1: Тесты**

Создать `tests/e2e/rotate.spec.mjs`:

```js
// Quarter turns: shown at once, saved into the file through rotate_image, and
// nothing else from the session ever reaches the original.
import { test, expect } from "@playwright/test";
import { APP_URL, installTauriMock, waitForImage, exportPixels, expectColors, makePng, QUADRANTS, RED, GREEN, BLUE, YELLOW } from "./helpers.mjs";

const A = "C:\\pics\\a.png";
const B = "C:\\pics\\b.png";
const CORNERS = [[0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9]]; // TL, TR, BL, BR
const quad = { width: 400, height: 300, rgba: QUADRANTS(400, 300) };

async function openWith(page, opts) {
  await installTauriMock(page, opts);
  await page.goto(APP_URL);
}
const rotations = (page) => page.evaluate(() => window.__mockLog.rotations);

test("⟳ turns the view and the export, and saves exactly one turn", async ({ page }) => {
  await openWith(page, { initialFile: A, files: { [A]: quad } });
  await waitForImage(page, 400, 300);
  await page.keyboard.press("Escape");

  await page.click("#rotateRightBtn");
  await expect(page.locator("#fileSize")).toHaveText("300 × 400");
  expect(await rotations(page)).toEqual([{ path: A, quarterTurns: 1 }]);
  // clockwise: the old bottom-left (blue) is now top-left
  expectColors(await exportPixels(page, CORNERS, { w: 300, h: 400 }), [BLUE, RED, YELLOW, GREEN]);
});

test("⟲ turns the other way", async ({ page }) => {
  await openWith(page, { initialFile: A, files: { [A]: quad } });
  await waitForImage(page, 400, 300);
  await page.keyboard.press("Escape");

  await page.click("#rotateLeftBtn");
  await expect(page.locator("#fileSize")).toHaveText("300 × 400");
  expect(await rotations(page)).toEqual([{ path: A, quarterTurns: -1 }]);
  expectColors(await exportPixels(page, CORNERS, { w: 300, h: 400 }), [GREEN, YELLOW, RED, BLUE]);
});

test("R, L, Ctrl+R and the Russian К, Д rotate; Ctrl+R does not reload", async ({ page }) => {
  await openWith(page, { initialFile: A, files: { [A]: quad } });
  await waitForImage(page, 400, 300);
  await page.evaluate(() => { window.__notReloaded = true; });

  for (const key of ["r", "l", "Control+r", "к", "д"]) await page.keyboard.press(key);
  expect((await rotations(page)).map((r) => r.quarterTurns)).toEqual([1, -1, 1, 1, -1]);
  expect(await page.evaluate(() => window.__notReloaded)).toBe(true);
  await expect(page.locator("#fileSize")).toHaveText("300 × 400");
});

test("four turns bring the picture back", async ({ page }) => {
  await openWith(page, { initialFile: A, files: { [A]: quad } });
  await waitForImage(page, 400, 300);
  for (let i = 0; i < 4; i++) await page.keyboard.press("r");
  await expect(page.locator("#fileSize")).toHaveText("400 × 300");
  expect(await rotations(page)).toHaveLength(4);
});

test("only the turn reaches the file: size, frame and format stay in the app", async ({ page }) => {
  await openWith(page, { initialFile: A, files: { [A]: quad } });
  await waitForImage(page, 400, 300);
  await page.keyboard.press("Escape");
  await page.click("#rotateRightBtn");
  await page.fill("#inputW", "640");
  await page.locator("#inputW").blur();
  await page.click("#fmtBtn");
  await page.click('.fmt[data-fmt="jpeg"]');
  await page.keyboard.press("Escape");
  await page.keyboard.press("Shift+ArrowRight");

  const log = await page.evaluate(() => window.__mockLog);
  expect(log.writes).toHaveLength(0);
  const sent = log.invokes.map((i) => i.cmd).filter((c) => !["get_initial_file", "read_file_bytes", "list_siblings", "app_ready"].includes(c));
  expect(sent).toEqual(["rotate_image"]);

  await page.reload(); // closing the window reloads the page; the file opens again
  await waitForImage(page, 300, 400);
  await expect(page.locator("#fileSize")).toHaveText("300 × 400");
});

test("a failed save is reported and the view stays turned", async ({ page }) => {
  await openWith(page, { initialFile: A, files: { [A]: quad }, rotateError: "read-only" });
  await waitForImage(page, 400, 300);
  await page.keyboard.press("r");
  await expect(page.locator("#notice")).toHaveText("Поворот не сохранён: файл только для чтения. Снимите галочку «Только чтение» в свойствах файла");
  await expect(page.locator("#fileSize")).toHaveText("300 × 400");
});

test("an unknown error is shown with its text", async ({ page }) => {
  await openWith(page, { initialFile: A, files: { [A]: quad }, rotateError: "disk full" });
  await waitForImage(page, 400, 300);
  await page.keyboard.press("r");
  await expect(page.locator("#notice")).toHaveText("Поворот не сохранён: disk full");
});

test("a turned file stays turned when you come back to it", async ({ page }) => {
  await openWith(page, { initialFile: A, siblings: [A, B], files: { [A]: quad, [B]: { width: 200, height: 100 } } });
  await waitForImage(page, 400, 300);
  await page.keyboard.press("r");
  await page.keyboard.press("ArrowRight");
  await waitForImage(page, 200, 100);
  await expect(page.locator("#fileSize")).toHaveText("200 × 100");
  await page.keyboard.press("ArrowLeft");
  await waitForImage(page, 300, 400); // the saved file comes back turned
  await expect(page.locator("#fileSize")).toHaveText("300 × 400");
});

test("a turn during a slow Next load goes to the file on screen", async ({ page }) => {
  await openWith(page, {
    initialFile: A, siblings: [A, B],
    files: { [A]: quad, [B]: { width: 200, height: 100, delayMs: 400 } },
  });
  await waitForImage(page, 400, 300);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("r");
  await waitForImage(page, 200, 100);
  expect(await rotations(page)).toEqual([{ path: A, quarterTurns: 1 }]);
  await expect(page.locator("#fileSize")).toHaveText("200 × 100");
});

test("the first turn explains that it is saved; later turns stay quiet", async ({ page }) => {
  await openWith(page, { initialFile: A, files: { [A]: quad } });
  await waitForImage(page, 400, 300);
  await page.keyboard.press("r");
  await expect(page.locator("#hint")).toHaveText("Поворот сразу сохраняется в файл");
  await page.evaluate(() => { document.getElementById("hint").style.display = "none"; });
  await page.keyboard.press("r");
  await page.waitForTimeout(200);
  expect(await page.locator("#hint").isVisible()).toBe(false); // one-shot, see desktop.spec
});

test("a dropped file (no path) turns on screen only and says so", async ({ page }) => {
  await openWith(page, { initialFile: A, files: { [A]: quad } });
  await waitForImage(page, 400, 300);
  await page.evaluate((b64) => {
    const bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], "dropped.png", { type: "image/png" }));
    window.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, makePng(200, 100).toString("base64"));
  await waitForImage(page, 200, 100);

  await page.keyboard.press("r");
  await expect(page.locator("#fileSize")).toHaveText("100 × 200");
  await expect(page.locator("#hint")).toHaveText("Этот файл открыт без пути — поворот виден только здесь, в файл не сохраняется");
  expect(await rotations(page)).toEqual([]);
});
```

В `tests/e2e/browser.spec.mjs` импорт заменить на
`import { APP_URL, makePng, pngSize, waitForImage, QUADRANTS } from "./helpers.mjs";` и добавить тест:

```js
test("in a plain browser a turn changes the view and the download, not a file", async ({ page }) => {
  await page.setInputFiles("#fileInput", {
    name: "photo.png",
    mimeType: "image/png",
    buffer: makePng(400, 300, QUADRANTS(400, 300)),
  });
  await waitForImage(page, 400, 300);
  await page.keyboard.press("r");
  await expect(page.locator("#fileSize")).toHaveText("300 × 400");
  await expect(page.locator("#hint")).toContainText("открыт без пути");

  await page.keyboard.press("Escape");
  await page.fill("#inputW", "300");
  await page.fill("#inputH", "400");
  await page.locator("#inputH").blur();
  const [download] = await Promise.all([page.waitForEvent("download"), page.click("#downloadBtn")]);
  const buf = await readFile(await download.path());
  expect(pngSize(buf)).toEqual({ width: 300, height: 400 });
});
```

- [ ] **Step 2: Запустить — должны упасть**

Run: `npx playwright test rotate browser`
Expected: FAIL — нет `#rotateRightBtn`, клавиши ничего не делают.

- [ ] **Step 3: Подключить геометрию**

Перед строкой `<script>` основного скрипта (сейчас строка 340, сразу после `<input id="fileInput" …>`) вставить:

```html
<script src="geometry.js"></script>
```

- [ ] **Step 4: CSS**

Заменить `#stage img{ display:block; }` на:

```css
  /* Картинка поворачивается CSS-трансформацией вокруг центра; #stage — её
     габарит на экране (при наклоне — габарит наклонённой картинки). */
  #stage img{ position:absolute; left:0; top:0; display:block; transform-origin:50% 50%; }
  #stage.turning img{ transition:transform .15s ease-out; }
```

Заменить `.tools{ display:flex; gap:2px; justify-self:end; grid-column:3; }` на:

```css
  .tools{ display:flex; align-items:center; gap:2px; justify-self:end; grid-column:3; }
  .barDiv{ width:1px; height:20px; background:var(--line); margin:0 4px; flex:none; }
```

В блоке `/* ---------- состояния ---------- */` расширить первое правило:

```css
  body:not(.ready) #fileSize, body:not(.ready) #zoomBtn, body:not(.ready) #cropToggleBtn,
  body:not(.ready) #focusToggleBtn, body:not(.ready) #rotateLeftBtn, body:not(.ready) #rotateRightBtn,
  body:not(.ready) .barDiv{ display:none; }
```

В `@media (max-width: 760px)` добавить правило. Иначе две равные колонки `1fr` не вмещают новые кнопки: при окне 720 px справа нужно 279 px, а колонка — 278 px, и группы налезают друг на друга. Навигация ‹ › на узком окне перестаёт быть строго по центру — это приемлемо.

```css
    #bar{ grid-template-columns:minmax(0,1fr) auto auto; }
```

В `@media (max-width: 460px)` добавить:

```css
    #navPos, .barDiv{ display:none; }
    #bar .iconBtn{ width:28px; }
```

- [ ] **Step 5: Разметка**

В `<div class="tools">` первыми элементами вставить:

```html
    <button id="rotateLeftBtn" class="iconBtn" aria-label="Повернуть влево" title="Повернуть влево (L). Сохраняется в файл"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 9V7a2 2 0 0 0-2-2h-6"/><path d="m15 2-3 3 3 3"/><path d="M20 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2"/></svg></button>
    <button id="rotateRightBtn" class="iconBtn" aria-label="Повернуть вправо" title="Повернуть вправо (R). Сохраняется в файл"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5H6a2 2 0 0 0-2 2v3"/><path d="m9 8 3-3-3-3"/><path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/></svg></button>
    <span class="barDiv" aria-hidden="true"></span>
```

В справке `#help` после строки про `X` добавить:

```html
      <dt><kbd>R</kbd> <kbd>L</kbd></dt><dd>Повернуть вправо / влево на 90° (сохраняется в файл)</dd>
```

- [ ] **Step 6: Состояние**

После `var cropActive = true; …` (строка 394) добавить:

```js
  var G = window.PccGeometry;
  var raw = { w:0, h:0 };   // размер картинки, как её декодировал браузер (EXIF-ориентация уже учтена)
  var quarterTurns = 0;     // поворот на 90° относительно загруженной картинки, 0…3
  // То же без деления по модулю: CSS-анимация 270° → 360° идёт на 90°, а 270° → 0° пошла бы на 270° назад.
  var viewTurns = 0;
  var tilt = 0;             // наклон в градусах (Task 7)
  var turnTimer = null;
```

Переменная `natural` остаётся, но теперь это размер после поворота на 90° (его считает `updateNatural`). Рядом с функцией `clamp` добавить:

```js
  function updateNatural(){ natural = G.orientedSize(raw.w, raw.h, quarterTurns); }

  // Картинка в координатах #stage: прямоугольник размера после поворота на 90°,
  // наклонённый на tilt вокруг центра stage.
  function imageRect(){
    return { cx: display.w / 2, cy: display.h / 2, w: natural.w * display.scale, h: natural.h * display.scale, deg: tilt };
  }
```

- [ ] **Step 7: Вписывание и размер stage**

В `computeBaseScale` заменить `return Math.min(availW / natural.w, availH / natural.h, cap);` на:

```js
    var b = G.boundingSize(natural.w, natural.h, tilt);
    return Math.min(availW / b.w, availH / b.h, cap);
```

Заменить `resizeStageTo` целиком:

```js
  function resizeStageTo(newScale){
    var b = G.boundingSize(natural.w, natural.h, tilt);
    display = { w: b.w * newScale, h: b.h * newScale, scale: newScale };
    var iw = raw.w * newScale, ih = raw.h * newScale;
    imgTag.style.width = iw + "px";
    imgTag.style.height = ih + "px";
    imgTag.style.left = (display.w - iw) / 2 + "px";
    imgTag.style.top = (display.h - ih) / 2 + "px";
    imgTag.style.transform = "rotate(" + (viewTurns * 90 + tilt) + "deg)";
    stage.style.width = display.w + "px";
    stage.style.height = display.h + "px";
    $("zoomBtn").textContent = Math.round(newScale * 100) + " %";
  }
```

После `function actualSize(){…}` добавить:

```js
  // Вписать картинку в окно и поставить рамку заново: новый файл, поворот на 90°.
  function resetView(){
    zoom = 1;
    baseScale = computeBaseScale();
    resizeStageTo(baseScale * zoom);
    offX = offY = 0;
    clampOffsets();
    box = G.fitInside(fitBox(display.w, display.h, targetW / targetH), imageRect());
    applyTransform();
    renderBox();
  }
```

- [ ] **Step 8: Загрузка файла**

В `loadFile` заменить `natural = { w: image.naturalWidth, h: image.naturalHeight };` на:

```js
      raw = { w: image.naturalWidth, h: image.naturalHeight };
      quarterTurns = viewTurns = 0;
      tilt = 0;
      updateNatural();
```

и блок

```js
      zoom = 1;
      baseScale = computeBaseScale();
      resizeStageTo(baseScale * zoom);
      offX = offY = 0;
      clampOffsets();

      box = fitBox(display.w, display.h, targetW / targetH);
      applyTransform();
      renderBox();
```

на `      resetView();`

- [ ] **Step 9: Поворот и сохранение**

Перед `// ---------- загрузка ----------` добавить:

```js
  // ---------- поворот на 90° ----------

  // Подсказка, которую показываем один раз за сеанс (sessionStorage живёт,
  // пока жив процесс, и переживает перезагрузки страницы).
  function onceHint(key, text){
    try {
      if (sessionStorage.getItem(key) === "1") return;
      sessionStorage.setItem(key, "1");
    } catch (e) {}
    showHint(text);
  }

  var ROTATE_ERRORS = {
    "read-only": "Поворот не сохранён: файл только для чтения. Снимите галочку «Только чтение» в свойствах файла",
    "access denied": "Поворот не сохранён: нет прав на запись в эту папку",
    "corrupt EXIF": "Поворот не сохранён: метаданные файла повреждены",
    "animated PNG": "Поворот не сохранён: анимированные PNG не поддерживаются"
  };

  // Поворот сразу виден и сразу уходит в файл: команда без задержки и без
  // очереди, Rust доведёт её до конца, даже если окно закроют и страница
  // перезагрузится. Повороты складываются, порядок выполнения неважен.
  function rotateBy(delta){
    if (!ready) return;
    quarterTurns = (quarterTurns + delta + 4) % 4;
    viewTurns += delta;
    updateNatural();
    $("fileSize").textContent = natural.w + " × " + natural.h;
    stage.classList.add("turning");
    clearTimeout(turnTimer);
    turnTimer = setTimeout(function(){ stage.classList.remove("turning"); }, 200);
    resetView();
    if (tauri && currentPath){
      onceHint("rotateHintShown", "Поворот сразу сохраняется в файл");
      tauri.core.invoke("rotate_image", { path: currentPath, quarterTurns: delta }).catch(function(err){
        console.error("rotate_image failed", err);
        showNotice(ROTATE_ERRORS[err] || "Поворот не сохранён: " + err);
      });
    } else {
      onceHint("noPathHintShown", "Этот файл открыт без пути — поворот виден только здесь, в файл не сохраняется");
    }
  }
```

- [ ] **Step 10: Экспорт одним преобразованием**

В `download()` заменить

```js
    var scale = display.scale;
    var sx = box.x / scale, sy = box.y / scale, sw = box.w / scale, sh = box.h / scale;
```

на ничего (удалить), а строку `ctx.drawImage(imgEl, sx, sy, sw, sh, 0, 0, targetW, targetH);` на:

```js
    // Рамка (в px stage) → холст W×H; картинка — повёрнутая вокруг центра stage.
    // Пиксели оригинала пересчитываются один раз.
    var t = G.cosSin(quarterTurns * 90 + tilt);
    ctx.scale(targetW / box.w, targetH / box.h);
    ctx.translate(display.w / 2 - box.x, display.h / 2 - box.y);
    ctx.transform(t.c, t.s, -t.s, t.c, 0, 0);
    ctx.scale(display.scale, display.scale);
    ctx.drawImage(imgEl, -raw.w / 2, -raw.h / 2);
```

- [ ] **Step 11: Кнопки и клавиши**

После `flipBtn.addEventListener(…)` добавить:

```js
  $("rotateLeftBtn").addEventListener("click", function(){ rotateBy(-1); });
  $("rotateRightBtn").addEventListener("click", function(){ rotateBy(1); });
```

В обработчике `keydown` после строки с Ctrl+O добавить:

```js
    // Ctrl+R — как в «Фотографиях» Windows; заодно WebView2 не перезагрузит страницу
    if (e.ctrlKey && !e.altKey && (low === "r" || low === "к")){ e.preventDefault(); rotateBy(1); return; }
```

и в цепочку букв после `else if (low === "x" || low === "ч") …`:

```js
    else if (low === "r" || low === "к") rotateBy(1);
    else if (low === "l" || low === "д") rotateBy(-1);
```

- [ ] **Step 12: Запустить новые и все тесты**

Run: `npx playwright test rotate browser`
Expected: PASS (12 в rotate, 3 в browser).

Run: `npm test`
Expected: PASS — все, включая `layout.spec.mjs` на всех 7 размерах (новые кнопки помещаются).

- [ ] **Step 13: Посмотреть глазами**

Создать временный `tests/e2e/_look.spec.mjs`:

```js
import { test } from "@playwright/test";
import { APP_URL, installTauriMock, waitForImage, QUADRANTS } from "./helpers.mjs";

test("look", async ({ page }) => {
  const A = "C:\\pics\\a.png";
  await installTauriMock(page, { initialFile: A, siblings: [A, "C:\\pics\\b.png"], files: { [A]: { width: 400, height: 300, rgba: QUADRANTS(400, 300) } } });
  await page.goto(APP_URL);
  await waitForImage(page, 400, 300);
  await page.keyboard.press("Escape");
  await page.screenshot({ path: "test-results/look-bar.png", clip: { x: 0, y: 0, width: 1280, height: 60 } });
  await page.keyboard.press("r");
  await page.waitForTimeout(300);
  await page.screenshot({ path: "test-results/look-rotated.png" });
});
```

Run: `npx playwright test _look`, открыть оба PNG (Read). Проверить: иконки — квадрат со стрелкой (не «отменить»), разделитель между группами, повёрнутая картинка целиком в окне, рамка на ней. Затем удалить `tests/e2e/_look.spec.mjs`.

- [ ] **Step 14: Commit**

```bash
git add frontend/index.html tests/e2e/rotate.spec.mjs tests/e2e/browser.spec.mjs
git commit -m "feat: rotate 90° left/right and save the turn into the file at once

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Наклон — картинка, рамка, экспорт, клавиши

**Files:**
- Modify: `frontend/index.html`
- Create: `tests/e2e/tilt.spec.mjs`

**Interfaces:**
- Consumes: `tilt`, `imageRect()`, `resetView()`, `G` (Task 6).
- Produces (для Task 8–9): `MAX_TILT = 45`, `setTilt(deg)`, `updateTiltUi()`, `tiltLabel(d)`, `flashGrid()`, элементы `#tiltBtn`, `#tiltLbl`, `#tiltGrid`.

- [ ] **Step 1: Тесты**

Создать `tests/e2e/tilt.spec.mjs`:

```js
// Tilt: the picture leans by whole degrees, the frame never leaves it, the
// export never contains background, and the angle never reaches the file.
import { test, expect } from "@playwright/test";
import { createRequire } from "node:module";
import { APP_URL, installTauriMock, waitForImage, exportPixels, expectColors } from "./helpers.mjs";

const G = createRequire(import.meta.url)("../../frontend/geometry.js");
const A = "C:\\pics\\a.png";
const B = "C:\\pics\\b.png";
const SOLID = [20, 160, 90, 255];

async function open(page, opts = {}) {
  await installTauriMock(page, { initialFile: A, files: { [A]: { width: 400, height: 300, rgba: SOLID } }, ...opts });
  await page.goto(APP_URL);
  await waitForImage(page, 400, 300);
  await page.keyboard.press("Escape");
}

async function pressTimes(page, key, n) {
  for (let i = 0; i < n; i++) await page.keyboard.press(key);
}

/** The frame and the tilted picture, read from the page (no quarter turns in these tests). */
async function frameState(page) {
  return page.evaluate(() => {
    const px = (el, p) => parseFloat(el.style[p]);
    const st = document.getElementById("stage"), img = document.getElementById("img"), cb = document.getElementById("cropBox");
    const deg = parseFloat(/rotate\((-?[\d.]+)deg\)/.exec(img.style.transform)[1]);
    return {
      box: { x: px(cb, "left"), y: px(cb, "top"), w: px(cb, "width"), h: px(cb, "height") },
      rect: { cx: px(st, "width") / 2, cy: px(st, "height") / 2, w: px(img, "width"), h: px(img, "height"), deg },
    };
  });
}

async function expectFrameInside(page) {
  const { box, rect } = await frameState(page);
  // 0.01 px slack for rounding in the style strings
  const grown = { x: box.x + 0.01, y: box.y + 0.01, w: box.w - 0.02, h: box.h - 0.02 };
  expect(G.isBoxInside(grown, rect), JSON.stringify({ box, rect })).toBe(true);
}

async function drag(page, selector, dx, dy) {
  const bb = await page.locator(selector).boundingBox();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await page.mouse.down();
  await page.mouse.move(bb.x + bb.width / 2 + dx, bb.y + bb.height / 2 + dy, { steps: 5 });
  await page.mouse.up();
}

test("] and [ change the angle; the button turns cyan away from 0°", async ({ page }) => {
  await open(page);
  await page.keyboard.press("]");
  await expect(page.locator("#tiltLbl")).toHaveText("+1°");
  await expect(page.locator("#tiltBtn")).toHaveClass(/\bon\b/);
  await page.keyboard.press("[");
  await expect(page.locator("#tiltLbl")).toHaveText("0°");
  await expect(page.locator("#tiltBtn")).not.toHaveClass(/\bon\b/);
  await page.keyboard.press("[");
  await expect(page.locator("#tiltLbl")).toHaveText("−1°");
  await page.keyboard.press("ъ");
  await expect(page.locator("#tiltLbl")).toHaveText("0°");
  await page.keyboard.press("х");
  await expect(page.locator("#tiltLbl")).toHaveText("−1°");
});

test("the angle stops at ±45°", async ({ page }) => {
  await open(page);
  await pressTimes(page, "]", 50);
  await expect(page.locator("#tiltLbl")).toHaveText("+45°");
  await pressTimes(page, "[", 100);
  await expect(page.locator("#tiltLbl")).toHaveText("−45°");
});

test("the grid shows while adjusting and fades after a second", async ({ page }) => {
  await open(page);
  await page.keyboard.press("]");
  await expect(page.locator("#stage")).toHaveClass(/\btilting\b/);
  await expect(page.locator("#stage")).not.toHaveClass(/\btilting\b/, { timeout: 2500 });
});

test("at 45° the export never contains background, even with the frame pushed to a corner", async ({ page }) => {
  await open(page);
  await page.fill("#inputW", "200");
  await page.fill("#inputH", "200");
  await page.locator("#inputH").blur();
  await pressTimes(page, "]", 45);
  await drag(page, "#cropBox", -3000, -3000);
  await expectFrameInside(page);
  const px = await exportPixels(page, [[0, 0], [0.999, 0], [0, 0.999], [0.999, 0.999], [0.5, 0.5]]);
  expectColors(px, [SOLID, SOLID, SOLID, SOLID, SOLID], 10);
});

test("dragging and resizing keep the frame inside the tilted image", async ({ page }) => {
  await open(page);
  await page.fill("#inputW", "100");
  await page.fill("#inputH", "100");
  await page.locator("#inputH").blur();
  await pressTimes(page, "]", 10);
  for (const [dx, dy] of [[3000, 3000], [-3000, 3000], [3000, -3000]]) {
    await drag(page, "#cropBox", dx, dy);
    await expectFrameInside(page);
  }
  for (const corner of ["br", "tl", "tr", "bl"]) {
    await drag(page, `.handle[data-corner="${corner}"]`, corner.includes("r") ? 3000 : -3000, corner.includes("b") ? 3000 : -3000);
    await expectFrameInside(page);
    const { box } = await frameState(page);
    expect(box.w / box.h).toBeCloseTo(1, 2);
  }
});

test("zoom and window resize keep the frame inside", async ({ page }) => {
  await open(page);
  await pressTimes(page, "]", 20);
  const vp = await page.locator("#viewport").boundingBox();
  await page.mouse.move(vp.x + vp.width / 2, vp.y + vp.height / 2);
  for (let i = 0; i < 3; i++) await page.mouse.wheel(0, -100);
  await expectFrameInside(page);
  await page.setViewportSize({ width: 700, height: 500 });
  await page.waitForTimeout(100);
  await expectFrameInside(page);
});

test("a tilt change keeps the frame where it was and shrinks it only if it must", async ({ page }) => {
  await open(page);
  await page.fill("#inputW", "100");
  await page.fill("#inputH", "100");
  await page.locator("#inputH").blur();
  const before = await frameState(page);
  await page.keyboard.press("]");
  const after = await frameState(page);
  // centre relative to the picture centre, in picture pixels, stays put
  const rel = (s) => [(s.box.x + s.box.w / 2 - s.rect.cx) / s.rect.w, (s.box.y + s.box.h / 2 - s.rect.cy) / s.rect.h];
  expect(rel(after)[0]).toBeCloseTo(rel(before)[0], 3);
  expect(rel(after)[1]).toBeCloseTo(rel(before)[1], 3);
  await expectFrameInside(page);
});

test("tilt never reaches Rust and resets on the next file", async ({ page }) => {
  await open(page, { siblings: [A, B], files: { [A]: { width: 400, height: 300, rgba: SOLID }, [B]: { width: 200, height: 100 } } });
  await pressTimes(page, "]", 2);
  expect(await page.evaluate(() => window.__mockLog.invokes.some((i) => i.cmd === "rotate_image"))).toBe(false);
  await page.keyboard.press("ArrowRight");
  await waitForImage(page, 200, 100);
  await expect(page.locator("#tiltLbl")).toHaveText("0°");
});
```

- [ ] **Step 2: Запустить — должны упасть**

Run: `npx playwright test tilt`
Expected: FAIL — нет `#tiltLbl`, клавиши `]`/`[` ничего не делают.

- [ ] **Step 3: CSS**

Заменить строку `#stage{ position:relative; background:#000; user-select:none; overflow:hidden; flex:none;` + следующую `box-shadow:0 18px 50px rgba(0,0,0,.45); }` на:

```css
  #stage{ position:relative; background:#000; user-select:none; overflow:hidden; flex:none;
    box-shadow:0 18px 50px rgba(0,0,0,.45); }
  /* При наклоне углы stage пустые: цвет окружения, а не часть фото. Чёрная
     подложка под прозрачными местами переезжает на саму картинку. */
  #stage.tilted{ background:transparent; box-shadow:none; }
  #stage.tilted img{ background:#000; }
  /* Сетка для выравнивания горизонта — по экрану, а не по картинке. */
  #tiltGrid{ position:absolute; inset:0; pointer-events:none; opacity:0; transition:opacity .2s;
    background-image:linear-gradient(to right, rgba(255,255,255,.4) 1px, transparent 1px),
      linear-gradient(to bottom, rgba(255,255,255,.4) 1px, transparent 1px);
    background-size:48px 48px; background-position:center; }
  #stage.tilting #tiltGrid{ opacity:1; }
```

После правила `.barDiv{…}` добавить:

```css
  /* Угол наклона — значение, которое меняется по клику, как масштаб рядом. */
  #tiltBtn{ height:24px; display:flex; align-items:center; gap:4px; padding:0 7px; margin:0 2px; border:1px solid var(--line);
    border-radius:var(--r-m); background:transparent; color:var(--muted); font-size:var(--fs-s); cursor:pointer; flex:none; }
  #tiltBtn:hover, #tiltBtn[aria-expanded="true"]{ color:var(--text); border-color:var(--muted); }
  #tiltBtn.on{ color:var(--cyan); border-color:var(--cyan); background:var(--cyanSoft); }
  #tiltLbl{ min-width:3.2em; text-align:center; }
```

Добавить `body:not(.ready) #tiltBtn` в правило скрытия до открытия файла. В `@media (max-width: 460px)` добавить:

```css
    #tiltBtn svg{ display:none; }
    #tiltLbl{ min-width:2.6em; }
```

- [ ] **Step 4: Разметка**

В `.tools` между `#rotateRightBtn` и `.barDiv`:

```html
    <button id="tiltBtn" aria-haspopup="true" aria-expanded="false" aria-label="Наклон" title="Наклон (клавиши [ и ]). Только для сохраняемой обрезки"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M3 20h18M3 20 17 6"/></svg><span id="tiltLbl" class="px">0°</span></button>
```

В `#stage` между `<img id="img" …>` и `<div id="cropBox">`:

```html
        <div id="tiltGrid"></div>
```

В справке после строки про R/L:

```html
      <dt><kbd>]</kbd> <kbd>[</kbd></dt><dd>Наклон +1° / −1° (только для обрезки)</dd>
```

- [ ] **Step 5: Состояние и функции наклона**

Рядом с `var tilt = 0;` заменить комментарий на `// наклон в градусах, −MAX_TILT…MAX_TILT` и добавить:

```js
  var MAX_TILT = 45;
  var gridTimer = null;
  var tiltBtn = $("tiltBtn");
```

(`$` — объявление функции, оно поднимается, а скрипт стоит в конце `<body>`, так что элемент уже есть.)

В `resizeStageTo` после `stage.style.height = …` добавить:

```js
    stage.classList.toggle("tilted", tilt !== 0);
```

После `rotateBy` добавить:

```js
  // ---------- наклон ----------

  function tiltLabel(d){ return (d > 0 ? "+" : d < 0 ? "−" : "") + Math.abs(d) + "°"; }

  function updateTiltUi(){
    $("tiltLbl").textContent = tiltLabel(tilt);
    tiltBtn.classList.toggle("on", tilt !== 0);
  }

  // Сетка видна, пока угол меняют, и гаснет через секунду после последнего изменения.
  function flashGrid(){
    stage.classList.add("tilting");
    clearTimeout(gridTimer);
    gridTimer = setTimeout(function(){ stage.classList.remove("tilting"); }, 1000);
  }

  // Новый угол: центр картинки на экране и положение рамки на картинке не
  // меняются; рамка уменьшается и сдвигается, только если иначе вылезет на фон.
  function setTilt(deg){
    deg = clamp(Math.round(deg), -MAX_TILT, MAX_TILT);
    if (!ready || deg === tilt) return;
    var s = display.scale, oldW = display.w, oldH = display.h;
    var centerX = offX + oldW / 2, centerY = offY + oldH / 2;
    var rel = { x: (box.x + box.w / 2 - oldW / 2) / s, y: (box.y + box.h / 2 - oldH / 2) / s, w: box.w / s, h: box.h / s };
    tilt = deg;
    baseScale = computeBaseScale();
    zoom = clamp(zoom, MIN_ZOOM, maxZoom());
    resizeStageTo(baseScale * zoom);
    var k = display.scale;
    box = G.fitInside({ x: display.w / 2 + rel.x * k - rel.w * k / 2, y: display.h / 2 + rel.y * k - rel.h * k / 2, w: rel.w * k, h: rel.h * k }, imageRect());
    offX = centerX - display.w / 2;
    offY = centerY - display.h / 2;
    clampOffsets();
    applyTransform();
    renderBox();
    updateTiltUi();
    flashGrid();
  }
```

В `loadFile` после `tilt = 0;` добавить `updateTiltUi();`.

- [ ] **Step 6: Рамка через геометрию**

В `applyScale` сразу после существующего блока `if (box){ box = { x: box.x * ratio, … }; }` добавить строку:

```js
    if (box) box = G.fitInside(box, imageRect()); // накопленная погрешность не выводит рамку за картинку
```

В `onTargetChanged` после присваивания `box = { … };` (перед `renderBox();`) добавить:

```js
    box = G.fitInside(box, imageRect());
```

Заменить тело `nudge`:

```js
  function nudge(dx, dy){
    var s = display.scale;
    var sx = Math.round(box.x / s) + dx, sy = Math.round(box.y / s) + dy;
    box = G.clampBoxCenter({ x: sx * s, y: sy * s, w: box.w, h: box.h }, imageRect());
    renderBox();
  }
```

В `startDrag` → `onMove`, ветка `"move"`: заменить присваивание `box = { x: clamp(…), y: clamp(…), w: b0.w, h: b0.h };` на:

```js
        box = G.clampBoxCenter({ x: b0.x + dx, y: b0.y + dy, w: b0.w, h: b0.h }, imageRect());
```

Ветка изменения размера: заменить всё от `var rawW = Math.abs(p.x - anchorX);` до `var y = growY === 1 ? anchorY : anchorY - h;` включительно на:

```js
      var rawW = Math.abs(p.x - anchorX);
      var rawH = Math.abs(p.y - anchorY);
      var w = Math.max(rawW, rawH * aspect);
      var maxW = G.maxWidthFromAnchor(anchorX, anchorY, growX, growY, aspect, imageRect());
      w = clamp(w, MIN_BOX, Math.max(maxW, MIN_BOX));
      var h = w / aspect;
      var x = growX === 1 ? anchorX : anchorX - w;
      var y = growY === 1 ? anchorY : anchorY - h;
```

- [ ] **Step 7: Клавиши**

В цепочку букв после строк про `r`/`l`:

```js
    else if (key === "]" || low === "ъ") setTilt(tilt + 1);
    else if (key === "[" || low === "х") setTilt(tilt - 1);
```

- [ ] **Step 8: Запустить**

Run: `npx playwright test tilt`
Expected: PASS, 8 тестов.

Run: `npm test`
Expected: PASS — все, включая старые P6, P8 и «frame cannot be dragged outside the image» (при 0° поведение не изменилось) и layout.

- [ ] **Step 9: Commit**

```bash
git add frontend/index.html tests/e2e/tilt.spec.mjs
git commit -m "feat: tilt by whole degrees, keeping the crop frame inside the image

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Линейка наклона

**Files:**
- Modify: `frontend/index.html`, `tests/e2e/tilt.spec.mjs`, `tests/e2e/layout.spec.mjs`

**Interfaces:**
- Consumes: `setTilt`, `tiltLabel`, `MAX_TILT`, `tiltBtn` (Task 7); `openPop`, `placePop`, `closePops` (существующие).
- Produces: `#tiltPop` (`data-place="below"`), `#tiltRuler` (`role="slider"`), `#tiltScale`, `#tiltValue`, `#tiltMinus`, `#tiltPlus`, `#tiltReset`; `PX_PER_DEG = 8`; `tiltSpoken(d)`.

- [ ] **Step 1: Тесты**

В конец `tests/e2e/tilt.spec.mjs`:

```js
test.describe("the tilt ruler", () => {
  const PX_PER_DEG = 8; // frontend/index.html: PX_PER_DEG and --deg

  test("opens from the angle button and closes with Esc", async ({ page }) => {
    await open(page);
    await page.click("#tiltBtn");
    await expect(page.locator("#tiltPop")).toBeVisible();
    await expect(page.locator("#tiltBtn")).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
    await expect(page.locator("#tiltPop")).toBeHidden();
  });

  test("dragging the scale changes the angle by whole degrees", async ({ page }) => {
    await open(page);
    await page.click("#tiltBtn");
    await drag(page, "#tiltRuler", -3 * PX_PER_DEG, 0); // the scale moves left: bigger angles come under the mark
    await expect(page.locator("#tiltValue")).toHaveText("+3°");
    await expect(page.locator("#tiltLbl")).toHaveText("+3°");
  });

  test("wheel, double-click and the buttons", async ({ page }) => {
    await open(page);
    await page.click("#tiltBtn");
    const bb = await page.locator("#tiltRuler").boundingBox();
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await page.mouse.wheel(0, -100);
    await expect(page.locator("#tiltValue")).toHaveText("+1°");
    await page.mouse.dblclick(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await expect(page.locator("#tiltValue")).toHaveText("0°");
    await page.click("#tiltPlus");
    await page.click("#tiltPlus");
    await expect(page.locator("#tiltValue")).toHaveText("+2°");
    await page.click("#tiltMinus");
    await expect(page.locator("#tiltValue")).toHaveText("+1°");
    await page.click("#tiltReset");
    await expect(page.locator("#tiltValue")).toHaveText("0°");
  });

  test("keyboard on the ruler, announced for screen readers, without paging files", async ({ page }) => {
    await open(page, { siblings: [A, B], files: { [A]: { width: 400, height: 300, rgba: SOLID }, [B]: { width: 200, height: 100 } } });
    await page.click("#tiltBtn");
    await page.locator("#tiltRuler").focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("#tiltRuler")).toHaveAttribute("aria-valuenow", "1");
    await expect(page.locator("#tiltRuler")).toHaveAttribute("aria-valuetext", "плюс 1 градус");
    await pressTimes(page, "ArrowLeft", 3);
    await expect(page.locator("#tiltRuler")).toHaveAttribute("aria-valuetext", "минус 2 градуса");
    await page.keyboard.press("Home");
    await expect(page.locator("#tiltRuler")).toHaveAttribute("aria-valuetext", "0 градусов");
    await expect(page.locator("#navPos")).toHaveText("1 / 2"); // arrows on the ruler did not change file
  });

  test("in focus mode the bar stays visible while the ruler is open", async ({ page }) => {
    await installTauriMock(page, { initialFile: A, files: { [A]: { width: 400, height: 300, rgba: SOLID } } });
    await page.goto(APP_URL);
    await waitForImage(page, 400, 300); // opens in focus mode
    await page.click("#tiltBtn");
    await page.mouse.move(400, 500); // away from the bar
    await expect(page.locator("#bar")).toHaveCSS("opacity", "1");
  });
});
```

В `tests/e2e/layout.spec.mjs` после теста «format popover…» добавить:

```js
    test("tilt ruler fits under the bar", async ({ page }) => {
      await page.click("#tiltBtn");
      expect(await page.evaluate(audit)).toEqual([]);
    });
```

- [ ] **Step 2: Запустить — должны упасть**

Run: `npx playwright test tilt layout`
Expected: FAIL — нет `#tiltPop`.

- [ ] **Step 3: Разметка линейки**

После `<div class="pop" id="fmtPop" …>…</div>` добавить:

```html
<div class="pop" id="tiltPop" data-place="below" role="dialog" aria-label="Наклон">
  <div class="tiltHead">
    <button id="tiltMinus" class="iconBtn" aria-label="Наклон −1°" title="−1° ([)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 18-6-6 6-6"/></svg></button>
    <span id="tiltValue" class="px">0°</span>
    <button id="tiltPlus" class="iconBtn" aria-label="Наклон +1°" title="+1° (])"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg></button>
    <button id="tiltReset" class="chip" title="Сбросить наклон">0°</button>
  </div>
  <div id="tiltRuler" role="slider" tabindex="0" aria-label="Наклон, градусы" aria-valuemin="-45" aria-valuemax="45" aria-valuenow="0" aria-valuetext="0 градусов">
    <div id="tiltScale"></div>
  </div>
</div>
```

- [ ] **Step 4: CSS линейки**

После `#qualityRange{…}`:

```css
  /* Линейка наклона: шкала едет под неподвижной голубой меткой, 1° = --deg px. */
  #tiltPop{ width:min(320px, calc(100vw - 16px)); padding:10px 12px 8px; }
  .tiltHead{ display:flex; align-items:center; gap:6px; }
  #tiltValue{ flex:1; text-align:center; font-size:var(--fs-l); font-weight:600; color:var(--text); }
  #tiltReset{ flex-direction:row; padding:4px 10px; font:600 var(--fs-s) var(--mono); }
  #tiltRuler{ position:relative; height:44px; margin-top:6px; overflow:hidden; cursor:ew-resize; touch-action:none;
    border-radius:var(--r-s); -webkit-mask-image:linear-gradient(to right, transparent, #000 18%, #000 82%, transparent);
    mask-image:linear-gradient(to right, transparent, #000 18%, #000 82%, transparent); }
  #tiltRuler::after{ content:""; position:absolute; left:50%; top:2px; height:22px; width:2px; margin-left:-1px;
    background:var(--cyan); border-radius:1px; }
  #tiltScale{ --deg:8px; position:absolute; left:50%; top:4px; height:36px; width:calc(90 * var(--deg) + 1px);
    background:repeating-linear-gradient(to right, var(--muted) 0 1px, transparent 1px var(--deg)) top left / 100% 7px no-repeat; }
  #tiltScale span{ position:absolute; top:0; width:1px; height:13px; background:var(--muted); }
  #tiltScale b{ position:absolute; top:16px; transform:translateX(-50%); font:500 11px var(--mono); color:var(--muted); }
  body.focusMode:has(#tiltPop.open) #bar{ opacity:1; }
```

- [ ] **Step 5: Позиция под панелью**

Заменить `placePop`:

```js
  // Поповер пилюли — над ней и никогда не выше окна: высота ограничена
  // свободным местом. Линейка наклона (data-place="below") — под строкой статуса.
  function placePop(pop, btn){
    var r = btn.getBoundingClientRect(), pw;
    if (pop.getAttribute("data-place") === "below"){
      pw = pop.offsetWidth;
      pop.style.left = clamp(r.left + r.width / 2 - pw / 2, GAP, window.innerWidth - pw - GAP) + "px";
      pop.style.top = $("bar").getBoundingClientRect().bottom + GAP + "px";
      return;
    }
    var above = pill.getBoundingClientRect().top;
    pop.style.maxHeight = Math.max(120, above - GAP * 2) + "px";
    pw = pop.offsetWidth;
    var ph = pop.offsetHeight;
    pop.style.left = clamp(r.left + r.width / 2 - pw / 2, GAP, window.innerWidth - pw - GAP) + "px";
    pop.style.top = Math.max(GAP, above - ph - GAP) + "px";
  }
```

Заменить в обработчике `document.addEventListener("pointerdown", …)` селектор `".pop, .pbtn"` на `".pop, [aria-haspopup]"`.

- [ ] **Step 6: Поведение линейки**

Рядом с `var MAX_TILT = 45;`:

```js
  var PX_PER_DEG = 8;       // то же, что --deg в CSS линейки
  var SNAP_ZERO = 0.8;      // у нуля линейка «примагничивается»: 0° шире, чем ±0,5°
```

Рядом с `var tiltBtn = $("tiltBtn");`:

```js
  var tiltPop = $("tiltPop"), tiltRuler = $("tiltRuler");
```

Заменить `updateTiltUi` и добавить `tiltSpoken`:

```js
  // «минус 3 градуса» — для экранного диктора
  function tiltSpoken(d){
    var n = Math.abs(d), m10 = n % 10, m100 = n % 100;
    var word = m10 === 1 && m100 !== 11 ? "градус"
      : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? "градуса" : "градусов";
    return (d < 0 ? "минус " : d > 0 ? "плюс " : "") + n + " " + word;
  }

  function updateTiltUi(){
    var label = tiltLabel(tilt);
    $("tiltLbl").textContent = label;
    $("tiltValue").textContent = label;
    tiltBtn.classList.toggle("on", tilt !== 0);
    tiltRuler.setAttribute("aria-valuenow", String(tilt));
    tiltRuler.setAttribute("aria-valuetext", tiltSpoken(tilt));
    $("tiltScale").style.transform = "translateX(" + (-(tilt + MAX_TILT) * PX_PER_DEG) + "px)";
  }
```

После объявлений обработчиков `rotateLeftBtn/rotateRightBtn` добавить:

```js
  // Деления через 5° с подписями; мелкие деления через 1° рисует CSS.
  (function buildRuler(){
    var html = "";
    for (var d = -MAX_TILT; d <= MAX_TILT; d += 5){
      var x = (d + MAX_TILT) * PX_PER_DEG;
      html += '<span style="left:' + x + 'px"></span><b style="left:' + x + 'px">' + (d < 0 ? "−" + -d : d) + "</b>";
    }
    $("tiltScale").innerHTML = html;
  })();
  updateTiltUi();

  tiltBtn.addEventListener("click", function(e){ e.stopPropagation(); openPop(tiltPop, tiltBtn); });
  $("tiltMinus").addEventListener("click", function(){ setTilt(tilt - 1); });
  $("tiltPlus").addEventListener("click", function(){ setTilt(tilt + 1); });
  $("tiltReset").addEventListener("click", function(){ setTilt(0); });

  // Тянем шкалу: она едет под меткой, поэтому влево — больший угол.
  tiltRuler.addEventListener("pointerdown", function(e){
    if (e.button !== 0) return;
    e.preventDefault();
    tiltRuler.focus();
    tiltRuler.setPointerCapture(e.pointerId);
    var startX = e.clientX, start = tilt;
    function onMove(ev){
      var deg = start - (ev.clientX - startX) / PX_PER_DEG;
      setTilt(Math.abs(deg) < SNAP_ZERO ? 0 : deg);
    }
    function onUp(){
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  });
  tiltRuler.addEventListener("wheel", function(e){
    e.preventDefault();
    setTilt(tilt + (e.deltaY < 0 ? 1 : -1));
  }, { passive: false });
  tiltRuler.addEventListener("dblclick", function(){ setTilt(0); });
  // Стрелки на линейке меняют угол и не уходят дальше — иначе листали бы файлы.
  tiltRuler.addEventListener("keydown", function(e){
    var step = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[e.key];
    if (step) setTilt(tilt + step);
    else if (e.key === "Home") setTilt(0);
    else return;
    e.preventDefault();
    e.stopPropagation();
  });
```

- [ ] **Step 7: Запустить**

Run: `npx playwright test tilt layout`
Expected: PASS (13 в tilt, layout на 7 размерах — включая новый тест линейки).

Run: `npm test`
Expected: PASS.

- [ ] **Step 8: Посмотреть глазами**

Временный тест (как в Task 6 Step 13): открыть файл, `]`×3, клик `#tiltBtn`, `page.screenshot({ path: 'test-results/ruler.png' })` при 1280×800 и при 320×240. Проверить: метка по центру над делением «+3°» шкалы, края шкалы растворяются, подписи читаются, окно линейки не выходит за экран. Временный файл удалить.

- [ ] **Step 9: Commit**

```bash
git add frontend/index.html tests/e2e/tilt.spec.mjs tests/e2e/layout.spec.mjs
git commit -m "feat: tilt ruler popover with drag, wheel, keyboard and screen reader support

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Касание: первый тап показывает скрытую панель; крупные цели

**Files:**
- Modify: `frontend/index.html`, `tests/e2e/tilt.spec.mjs`

**Interfaces:**
- Consumes: `focusMode`, `rotateBy` (Task 6).
- Produces: класс `body.barPeek`; константы `PEEK_ZONE = 56`, `PEEK_MS = 3000`.

- [ ] **Step 1: Тест**

В конец `tests/e2e/tilt.spec.mjs`:

```js
test.describe("touch in focus mode", () => {
  test.use({ hasTouch: true });

  test("the first tap on the hidden bar only reveals it; the next one presses", async ({ page }) => {
    await installTauriMock(page, { initialFile: A, files: { [A]: { width: 400, height: 300, rgba: SOLID } } });
    await page.goto(APP_URL);
    await waitForImage(page, 400, 300); // opens in focus mode, bar transparent
    const bb = await page.locator("#rotateRightBtn").boundingBox();
    const tap = () => page.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2);

    await tap();
    await expect(page.locator("body")).toHaveClass(/\bbarPeek\b/);
    expect(await page.evaluate(() => window.__mockLog.rotations)).toEqual([]);

    await tap();
    await page.waitForFunction(() => window.__mockLog.rotations.length === 1);

    await expect(page.locator("body")).not.toHaveClass(/\bbarPeek\b/, { timeout: 4000 });
  });

  test("a tap on the picture below hides the revealed bar", async ({ page }) => {
    await installTauriMock(page, { initialFile: A, files: { [A]: { width: 400, height: 300, rgba: SOLID } } });
    await page.goto(APP_URL);
    await waitForImage(page, 400, 300);
    await page.touchscreen.tap(640, 10);
    await expect(page.locator("body")).toHaveClass(/\bbarPeek\b/);
    await page.touchscreen.tap(640, 400);
    await expect(page.locator("body")).not.toHaveClass(/\bbarPeek\b/);
  });
});
```

- [ ] **Step 2: Запустить — должен упасть**

Run: `npx playwright test tilt -g "touch"`
Expected: FAIL — первый тап сразу вызывает `rotate_image`, класса `barPeek` нет.

- [ ] **Step 3: CSS**

После `body.focusMode #bar:hover, body.focusMode #bar:focus-within{ opacity:1; }`:

```css
  body.focusMode.barPeek #bar{ opacity:1; }
```

В конец адаптивного блока (перед `prefers-reduced-motion`):

```css
  /* Палец: цели не меньше 44 px. На узком окне места нет — там остаются 30/28 px (≥ 24 px, WCAG AA). */
  @media (pointer: coarse) and (min-width: 561px){
    :root{ --bar:44px; }
    #bar .iconBtn{ width:44px; height:40px; }
    #tiltRuler{ height:52px; }
  }
```

- [ ] **Step 4: JS**

После `setFocus` добавить:

```js
  // Касание в режиме фокуса: панель прозрачна, но её кнопки нажимаются. Первый
  // тап по верхней полосе (~1,5 см) только показывает панель, нажимает —
  // следующий. Панель прячется через 3 с или после тапа ниже полосы.
  var PEEK_ZONE = 56, PEEK_MS = 3000;
  var peekTimer = null, swallowClickUntil = 0;
  function setPeek(on){
    document.body.classList.toggle("barPeek", on);
    clearTimeout(peekTimer);
    if (on) peekTimer = setTimeout(function(){ setPeek(false); }, PEEK_MS);
  }
  document.addEventListener("pointerdown", function(e){
    if (e.pointerType !== "touch" || !focusMode) return;
    swallowClickUntil = 0;   // новый тап: клик предыдущего уже прошёл
    if (e.clientY > Math.max($("bar").offsetHeight, PEEK_ZONE)){ setPeek(false); return; }
    if (document.body.classList.contains("barPeek")){ setPeek(true); return; }
    e.preventDefault();
    e.stopPropagation();
    swallowClickUntil = Date.now() + 600;
    setPeek(true);
  }, true);
  // pointerdown.preventDefault() не отменяет click — гасим его отдельно.
  document.addEventListener("click", function(e){
    if (Date.now() < swallowClickUntil){
      e.preventDefault();
      e.stopPropagation();
      swallowClickUntil = 0;
    }
  }, true);
```

В `setFocus` после строки `focusMode = on;` добавить `setPeek(false);`.

- [ ] **Step 5: Запустить**

Run: `npx playwright test tilt -g "touch"`
Expected: PASS, 2 теста.

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/index.html tests/e2e/tilt.spec.mjs
git commit -m "feat: first tap on the hidden focus-mode bar only reveals it; larger touch targets

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Ctrl+O через нативный диалог

**Files:**
- Modify: `frontend/index.html`, `tests/e2e/rotate.spec.mjs`

**Interfaces:**
- Consumes: `loadFromPath`, `initSiblings`, `clearSiblings`, `updateNavButtons` (существующие); мок `dialog.open` (Task 5).
- Produces: `chooseFile()`.

- [ ] **Step 1: Тесты**

В конец `tests/e2e/rotate.spec.mjs`:

```js
test.describe("Ctrl+O opens through the native dialog", () => {
  const files = { [A]: quad, [B]: { width: 200, height: 100 } };

  test("the chosen file opens with its path: turns are saved and Prev/Next works", async ({ page }) => {
    await openWith(page, { initialFile: A, siblings: [A, B], files, openResult: B });
    await waitForImage(page, 400, 300);
    await page.keyboard.press("Control+o");
    await waitForImage(page, 200, 100);
    expect(await page.evaluate(() => window.__mockLog.opens)).toHaveLength(1);
    await expect(page.locator("#navPos")).toHaveText("2 / 2");
    await page.keyboard.press("r");
    expect(await rotations(page)).toEqual([{ path: B, quarterTurns: 1 }]);
  });

  test("the folder button uses the same dialog", async ({ page }) => {
    await openWith(page, { initialFile: A, siblings: [A, B], files, openResult: B });
    await waitForImage(page, 400, 300);
    await page.keyboard.press("Escape");
    await page.click("#openBtn");
    await waitForImage(page, 200, 100);
  });

  test("cancelling the dialog keeps the current image", async ({ page }) => {
    await openWith(page, { initialFile: A, siblings: [A, B], files, openResult: null });
    await waitForImage(page, 400, 300);
    await page.keyboard.press("Control+o");
    await page.waitForFunction(() => window.__mockLog.opens.length === 1);
    await page.waitForTimeout(200);
    await expect(page.locator("#fileName")).toHaveText("a.png");
    await expect(page.locator("#navPos")).toHaveText("1 / 2");
  });
});
```

- [ ] **Step 2: Запустить — должны упасть**

Run: `npx playwright test rotate -g "Ctrl\\+O"`
Expected: FAIL — `__mockLog.opens` пуст (страница кликает по `<input type=file>`).

- [ ] **Step 3: Реализация**

После `openLocalFile` добавить:

```js
  // В десктопе — нативный диалог: у файла есть путь, поэтому поворот
  // сохраняется в файл и работает Prev/Next по папке. В браузере — <input>.
  function chooseFile(){
    if (!(tauri && tauri.dialog && tauri.dialog.open)){ fileInput.click(); return; }
    tauri.dialog.open({
      multiple: false,
      directory: false,
      filters: [{ name: "Изображения", extensions: ["jpg", "jpeg", "png"] }]
    }).then(function(path){
      if (!path) return; // отмена
      clearSiblings();
      updateNavButtons();
      loadFromPath(path);
      initSiblings(path);
    }, function(err){
      console.error("open dialog failed, falling back", err);
      fileInput.click();
    });
  }
```

Заменить четыре вызова `fileInput.click()`: в обработчике клика `#dropCard`, в его `keydown` (Enter/пробел), в обработчике `#openBtn` и в Ctrl+O внутри `keydown` — на `chooseFile()`.

- [ ] **Step 4: Запустить**

Run: `npx playwright test rotate browser`
Expected: PASS (браузерные тесты по-прежнему ходят через `#fileInput`).

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/index.html tests/e2e/rotate.spec.mjs
git commit -m "feat: Ctrl+O opens through the native dialog, so turns save and Prev/Next works

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Движок WebView2 читает наш тег

**Files:**
- Create: `tests/e2e/exif.spec.mjs`

**Interfaces:**
- Consumes: `withOrientation`, `exportPixels`, `expectColors`, цвета (Task 5); поворот (Task 6).

- [ ] **Step 1: Тест**

Создать `tests/e2e/exif.spec.mjs`:

```js
// Edge runs the same Chromium engine as WebView2. These tests check that it
// shows a JPEG turned by an Orientation tag laid out exactly as the Rust side
// writes it (exif::insert_app1), and that a turn starts from what is shown.
import { test, expect } from "@playwright/test";
import { APP_URL, installTauriMock, waitForImage, exportPixels, expectColors, withOrientation, RED, GREEN, BLUE, YELLOW } from "./helpers.mjs";

const J = "C:\\pics\\phone.jpg";
const CORNERS = [[0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9]];

/** A 64×48 JPEG with four solid quadrants, encoded by the browser itself. */
async function quadrantJpeg(browser) {
  const gen = await browser.newPage();
  const b64 = await gen.evaluate(async (colors) => {
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 48;
    const ctx = c.getContext("2d");
    [[0, 0], [32, 0], [0, 24], [32, 24]].forEach(([x, y], i) => {
      ctx.fillStyle = `rgb(${colors[i].slice(0, 3).join(",")})`;
      ctx.fillRect(x, y, 32, 24);
    });
    const blob = await new Promise((res) => c.toBlob(res, "image/jpeg", 0.95));
    let s = "";
    for (const b of new Uint8Array(await blob.arrayBuffer())) s += String.fromCharCode(b);
    return btoa(s);
  }, [RED, GREEN, BLUE, YELLOW]);
  await gen.close();
  return Buffer.from(b64, "base64");
}

test("WebView2's engine applies the Orientation tag the app writes", async ({ page, browser }) => {
  const jpeg = withOrientation(await quadrantJpeg(browser), 6);
  await installTauriMock(page, { initialFile: J, files: { [J]: { raw: jpeg } } });
  await page.goto(APP_URL);
  await waitForImage(page, 48, 64); // Orientation 6: shown a quarter turn clockwise
  await expect(page.locator("#fileSize")).toHaveText("48 × 64");
  await page.keyboard.press("Escape");
  expectColors(await exportPixels(page, CORNERS, { w: 48, h: 64 }), [BLUE, RED, YELLOW, GREEN], 40);
});

test("a phone photo (Orientation 6) turns from what is on screen", async ({ page, browser }) => {
  const jpeg = withOrientation(await quadrantJpeg(browser), 6);
  await installTauriMock(page, { initialFile: J, files: { [J]: { raw: jpeg } } });
  await page.goto(APP_URL);
  await waitForImage(page, 48, 64);
  await page.keyboard.press("Escape");
  await page.keyboard.press("r");
  await expect(page.locator("#fileSize")).toHaveText("64 × 48");
  expect(await page.evaluate(() => window.__mockLog.rotations)).toEqual([{ path: J, quarterTurns: 1 }]);
  // shown turned once by the tag and once more by us: half a turn from the stored pixels
  expectColors(await exportPixels(page, CORNERS, { w: 64, h: 48 }), [YELLOW, BLUE, GREEN, RED], 40);
});
```

- [ ] **Step 2: Запустить**

Run: `npx playwright test exif`
Expected: PASS, 2 теста. (Если первый тест упадёт на `waitForImage(48, 64)` — значит, раскладка байтов в `withOrientation` или в Rust `insert_app1` расходится с тем, что понимает Chromium; сравнить с Task 1 и исправить обе стороны одинаково.)

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/exif.spec.mjs
git commit -m "test: the WebView2 engine honours the Orientation tag as we write it

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Документация и версия 0.1.6

**Files:**
- Modify: `README.md`, `CLAUDE.md`, `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.lock`, `docs/superpowers/specs/2026-10-03-rotate-and-tilt-design.md`, `PROGRESS.md` (локальный, не коммитится)

- [ ] **Step 1: README**

В «Возможности» после пункта про ⇄ добавить:

```markdown
- **Поворот на 90°** — кнопки ⟲ ⟳ на верхней строке (или **L** / **R**, **Ctrl+R**).
  Поворот **сразу сохраняется в сам файл**, как в «Фотографиях» Windows: закрыл
  окно — поворот остался. Больше в исходный файл не попадает ничего: рамка,
  размер, формат и наклон живут только в приложении. JPEG поворачивается без
  потерь (меняется только тег EXIF Orientation), PNG — попиксельно без потерь.
  Файл, перетащенный в окно, поворачивается только на экране: у него нет пути
- **Наклон** по 1° (до ±45°) — кнопка с углом на верхней строке открывает
  линейку (тянуть, колесо, стрелки), **[** / **]** — без неё. Пока угол меняют,
  поверх картинки видна сетка. Наклон влияет только на сохраняемую обрезку;
  рамка не может заехать на пустые углы
```

В таблицу «Горячие клавиши» после строки `X`:

```markdown
| `R` / `L` (или `К` / `Д`), `Ctrl+R` | повернуть вправо / влево на 90° (сохраняется в файл) |
| `]` / `[` (или `Ъ` / `Х`) | наклон +1° / −1° (только для обрезки) |
```

Строку `| Ctrl+S / Ctrl+O | …` оставить; в пункте «Возможности» про «Открыть с помощью» дописать: «то же после Ctrl+O». В «Структура проекта»:

```
├── frontend/index.html     # весь UI: крап, зум/пан, поворот, наклон, фокус-режим, пилюля
├── frontend/geometry.js    # геометрия рамки на наклонённой картинке
…
    └── src/main.rs         # 6 команд: get_initial_file, app_ready, read_file_bytes,
                             # list_siblings, write_file_bytes, rotate_image;
                             # фоновый режим, трей, единственный экземпляр
        src/exif.rs, png_rotate.rs, rotate.rs  # поворот в файле: EXIF / PNG / запись
```

- [ ] **Step 2: CLAUDE.md**

- В «Architecture» про `frontend/index.html`: «(~1500 lines)», добавить предложение: «Pure geometry for rotation and tilt lives in `frontend/geometry.js` (ES5, `window.PccGeometry`, also `require`-able for `tests/e2e/geometry.spec.mjs`); when running the suite against a modified copy via `APP_URL`, copy `geometry.js` next to it.»
- «exposes five commands» → «exposes six commands», добавить пункт:
  `- rotate_image: saves a quarter turn into the file (JPEG: EXIF Orientation only, src/exif.rs; PNG: lossless pixel turn, src/png_rotate.rs). Every image read and write goes through one file lock (rotate::lock), so a read after a turn always sees the turned file.`
- В «Tests» дописать: `rotate.spec.mjs` (quarter turns, saving, Ctrl+O), `tilt.spec.mjs` (tilt, ruler, touch), `exif.spec.mjs` (the engine honours our Orientation tag), `geometry.spec.mjs` (Node only).
- Про Prev/Next: «Prev/Next and saving a turn need a file path: launch argument, Prev/Next or Ctrl+O (native dialog). A dropped file has none.»

- [ ] **Step 3: Версия 0.1.6**

В `package.json`, `src-tauri/Cargo.toml` (`version = "0.1.6"`) и `src-tauri/tauri.conf.json` (`"version": "0.1.6"`) поднять версию. Затем:

Run: `cargo test --manifest-path src-tauri/Cargo.toml` (обновит `Cargo.lock`)
Expected: PASS.

Run: `npm test`
Expected: PASS — все тесты.

- [ ] **Step 4: Сверить спек с планом**

В спеке поправить расхождения, которые выяснились при планировании:
- «Фикстуры»: вместо закоммиченных `tests/fixtures/*.jpg` и `scripts/make-fixtures.mjs` — Rust строит синтетические JPEG в `exif::fixture`, Playwright кодирует JPEG в Edge во время теста (`exif.spec.mjs`).
- Тест PNG-чанков: `sRGB`, `tEXt`, неизвестный `teSt`, `pHYs` (вместо iCCP — без валидного zlib-профиля).
- Тест 17 объединён с тестом 1 (цвета квадрантов экспорта после поворота).
- `geometry.js` экспортирует ещё `cosSin` и `fitInside`.
- Сенсорные размеры (`pointer: coarse`) — только при ширине окна > 560 px.
- При ширине ≤ 760 px строка статуса — `minmax(0,1fr) auto auto` (‹ › не строго по центру).

- [ ] **Step 5: Commit**

```bash
git add README.md CLAUDE.md package.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json docs/superpowers/specs/2026-10-03-rotate-and-tilt-design.md
git commit -m "chore: release 0.1.6 — rotate with auto-save, tilt; docs

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 6: PROGRESS.md (локально)**

Отметить три пункта 0.1.6 как сделанные, обновить «Current state» (версия 0.1.6 в ветке, число тестов по выводу `npm test` + `cargo test`).

- [ ] **Step 7: Ручная проверка в настоящем приложении (`npm run tauri dev` не подходит: нужен путь к файлу)**

Собрать (`npm run tauri build` или GNU-сборка из CLAUDE.md), открыть через «Открыть с помощью» копию телефонного JPEG и копию PNG из Проводника:
1. ⟳, закрыть окно, открыть снова — повёрнуто; миниатюра в Проводнике обновилась.
2. Ctrl+R — поворачивает, страница не перезагружается (в WebView2 браузерные клавиши могли бы сработать; тест в Edge этого не доказывает).
3. Файл с атрибутом «Только чтение» — сообщение, файл не изменился.
4. Наклон линейкой, сохранить обрезку — углы без фона.
5. Свойства файла → «Подробно» — дата создания не изменилась после поворота PNG.
```
