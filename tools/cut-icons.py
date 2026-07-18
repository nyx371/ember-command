#!/usr/bin/env python3
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / 'assets' / 'war2-sheet.png'
OUT = ROOT / 'assets' / 'icons'
COLS = 10
ROWS = 18
SIZE = 64

ICONS = {
    'gold': (6, 13),
    'lumber': (8, 13),
    'oil': (8, 15),
    'supply': (4, 13),
    'worker': (0, 0),
    'soldier': (2, 0),
    'archer': (4, 3),
    'hall': (0, 4),
    'farm': (1, 4),
    'barracks': (2, 4),
    'enemy': (3, 8),
    'wait': (6, 17),
    'attack': (3, 8),
}

def cell_box(image, col, row):
    width, height = image.size
    return (
        round(col * width / COLS),
        round(row * height / ROWS),
        round((col + 1) * width / COLS),
        round((row + 1) * height / ROWS),
    )

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    sheet = Image.open(SRC).convert('RGBA')

    for name, (col, row) in ICONS.items():
        icon = sheet.crop(cell_box(sheet, col, row))
        icon = icon.resize((SIZE, SIZE), Image.Resampling.NEAREST)
        path = OUT / f'{name}.png'
        icon.save(path, optimize=True)
        print(path.relative_to(ROOT))

if __name__ == '__main__':
    main()
