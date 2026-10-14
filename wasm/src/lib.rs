use wasm_bindgen::{prelude::*, JsValue};

// ── Panic hook ────────────────────────────────────────────────────────────────
// Redirects Rust panics to browser console.error so debugging is bearable.
#[cfg(feature = "console_error_panic_hook")]
#[wasm_bindgen(start)]
pub fn init_panic_hook() {
    console_error_panic_hook::set_once();
}

// ── Grayscale ─────────────────────────────────────────────────────────────────
/// Convert an RGBA pixel buffer to greyscale (in-place via owned Vec).
/// Uses ITU-R BT.601 luma coefficients: Y = 0.299R + 0.587G + 0.114B.
/// Alpha channel is preserved unchanged.
#[wasm_bindgen]
pub fn grayscale(mut pixels: Vec<u8>) -> Result<Vec<u8>, JsValue> {
    if pixels.len() % 4 != 0 {
        return Err(JsValue::from_str("pixel buffer length must be a multiple of 4 (RGBA)"));
    }

    for chunk in pixels.chunks_exact_mut(4) {
        let luma = (0.299 * chunk[0] as f32
                  + 0.587 * chunk[1] as f32
                  + 0.114 * chunk[2] as f32)
                  .round() as u8;
        chunk[0] = luma;
        chunk[1] = luma;
        chunk[2] = luma;
        // chunk[3] = alpha — untouched
    }
    Ok(pixels)
}

// ── Invert ────────────────────────────────────────────────────────────────────
/// Invert every colour channel (255 - value). Alpha is preserved.
#[wasm_bindgen]
pub fn invert(mut pixels: Vec<u8>) -> Result<Vec<u8>, JsValue> {
    if pixels.len() % 4 != 0 {
        return Err(JsValue::from_str("pixel buffer length must be a multiple of 4 (RGBA)"));
    }

    for chunk in pixels.chunks_exact_mut(4) {
        chunk[0] = 255 - chunk[0];
        chunk[1] = 255 - chunk[1];
        chunk[2] = 255 - chunk[2];
    }
    Ok(pixels)
}

// ── Brightness ────────────────────────────────────────────────────────────────
/// Multiply each colour channel by `factor` and clamp to [0, 255].
/// factor > 1.0 brightens, 0.0 < factor < 1.0 darkens. Alpha preserved.
#[wasm_bindgen]
pub fn brightness(mut pixels: Vec<u8>, factor: f32) -> Result<Vec<u8>, JsValue> {
    if pixels.len() % 4 != 0 {
        return Err(JsValue::from_str("pixel buffer length must be a multiple of 4 (RGBA)"));
    }

    for chunk in pixels.chunks_exact_mut(4) {
        chunk[0] = ((chunk[0] as f32 * factor).round() as i32).clamp(0, 255) as u8;
        chunk[1] = ((chunk[1] as f32 * factor).round() as i32).clamp(0, 255) as u8;
        chunk[2] = ((chunk[2] as f32 * factor).round() as i32).clamp(0, 255) as u8;
    }
    Ok(pixels)
}

// ── Luma statistics ───────────────────────────────────────────────────────────
/// Compute per-frame luma statistics.
/// Returns a Float32Array of 4 values: [min, max, mean, pixel_count].
#[wasm_bindgen]
pub fn frame_luma_stats(pixels: &[u8]) -> Vec<f32> {
    if pixels.is_empty() || pixels.len() % 4 != 0 {
        return vec![0.0, 0.0, 0.0, 0.0];
    }
    let mut min: f32 = 255.0;
    let mut max: f32 = 0.0;
    let mut sum: f64 = 0.0;
    let mut count: u32 = 0;

    for chunk in pixels.chunks_exact(4) {
        let luma = 0.299 * chunk[0] as f32
                 + 0.587 * chunk[1] as f32
                 + 0.114 * chunk[2] as f32;
        if luma < min { min = luma; }
        if luma > max { max = luma; }
        sum   += luma as f64;
        count += 1;
    }

    let mean = if count > 0 { (sum / count as f64) as f32 } else { 0.0 };
    vec![min, max, mean, count as f32]
}

// ── Sepia ─────────────────────────────────────────────────────────────────────
/// Classic sepia tone filter. Alpha preserved.
#[wasm_bindgen]
pub fn sepia(mut pixels: Vec<u8>) -> Result<Vec<u8>, JsValue> {
    if pixels.len() % 4 != 0 {
        return Err(JsValue::from_str("pixel buffer length must be a multiple of 4 (RGBA)"));
    }

    for chunk in pixels.chunks_exact_mut(4) {
        let r = chunk[0] as f32;
        let g = chunk[1] as f32;
        let b = chunk[2] as f32;
        chunk[0] = ((0.393 * r + 0.769 * g + 0.189 * b).round() as i32).clamp(0, 255) as u8;
        chunk[1] = ((0.349 * r + 0.686 * g + 0.168 * b).round() as i32).clamp(0, 255) as u8;
        chunk[2] = ((0.272 * r + 0.534 * g + 0.131 * b).round() as i32).clamp(0, 255) as u8;
    }
    Ok(pixels)
}

// ── Color matrix ──────────────────────────────────────────────────────────────
/// Apply a row-major 4×5 color matrix to RGBA pixels.
/// Channels are converted to 0–1, multiplied, then scaled back to bytes.
/// `matrix` must contain 20 floats: four rows of `[r, g, b, a, offset]`.
#[wasm_bindgen]
pub fn color_matrix(mut pixels: Vec<u8>, matrix: &[f32]) -> Result<Vec<u8>, JsValue> {
    if pixels.len() % 4 != 0 {
        return Err(JsValue::from_str("pixel buffer length must be a multiple of 4 (RGBA)"));
    }
    if matrix.len() != 20 {
        return Err(JsValue::from_str("color matrix must contain 20 floats"));
    }

    for chunk in pixels.chunks_exact_mut(4) {
        let r = chunk[0] as f32 / 255.0;
        let g = chunk[1] as f32 / 255.0;
        let b = chunk[2] as f32 / 255.0;
        let a = chunk[3] as f32 / 255.0;

        let next = |row: usize| {
            let index = row * 5;
            matrix[index] * r
                + matrix[index + 1] * g
                + matrix[index + 2] * b
                + matrix[index + 3] * a
                + matrix[index + 4]
        };

        chunk[0] = (next(0) * 255.0).round().clamp(0.0, 255.0) as u8;
        chunk[1] = (next(1) * 255.0).round().clamp(0.0, 255.0) as u8;
        chunk[2] = (next(2) * 255.0).round().clamp(0.0, 255.0) as u8;
        chunk[3] = (next(3) * 255.0).round().clamp(0.0, 255.0) as u8;
    }

    Ok(pixels)
}
