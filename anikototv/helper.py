r"""
Anime capture helper: saves what the "Anime Capture" Tampermonkey script
captures on anime sites into your capture folder (settings.json, see below):
  ]  screenshot - the video's own frame, as the best JPEG that stays under 200 KB
  =  start recording, -  stop - the video with its sound, as MP4
Names: "2026-10-25 14-03-27 The Apothecary Diaries S3E1.jpg" (OBS's date style).
Never overwrites: adds " (2)".

Runs hidden (start-helper.vbs, or pythonw helper.py); put a shortcut to
start-helper.vbs in shell:startup to start it with Windows. Only one runs at a
time (the port is taken).

  pythonw helper.py          (http://127.0.0.1:8767)

Capture folder: settings.json next to this file, {"save_folder": "D:\Anime captures"}
(a pasted path with single backslashes is fine). The first start makes it, set
to Pictures\Anime captures. It is read again for every capture, so a change
works at once.

Safety
- Listens on 127.0.0.1 only, and only answers Host 127.0.0.1 / localhost.
- Every call needs the secret key (header X-ACap-Key). /key gives it only to
  requests made by an extension (Tampermonkey's GM_xmlhttpRequest), never to
  a web page. Key, log and the list of unfinished recordings live in
  %LOCALAPPDATA%\AnimeCapture\.
- Only writes new files into the capture folder.

API (JSON replies)
  GET  /key  ·  GET /ping  ·  GET /anime-capture.user.js (install / update)
  POST /shot?name=&ep=&t=    body: the frame as PNG
  POST /rec/start            {name, ep, t, mime}       -> {id, file}
  POST /rec/chunk?id=&seq=   body: the next piece of the recording
  POST /rec/alive            {id}   (every 15 s while recording, paused too)
  POST /rec/stop             {id, chunks}               -> {ok, file}
A recording whose page went away (tab closed, next episode) is finished by
itself 90 s after the last sign of life.
"""
import io
import json
import os
import re
import secrets
import shutil
import socket
import subprocess
import sys
import threading
import time
import traceback
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import numpy as np
from PIL import Image

# pythonw has no console: anything printed would raise.
if sys.stdout is None:
    sys.stdout = open(os.devnull, 'w')
if sys.stderr is None:
    sys.stderr = open(os.devnull, 'w')

VERSION = '1.2.2'
HERE = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get('ACAP_PORT', 8767))                                      # env: tests


def read_save_folder(path):
    r"""The "save_folder" in settings.json, or None. A Windows path pasted as
    it is ("D:\Anime captures", single backslashes) isn't valid JSON, so that
    is read too."""
    try:
        with open(path, encoding='utf-8-sig') as f:
            text = f.read()
    except OSError:
        return None
    try:
        folder = json.loads(text).get('save_folder')
    except (ValueError, AttributeError):
        m = re.search(r'"save_folder"\s*:\s*"([^"]+)"', text)
        folder = m.group(1).replace('\\\\', '\\') if m else None
    folder = str(folder or '').strip()
    return os.path.expandvars(os.path.expanduser(folder)) if folder else None


DEFAULT_FOLDER = os.path.join(os.path.expanduser('~'), 'Pictures', 'Anime captures')


def capture_dir():
    """Read again for every capture, so a changed settings.json works at once."""
    return os.environ.get('ACAP_DIR') or read_save_folder(os.path.join(HERE, 'settings.json')) or DEFAULT_FOLDER
DATA = os.environ.get('ACAP_DATA') or os.path.join(
    os.environ.get('LOCALAPPDATA') or os.path.join(os.path.expanduser('~'), 'AppData', 'Local'), 'AnimeCapture')
TEST_ORIGIN = os.environ.get('ACAP_TEST_ORIGIN', '')     # tests only: a page allowed to call like the userscript
KEY_FILE = os.path.join(DATA, 'key.txt')
LOG_FILE = os.path.join(DATA, 'helper.log')
ACTIVE_FILE = os.path.join(DATA, 'recording.json')
SCRIPT = os.path.join(HERE, 'anime-capture.user.js')
SHOT_MAX = 200 * 1024            # screenshot JPEG cap
MIN_FREE = 3 * 1024 ** 3         # don't start a recording with less free space than this
ALIVE_TIMEOUT = float(os.environ.get('ACAP_ALIVE', 90))   # s without pieces / heartbeats -> finished
NO_WINDOW = 0x08000000           # CREATE_NO_WINDOW
BELOW_NORMAL = 0x00004000        # BELOW_NORMAL_PRIORITY_CLASS

os.makedirs(DATA, exist_ok=True)
if not os.path.exists(KEY_FILE):
    with open(KEY_FILE, 'w', encoding='utf8') as f:
        f.write(secrets.token_hex(24))
with open(KEY_FILE, encoding='utf8') as f:
    KEY = f.read().strip()

_log_lock = threading.Lock()


def log(msg):
    line = f'{datetime.now():%Y-%m-%d %H:%M:%S}  {msg}\n'
    with _log_lock:
        try:
            if os.path.exists(LOG_FILE) and os.path.getsize(LOG_FILE) > 1024 * 1024:
                with open(LOG_FILE, encoding='utf8', errors='replace') as f:
                    keep = f.read()[-256 * 1024:]
                with open(LOG_FILE, 'w', encoding='utf8') as f:
                    f.write(keep)
            with open(LOG_FILE, 'a', encoding='utf8') as f:
                f.write(line)
        except OSError:
            pass


def find_ffmpeg():
    """ffmpeg on PATH, or ffmpeg.exe put next to this file."""
    for p in (shutil.which('ffmpeg'), os.path.join(HERE, 'ffmpeg.exe')):
        if p and os.path.isfile(p):
            return p
    return None


# ------------------------------------------------------------------ names
def clean(s):
    """A piece of a Windows file name: no : / \\ | ? * < > " or control characters."""
    s = re.sub(r'\s*:\s+', ' - ', str(s or ''))          # "Title: Sub" -> "Title - Sub"
    s = s.replace(':', '-').replace('/', '-').replace('\\', '-').replace('|', '-').replace('"', "'")
    s = re.sub(r'[<>?*\x00-\x1f]', '', s)
    return re.sub(r'\s+', ' ', s).strip().rstrip('. ')


SEASON = re.compile(r'\s+(?:season\s*(\d+)|(\d+)(?:st|nd|rd|th)\s+season|s(\d+))$', re.I)


def label(name, ep):
    """"The Apothecary Diaries Season 3", "1" -> "The Apothecary Diaries S3E1";
    "One Piece", "1150" -> "One Piece E1150"."""
    n = clean(name)[:120].rstrip('. -') or 'Anime'
    season = None
    m = SEASON.search(n)
    if m and m.start() > 0:
        season = int(next(g for g in m.groups() if g))
        n = n[:m.start()].rstrip(' -')
    e = str(ep or '').strip()
    em = re.fullmatch(r'0*(\d+)(?:\.(\d+))?', e)
    e = (em.group(1) + ('.' + em.group(2) if em.group(2) else '')) if em else clean(e)[:20]
    if season and e:
        return f'{n} S{season}E{e}'
    if season:
        return f'{n} S{season}'
    return f'{n} E{e}' if e else n


def stamp(ms):
    """OBS's style: "2026-10-25 14-03-27", at the moment the key was pressed."""
    try:
        s = float(ms) / 1000
        d = datetime.fromtimestamp(s) if abs(s - time.time()) < 86400 else datetime.now()
    except (TypeError, ValueError, OverflowError, OSError):
        d = datetime.now()
    return d.strftime('%Y-%m-%d %H-%M-%S')


_name_lock = threading.Lock()


def reserve(base, ext, also=()):
    """A new file in the capture folder, created empty so nothing else can take
    it: "<base><ext>", or "<base> (2)<ext>" ... Paths in `also` (suffixes added
    to the name) must be free too."""
    folder = capture_dir()
    os.makedirs(folder, exist_ok=True)
    with _name_lock:
        for i in range(1, 10000):
            p = os.path.join(folder, (base if i == 1 else f'{base} ({i})') + ext)
            if os.path.exists(p) or any(os.path.exists(p + a) for a in also):
                continue
            open(p, 'xb').close()
            return p
    raise OSError('no free file name')


# ------------------------------------------------------------- screenshots
def _highest(im, sub):
    """Highest JPEG quality (30-95) of im that fits SHOT_MAX, or None."""
    lo, hi, best = 30, 95, None
    while lo <= hi:
        q = (lo + hi) // 2
        b = io.BytesIO()
        im.save(b, 'JPEG', quality=q, subsampling=sub, optimize=True, progressive=True)
        if b.tell() <= SHOT_MAX:
            best, lo = (q, b.getvalue()), q + 1
        else:
            hi = q - 1
    return best


def best_jpeg(img):
    """The best JPEG of img under 200 KB. Tries full colour detail (4:4:4) and
    halved colour detail (4:2:0), each at the highest quality that fits, and
    keeps the one closer to the frame (brightness errors count double, as the
    eye sees them more). Shrinks the picture only if neither fits.
    Returns (bytes, (w, h), quality, subsampling)."""
    img = img.convert('RGB')
    w0, h0 = img.size
    scale = 1.0
    while True:
        im = img if scale == 1.0 else img.resize((max(16, round(w0 * scale)), max(16, round(h0 * scale))),
                                                 Image.LANCZOS)
        ref = np.asarray(im.convert('YCbCr'), np.float32)
        best = None
        for sub in (0, 2):
            r = _highest(im, sub)
            if not r:
                continue
            got = np.asarray(Image.open(io.BytesIO(r[1])).convert('YCbCr'), np.float32)
            m = ((ref - got) ** 2).reshape(-1, 3).mean(0)
            err = m[0] + 0.25 * (m[1] + m[2])
            if best is None or err < best[0]:
                best = (err, r[1], r[0], sub)
        if best:
            return best[1], im.size, best[2], best[3]
        scale *= 0.85


def save_shot(body, q):
    img = Image.open(io.BytesIO(body))
    if img.format not in ('PNG', 'JPEG', 'WEBP', 'BMP'):
        raise ValueError('not a picture')
    t0 = time.time()
    data, size, quality, sub = best_jpeg(img)
    out = reserve(f"{stamp(q.get('t'))} {label(q.get('name'), q.get('ep'))}", '.jpg')
    with open(out, 'wb') as f:
        f.write(data)
    log(f'shot {os.path.basename(out)}  {size[0]}x{size[1]} q{quality} '
        f'{"444" if sub == 0 else "420"} {len(data) // 1024} KB  {time.time() - t0:.2f}s')
    return {'ok': True, 'file': os.path.basename(out), 'kb': len(data) // 1024,
            'w': size[0], 'h': size[1], 'q': quality}


# -------------------------------------------------------------- recordings
recs = {}
_recs_lock = threading.Lock()


def _save_active():
    with _recs_lock:
        parts = [r.part for r in recs.values() if not r.closed]
    try:
        with open(ACTIVE_FILE, 'w', encoding='utf8') as f:
            json.dump(parts, f)
    except OSError:
        pass


class Recording:
    """One recording: pieces arrive in order (seq 0, 1, 2 ...) and are appended
    to "<final>.part" in the capture folder; at the end ffmpeg rewrites it as
    a normal MP4 (seekable, with its length) without re-encoding."""

    def __init__(self, name, ep, t, mime):
        mime = str(mime or '').lower()
        ext = '.mp4' if ('mp4' in mime or 'avc1' in mime or 'h264' in mime) else '.webm'
        self.final = reserve(f'{stamp(t)} {label(name, ep)}', ext, also=('.part',))
        self.part = self.final + '.part'
        os.replace(self.final, self.part)          # the reserved name becomes the .part file
        self.id = secrets.token_hex(8)
        self.mime = mime
        self.ref = None                            # the browser's own look of the first frame (PNG)
        self.f = open(self.part, 'ab')
        self.next = 0
        self.pending = {}
        self.expect = None                         # number of pieces, once stop arrives
        self.alive = time.time()
        self.closed = False
        self.bytes = 0
        self.lock = threading.Lock()

    def add(self, seq, data):
        with self.lock:
            if self.closed:
                return False
            self.alive = time.time()
            if seq >= self.next and seq not in self.pending:
                self.pending[seq] = data
            while self.next in self.pending:
                d = self.pending.pop(self.next)
                self.f.write(d)
                self.bytes += len(d)
                self.next += 1
            done = self.expect is not None and self.next >= self.expect
        if done:
            self.close('stopped')
        return True

    def stop(self, chunks):
        with self.lock:
            self.expect = max(0, int(chunks))
            self.alive = time.time()
            done = self.next >= self.expect
        if done:
            self.close('stopped')

    def close(self, why):
        with self.lock:
            if self.closed:
                return
            self.closed = True
            for seq in sorted(self.pending):       # a missing piece: keep what came
                self.f.write(self.pending[seq])
                self.bytes += len(self.pending[seq])
            self.pending.clear()
            self.f.close()
        log(f'rec {self.id} closed ({why}), {self.next} pieces, {self.bytes / 1e6:.1f} MB')
        _save_active()
        h264 = any(k in self.mime for k in ('avc1', 'h264'))
        threading.Thread(target=finish, args=(self.part, self.ref if h264 else None), daemon=True).start()


def colour_fix(ff, src, ref):
    """Browsers store a recording's colours one way and often label them
    another (Chromium: BT.601 or BT.709 numbers depending on the route a frame
    took, labelled BT.709 or not at all), so players can show reds too orange
    and greens too dull. The script sends a small copy of one of the first
    frames exactly as it went to the recorder (ref); the reading of the file
    that matches it best (on its closest frame among the first ones) is the
    right one. Returns (matrix code, full range, note) for h264_metadata,
    (None, None, note) when it can't tell, or None."""
    try:
        want = np.asarray(Image.open(ref).convert('RGB'), np.float32)
    except (OSError, ValueError):
        return None
    h, w = want.shape[:2]
    errs = []
    for name, code in (('bt601', 6), ('bt709', 1)):
        for rng, full in (('tv', 0), ('pc', 1)):
            try:
                r = subprocess.run([ff, '-v', 'error', '-i', src, '-frames:v', '20', '-vf',
                                    f'scale={w}:{h}:in_color_matrix={name}:in_range={rng}:flags=area,format=rgb24',
                                    '-f', 'rawvideo', '-'], capture_output=True, timeout=120, creationflags=NO_WINDOW)
            except (OSError, subprocess.SubprocessError):
                continue
            n = len(r.stdout) // (w * h * 3)
            if r.returncode or not n:
                continue
            got = np.frombuffer(r.stdout[:n * w * h * 3], np.uint8).reshape(n, h, w, 3).astype(np.float32)
            # Compared as 4x4-pixel averages: the colours matter, not how
            # the browser and ffmpeg shrink sharp edges.
            hh, ww = h // 4 * 4, w // 4 * 4
            a = got[:, :hh, :ww].reshape(n, hh // 4, 4, ww // 4, 4, 3).mean((2, 4))
            b = want[:hh, :ww].reshape(hh // 4, 4, ww // 4, 4, 3).mean((1, 3))
            err = float(((a - b) ** 2).reshape(n, -1).mean(1).min())
            errs.append((err, code, full, f'{name} {rng}'))
    if len(errs) < 2:
        return None
    errs.sort()
    best = errs[0]
    other = min((e[0] for e in errs if e[1] != best[1]), default=None)
    note = ', '.join(f'{e[3]} {e[0]:.0f}' for e in errs)
    if other is None or best[0] > 0.6 * other:     # a grey-ish frame: both readings look alike
        return None, None, note
    return best[1], best[2], note


def finish(part, ref=None):
    """"<x>.mp4.part" -> "<x>.mp4": ffmpeg copies the streams into a normal file
    (an index at the front, so players can seek), with the colour label fixed
    to match what the browser showed (colour_fix). If ffmpeg can't, the raw
    recording is kept under the final name (it still plays)."""
    try:
        _finish(part, ref)
    finally:
        if ref:
            try:
                os.remove(ref)
            except OSError:
                pass


def _finish(part, ref):
    final = part[:-len('.part')]
    try:
        size = os.path.getsize(part)
    except OSError:
        return
    if size < 2048:
        os.remove(part)
        log(f'  empty recording dropped {os.path.basename(final)}')
        return
    if os.path.exists(final):
        base, ext = os.path.splitext(final)
        final = reserve(os.path.basename(base), ext)
        os.remove(final)
    ext = os.path.splitext(final)[1]
    tmp = final[:-len(ext)] + '.saving' + ext
    ff = find_ffmpeg()
    ok = False
    if ff:
        args = [ff, '-hide_banner', '-loglevel', 'error', '-y', '-i', part, '-map', '0', '-c', 'copy']
        if ext == '.mp4':
            args += ['-movflags', '+faststart']
        fix = colour_fix(ff, part, ref) if ref else None
        if fix:
            log(f'  colours: {fix[2]}' + ('' if fix[0] else ' -> left as it was'))
            if fix[0]:
                args += ['-bsf:v', f'h264_metadata=matrix_coefficients={fix[0]}:colour_primaries=1:'
                                   f'transfer_characteristics=1:video_full_range_flag={fix[1]}']
        try:
            r = subprocess.run(args + [tmp], capture_output=True, timeout=3600,
                               creationflags=NO_WINDOW | BELOW_NORMAL)
            ok = r.returncode == 0 and os.path.exists(tmp) and os.path.getsize(tmp) > size * 0.5
            if not ok:
                log('  ffmpeg: ' + (r.stderr or b'').decode('utf8', 'replace').strip().splitlines()[-1:][0]
                    if r.stderr else '  ffmpeg failed')
        except (OSError, subprocess.SubprocessError, IndexError) as e:
            log(f'  ffmpeg: {e}')
    try:
        if ok:
            os.replace(tmp, final)
            os.remove(part)
        else:
            if os.path.exists(tmp):
                os.remove(tmp)
            os.replace(part, final)
        log(f'  saved {os.path.basename(final)} ({os.path.getsize(final) / 1e6:.1f} MB'
            f'{"" if ok else ", raw"})')
    except OSError as e:
        log(f'  could not finish {part}: {e}')


def watchdog():
    """Finishes recordings whose page went away (no pieces or heartbeats)."""
    while True:
        time.sleep(min(10.0, ALIVE_TIMEOUT / 3))
        now = time.time()
        with _recs_lock:
            items = list(recs.items())
        for rid, r in items:
            if not r.closed and now - r.alive > ALIVE_TIMEOUT:
                r.close('page went away')
            if r.closed and now - r.alive > 600:
                with _recs_lock:
                    recs.pop(rid, None)


def recover():
    """Recordings left unfinished when the helper last stopped (PC shut down)."""
    try:
        with open(ACTIVE_FILE, encoding='utf8') as f:
            parts = json.load(f)
    except (OSError, ValueError):
        return
    for p in parts:
        if isinstance(p, str) and p.endswith('.part') and os.path.exists(p):
            log(f'finishing a recording left over: {os.path.basename(p)}')
            finish(p)
    _save_active()


# ------------------------------------------------------------------ server
def from_extension(h):
    origin = h.get('Origin') or ''
    if TEST_ORIGIN and origin == TEST_ORIGIN:
        return True
    return ((not origin or re.match(r'^(chrome|moz)-extension://', origin) is not None)
            and (h.get('Sec-Fetch-Site') or 'none') == 'none')


class Handler(BaseHTTPRequestHandler):
    server_version = 'AnimeCapture/' + VERSION
    protocol_version = 'HTTP/1.1'

    def log_message(self, fmt, *args):     # quiet (pythonw has no console)
        pass

    def _cors(self):
        if TEST_ORIGIN and self.headers.get('Origin') == TEST_ORIGIN:
            self.send_header('Access-Control-Allow-Origin', TEST_ORIGIN)

    def send(self, code, obj, ctype='application/json'):
        body = obj if isinstance(obj, bytes) else json.dumps(obj).encode('utf8')
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        if TEST_ORIGIN and self.headers.get('Origin') == TEST_ORIGIN:
            self.send_header('Access-Control-Allow-Origin', TEST_ORIGIN)
            self.send_header('Access-Control-Allow-Methods', 'GET, POST')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-ACap-Key')
        self.send_header('Content-Length', '0')
        self.end_headers()

    def body(self, limit):
        n = int(self.headers.get('Content-Length') or 0)
        if n > limit:
            raise ValueError('too big')
        return self.rfile.read(n) if n else b''

    def do_GET(self):
        self.route('GET')

    def do_POST(self):
        self.route('POST')

    def route(self, method):
        try:
            host = (self.headers.get('Host') or '').lower()
            if host not in (f'127.0.0.1:{PORT}', f'localhost:{PORT}'):
                return self.send(403, {'error': 'host'})
            u = urlparse(self.path)
            q = {k: v[0] for k, v in parse_qs(u.query).items()}
            p = u.path

            if p == '/anime-capture.user.js':
                with open(SCRIPT, 'rb') as f:
                    return self.send(200, f.read(), 'text/javascript; charset=utf-8')
            if p == '/key':
                return (self.send(200, {'key': KEY}) if from_extension(self.headers)
                        else self.send(403, {'error': 'not from the userscript'}))
            if self.headers.get('X-ACap-Key') != KEY:
                return self.send(403, {'error': 'key'})
            if p == '/ping':
                return self.send(200, {'ok': True, 'version': VERSION, 'dir': capture_dir(),
                                       'ffmpeg': bool(find_ffmpeg())})
            if method != 'POST':
                return self.send(404, {'error': 'unknown'})

            if p == '/shot':
                return self.send(200, save_shot(self.body(80 * 1024 * 1024), q))

            if p == '/rec/ref':
                with _recs_lock:
                    r = recs.get(q.get('id'))
                if not r or r.closed:
                    return self.send(404, {'error': 'recording not found'})
                body = self.body(8 * 1024 * 1024)
                if body[:8] != b'\x89PNG\r\n\x1a\n':
                    return self.send(400, {'error': 'not a PNG'})
                ref = os.path.join(DATA, f'ref-{r.id}.png')
                with open(ref, 'wb') as f:
                    f.write(body)
                r.ref = ref
                return self.send(200, {'ok': True})

            if p == '/rec/chunk':
                with _recs_lock:
                    r = recs.get(q.get('id'))
                if not r:
                    return self.send(404, {'error': 'recording not found'})
                ok = r.add(int(q.get('seq', -1)), self.body(64 * 1024 * 1024))
                return self.send(200 if ok else 409, {'ok': ok} if ok else {'error': 'recording already finished'})

            b = json.loads(self.body(10000) or b'{}')
            if p == '/rec/start':
                folder = capture_dir()
                while folder and not os.path.isdir(folder) and os.path.dirname(folder) != folder:
                    folder = os.path.dirname(folder)          # not made yet: check the drive it will be on
                if os.path.isdir(folder) and shutil.disk_usage(folder).free < MIN_FREE:
                    return self.send(507, {'error': 'the drive is nearly full'})
                r = Recording(b.get('name'), b.get('ep'), b.get('t'), b.get('mime'))
                with _recs_lock:
                    recs[r.id] = r
                _save_active()
                log(f'rec {r.id} started {os.path.basename(r.final)} ({r.mime})')
                return self.send(200, {'id': r.id, 'file': os.path.basename(r.final)})
            with _recs_lock:
                r = recs.get(str(b.get('id')))
            if p == '/rec/alive':
                if r and not r.closed:
                    r.alive = time.time()
                return self.send(200, {'ok': bool(r and not r.closed)})
            if p == '/rec/stop':
                if not r:
                    return self.send(404, {'error': 'recording not found'})
                r.stop(b.get('chunks', 0))
                return self.send(200, {'ok': True, 'file': os.path.basename(r.final)})
            return self.send(404, {'error': 'unknown'})
        except Exception as e:  # noqa: BLE001 - reported to the script and the log
            log('error ' + traceback.format_exc().strip().replace('\n', ' | ')[-600:])
            try:
                self.send(500, {'error': str(e) or e.__class__.__name__})
            except OSError:
                pass


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = False      # on Windows that would let a second helper share the port

    def server_bind(self):
        if hasattr(socket, 'SO_EXCLUSIVEADDRUSE'):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def ensure_settings():
    """First start: make settings.json next to this file, set to the default
    folder, so there is a file to open and change (tests set ACAP_DIR)."""
    p = os.path.join(HERE, 'settings.json')
    if os.path.exists(p) or os.environ.get('ACAP_DIR'):
        return
    try:
        with open(p, 'w', encoding='utf8') as f:
            json.dump({'save_folder': DEFAULT_FOLDER}, f, indent=2)
            f.write('\n')
        log(f'made {p}')
    except OSError as e:
        log(f'could not make settings.json: {e}')


def main():
    try:
        srv = Server(('127.0.0.1', PORT), Handler)
    except OSError as e:
        log(f'not started, port {PORT} taken ({e.strerror}) - already running?')
        return
    ensure_settings()
    log(f'helper {VERSION} listening on 127.0.0.1:{PORT}, saving to {capture_dir()}')
    threading.Thread(target=recover, daemon=True).start()
    threading.Thread(target=watchdog, daemon=True).start()
    srv.serve_forever()


if __name__ == '__main__':
    main()
