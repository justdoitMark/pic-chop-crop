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

/// The orientation stored in the file (None: no EXIF or no tag).
#[cfg(test)]
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
