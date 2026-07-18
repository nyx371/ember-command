#!/usr/bin/env python3
import json
import urllib.parse
import urllib.request
from io import BytesIO
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets' / 'icons'
API = 'https://warcraft.wiki.gg/api.php'
USER_AGENT = 'OpenClaw Nyx asset helper (https://github.com/nyx371/ember-command)'
SIZE = 64

ICONS = {
    'gold': 'SmGoldWC2.gif',
    'lumber': 'SmLumberWC2.gif',
    'oil': 'SmOilWC2.gif',
    'supply': 'SmFoodWC2.png',
    'worker': 'Peasant.gif',
    'soldier': 'Foot.gif',
    'archer': 'Wc2ranger.gif',
    'hall': 'HumanTownhall.gif',
    'farm': 'HumanFarm.gif',
    'barracks': 'Barracks.gif',
    'enemy': 'Grunt.gif',
    'wait': 'IconSearchforoil.gif',
    'attack': 'WC2HumanUpgradeWeapons.gif',
}

def api_query(params):
    query = urllib.parse.urlencode(params)
    req = urllib.request.Request(f'{API}?{query}', headers={'User-Agent': USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.load(response)

def file_urls(file_names):
    titles = '|'.join(f'File:{name}' for name in file_names)
    data = api_query({
        'action': 'query',
        'titles': titles,
        'prop': 'imageinfo',
        'iiprop': 'url',
        'format': 'json',
        'origin': '*',
    })
    urls = {}
    for page in data['query']['pages'].values():
        title = page['title'].replace('File:', '')
        if 'missing' in page:
            raise RuntimeError(f'Missing wiki file: {title}')
        urls[title] = page['imageinfo'][0]['url']
    return urls

def download(url):
    req = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as response:
        return response.read()

def save_icon(name, blob):
    image = Image.open(BytesIO(blob)).convert('RGBA')
    image.thumbnail((SIZE, SIZE), Image.Resampling.NEAREST)

    canvas = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    x = (SIZE - image.width) // 2
    y = (SIZE - image.height) // 2
    canvas.alpha_composite(image, (x, y))
    canvas.save(OUT / f'{name}.png', optimize=True)

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    urls = file_urls(sorted(set(ICONS.values())))

    for name, file_name in ICONS.items():
        blob = download(urls[file_name])
        save_icon(name, blob)
        print(f'{name}: {file_name}')

if __name__ == '__main__':
    main()
