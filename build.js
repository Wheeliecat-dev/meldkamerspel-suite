// Builds the userscripts in dist/ from src/core + src/modules.
//
//   node build.js                beta only   -> dist/meldkamerspel-suite-beta.user.js
//   node build.js release        stable+beta, bumps the patch version (1.0.1 -> 1.0.2)
//   node build.js release minor  same, bumps minor (1.0.1 -> 1.1.0); also: major
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

let VERSION = '1.2.0';
const REPO = 'Wheeliecat-dev/meldkamerspel-suite'; // GitHub user/repo
const BRANCH = 'main';

// Order = order in the dashboard (within each category).
const MODULES = [
    'dark-theme',
    'small-vehicle-icons',
    'vehicle-search',
    'preset-search',
    'auto-load-vehicles',
    'credit-filter',
    'map-filter',
    'team-filter',
    'dispatch-presets',
    'vehicle-namer',
    'building-namer',
    'personnel-overview',
    'income-tracker',
    'coverage-map',
    'placement-advisor',
];

const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8').replace(/\r\n/g, '\n').trimEnd();

const present = fs.readdirSync(path.join(__dirname, 'src/modules')).map((f) => f.replace(/\.js$/, ''));
const unlisted = present.filter((m) => !MODULES.includes(m));
if (unlisted.length) throw new Error(`src/modules not listed in build.js: ${unlisted.join(', ')}`);

function stamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}`;
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
    };
    const fill = (text) => text.replace(/\{\{(\w+)\}\}/g, (all, k) => (k in vars ? vars[k] : all));
    const code = fill([
        `/* ${vars.NAME} v${version} — https://github.com/${REPO} */`,
        read('src/core/core.js'),
        ...MODULES.map((m) => `/* ==== module: ${m} ${'='.repeat(Math.max(0, 60 - m.length))} */\n${read(`src/modules/${m}.js`)}`),
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
