//! bg-remove-rs <model.onnx> <photo> <out_mask.png> [--cpu [--no-arena]]
//!
//! The same pipeline as bench.py, through Rust `ort` with load-dynamic:
//! EXIF-aware open -> resize to the model input -> rescale/normalize from the
//! model's preprocessor_config.json -> run -> sigmoid if needed -> bicubic
//! upscale -> 8-bit mask. Prints `session_ms first_ms warm_ms`.
//!
//! onnxruntime.dll is taken from ORT_DYLIB_PATH, else from next to the exe.
//! Keep DirectML.dll next to the exe too, so Windows does not pick the older
//! copy in System32; the paths actually loaded are printed.

use std::{
    path::{Path, PathBuf},
    time::Instant,
};

use anyhow::{anyhow, bail, Context, Result};
use image::{imageops::FilterType, DynamicImage, ImageDecoder, ImageReader, Luma};
use ndarray::Array4;
use ort::{
    ep,
    session::{builder::GraphOptimizationLevel, Session},
    value::TensorRef,
};

const WARM_RUNS: usize = 5;

struct Preprocess {
    width: u32,
    height: u32,
    rescale: f32,
    mean: [f32; 3],
    std: [f32; 3],
}

fn load_preprocess(model: &Path) -> Result<Preprocess> {
    // models/<key>/onnx/model.onnx -> models/<key>/preprocessor_config.json
    let cfg_path = model
        .parent()
        .and_then(Path::parent)
        .map(|p| p.join("preprocessor_config.json"))
        .context("model path has no parent folder")?;
    let cfg: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&cfg_path)?)?;
    let num = |v: &serde_json::Value| v.as_f64().map(|x| x as f32).context("not a number");
    let triple = |key: &str| -> Result<[f32; 3]> {
        let a = cfg[key].as_array().context("missing mean/std")?;
        Ok([num(&a[0])?, num(&a[1])?, num(&a[2])?])
    };
    let normalize = cfg["do_normalize"].as_bool().unwrap_or(false);
    let rescale = if cfg["do_rescale"].as_bool().unwrap_or(false) {
        cfg.get("rescale_factor").map(num).transpose()?.unwrap_or(1.0 / 255.0)
    } else {
        1.0
    };
    Ok(Preprocess {
        width: cfg["size"]["width"].as_u64().context("size.width")? as u32,
        height: cfg["size"]["height"].as_u64().context("size.height")? as u32,
        rescale,
        mean: if normalize { triple("image_mean")? } else { [0.0; 3] },
        std: if normalize { triple("image_std")? } else { [1.0; 3] },
    })
}

/// Open in display orientation, like PIL's ImageOps.exif_transpose.
fn open_photo(path: &Path) -> Result<DynamicImage> {
    let mut decoder = ImageReader::open(path)?.with_guessed_format()?.into_decoder()?;
    let orientation = decoder.orientation()?;
    let mut img = DynamicImage::from_decoder(decoder)?;
    img.apply_orientation(orientation);
    Ok(DynamicImage::ImageRgb8(img.to_rgb8()))
}

fn to_input(img: &DynamicImage, p: &Preprocess) -> Array4<f32> {
    // Triangle = bilinear, as the configs ask for (resample: 2).
    let small = img.resize_exact(p.width, p.height, FilterType::Triangle).to_rgb8();
    let mut x = Array4::<f32>::zeros((1, 3, p.height as usize, p.width as usize));
    for (col, row, px) in small.enumerate_pixels() {
        for c in 0..3 {
            x[[0, c, row as usize, col as usize]] =
                (px[c] as f32 * p.rescale - p.mean[c]) / p.std[c];
        }
    }
    x
}

fn make_session(model: &Path, cpu: bool, no_arena: bool) -> ort::Result<Session> {
    let mut builder = Session::builder()?
        .with_optimization_level(GraphOptimizationLevel::Level3)?;
    if cpu && no_arena {
        // Without the arena (and the pre-planned memory pattern) BiRefNet fits
        // a 16 GB laptop instead of swapping or failing with bad_alloc.
        builder = builder
            .with_memory_pattern(false)?
            .with_execution_providers([ep::CPU::default().with_arena_allocator(false).build()])?;
    }
    if !cpu {
        // DirectML supports neither memory patterns nor parallel execution.
        builder = builder
            .with_memory_pattern(false)?
            .with_parallel_execution(false)?
            .with_execution_providers([ep::DirectML::default().build().error_on_failure()])?;
    }
    builder.commit_from_file(model)
}

fn run(session: &mut Session, x: &Array4<f32>) -> Result<(Vec<usize>, Vec<f32>)> {
    let name = session.inputs()[0].name().to_string();
    let outputs = session.run(ort::inputs![name => TensorRef::from_array_view(x)?])?;
    let (shape, data) = outputs[0].try_extract_tensor::<f32>()?;
    Ok((shape.iter().map(|&d| d as usize).collect(), data.to_vec()))
}

fn ms(t: Instant) -> f64 {
    (t.elapsed().as_secs_f64() * 10_000.0).round() / 10.0
}

fn save_mask(shape: &[usize], data: &[f32], size: (u32, u32), out: &Path) -> Result<bool> {
    let (h, w) = (shape[shape.len() - 2], shape[shape.len() - 1]);
    let (lo, hi) = data.iter().fold((f32::MAX, f32::MIN), |(a, b), &v| (a.min(v), b.max(v)));
    let sigmoid = lo < 0.0 || hi > 1.0;
    let vals: Vec<f32> = if sigmoid {
        data.iter().map(|v| 1.0 / (1.0 + (-v).exp())).collect()
    } else {
        data.to_vec()
    };
    let small = image::ImageBuffer::<Luma<f32>, _>::from_raw(w as u32, h as u32, vals)
        .context("output shape does not match its data")?;
    // CatmullRom = bicubic (a = -0.5), as PIL's BICUBIC used in bench.py.
    let full = image::imageops::resize(&small, size.0, size.1, FilterType::CatmullRom);
    let mask = image::ImageBuffer::from_fn(size.0, size.1, |x, y| {
        Luma([(full.get_pixel(x, y)[0].clamp(0.0, 1.0) * 255.0 + 0.5) as u8])
    });
    mask.save(out)?;
    Ok(sigmoid)
}

#[cfg(windows)]
fn loaded_from(dll: &str) -> String {
    #[link(name = "kernel32")]
    extern "system" {
        fn GetModuleHandleW(name: *const u16) -> *mut core::ffi::c_void;
        fn GetModuleFileNameW(module: *mut core::ffi::c_void, buf: *mut u16, size: u32) -> u32;
    }
    let wide: Vec<u16> = dll.encode_utf16().chain(Some(0)).collect();
    let mut buf = [0u16; 1024];
    // SAFETY: plain Win32 calls with a NUL-terminated name and a sized buffer.
    unsafe {
        let module = GetModuleHandleW(wide.as_ptr());
        if module.is_null() {
            return "not loaded".into();
        }
        let n = GetModuleFileNameW(module, buf.as_mut_ptr(), buf.len() as u32);
        String::from_utf16_lossy(&buf[..n as usize])
    }
}

#[cfg(not(windows))]
fn loaded_from(_dll: &str) -> String {
    "n/a".into()
}

fn dylib_path() -> Result<PathBuf> {
    if let Some(p) = std::env::var_os("ORT_DYLIB_PATH") {
        return Ok(PathBuf::from(p));
    }
    let exe = std::env::current_exe()?;
    Ok(exe.with_file_name("onnxruntime.dll"))
}

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let cpu = args.iter().any(|a| a == "--cpu");
    let no_arena = args.iter().any(|a| a == "--no-arena");
    let pos: Vec<&String> = args.iter().filter(|a| !a.starts_with("--")).collect();
    let [model, photo, out] = pos.as_slice() else {
        bail!("usage: bg-remove-rs <model.onnx> <photo> <out_mask.png> [--cpu [--no-arena]]");
    };
    let (model, photo, out) = (Path::new(model), Path::new(photo), Path::new(out));

    let dylib = dylib_path()?;
    if !ort::init_from(&dylib).map_err(|e| anyhow!("load {}: {e}", dylib.display()))?.commit() {
        eprintln!("note: ONNX Runtime environment was already set up");
    }

    let prep = load_preprocess(model)?;
    let img = open_photo(photo)?;
    let x = to_input(&img, &prep);

    let t = Instant::now();
    let mut session = make_session(model, cpu, no_arena).map_err(|e| anyhow!("session: {e}"))?;
    let session_ms = ms(t);

    let t = Instant::now();
    let (shape, data) = run(&mut session, &x)?;
    let first_ms = ms(t);
    let mut times = Vec::with_capacity(WARM_RUNS);
    for _ in 0..WARM_RUNS {
        let t = Instant::now();
        run(&mut session, &x)?;
        times.push(ms(t));
    }
    times.sort_by(|a, b| a.total_cmp(b));
    let warm_ms = times[WARM_RUNS / 2];

    let sigmoid = save_mask(&shape, &data, (img.width(), img.height()), out)?;
    eprintln!("onnxruntime.dll: {}", loaded_from("onnxruntime.dll"));
    eprintln!("DirectML.dll:    {}", loaded_from("DirectML.dll"));
    eprintln!("provider: {}  sigmoid: {sigmoid}", if cpu { "cpu" } else { "dml" });
    println!("session_ms={session_ms} first_ms={first_ms} warm_ms={warm_ms}");
    Ok(())
}
