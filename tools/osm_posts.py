"""Extract real emergency posts from OpenStreetMap country files (.osm.pbf)
into the tiles the placement-advisor module reads (dist/data/posts/).

    python tools/osm_posts.py <out_dir> <file.osm.pbf> [<file.osm.pbf> ...]

Normally run through `node build.js osm`, which downloads the files first.
Needs pyosmium (`pip install osmium`).

Three passes per file, so it never has to hold every node position in
memory (Germany has ~400 million nodes):
  1. objects with interesting tags; matching nodes are done right away,
     ways and relations remember which nodes/ways they need;
  2. member ways of matching relations;
  3. positions of only the nodes that are needed.
A way or relation is placed at the average of (up to) 50 of its nodes.

Output: one JSON file per 1x1 degree tile, named after its south-west
corner ("52_4.json"): {"date", "posts": [[lat, lon, cat, name, osmId], ...]},
plus index.json listing the tiles. Categories match CATS in the module.
"""
import datetime
import json
import math
import os
import re
import sys

import osmium

KEYS = ('amenity', 'emergency', 'healthcare', 'aeroway', 'military', 'office', 'shop', 'craft',
        'service:vehicle:towing', 'name')
LIFEBOAT = {'lifeboat_station', 'lifeboat', 'water_rescue', 'lifeguard_base'}
MILITARY = {'barracks', 'base', 'airfield', 'naval_base'}
TOWING_NAME = re.compile(r'berging|takel|abschlepp|bergungs|remorquage|pechhulp|towing', re.I)
# In French "dépannage" is any repair (electricians too): only for car businesses.
DEPANNAGE = re.compile(r'd[ée]pannage', re.I)
CAR_SHOPS = {'car_repair', 'car', 'tyres', 'car_parts'}
CAR_NAME = re.compile(r'auto|garage|remorqu|camion|poids', re.I)
ROAD_NAME = re.compile(r'^(autobahn|stra(ß|ss)en|stra(ß|ss)en- und autobahn)meisterei'
                       r'|rijkswaterstaat.*steunpunt|steunpunt.*rijkswaterstaat'
                       r'|wegendistrict|district routier|centre d.entretien et d.intervention', re.I)
SAMPLE = 50


def category(t):
    if t.get('amenity') == 'fire_station':
        return 'F'
    if t.get('emergency') == 'ambulance_station':
        return 'A'
    if t.get('amenity') == 'police':
        return 'P'
    if t.get('amenity') == 'hospital' or t.get('healthcare') == 'hospital':
        return 'H'
    if t.get('amenity') in LIFEBOAT or t.get('emergency') in LIFEBOAT:
        return 'W'
    if t.get('military') in MILITARY:
        return 'M'
    if t.get('aeroway') in ('helipad', 'heliport'):
        return 'L'
    if 'highway' in t or 'public_transport' in t or 'railway' in t:
        return None  # bus stops and roads named after a depot
    name = t.get('name', '')
    if ROAD_NAME.search(name) or (t.get('office') == 'government' and re.search('rijkswaterstaat', name, re.I)) \
            or (re.search('rijkswaterstaat', t.get('operator', ''), re.I) and re.search('steunpunt', name, re.I)):
        return 'R'
    if t.get('service:vehicle:towing') == 'yes' or 'towing' in (t.get('shop'), t.get('office'), t.get('amenity'), t.get('craft')):
        return 'T'
    if any(k in t for k in ('shop', 'office', 'craft')) and not re.search('fiets', name, re.I):
        if TOWING_NAME.search(name):
            return 'T'
        if DEPANNAGE.search(name) and (t.get('shop') in CAR_SHOPS or CAR_NAME.search(name)):
            return 'T'
    return None


def extract(path):
    posts = {}       # osmId -> [lat, lon, cat, name, osmId]
    ways = {}        # osmId -> (cat, name, [node ids])
    rels = {}        # osmId -> (cat, name, [way ids])

    for o in osmium.FileProcessor(path).with_filter(osmium.filter.KeyFilter(*KEYS)):
        t = dict(o.tags)
        cat = category(t)
        if not cat:
            continue
        name = t.get('name', '')
        if o.is_node():
            if o.location.valid():
                posts[f'n{o.id}'] = [o.location.lat, o.location.lon, cat, name, f'n{o.id}']
        elif o.is_way():
            refs = [n.ref for n in o.nodes]
            ways[f'w{o.id}'] = (cat, name, refs[:: max(1, len(refs) // SAMPLE)])
        elif o.is_relation():
            members = [m.ref for m in o.members if m.type == 'w' and m.role in ('outer', '')]
            if members:
                rels[f'r{o.id}'] = (cat, name, members[:10])

    rel_ways = {w for _, _, ws in rels.values() for w in ws}
    rel_way_nodes = {}
    if rel_ways:
        for o in osmium.FileProcessor(path, osmium.osm.WAY).with_filter(osmium.filter.IdFilter(rel_ways)):
            refs = [n.ref for n in o.nodes]
            rel_way_nodes[o.id] = refs[:: max(1, len(refs) // 10)]

    need = {n for _, _, ns in ways.values() for n in ns} | {n for ns in rel_way_nodes.values() for n in ns}
    loc = {}
    if need:
        for o in osmium.FileProcessor(path, osmium.osm.NODE).with_filter(osmium.filter.IdFilter(need)):
            if o.location.valid():
                loc[o.id] = (o.location.lat, o.location.lon)

    def centre(node_ids):
        pts = [loc[n] for n in node_ids if n in loc]
        if not pts:
            return None
        return sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)

    for oid, (cat, name, ns) in ways.items():
        c = centre(ns)
        if c:
            posts[oid] = [c[0], c[1], cat, name, oid]
    for oid, (cat, name, ws) in rels.items():
        c = centre([n for w in ws for n in rel_way_nodes.get(w, [])])
        if c:
            posts[oid] = [c[0], c[1], cat, name, oid]
    return posts


def dedupe(posts):
    """One post is often mapped twice (a node and a building outline): keep
    one per category within ~100 m, preferring the one with a name."""
    posts.sort(key=lambda p: 0 if p[3] else 1)
    kept, grid = [], {}
    for p in posts:
        cell = (round(p[0] / 0.001), round(p[1] / 0.0015))
        dup = False
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                for k in grid.get((cell[0] + dy, cell[1] + dx), ()):
                    if k[2] == p[2] and abs(k[0] - p[0]) < 0.0009 and abs(k[1] - p[1]) < 0.0015:
                        dup = True
        if not dup:
            kept.append(p)
            grid.setdefault(cell, []).append(p)
    return sorted(kept, key=lambda p: p[0])


def main():
    out_dir, files = sys.argv[1], sys.argv[2:]
    posts = {}
    for f in files:
        print(f'reading {os.path.basename(f)}...', flush=True)
        found = extract(f)
        print(f'  {len(found)} objects', flush=True)
        posts.update(found)  # same osmId from two country files = one post

    tiles = {}
    for p in posts.values():
        p[0], p[1] = round(p[0], 5), round(p[1], 5)
        tiles.setdefault(f'{math.floor(p[0])}_{math.floor(p[1])}', []).append(p)

    os.makedirs(out_dir, exist_ok=True)
    for f in os.listdir(out_dir):
        if f.endswith('.json'):
            os.remove(os.path.join(out_dir, f))
    date = datetime.date.today().isoformat()
    totals = {}
    for key, list_ in tiles.items():
        kept = dedupe(list_)
        for p in kept:
            totals[p[2]] = totals.get(p[2], 0) + 1
        with open(os.path.join(out_dir, f'{key}.json'), 'w', encoding='utf-8') as fh:
            json.dump({'date': date, 'posts': kept}, fh, ensure_ascii=False, separators=(',', ':'))
    with open(os.path.join(out_dir, 'index.json'), 'w', encoding='utf-8') as fh:
        json.dump({'date': date, 'license': 'ODbL, (c) OpenStreetMap contributors', 'tiles': sorted(tiles)}, fh, separators=(',', ':'))
    print(f'wrote {len(tiles)} tiles, {sum(totals.values())} posts: {dict(sorted(totals.items()))}')


if __name__ == '__main__':
    main()
