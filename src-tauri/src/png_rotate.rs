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
