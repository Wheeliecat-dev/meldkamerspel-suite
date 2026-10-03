// Builds the userscripts in dist/ from src/core + src/modules.
//
//   node build.js                beta only   -> dist/meldkamerspel-suite-beta.user.js
//   node build.js release        stable+beta, bumps the patch version (1.0.1 -> 1.0.2)
//   node build.js release minor  same, bumps minor (1.0.1 -> 1.1.0); also: major
//   node build.js osm            refresh dist/data/posts/ (real emergency posts in
//                                NL, BE and DE from OpenStreetMap, for Plaatsingsadvies)
//   node build.js osm resume     same, but keeps tiles fetched in the last 24 hours
//
// The .user.js files are tiny loaders (just the header). The code itself
// is dist/lib/*.js, pulled in with @require. Tampermonkey downloads it once
// per version, stores it, and checks it against the sha256 in the URL, so
// it runs from local storage (no delay, no flash) and can't be swapped out.
// Push dist/ to GitHub and Tampermonkey updates everyone by itself
// (@updateURL). Stable is what you share; beta is for live testing.
// The beta version gets a timestamp suffix, so every beta build counts as
// an update. Stable only updates when VERSION goes up; release bumps it.
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

let VERSION = '1.6.0';
const REPO = 'Wheeliecat-dev/meldkamerspel-suite'; // GitHub user/repo
const BRANCH = 'main';

// Order = order in the dashboard (within each category).
const MODULES = [
    'dark-theme',
    'small-vehicle-icons',
    'vehicle-search',
    'preset-search',
    'mission-helper',
    'auto-load-vehicles',
    'transport-requests',
    'destination-filter',
    'credit-filter',
    'map-filter',
    'team-filter',
    'dispatch-presets',
    'vehicle-namer',
    'building-namer',
    'personnel-overview',
    'income-tracker',
    'daily-summary',
    'coverage-map',
    'placement-advisor',
    'building-price',
    'building-share',
    'vehicle-scrap',
    'personnel-assign',
    'auto-dispatch',
];

// Only in the beta build, still being tested. Stable leaves them out.
const BETA_ONLY = ['auto-dispatch'];

const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8').replace(/\r\n/g, '\n').trimEnd();

const present = fs.readdirSync(path.join(__dirname, 'src/modules')).map((f) => f.replace(/\.js$/, ''));
const unlisted = present.filter((m) => !MODULES.includes(m));
if (unlisted.length && process.argv[2] !== 'osm') throw new Error(`src/modules not listed in build.js: ${unlisted.join(', ')}`);

function stamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    // Seconds too: two builds in one minute got the same lib file name, and
    // GitHub's raw cache then served the old file, failing the sha256 check.
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function build(channel) {
    const beta = channel === 'beta';
    const file = beta ? 'meldkamerspel-suite-beta.user.js' : 'meldkamerspel-suite.user.js';
    const version = beta ? `${VERSION}.${stamp()}` : VERSION;
    // Version in the file name: GitHub's raw cache ignores ?query, so a
    // reused name could serve the old file (and fail the sha256 check) for
    // ~5 minutes after a push. A new name is never cached.
    const prefix = beta ? 'suite-beta-' : 'suite-';
    const lib = `${prefix}${version}.js`;
    const raw = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/dist`;
    const url = `${raw}/${file}`;
    const vars = {
        VERSION: version,
        NAME: beta ? "Wheeliecat's Meldkamerspel Scripts (beta)" : "Wheeliecat's Meldkamerspel Scripts",
        NAMESPACE: beta ? 'https://meldkamerspel.com/suite-beta' : 'https://meldkamerspel.com/suite',
        UPDATE_URL: url,
        CHANNEL: channel,
        DATA_BASE: `${raw}/data/posts/`,
    };
    const fill = (text) => text.replace(/\{\{(\w+)\}\}/g, (all, k) => (k in vars ? vars[k] : all));
    const code = fill([
        `/* ${vars.NAME} v${version} — https://github.com/${REPO} */`,
        read('src/core/core.js'),
        ...MODULES.filter((m) => beta || !BETA_ONLY.includes(m)).map((m) => `/* ==== module: ${m} ${'='.repeat(Math.max(0, 60 - m.length))} */\n${read(`src/modules/${m}.js`)}`),
        'MKS.boot();',
    ].join('\n\n')) + '\n';
    const hash = crypto.createHash('sha256').update(code, 'utf8').digest('hex');
    vars.REQUIRE_URL = `${raw}/lib/${lib}#sha256=${hash}`;
    const loader = fill(read('src/core/header.js')) + '\n';

    fs.mkdirSync(path.join(__dirname, 'dist/lib'), { recursive: true });
    fs.writeFileSync(path.join(__dirname, 'dist/lib', lib), code);
    // Keep the newest 3 per channel: a loader still in someone's cache can
    // point at a slightly older file. Older ones are gone for good.
    const libDir = path.join(__dirname, 'dist/lib');
    const isChannel = (f) => f.startsWith(prefix) && (beta || !f.startsWith('suite-beta-'));
    const old = fs.readdirSync(libDir).filter(isChannel)
        .sort((a, b) => fs.statSync(path.join(libDir, b)).mtimeMs - fs.statSync(path.join(libDir, a)).mtimeMs);
    old.slice(3).forEach((f) => fs.unlinkSync(path.join(libDir, f)));
    // The old unversioned names from before this scheme.
    for (const f of ['suite.js', 'suite-beta.js']) if (fs.existsSync(path.join(libDir, f)) && (f === 'suite-beta.js') === beta) fs.unlinkSync(path.join(libDir, f));
    fs.writeFileSync(path.join(__dirname, 'dist', file), loader);
    console.log(`built dist/${file} v${version} (${loader.split('\n').length} lines) + dist/lib/${lib} (${(code.length / 1024).toFixed(0)} KB)`);
}

/* ============================================================================
 * OSM POSTS: every real emergency post in the Netherlands, Belgium and
 * Germany, for the placement-advisor module. The public Overpass server
 * takes minutes for this and is often overloaded, so players never query it
 * live: they download these files from GitHub.
 *
 * Germany alone has ~45,000 posts, so the data is split into 1x1 degree
 * tiles (dist/data/posts/<lat>_<lon>.json, named after the south-west
 * corner). The module only loads the tiles around the marker.
 * dist/data/posts/index.json lists the tiles that exist.
 * Tiles are cut by coordinates, not borders: posts just across the border
 * (FR, LU, CH, AT, CZ, PL, DK) come along too.
 * Categories match the module's CATS.
 * ========================================================================== */
const OSM_COUNTRIES = ['NL', 'BE', 'DE'];
const OSM_AREA = { s: 47, w: 2, n: 55, e: 15 }; // tiles to consider (south-west corners)
const TOWING_NAME = '(berging|takel|abschlepp|bergungs|dépannage|depannage|pechhulp)';
const OSM_FILTERS = [
    '[amenity~"^(fire_station|police|hospital|lifeboat_station|lifeboat)$"]',
    '[emergency~"^(ambulance_station|lifeguard_base|water_rescue|lifeboat_station)$"]',
    '[healthcare=hospital]',
    '[aeroway~"^(helipad|heliport)$"]',
    '[military~"^(barracks|base|airfield|naval_base)$"]',
    // Road authority depots: RWS steunpunten (few are mapped). The German
    // Meistereien only have a name, see MEISTEREI_QUERY.
    '[office=government][name~"Rijkswaterstaat|meisterei|wegendistrict",i]',
    '[operator~"Rijkswaterstaat",i][name~"steunpunt",i]',
    // Towing / recovery. Rarely tagged as such, so also by name (only on
    // car repair shops and companies: a name search over everything is far
    // too slow on the public server).
    '["service:vehicle:towing"=yes]',
    '[shop=towing]', '[office=towing]', '[amenity=towing]', '[craft=towing]',
    `[shop=car_repair][name~"${TOWING_NAME}",i]`,
    `[office=company][name~"${TOWING_NAME}",i]`,
];

// Autobahn- and Straßenmeistereien are only recognisable by name. A name
// search per tile costs ~90 s, so it runs once for all of Germany and the
// results are merged into the tiles.
const MEISTEREI_QUERY = '[out:json][timeout:900];area["ISO3166-1"="DE"][admin_level=2]->.a;'
    + 'nwr(area.a)[name~"^(Autobahn|Straßen|Strassen|Straßen- und Autobahn)meisterei",i];out center tags;';

function postCategory(t) {
    if (t.amenity === 'fire_station') return 'F';
    if (t.emergency === 'ambulance_station') return 'A';
    if (t.amenity === 'police') return 'P';
    if (t.amenity === 'hospital' || t.healthcare === 'hospital') return 'H';
    if (/^(lifeboat_station|lifeboat|water_rescue|lifeguard_base)$/.test(t.amenity || t.emergency || '')) return 'W';
    if (t.military) return 'M';
    if (t.aeroway === 'helipad' || t.aeroway === 'heliport') return 'L';
    if (t.highway || t.public_transport || t.railway) return null; // bus stops named after a depot
    if (/rijkswaterstaat|steunpunt|meisterei|wegendistrict/i.test(t.name || '')) return 'R';
    if (t['service:vehicle:towing'] === 'yes' || [t.shop, t.office, t.amenity, t.craft].includes('towing')
        || new RegExp(TOWING_NAME, 'i').test(t.name || '')) return 'T';
    return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The public server allows 2 queries at a time per user; /api/status says
// when the next slot is free.
async function waitForSlot() {
    const { execFileSync } = require('child_process');
    for (let i = 0; i < 60; i++) {
        let status = '';
        try { status = execFileSync('curl', ['-s', '-m', '20', '-A', `Meldkamerspel-Suite (github.com/${REPO})`, 'https://overpass-api.de/api/status']).toString(); } catch (e) { /* retry */ }
        if (/slots? available now/.test(status)) return;
        const wait = Number((status.match(/in (d+) seconds/) || [])[1]);
        await sleep(((wait || 15) + 2) * 1000);
    }
}

// curl, not fetch: Node's fetch gives up after 300 s without response
// headers, and a big tile can take longer than that.
async function overpass(query) {
    const { execFileSync } = require('child_process');
    for (let attempt = 1; ; attempt++) {
        await waitForSlot();
        let out;
        try {
            out = execFileSync('curl', ['-s', '-m', '900', '-w', '\n%{http_code}', '-A', `Meldkamerspel-Suite (github.com/${REPO})`,
                '--data-urlencode', 'data@-', 'https://overpass-api.de/api/interpreter'], { input: query, maxBuffer: 1 << 30 }).toString();
        } catch (e) {
            out = '\n000';
        }
        const cut = out.lastIndexOf('\n');
        const status = Number(out.slice(cut + 1));
        if (status === 200) return JSON.parse(out.slice(0, cut));
        if (attempt === 10) throw new Error(`Overpass HTTP ${status}`);
        console.log(`  Overpass busy (HTTP ${status}), retry ${attempt} in 30 s`);
        await sleep(30000);
    }
}

// Tiles with at least one of 5 sample points inside OSM_COUNTRIES.
async function countryTiles() {
    const points = [];
    for (let lat = OSM_AREA.s; lat < OSM_AREA.n; lat++) {
        for (let lon = OSM_AREA.w; lon < OSM_AREA.e; lon++) {
            for (const [dy, dx] of [[0.5, 0.5], [0.1, 0.1], [0.1, 0.9], [0.9, 0.1], [0.9, 0.9]]) points.push([lat, lon, lat + dy, lon + dx]);
        }
    }
    // One count element per point, in order.
    const re = `^(${OSM_COUNTRIES.join('|')})$`;
    const query = '[out:json][timeout:600];'
        + points.map(([, , y, x]) => `is_in(${y},${x})->.a;area.a[admin_level=2]["ISO3166-1"~"${re}"];out count;`).join('');
    const { elements } = await overpass(query);
    const keep = new Set();
    elements.forEach((el, i) => {
        if (Number(el.tags.areas || el.tags.total) > 0) keep.add(`${points[i][0]}_${points[i][1]}`);
    });
    return [...keep].sort();
}

async function fetchTile(key) {
    const [s, w] = key.split('_').map(Number);
    const query = `[out:json][timeout:900][bbox:${s},${w},${s + 1},${w + 1}];(${OSM_FILTERS.map((f) => `nwr${f};`).join('')});out center tags;`;
    const { elements } = await overpass(query);
    return dedupePosts(toPosts(elements).filter((p) => Math.floor(p[0]) === s && Math.floor(p[1]) === w)); // a way's centre can lie outside the tile
}

function toPosts(elements) {
    const posts = [];
    for (const el of elements) {
        const t = el.tags || {};
        const cat = postCategory(t);
        const lat = el.lat ?? el.center?.lat;
        const lon = el.lon ?? el.center?.lon;
        if (!cat || lat === undefined || lon === undefined) continue;
        posts.push([+lat.toFixed(5), +lon.toFixed(5), cat, t.name || '', `${el.type[0]}${el.id}`]);
    }
    return posts;
}

// One post is often mapped twice (a node and a building outline): keep one
// per category within 100 m, preferring the one with a name.
function dedupePosts(posts) {
    posts.sort((a, b) => (b[3] ? 1 : 0) - (a[3] ? 1 : 0));
    const kept = [];
    for (const p of posts) {
        const dup = kept.some((k) => k[2] === p[2] && Math.abs(k[0] - p[0]) < 0.0009 && Math.abs(k[1] - p[1]) < 0.0015);
        if (!dup) kept.push(p);
    }
    return kept.sort((a, b) => a[0] - b[0]);
}

async function fetchPosts(resume) {
    const dir = path.join(__dirname, 'dist/data/posts');
    fs.mkdirSync(dir, { recursive: true });
    console.log(`finding tiles that cover ${OSM_COUNTRIES.join(', ')}...`);
    const tiles = await countryTiles();
    console.log(`${tiles.length} tiles`);
    const date = new Date().toISOString().slice(0, 10);
    const totals = {};
    const written = [];
    for (const [i, key] of tiles.entries()) {
        const file = path.join(dir, `${key}.json`);
        if (resume && fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < 24 * 3600 * 1000) {
            for (const p of JSON.parse(fs.readFileSync(file, 'utf8')).posts) totals[p[2]] = (totals[p[2]] || 0) + 1;
            written.push(key);
            continue;
        }
        const posts = await fetchTile(key);
        console.log(`[${i + 1}/${tiles.length}] ${key}: ${posts.length} posts`);
        if (!posts.length) { if (fs.existsSync(file)) fs.unlinkSync(file); continue; }
        fs.writeFileSync(file, JSON.stringify({ date, posts }));
        for (const p of posts) totals[p[2]] = (totals[p[2]] || 0) + 1;
        written.push(key);
    }
    console.log('Autobahn-/Straßenmeistereien (one query for all of Germany)...');
    try {
        const extra = toPosts((await overpass(MEISTEREI_QUERY)).elements);
        const byTile = {};
        for (const p of extra) (byTile[`${Math.floor(p[0])}_${Math.floor(p[1])}`] ||= []).push(p);
        for (const [key, list] of Object.entries(byTile)) {
            const file = path.join(dir, `${key}.json`);
            const old = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).posts : [];
            const merged = dedupePosts(old.concat(list));
            fs.writeFileSync(file, JSON.stringify({ date, posts: merged }));
            totals.R = (totals.R || 0) + merged.length - old.length;
            if (!written.includes(key)) written.push(key);
        }
        console.log(`${extra.length} Meistereien`);
    } catch (e) {
        console.log(`Meistereien skipped: ${e.message}`);
    }
    fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ date, license: 'ODbL, (c) OpenStreetMap contributors', tiles: written }));
    console.log(`wrote ${written.length} tiles to dist/data/posts/`, totals);
}

if (process.argv[2] === 'osm') {
    fetchPosts(process.argv[3] === 'resume').catch((e) => { console.error(e); process.exit(1); });
} else {
    const release = process.argv[2] === 'release';
    if (release) {
        const part = process.argv[3] || 'patch';
        const v = VERSION.split('.').map(Number);
        if (part === 'major') { v[0]++; v[1] = 0; v[2] = 0; } else if (part === 'minor') { v[1]++; v[2] = 0; } else v[2]++;
        const next = v.join('.');
        const self = path.join(__dirname, 'build.js');
        fs.writeFileSync(self, fs.readFileSync(self, 'utf8').replace(`let VERSION = '${VERSION}';`, `let VERSION = '${next}';`));
        VERSION = next;
    }
    build('beta');
    if (release) build('stable');
}
