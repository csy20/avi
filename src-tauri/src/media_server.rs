//! Loopback server for local media.
//!
//! WebKitGTK reports media error 4 for `asset://` URLs in a `<video>` element.
//! This server reads only files the editor has allowed, binds to 127.0.0.1,
//! and answers HTTP range requests so playback can seek.

use std::collections::HashSet;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

#[derive(Clone)]
pub struct MediaServer {
    port: u16,
    allowed: Arc<Mutex<HashSet<PathBuf>>>,
}

impl MediaServer {
    pub fn start() -> std::io::Result<Self> {
        let allowed = Arc::new(Mutex::new(HashSet::new()));
        let listener = TcpListener::bind("127.0.0.1:0")?;
        let port = listener.local_addr()?.port();
        let allowed_for_thread = Arc::clone(&allowed);
        thread::Builder::new()
            .name("avi-media".into())
            .spawn(move || accept_loop(listener, allowed_for_thread))?;
        Ok(Self { port, allowed })
    }

    pub fn base_url(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }

    pub fn allow(&self, path: &Path) -> Result<(), String> {
        let canonical = canonicalize_file(path)?;
        let mut allowed = self
            .allowed
            .lock()
            .map_err(|_| "media allow list is locked".to_string())?;
        allowed.insert(canonical);
        Ok(())
    }
}

fn canonicalize_file(path: &Path) -> Result<PathBuf, String> {
    if path.as_os_str().is_empty() {
        return Err("media path is empty".into());
    }
    let text = path.to_str().ok_or("media path is not valid unicode")?;
    if text.contains('\0') {
        return Err("media path is not valid".into());
    }
    let canonical = path.canonicalize().map_err(|error| error.to_string())?;
    if !canonical.is_file() {
        return Err("media path is not a file".into());
    }
    Ok(canonical)
}

fn accept_loop(listener: TcpListener, allowed: Arc<Mutex<HashSet<PathBuf>>>) {
    for connection in listener.incoming() {
        let Ok(stream) = connection else {
            continue;
        };
        let allowed = Arc::clone(&allowed);
        thread::spawn(move || {
            let _ = handle_connection(stream, &allowed);
        });
    }
}

fn handle_connection(mut stream: TcpStream, allowed: &Mutex<HashSet<PathBuf>>) -> std::io::Result<()> {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(10)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(60)));
    let header_text = read_headers(&mut stream)?;
    let mut lines = header_text.split("\r\n");
    let Some(request_line) = lines.next() else {
        return write_empty(&mut stream, "400 Bad Request");
    };
    let mut parts = request_line.split_whitespace();
    let Some(method) = parts.next() else {
        return write_empty(&mut stream, "400 Bad Request");
    };
    let Some(target) = parts.next() else {
        return write_empty(&mut stream, "400 Bad Request");
    };

    if method == "OPTIONS" {
        return write_empty(&mut stream, "204 No Content");
    }
    if method != "GET" && method != "HEAD" {
        return write_empty(&mut stream, "405 Method Not Allowed");
    }

    let Some(raw_path) = path_query(target) else {
        return write_empty(&mut stream, "400 Bad Request");
    };
    if raw_path.len() > 4096 || raw_path.contains('\0') {
        return write_empty(&mut stream, "400 Bad Request");
    }

    let candidate = PathBuf::from(&raw_path);
    let canonical = match canonicalize_file(&candidate) {
        Ok(path) => path,
        Err(_) => return write_empty(&mut stream, "404 Not Found"),
    };
    let allowed_path = allowed
        .lock()
        .map(|set| set.contains(&canonical))
        .unwrap_or(false);
    if !allowed_path {
        return write_empty(&mut stream, "403 Forbidden");
    }

    let mut file = File::open(&canonical)?;
    let length = file.metadata()?.len();
    let range_header = lines.find_map(|line| {
        let (name, value) = line.split_once(':')?;
        if name.eq_ignore_ascii_case("range") {
            Some(value.trim().to_string())
        } else {
            None
        }
    });

    let (status, start, end_inclusive) = if let Some(header) = range_header {
        match parse_byte_range(&header, length) {
            Some(range) => ("206 Partial Content", range.start, range.end_inclusive),
            None => return write_range_not_satisfiable(&mut stream, length),
        }
    } else if length == 0 {
        ("200 OK", 0, 0)
    } else {
        ("200 OK", 0, length - 1)
    };

    let body_len = if length == 0 {
        0
    } else {
        end_inclusive - start + 1
    };
    let content_type = content_type(&canonical);
    let mut head = format!(
        "HTTP/1.1 {status}\r\n\
         Content-Type: {content_type}\r\n\
         Accept-Ranges: bytes\r\n\
         Content-Length: {body_len}\r\n\
         {CORS}\
         Connection: close\r\n\r\n",
        CORS = cors_headers()
    );
    if status.starts_with("206") {
        head = format!(
            "HTTP/1.1 206 Partial Content\r\n\
             Content-Type: {content_type}\r\n\
             Accept-Ranges: bytes\r\n\
             Content-Range: bytes {start}-{end_inclusive}/{length}\r\n\
             Content-Length: {body_len}\r\n\
             {CORS}\
             Connection: close\r\n\r\n",
            CORS = cors_headers()
        );
    }
    stream.write_all(head.as_bytes())?;
    if method == "HEAD" || body_len == 0 {
        return Ok(());
    }

    file.seek(SeekFrom::Start(start))?;
    let mut remaining = body_len;
    let mut buffer = [0u8; 64 * 1024];
    while remaining > 0 {
        let chunk = remaining.min(buffer.len() as u64) as usize;
        let read = file.read(&mut buffer[..chunk])?;
        if read == 0 {
            break;
        }
        stream.write_all(&buffer[..read])?;
        remaining -= read as u64;
    }
    Ok(())
}

fn cors_headers() -> &'static str {
    "Access-Control-Allow-Origin: *\r\n\
     Access-Control-Allow-Methods: GET, HEAD, OPTIONS\r\n\
     Access-Control-Allow-Headers: Range\r\n\
     Access-Control-Expose-Headers: Accept-Ranges, Content-Range, Content-Length, Content-Type\r\n"
}

fn write_empty(stream: &mut TcpStream, status: &str) -> std::io::Result<()> {
    let body = status.as_bytes();
    let head = format!(
        "HTTP/1.1 {status}\r\n\
         Content-Type: text/plain; charset=utf-8\r\n\
         Content-Length: {}\r\n\
         {CORS}\
         Connection: close\r\n\r\n",
        body.len(),
        CORS = cors_headers()
    );
    stream.write_all(head.as_bytes())?;
    stream.write_all(body)?;
    Ok(())
}

fn write_range_not_satisfiable(stream: &mut TcpStream, length: u64) -> std::io::Result<()> {
    let head = format!(
        "HTTP/1.1 416 Range Not Satisfiable\r\n\
         Content-Range: bytes */{length}\r\n\
         Content-Length: 0\r\n\
         {CORS}\
         Connection: close\r\n\r\n",
        CORS = cors_headers()
    );
    stream.write_all(head.as_bytes())
}

fn read_headers(stream: &mut TcpStream) -> std::io::Result<String> {
    let mut buffer = Vec::with_capacity(1024);
    let mut byte = [0u8; 1];
    while buffer.len() < 8192 {
        let read = stream.read(&mut byte)?;
        if read == 0 {
            break;
        }
        buffer.push(byte[0]);
        if buffer.ends_with(b"\r\n\r\n") {
            break;
        }
    }
    if !buffer.ends_with(b"\r\n\r\n") {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "media request headers were incomplete",
        ));
    }
    String::from_utf8(buffer).map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))
}

fn path_query(target: &str) -> Option<String> {
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    if path != "/media" {
        return None;
    }
    for pair in query.split('&') {
        let (key, value) = pair.split_once('=')?;
        if key == "path" {
            return percent_decode(value).ok();
        }
    }
    None
}

fn percent_decode(input: &str) -> Result<String, ()> {
    let bytes = input.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            let high = from_hex(bytes[index + 1]).ok_or(())?;
            let low = from_hex(bytes[index + 2]).ok_or(())?;
            decoded.push((high << 4) | low);
            index += 3;
            continue;
        }
        decoded.push(bytes[index]);
        index += 1;
    }
    String::from_utf8(decoded).map_err(|_| ())
}

fn from_hex(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

struct ByteRange {
    start: u64,
    end_inclusive: u64,
}

fn parse_byte_range(header: &str, length: u64) -> Option<ByteRange> {
    if length == 0 {
        return None;
    }
    let spec = header.trim().strip_prefix("bytes=")?.split(',').next()?.trim();
    if let Some(suffix) = spec.strip_prefix('-') {
        let count: u64 = suffix.parse().ok()?;
        if count == 0 {
            return None;
        }
        let count = count.min(length);
        return Some(ByteRange {
            start: length - count,
            end_inclusive: length - 1,
        });
    }
    let (start_text, end_text) = spec.split_once('-')?;
    let start: u64 = start_text.parse().ok()?;
    if start >= length {
        return None;
    }
    let end_inclusive = if end_text.is_empty() {
        length - 1
    } else {
        end_text.parse::<u64>().ok()?.min(length - 1)
    };
    if end_inclusive < start {
        return None;
    }
    Some(ByteRange {
        start,
        end_inclusive,
    })
}

fn content_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "mp4" | "m4v" => "video/mp4",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        "mkv" => "video/x-matroska",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "aac" => "audio/aac",
        "m4a" => "audio/mp4",
        "flac" => "audio/flac",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpStream;
    use std::path::Path;
    use std::time::Duration;

    #[test]
    fn decodes_an_encoded_absolute_path() {
        let decoded = percent_decode("%2Fhome%2Fcsy20%2Fclip.mp4").unwrap();
        assert_eq!(decoded, "/home/csy20/clip.mp4");
    }

    #[test]
    fn parses_open_and_suffix_ranges() {
        let open = parse_byte_range("bytes=4-", 16).unwrap();
        assert_eq!((open.start, open.end_inclusive), (4, 15));
        let suffix = parse_byte_range("bytes=-4", 16).unwrap();
        assert_eq!((suffix.start, suffix.end_inclusive), (12, 15));
        assert!(parse_byte_range("bytes=20-30", 16).is_none());
    }

    #[test]
    fn serves_an_allowed_file_with_a_range() {
        let directory = std::env::temp_dir().join(format!("avi-media-{}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        let media = directory.join("clip.mp4");
        let other = directory.join("other.mp4");
        std::fs::write(&media, b"0123456789abcdef").unwrap();
        std::fs::write(&other, b"nope").unwrap();

        let server = MediaServer::start().unwrap();
        server.allow(&media).unwrap();

        let allowed = http_get(&server, &media_url(&media), Some("bytes=4-7"));
        assert!(allowed.starts_with("HTTP/1.1 206 Partial Content"), "{allowed}");
        assert!(allowed.contains("Content-Type: video/mp4"));
        assert!(allowed.contains("Content-Range: bytes 4-7/16"));
        assert!(allowed.ends_with("4567"), "{allowed}");

        let full = http_get(&server, &media_url(&media), None);
        assert!(full.starts_with("HTTP/1.1 200 OK"), "{full}");
        assert!(full.ends_with("0123456789abcdef"), "{full}");

        let forbidden = http_get(&server, &media_url(&other), None);
        assert!(forbidden.starts_with("HTTP/1.1 403 Forbidden"), "{forbidden}");

        let _ = std::fs::remove_dir_all(&directory);
    }

    fn media_url(path: &Path) -> String {
        let mut encoded = String::new();
        for byte in path.to_str().unwrap().bytes() {
            if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.') {
                encoded.push(byte as char);
            } else {
                encoded.push_str(&format!("%{byte:02X}"));
            }
        }
        format!("/media?path={encoded}")
    }

    fn http_get(server: &MediaServer, target: &str, range: Option<&str>) -> String {
        let mut stream = TcpStream::connect(format!("127.0.0.1:{}", server.port)).unwrap();
        stream.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
        let range_header = range
            .map(|value| format!("Range: {value}\r\n"))
            .unwrap_or_default();
        write!(
            stream,
            "GET {target} HTTP/1.1\r\nHost: 127.0.0.1\r\n{range_header}Connection: close\r\n\r\n"
        )
        .unwrap();
        let mut response = String::new();
        let _ = stream.read_to_string(&mut response);
        response
    }
}
