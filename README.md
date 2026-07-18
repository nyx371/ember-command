# Ember Command

A simple vanilla HTML/CSS/JS web-based abstract RTS prototype inspired by incremental/clicker survival games like **A Dark Room**.

You begin in darkness, light the fire, gather supplies, set traps, build huts, assign workers, and grow toward a minimal RTS command layer.

## Run locally

Open `index.html` in a browser, or serve the folder with any static file server.

```bash
python3 -m http.server 5173
```

## Design direction

- Plain static site: no React, no build step, GitHub Pages native.
- Warcraft 2 mindset: simple data structures, explicit systems, one render pass.
- Phone-first HUD: iPhone 15 Pro viewport, no body scroll; only the log scrolls.
- Mobile zoom guarded with viewport scaling limits plus touch/gesture prevention.
- Cache-bust `styles.css` and `app.js` query strings on every push.
- Dark, flat styling with a tiny palette; no gradients.
- Warcraft 2 icons fetched from Warcraft Wiki/wikigg into separate PNGs under `assets/icons/`.
- Warcraft 2-style loop: gold/lumber/oil, workers/soldiers/archers, hall/farms/barracks.
- Resources live at the top; structures, units, workers, enemy, and commands live inside the central world canvas.
- Workers are assigned to gold/lumber/idle and harvest automatically on a cooldown.
- Training/building uses producer cooldowns instead of instant completion.
- Worker tiles are full-bleed image buttons with resource/cooldown overlays.
