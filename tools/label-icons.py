#!/usr/bin/env python3
"""
Icon labeler — run from repo root: python3 tools/label-icons.py
Opens a browser UI to tab through all sprite sheet tiles and name them.
On submit, named tiles are saved as assets/icons/{name}.png.
Labels are persisted in assets/icons/raw/labels.json between sessions.
"""
import http.server, json, os, shutil, webbrowser
from pathlib import Path

RAW_DIR    = Path(__file__).parent.parent / 'assets/icons/raw'
OUT_DIR    = Path(__file__).parent.parent / 'assets/icons'
LABELS_FILE = RAW_DIR / 'labels.json'
PORT       = 7777
COUNT      = len(list(RAW_DIR.glob('*.png')))

# User-confirmed names only (h_ = human, o_ = orc, n_ = neutral)
GUESSES = {
    # Row 0
    5:  'o_axethrower',   6:  'h_ranger',
    # Row 1
    10: 'h_paladin',      12: 'h_demolition',   13: 'o_sapper',
    14: 'h_mage',         15: 'o_deathknight',  17: 'o_catapult',
    19: 'o_oiltanker',
    # Row 2
    20: 'h_transport',    21: 'o_transport',     22: 'h_destroyer',
    24: 'h_battleship',   25: 'o_juggernaut',    26: 'h_submarine',
    27: 'o_turtle',       28: 'h_flyingmachine',
    # Row 3
    30: 'h_gryphon',      31: 'o_dragon',        32: 'h_lothar',
    33: 'o_guldan',       34: 'h_uther',         36: 'o_chogall',
    37: 'n_daemon',
    # Row 4
    40: 'h_townhall',     42: 'h_barracks',      43: 'o_barracks',
    44: 'h_lumbermill',   45: 'o_lumbermill',    48: 'h_shipyard',
    49: 'o_shipyeard',
    # Row 5
    53: 'o_foundry',
}

def load_labels():
    """Merge saved labels over guesses. Saved labels win."""
    labels = {str(k): v for k, v in GUESSES.items()}
    if LABELS_FILE.exists():
        saved = json.loads(LABELS_FILE.read_text())
        labels.update(saved)
    return labels

def save_labels(names: dict):
    existing = json.loads(LABELS_FILE.read_text()) if LABELS_FILE.exists() else {}
    existing.update(names)
    LABELS_FILE.write_text(json.dumps(existing, indent=2))


HTML = """<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>WC2 Icon Labeler</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #111; color: #ccc; font: 13px/1.4 monospace; padding: 16px; }
  h1 { color: #fff; margin-bottom: 12px; font-size: 15px; }
  .grid { display: grid; grid-template-columns: repeat(10, 1fr); gap: 6px; }
  .cell { display: flex; flex-direction: column; align-items: center; gap: 4px; }
  .cell img { image-rendering: pixelated; width: 92px; height: 76px; background: #222; border: 1px solid #333; }
  .cell span { font-size: 9px; color: #555; }
  .cell input {
    width: 100%; background: #1a1a1a; border: 1px solid #444; color: #eee;
    padding: 2px 4px; font: 11px monospace; border-radius: 2px;
  }
  .cell input:focus { outline: none; border-color: #888; background: #222; }
  .cell input.named { border-color: #5a8; color: #8fa; }
  footer { margin-top: 16px; display: flex; gap: 12px; align-items: center; }
  button {
    background: #335; border: 1px solid #557; color: #aac; padding: 6px 20px;
    font: 13px monospace; cursor: pointer; border-radius: 3px;
  }
  button:hover { background: #446; }
  #status { color: #8a8; font-size: 12px; }
  .divider { grid-column: 1 / -1; border-top: 1px solid #222; margin: 4px 0; }
</style>
</head>
<body>
<h1>WC2 Icon Labeler &mdash; tab through, name what you know, submit to save</h1>
<div class="grid" id="grid"></div>
<footer>
  <button onclick="submit()">Save named icons</button>
  <span id="status"></span>
</footer>
<script>
const COUNT = ICON_COUNT;
const grid = document.getElementById('grid');

async function init() {
  const labels = await fetch('/labels').then(r => r.json());
  for (let i = 0; i < COUNT; i++) {
    if (i > 0 && i % 10 === 0) {
      const div = document.createElement('div');
      div.className = 'divider';
      grid.appendChild(div);
    }
    const id = String(i).padStart(3, '0');
    const name = labels[id] || labels[String(i)] || '';
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.innerHTML = `
      <img src="/raw/${id}.png" title="${id}">
      <span>${id}</span>
      <input type="text" id="n${id}" value="${name}" tabindex="${i+1}"
        class="${name ? 'named' : ''}"
        oninput="this.classList.toggle('named', this.value.trim() !== '')">
    `;
    grid.appendChild(cell);
  }
}
init();

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
    e.preventDefault();
    const idx = parseInt(e.target.id.slice(1));
    const next = document.getElementById('n' + String(idx + 1).padStart(3, '0'));
    if (next) next.focus(); else submit();
  }
});

async function submit() {
  const names = {};
  for (let i = 0; i < COUNT; i++) {
    const id = String(i).padStart(3, '0');
    const val = document.getElementById('n' + id).value.trim();
    if (val) names[id] = val;
  }
  const status = document.getElementById('status');
  status.textContent = 'Saving…';
  const r = await fetch('/rename', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(names)
  });
  const res = await r.json();
  status.textContent = res.message;
}
</script>
</body>
</html>
""".replace('ICON_COUNT', str(COUNT))


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def do_GET(self):
        if self.path == '/':
            data = HTML.encode()
            self.send_response(200)
            self.send_header('Content-Type', 'text/html')
            self.send_header('Content-Length', len(data))
            self.end_headers()
            self.wfile.write(data)
        elif self.path == '/labels':
            data = json.dumps(load_labels()).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', len(data))
            self.end_headers()
            self.wfile.write(data)
        elif self.path.startswith('/raw/'):
            fname = self.path[5:]
            fpath = RAW_DIR / fname
            if fpath.exists():
                data = fpath.read_bytes()
                self.send_response(200)
                self.send_header('Content-Type', 'image/png')
                self.send_header('Content-Length', len(data))
                self.end_headers()
                self.wfile.write(data)
            else:
                self.send_error(404)
        else:
            self.send_error(404)

    def do_POST(self):
        if self.path == '/rename':
            length = int(self.headers['Content-Length'])
            names = json.loads(self.rfile.read(length))
            saved = []
            for icon_id, name in names.items():
                src = RAW_DIR / f'{icon_id}.png'
                safe = ''.join(c for c in name if c.isalnum() or c in '_-')
                if src.exists() and safe:
                    shutil.copy2(src, OUT_DIR / f'{safe}.png')
                    saved.append(safe)
            save_labels(names)
            msg = f'Saved {len(saved)} icons: {", ".join(saved[:8])}{"…" if len(saved) > 8 else ""}'
            data = json.dumps({'message': msg}).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', len(data))
            self.end_headers()
            self.wfile.write(data)
        else:
            self.send_error(404)


if __name__ == '__main__':
    server = http.server.HTTPServer(('localhost', PORT), Handler)
    url = f'http://localhost:{PORT}'
    print(f'Icon labeler running at {url}')
    print('Press Ctrl-C to stop.')
    webbrowser.open(url)
    server.serve_forever()
