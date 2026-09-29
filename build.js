// Builds the userscripts in dist/ from src/core + src/modules.
//
//   node build.js                beta only   -> dist/meldkamerspel-suite-beta.user.js
//   node build.js release        stable+beta, bumps the patch version (1.0.1 -> 1.0.2)
//   node build.js release minor  same, bumps minor (1.0.1 -> 1.1.0); also: major
//   node build.js osm            refresh dist/data/posts-nl.json (real emergency
//                                posts from OpenStreetMap, for Plaatsingsadvies)
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

let VERSION = '1.3.1';
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
];

// Only in the beta build, still being tested. Stable leaves them out.
const BETA_ONLY = ['mission-helper'];

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
        DATA_URL: `${raw}/data/posts-nl.json`,
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
 * OSM POSTS: every real emergency post in the Netherlands, for the
 * placement-advisor module. The public Overpass server takes minutes for
 * this query and is often overloaded, so players never query it live: they
 * download this file from GitHub. Categories match the module's CATS.
 * ========================================================================== */
async function fetchPosts() {
    const filters = [
        '[amenity~"^(fire_station|police|hospital|lifeboat_station|lifeboat)$"]',
        '[emergency~"^(ambulance_station|lifeguard_base|water_rescue|lifeboat_station)$"]',
        '[healthcare=hospital]',
        '[aeroway~"^(helipad|heliport)$"]',
        '[military~"^(barracks|base|airfield|naval_base)$"]',
        '[office=government][name~"Rijkswaterstaat",i]',
    ];
    const query = `[out:json][timeout:600];area["ISO3166-1"="NL"][admin_level=2]->.nl;(${filters.map((f) => `nwr(area.nl)${f};`).join('')});out center tags;`;
    console.log('querying Overpass (takes a few minutes)...');
    let res;
    // 429/504 = server busy: wait and try again.
    for (let attempt = 1; ; attempt++) {
        res = await fetch('https://overpass-api.de/api/interpreter', {
            method: 'POST',
            body: `data=${encodeURIComponent(query)}`,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': `Meldkamerspel-Suite (github.com/${REPO})` },
        });
        if (res.ok || ![429, 504].includes(res.status) || attempt === 8) break;
        console.log(`Overpass busy (HTTP ${res.status}), retry ${attempt} in 30 s`);
        await new Promise((r) => setTimeout(r, 30000));
    }
    if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
    const { elements } = await res.json();

    const category = (t) => {
        if (t.amenity === 'fire_station') return 'F';
        if (t.emergency === 'ambulance_station') return 'A';
        if (t.amenity === 'police') return 'P';
        if (t.amenity === 'hospital' || t.healthcare === 'hospital') return 'H';
        if (/^(lifeboat_station|lifeboat|water_rescue|lifeguard_base)$/.test(t.amenity || t.emergency || '')) return 'W';
        if (t.military) return 'M';
        if (t.aeroway === 'helipad' || t.aeroway === 'heliport') return 'L';
        if (t.office === 'government') return 'R';
        return null;
    };
    const posts = [];
    for (const el of elements) {
        const t = el.tags || {};
        const cat = category(t);
        const lat = el.lat ?? el.center?.lat;
        const lon = el.lon ?? el.center?.lon;
        if (!cat || lat === undefined || lon === undefined) continue;
        posts.push([+lat.toFixed(5), +lon.toFixed(5), cat, t.name || '', `${el.type[0]}${el.id}`]);
    }
    // One post is often mapped twice (a node and a building outline): keep
    // one per category within 100 m, preferring the one with a name.
    posts.sort((a, b) => (b[3] ? 1 : 0) - (a[3] ? 1 : 0));
    const kept = [];
    for (const p of posts) {
        const dup = kept.some((k) => k[2] === p[2] && Math.abs(k[0] - p[0]) < 0.0009 && Math.abs(k[1] - p[1]) < 0.0015);
        if (!dup) kept.push(p);
    }
    kept.sort((a, b) => a[0] - b[0]);
    const out = { date: new Date().toISOString().slice(0, 10), license: 'ODbL, (c) OpenStreetMap contributors', posts: kept };
    fs.mkdirSync(path.join(__dirname, 'dist/data'), { recursive: true });
    fs.writeFileSync(path.join(__dirname, 'dist/data/posts-nl.json'), JSON.stringify(out));
    const counts = {};
    for (const p of kept) counts[p[2]] = (counts[p[2]] || 0) + 1;
    console.log(`wrote dist/data/posts-nl.json: ${kept.length} posts`, counts);
}

if (process.argv[2] === 'osm') {
    fetchPosts().catch((e) => { console.error(e); process.exit(1); });
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
