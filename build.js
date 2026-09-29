// Builds the userscripts in dist/ from src/core + src/modules.
//
//   node build.js          beta only   -> dist/meldkamerspel-suite-beta.user.js
//   node build.js release  stable+beta -> also dist/meldkamerspel-suite.user.js
//
// Push dist/ to GitHub and Tampermonkey updates everyone by itself
// (@updateURL). Stable is what you share; beta is for live testing.
// The beta version gets a timestamp suffix, so every beta build counts as
// an update. Bump VERSION for each stable release.
const fs = require('fs');
const path = require('path');

const VERSION = '1.0.0';
const REPO = 'Wheeliecat-dev/meldkamerspel-suite'; // GitHub user/repo
const BRANCH = 'main';

// Order = order in the dashboard (within each category).
const MODULES = [
    'dark-theme',
    'small-vehicle-icons',
    'vehicle-search',
    'auto-load-vehicles',
    'credit-filter',
    'dispatch-presets',
    'auto-spraakaanvraag',
    'vehicle-namer',
    'building-namer',
    'personnel-overview',
    'crew-shortage',
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
    const url = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/dist/${file}`;
    const version = beta ? `${VERSION}.${stamp()}` : VERSION;
    const vars = {
        VERSION: version,
        NAME: beta ? 'Meldkamerspel Suite (beta)' : 'Meldkamerspel Suite',
        NAMESPACE: beta ? 'https://meldkamerspel.com/suite-beta' : 'https://meldkamerspel.com/suite',
        UPDATE_URL: url,
        CHANNEL: channel,
    };
    const parts = [
        read('src/core/header.js'),
        read('src/core/core.js'),
        ...MODULES.map((m) => `/* ==== module: ${m} ${'='.repeat(Math.max(0, 60 - m.length))} */\n${read(`src/modules/${m}.js`)}`),
        'MKS.boot();',
    ];
    const out = parts.join('\n\n').replace(/\{\{(\w+)\}\}/g, (all, k) => (k in vars ? vars[k] : all)) + '\n';
    fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(__dirname, 'dist', file), out);
    console.log(`built dist/${file} v${version} (${MODULES.length} modules, ${(out.length / 1024).toFixed(0)} KB)`);
}

build('beta');
if (process.argv[2] === 'release') build('stable');
