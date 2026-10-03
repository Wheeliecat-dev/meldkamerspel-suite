MKS.module({
    id: 'placement-advisor',
    name: 'Plaatsingsadvies',
    icon: '📍',
    category: 'map',
    description: 'Echte hulpdienstposten uit OpenStreetMap (Nederland, België, Duitsland): brandweer, ambulance, politie, ziekenhuis, heli, KNRM, '
        + 'wegbeheer (RWS, Autobahnmeisterei), bergingsbedrijven en defensie. Tijdens het bouwen zie je de posten rond de marker; klik er een en de marker springt erheen. '
        + 'Op de kaart kun je een soort aanzetten: klik een post en "Hier bouwen" opent het bouwformulier met type, plek en naam ingevuld. '
        + 'Kopen doe je altijd zelf met de knop van het spel.',
    tagline: 'Bij gebouw plaatsen en via "Echte posten" op de kaart',
    at: 'load',
    frames: 'all',
    live: true,
    settings: [
        { key: 'radiusKm', label: 'Zoekstraal', type: 'range', default: 5, min: 0.5, max: 10, step: 0.5, unit: ' km' },
        { key: 'onlyType', label: 'Alleen posten van het gekozen gebouwtype', type: 'bool', default: true,
            help: 'Uit: alle soorten hulpdienstposten. Bij een gebouwtype zonder echte tegenhanger zie je altijd alles.' },
        { key: 'mapLayer', label: 'Kaartlaag "Echte posten"', type: 'bool', default: true,
            help: 'Vakje linksboven op de kaart: kies een soort post en die verschijnen als bolletjes. Grijs = daar heb je er al een.' },
        { key: 'prefillName', label: 'Echte naam invullen', type: 'bool', default: true,
            help: 'Bij "Hier bouwen" altijd; bij klikken op een post in de lijst alleen als je zelf nog geen naam typte.' },
        { key: 'address', label: 'Adres van de marker tonen (Nominatim)', type: 'bool', default: true },
        { key: 'debug', label: 'Uitgebreid loggen in console', type: 'bool', default: false },
    ],

    run(ctx) {
        /* ========================================================================
         * CONFIG
         * ====================================================================
         * The posts come from dist/data/posts/ in the suite repo (made by
         * `node build.js osm`), not from a live Overpass query: that takes
         * minutes and the public server is often overloaded. The data is cut
         * into 1x1 degree tiles; only the tiles around the marker or the map
         * view are downloaded, and each is cached in GM storage until the
         * data is refreshed.
         *
         * This module never buys anything. It moves the game's own placement
         * marker, and "Hier bouwen" opens the game's own form and fills it in;
         * the player still presses the game's build button.
         * ==================================================================== */
        const CONFIG = {
            get DEBUG() { return ctx.cfg.debug; },
            get RADIUS_M() { return ctx.cfg.radiusKm * 1000; },
            POLL_MS: 500,       // how often to check whether the lat/lng fields changed
            DEBOUNCE_MS: 400,   // wait this long after the last change before searching
            DATA_BASE: '{{DATA_BASE}}',
            CACHE_PREFIX: 'mks.placementAdvisor.',
            INDEX_MAX_AGE_MS: 24 * 60 * 60 * 1000,
            MAX_TILES: 9,       // more than this in view = "zoom in"
            NOMINATIM_URL: 'https://nominatim.openstreetmap.org/reverse',
            // Sent only by the GM_xmlhttpRequest fallback; page fetch() cannot
            // set a User-Agent.
            USER_AGENT: 'Meldkamerspel-Suite (github.com/Wheeliecat-dev/meldkamerspel-suite)',
            REQUEST_TIMEOUT_MS: 20 * 1000,
            ON_SPOT_M: 60,      // marker this close to a post = "on" that post
            OWNED_M: 200,       // own building this close to a post = already built
            MAX_ROWS: 25,
            LAYER_MIN_ZOOM: 9,
            LAYER_MAX_MARKERS: 2000,
            LAYER_STORE_KEY: 'mks-placement-layer',
            PENDING_MS: 60 * 1000, // "Hier bouwen" waits this long for the form to open
        };

        const esc = ctx.esc;
        const log = (...a) => { if (CONFIG.DEBUG) console.log('%c[PlacementAdvisor]', 'color:#a06', ...a); };
        const warn = (...a) => console.warn('[PlacementAdvisor]', ...a);

        /* ========================================================================
         * Post categories (codes as written by build.js) and which category
         * belongs to each game building type (<select id="building_building_type">).
         * Types without a real counterpart (e.g. uitgangsstelling) show all.
         * BUILD_TYPE is the type "Hier bouwen" picks for a category.
         * ==================================================================== */
        const CATS = {
            F: { icon: '🚒', label: 'Brandweerkazerne', color: '#e03131' },
            A: { icon: '🚑', label: 'Ambulancepost', color: '#f5c400' },
            P: { icon: '🚓', label: 'Politiebureau', color: '#1c7ed6' },
            H: { icon: '🏥', label: 'Ziekenhuis', color: '#e64980' },
            L: { icon: '🚁', label: 'Helikopterplatform', color: '#9c36b5' },
            W: { icon: '🛟', label: 'Reddingsbrigade / KNRM', color: '#f76707' },
            R: { icon: '🚧', label: 'Wegbeheer (RWS / Autobahnmeisterei)', color: '#0ca678' },
            T: { icon: '🛻', label: 'Bergingsbedrijf', color: '#8d6e63' },
            M: { icon: '🪖', label: 'Defensie', color: '#5c940d' },
        };
        const TYPE_CAT = {
            0: 'F', 17: 'F', 4: 'F',
            3: 'A', 13: 'A',
            2: 'H',
            5: 'P', 11: 'P', 18: 'P', 8: 'P',
            6: 'L', 9: 'L', 21: 'L',
            16: 'W', 19: 'W', 20: 'W',
            22: 'R',
            24: 'T',
            23: 'M', 25: 'M', 26: 'M',
        };
        const BUILD_TYPE = { F: '0', A: '3', P: '5', H: '2', L: '6', W: '16', R: '22', T: '24', M: '25' };

        /* ========================================================================
         * HTTP
         * ====================================================================
         * Page fetch() first (GitHub raw and Nominatim both allow CORS).
         * GM_xmlhttpRequest is the fallback when fetch is blocked.
         * ==================================================================== */
        class HttpError extends Error {
            constructor(status) { super(`HTTP ${status}`); this.status = status; }
        }

        async function pageFetch(url) {
            const ac = new AbortController();
            const t = setTimeout(() => ac.abort(), CONFIG.REQUEST_TIMEOUT_MS);
            try {
                const res = await fetch(url, { signal: ac.signal, credentials: 'omit' });
                if (!res.ok) throw new HttpError(res.status);
                return await res.text();
            } finally {
                clearTimeout(t);
            }
        }

        function gmFetch(url) {
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url,
                    headers: { 'User-Agent': CONFIG.USER_AGENT },
                    timeout: CONFIG.REQUEST_TIMEOUT_MS,
                    onload: (res) => {
                        if (res.status >= 200 && res.status < 300) resolve(res.responseText);
                        else reject(new HttpError(res.status));
                    },
                    onerror: () => reject(new Error('network error')),
                    ontimeout: () => reject(new Error('timeout')),
                });
            });
        }

        async function request(url) {
            try {
                return await pageFetch(url);
            } catch (e) {
                if (e instanceof HttpError) throw e;
                log(`fetch ${url} failed (${e.message}), trying GM_xmlhttpRequest`);
                return gmFetch(url);
            }
        }

        /* ========================================================================
         * DATA (tiles)
         * ==================================================================== */
        const readGM = (key) => { try { return JSON.parse(GM_getValue(CONFIG.CACHE_PREFIX + key, 'null')); } catch (e) { return null; } };
        const writeGM = (key, value) => { try { GM_setValue(CONFIG.CACHE_PREFIX + key, JSON.stringify(value)); } catch (e) { warn('cache write failed', e); } };
        // The single NL file from before the tiles.
        try { GM_deleteValue(`${CONFIG.CACHE_PREFIX}posts`); } catch (e) { /* ignore */ }

        let indexPromise = null;
        // -> { date, tiles: Set }
        function loadIndex() {
            if (indexPromise) return indexPromise;
            const cached = readGM('index');
            if (cached && Date.now() - cached.t < CONFIG.INDEX_MAX_AGE_MS) {
                indexPromise = Promise.resolve({ date: cached.date, tiles: new Set(cached.tiles) });
                return indexPromise;
            }
            indexPromise = request(`${CONFIG.DATA_BASE}index.json`)
                .then((text) => {
                    const data = JSON.parse(text);
                    writeGM('index', { t: Date.now(), date: data.date, tiles: data.tiles });
                    log(`index: ${data.tiles.length} tiles (OSM ${data.date})`);
                    return { date: data.date, tiles: new Set(data.tiles) };
                })
                .catch((e) => {
                    indexPromise = null;
                    if (cached) { warn('could not refresh tile index, using old copy', e); return { date: cached.date, tiles: new Set(cached.tiles) }; }
                    throw e;
                });
            return indexPromise;
        }

        const tiles = new Map();     // key -> Promise<posts>
        const tilesReady = new Set();
        function loadTile(key, date) {
            if (tiles.has(key)) return tiles.get(key);
            const cached = readGM(`tile.${key}`);
            const p = (cached && cached.date === date ? Promise.resolve(cached.posts)
                : request(`${CONFIG.DATA_BASE}${key}.json`).then((text) => {
                    const data = JSON.parse(text);
                    writeGM(`tile.${key}`, { date, posts: data.posts });
                    log(`tile ${key}: ${data.posts.length} posts`);
                    return data.posts;
                }))
                .then((posts) => { tilesReady.add(key); return posts; })
                .catch((e) => {
                    tiles.delete(key);
                    if (cached) { warn(`could not refresh tile ${key}, using old copy`, e); return cached.posts; }
                    throw e;
                });
            tiles.set(key, p);
            return p;
        }

        function tileKeys(s, w, n, e) {
            const keys = [];
            for (let lat = Math.floor(s); lat <= Math.floor(n); lat++) {
                for (let lon = Math.floor(w); lon <= Math.floor(e); lon++) keys.push(`${lat}_${lon}`);
            }
            return keys;
        }

        // -> [[lat, lon, cat, name, osmId], ...], or null when the box needs too many tiles.
        async function postsInBox(s, w, n, e) {
            const keys = tileKeys(s, w, n, e);
            if (keys.length > CONFIG.MAX_TILES) return null;
            const index = await loadIndex();
            const parts = await Promise.all(keys.filter((k) => index.tiles.has(k)).map((k) => loadTile(k, index.date)));
            return parts.flat();
        }

        function boxAround(lat, lon, radiusM) {
            const dLat = radiusM / 111320;
            const dLon = radiusM / (111320 * Math.cos((lat * Math.PI) / 180));
            return [lat - dLat, lon - dLon, lat + dLat, lon + dLon];
        }
        const boxReady = (box) => tileKeys(...box).every((k) => tilesReady.has(k));

        async function reverseGeocode(lat, lon) {
            const url = `${CONFIG.NOMINATIM_URL}?format=jsonv2&zoom=18&addressdetails=1&accept-language=nl&lat=${lat}&lon=${lon}`;
            const data = JSON.parse(await request(url));
            const a = data.address || {};
            const street = [a.road || a.pedestrian || a.footway || a.path, a.house_number].filter(Boolean).join(' ');
            const place = a.city || a.town || a.village || a.hamlet || a.municipality || '';
            return [street, place].filter(Boolean).join(', ') || data.display_name || '';
        }

        // Haversine distance in meters.
        function distanceMeters(lat1, lon1, lat2, lon2) {
            const R = 6371000;
            const toRad = (d) => (d * Math.PI) / 180;
            const dLat = toRad(lat2 - lat1);
            const dLon = toRad(lon2 - lon1);
            const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
            return 2 * R * Math.asin(Math.sqrt(a));
        }

        function nearbyPosts(posts, lat, lon, cat) {
            const rows = [];
            for (const [plat, plon, pcat, name, osm] of posts) {
                if (cat && pcat !== cat) continue;
                const distance = distanceMeters(lat, lon, plat, plon);
                if (distance > CONFIG.RADIUS_M) continue;
                rows.push({ lat: plat, lon: plon, cat: pcat, name, osm, distance });
            }
            rows.sort((a, b) => a.distance - b.distance);
            return rows;
        }

        const fmtDist = (m) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`);
        const osmUrl = (id) => `https://www.openstreetmap.org/${{ n: 'node', w: 'way', r: 'relation' }[id[0]]}/${id.slice(1)}`;

        /* ========================================================================
         * GAME MARKER + FORM
         * ====================================================================
         * The game shows a draggable Leaflet marker while you place a building
         * and writes its position into #building_latitude/#building_longitude.
         * We find that marker on the map (the draggable one closest to the
         * current field values), move it, and fire the drag events so the
         * game's own handlers run as if you dragged it.
         * ==================================================================== */
        function gameMap() {
            // The form can sit in a lightbox iframe; the map lives in the top window.
            for (const w of [ctx.W, window.parent, window.top]) {
                try {
                    const W = w.wrappedJSObject || w;
                    if (W.map && W.L && typeof W.map.eachLayer === 'function') return { map: W.map, L: W.L, W };
                } catch (e) { /* cross-origin frame */ }
            }
            return null;
        }

        function findPlacementMarker(map, L, lat, lon) {
            let best = null;
            let bestD = Infinity;
            map.eachLayer((layer) => {
                if (!(layer instanceof L.Marker)) return;
                const draggable = layer.options.draggable || (layer.dragging && layer.dragging.enabled());
                if (!draggable) return;
                const ll = layer.getLatLng();
                const d = Math.abs(ll.lat - lat) + Math.abs(ll.lng - lon);
                if (d < bestD) { bestD = d; best = layer; }
            });
            return best;
        }

        function setField(input, value) {
            input.value = value;
            const $ = ctx.W.jQuery || ctx.W.$;
            if (typeof $ === 'function') $(input).trigger('change');
            else input.dispatchEvent(new Event('change', { bubbles: true }));
        }

        function moveMarker(lat, lon) {
            const fields = findLatLngInputs();
            const g = gameMap();
            let moved = false;
            if (g) {
                const curLat = fields ? Number(fields.lat.value) : lat;
                const curLon = fields ? Number(fields.lon.value) : lon;
                const marker = findPlacementMarker(g.map, g.L, curLat, curLon);
                if (marker) {
                    marker.setLatLng([lat, lon]);
                    marker.fire('dragstart');
                    marker.fire('drag');
                    marker.fire('dragend', { target: marker, distance: 1 });
                    g.map.panTo([lat, lon]);
                    moved = true;
                }
            }
            // Make sure the form has the new position even if the game's
            // handler did not write it.
            if (fields) {
                setField(fields.lat, lat);
                setField(fields.lon, lon);
            }
            if (!moved) warn('placement marker not found on the map; only the form fields were set');
            log(`moved marker to ${lat}, ${lon}`);
        }

        function findLatLngInputs() {
            const lat = document.querySelector('#building_latitude') || document.querySelector('input[name="building[latitude]"]');
            const lon = document.querySelector('#building_longitude') || document.querySelector('input[name="building[longitude]"]');
            return lat && lon ? { lat, lon } : null;
        }
        function findGebouwtypeSelect() {
            return document.querySelector('#building_building_type') || document.querySelector('select[name="building[building_type]"]');
        }
        function findNameInput() {
            return document.querySelector('#building_name') || document.querySelector('input[name="building[name]"]');
        }
        // The game's "Nieuw gebouw" button on the map page.
        function findBuildButton() {
            const direct = document.querySelector('#build_new_building, a[href$="/buildings/new"], button[data-url$="/buildings/new"]');
            if (direct) return direct;
            return [...document.querySelectorAll('a, button')].find((el) => /nieuw gebouw|gebouw bouwen|bouw nieuw/i.test(el.textContent || '')) || null;
        }

        // Name field: fill in the real name. Without force it never overwrites
        // a name you typed yourself, only an empty field or one we filled.
        let filledName = null;
        function fillName(p, force) {
            const input = findNameInput();
            if (!ctx.cfg.prefillName || !input || !p.name) return;
            const current = input.value.trim();
            if (!force && current && current !== filledName) return;
            setField(input, p.name);
            filledName = p.name;
        }

        // Fill the open form for post p: type, position, name.
        function fillForm(p) {
            const typeSelect = findGebouwtypeSelect();
            if (typeSelect && TYPE_CAT[typeSelect.value] !== p.cat) {
                const want = BUILD_TYPE[p.cat];
                const option = [...typeSelect.options].find((o) => o.value === want)
                    || [...typeSelect.options].find((o) => TYPE_CAT[o.value] === p.cat);
                if (option) setField(typeSelect, option.value);
            }
            moveMarker(p.lat, p.lon);
            fillName(p, true);
        }

        // "Hier bouwen": open the game's form (if needed) and fill it in once it is there.
        let pending = null; // { post, until }
        function buildHere(p) {
            if (findLatLngInputs()) { fillForm(p); return; }
            const g = gameMap();
            if (g) g.map.setView([p.lat, p.lon], Math.max(g.map.getZoom(), 15));
            pending = { post: p, until: Date.now() + CONFIG.PENDING_MS };
            const btn = findBuildButton();
            if (btn) { log('opening the build form'); btn.click(); } else {
                warn('build button not found');
                toast('Klik op "Nieuw gebouw" van het spel; type, plek en naam worden dan ingevuld.');
            }
        }

        function toast(text) {
            const el = document.createElement('div');
            el.textContent = text;
            el.style.cssText = 'position:fixed;left:50%;top:80px;transform:translateX(-50%);z-index:100000;background:#111;color:#eee;font:13px sans-serif;padding:8px 14px;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,.5);';
            document.body.appendChild(el);
            setTimeout(() => el.remove(), 6000);
        }

        /* ========================================================================
         * PANEL (while placing a building)
         * ==================================================================== */
        let panelEl = null;
        let dismissedKey = null; // coordinates the user closed the panel for
        let shownRows = [];

        function ensurePanel() {
            if (panelEl && document.body.contains(panelEl)) return panelEl;
            panelEl = document.createElement('div');
            panelEl.id = 'pa-panel';
            panelEl.style.cssText = 'position:fixed;top:70px;right:8px;z-index:99999;background:#111;color:#eee;font:12px/1.4 sans-serif;padding:10px 12px;border-radius:6px;opacity:0.95;width:320px;max-height:70vh;overflow-y:auto;box-shadow:0 2px 8px rgba(0,0,0,0.5);';
            panelEl.addEventListener('click', (e) => {
                if (e.target.closest('.pa-close')) { dismissedKey = lastKey; removePanel(); return; }
                if (e.target.closest('.pa-retry')) { recheck(); return; }
                if (e.target.closest('.pa-all')) { ctx.set('onlyType', !ctx.cfg.onlyType); recheck(); return; }
                if (e.target.closest('a')) return; // OSM link
                const row = e.target.closest('.pa-row');
                if (row) {
                    const r = shownRows[Number(row.dataset.i)];
                    if (r) { moveMarker(r.lat, r.lon); fillName(r, false); }
                }
            });
            document.body.appendChild(panelEl);
            return panelEl;
        }

        function removePanel() {
            if (panelEl) panelEl.remove();
            panelEl = null;
        }

        function show(bodyHtml) {
            if (dismissedKey && dismissedKey === lastKey) return;
            ensurePanel().innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">'
                + '<b>📍 Plaatsingsadvies</b>'
                + '<span class="pa-close" title="Sluiten" style="cursor:pointer;color:#999;font-size:16px;line-height:1;padding:0 2px;">×</span></div>'
                + bodyHtml;
        }

        const muted = (s) => `<div style="color:#999;">${s}</div>`;
        const link = (cls, text) => `<span class="${cls}" style="color:#7ad;cursor:pointer;text-decoration:underline;">${text}</span>`;
        const ATTRIBUTION = 'Gegevens © OpenStreetMap-bijdragers (ODbL)';

        function renderIdle() {
            show(muted(`Typ een adres of sleep de marker. Je ziet dan de echte hulpdienstposten binnen ${fmtDist(CONFIG.RADIUS_M)}.`));
        }

        function renderLoading() {
            show(muted('Posten laden...'));
        }

        function renderError(msg) {
            show(`<div style="color:#e66;">${esc(msg)}</div><div style="margin-top:6px;">${link('pa-retry', 'Opnieuw proberen')}</div>`);
        }

        function renderResults(rows, typeLabel, cat, address) {
            const radius = fmtDist(CONFIG.RADIUS_M);
            let html = address ? `<div style="margin-bottom:2px;">🏠 ${esc(address)}</div>` : '';
            if (typeLabel) {
                html += `<div style="color:#7ad;">Gekozen type: ${esc(typeLabel)}</div>`;
            }
            if (cat) {
                html += muted(ctx.cfg.onlyType
                    ? `Alleen ${esc(CATS[cat].label.toLowerCase())} · ${link('pa-all', 'toon alle posten')}`
                    : `Alle posten · ${link('pa-all', `alleen ${esc(CATS[cat].label.toLowerCase())}`)}`);
            }
            const onSpot = rows.find((r) => r.distance <= CONFIG.ON_SPOT_M && (!cat || r.cat === cat));
            if (onSpot) html += `<div style="color:#5c5;margin-top:4px;">✔ Marker staat op ${esc(onSpot.name || CATS[onSpot.cat].label)}</div>`;
            html += '<div style="margin-bottom:4px;"></div>';

            shownRows = rows.slice(0, CONFIG.MAX_ROWS);
            if (!shownRows.length) {
                show(html + muted(`Geen echte ${cat && ctx.cfg.onlyType ? esc(CATS[cat].label.toLowerCase()) : 'hulpdienstpost'} binnen ${radius}.`));
                return;
            }
            html += shownRows.map((r, i) => {
                const c = CATS[r.cat];
                const match = cat && r.cat === cat;
                return `<div class="pa-row" data-i="${i}" title="Klik: marker hierheen" style="padding:4px 2px;border-top:1px solid #333;cursor:pointer;${match ? 'color:#5c5;' : ''}"`
                    + ' onmouseover="this.style.background=\'#222\'" onmouseout="this.style.background=\'\'">'
                    + `${c.icon} <b>${esc(r.name || '(zonder naam)')}</b><br>`
                    + `<span style="color:#999;">${esc(c.label)} · ${fmtDist(r.distance)} · `
                    + `<a href="${osmUrl(r.osm)}" target="_blank" rel="noopener" style="color:#999;">OSM</a></span></div>`;
            }).join('');
            if (rows.length > shownRows.length) html += muted(`+ ${rows.length - shownRows.length} verder weg`);
            html += muted(`<div style="margin-top:6px;">Klik op een post om de marker erheen te zetten.</div><div style="font-size:10px;">${ATTRIBUTION}</div>`);
            show(html);
        }

        /* ========================================================================
         * FORM WATCHER
         * ==================================================================== */
        let lastKey = null;
        let lastRawFieldValue = null;
        let lastAddress = { key: null, text: '' };
        let debounceTimer = null;
        let seq = 0;            // drops answers for coordinates that are no longer current
        let formOpen = false;

        function recheck() {
            lastKey = null;
            lastRawFieldValue = null;
        }

        function scheduleCheck(latVal, lonVal, typeSelect) {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(async () => {
                const lat = Number(latVal);
                const lon = Number(lonVal);
                if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) return;
                const typeValue = typeSelect ? typeSelect.value : '';
                const key = `${lat.toFixed(6)},${lon.toFixed(6)},${typeValue},${CONFIG.RADIUS_M},${ctx.cfg.onlyType}`;
                if (key === lastKey) return;
                lastKey = key;
                const mySeq = ++seq;

                const typeLabel = typeSelect?.selectedOptions[0]?.textContent.trim() || '';
                const typeCat = TYPE_CAT[typeValue] || null;
                const filterCat = ctx.cfg.onlyType ? typeCat : null;

                // Address only when the position changed, not on a type/filter change.
                const posKey = `${lat.toFixed(6)},${lon.toFixed(6)}`;
                const addressP = !ctx.cfg.address ? Promise.resolve('')
                    : lastAddress.key === posKey ? Promise.resolve(lastAddress.text)
                        : reverseGeocode(lat, lon)
                            .then((text) => { lastAddress = { key: posKey, text }; return text; })
                            .catch((e) => { warn('Nominatim failed', e); return ''; });

                const box = boxAround(lat, lon, CONFIG.RADIUS_M);
                if (!boxReady(box)) renderLoading();
                try {
                    const posts = (await postsInBox(...box)) || [];
                    if (mySeq !== seq) return;
                    const rows = nearbyPosts(posts, lat, lon, filterCat);
                    renderResults(rows, typeLabel, typeCat, lastAddress.key === posKey ? lastAddress.text : '');
                    log(`checked ${key}: ${rows.length} post(s)`);
                    // The address is slower; add it when it arrives.
                    const address = await addressP;
                    if (mySeq === seq && address) renderResults(rows, typeLabel, typeCat, address);
                } catch (e) {
                    if (mySeq !== seq) return;
                    warn('could not load posts', e);
                    renderError(`Kon de lijst met posten niet laden (${e.message}).`);
                }
            }, CONFIG.DEBOUNCE_MS);
        }

        function poll() {
            const fields = findLatLngInputs();
            if (!fields) {
                // Form closed: hide the panel and start fresh next time.
                if (formOpen) {
                    formOpen = false;
                    filledName = null;
                    clearTimeout(debounceTimer);
                    seq++;
                    lastKey = lastRawFieldValue = dismissedKey = null;
                    removePanel();
                }
                return;
            }
            if (!formOpen) { formOpen = true; renderIdle(); }
            const latVal = fields.lat.value;
            const lonVal = fields.lon.value;
            if (!latVal || !lonVal) return;
            if (pending) {
                const p = pending.post;
                const fresh = Date.now() < pending.until;
                pending = null;
                if (fresh) { fillForm(p); return; }
            }
            const typeSelect = findGebouwtypeSelect();
            // Only reschedule on a real change: scheduleCheck() resets its
            // debounce timer, so calling it every tick would never let it fire.
            const rawKey = `${latVal}|${lonVal}|${typeSelect ? typeSelect.value : ''}|${CONFIG.RADIUS_M}|${ctx.cfg.onlyType}`;
            if (rawKey === lastRawFieldValue) return;
            lastRawFieldValue = rawKey;
            scheduleCheck(latVal, lonVal, typeSelect);
        }

        /* ========================================================================
         * MAP LAYER "Echte posten" (map page, top window only)
         * ====================================================================
         * A box top-left on the map: pick a category and its real posts show
         * as dots. A post where you already own a building of that category
         * (within OWNED_M) is grey. Clicking a dot gives "Hier bouwen".
         * ==================================================================== */
        let layerHandle = null;

        function initLayer(map, L) {
            let choice = 'off';
            try { choice = localStorage.getItem(CONFIG.LAYER_STORE_KEY) || 'off'; } catch (e) { /* ignore */ }
            if (!CATS[choice]) choice = 'off';

            const group = L.layerGroup().addTo(map);
            let owned = null;     // [{ lat, lon, cat }] from /api/buildings
            let drawSeq = 0;
            let shown = [];       // posts behind the drawn dots, for popups

            async function loadOwned() {
                if (owned) return owned;
                try {
                    const res = await fetch('/api/buildings', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
                    const list = res.ok ? await res.json() : [];
                    owned = list.map((b) => ({ lat: Number(b.latitude), lon: Number(b.longitude), cat: TYPE_CAT[b.building_type] }))
                        .filter((b) => b.cat && Number.isFinite(b.lat));
                } catch (e) {
                    warn('could not load own buildings', e);
                    owned = [];
                }
                return owned;
            }

            const Control = L.Control.extend({
                options: { position: 'topleft' },
                onAdd() {
                    const box = L.DomUtil.create('div', 'leaflet-bar mks-pa-layer');
                    box.style.cssText = 'background:#fff;color:#222;padding:5px 7px;font-size:12px;line-height:1.4;max-width:190px;';
                    box.innerHTML = '<b>Echte posten</b>'
                        + `<select class="mks-pa-cat" style="width:100%;margin:2px 0;color:#222"><option value="off">Uit</option>${
                            Object.entries(CATS).map(([k, c]) => `<option value="${k}">${c.icon} ${esc(c.label)}</option>`).join('')}</select>`
                        + '<div class="mks-pa-status" style="color:#777"></div>';
                    L.DomEvent.disableClickPropagation(box);
                    L.DomEvent.disableScrollPropagation(box);
                    const sel = box.querySelector('.mks-pa-cat');
                    sel.value = choice;
                    sel.addEventListener('change', () => {
                        choice = sel.value;
                        try { localStorage.setItem(CONFIG.LAYER_STORE_KEY, choice); } catch (e) { /* ignore */ }
                        draw();
                    });
                    this.status = box.querySelector('.mks-pa-status');
                    return box;
                },
            });
            const control = new Control();
            map.addControl(control);
            const status = (text) => { control.status.textContent = text; };

            async function draw() {
                const mySeq = ++drawSeq;
                group.clearLayers();
                shown = [];
                if (choice === 'off') { status(''); return; }
                if (map.getZoom() < CONFIG.LAYER_MIN_ZOOM) { status('Zoom verder in'); return; }
                const b = map.getBounds();
                const box = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()];
                if (!boxReady(box)) status('Laden...');
                let posts;
                let mine;
                try {
                    [posts, mine] = await Promise.all([postsInBox(...box), loadOwned()]);
                } catch (e) {
                    if (mySeq === drawSeq) status(`Laden mislukt (${e.message})`);
                    return;
                }
                if (mySeq !== drawSeq) return;
                if (!posts) { status('Zoom verder in'); return; }
                const c = CATS[choice];
                const inView = posts.filter((p) => p[2] === choice && b.contains([p[0], p[1]]));
                let free = 0;
                for (const p of inView.slice(0, CONFIG.LAYER_MAX_MARKERS)) {
                    const post = { lat: p[0], lon: p[1], cat: p[2], name: p[3], osm: p[4] };
                    post.owned = mine.some((o) => o.cat === choice && distanceMeters(o.lat, o.lon, post.lat, post.lon) <= CONFIG.OWNED_M);
                    if (!post.owned) free++;
                    const i = shown.push(post) - 1;
                    L.circleMarker([post.lat, post.lon], {
                        radius: 7, weight: 2, color: '#fff',
                        fillColor: post.owned ? '#868e96' : c.color, fillOpacity: post.owned ? 0.5 : 0.9,
                    })
                        .bindTooltip(esc(post.name || c.label))
                        .bindPopup(() => popupHtml(i))
                        .addTo(group);
                }
                const more = inView.length > CONFIG.LAYER_MAX_MARKERS ? ` (eerste ${CONFIG.LAYER_MAX_MARKERS})` : '';
                status(`${inView.length} in beeld${more}, ${free} nog niet van jou`);
            }

            function popupHtml(i) {
                const p = shown[i];
                const c = CATS[p.cat];
                const formOpenNow = !!findLatLngInputs();
                return `<div style="font-size:12px;min-width:170px">${c.icon} <b>${esc(p.name || '(zonder naam)')}</b><br>`
                    + `<span style="color:#777">${esc(c.label)} · <a href="${osmUrl(p.osm)}" target="_blank" rel="noopener">OSM</a></span>`
                    + (p.owned ? '<div style="color:#868e96;margin-top:3px">Hier heb je er al een.</div>' : '')
                    + `<div style="margin-top:6px"><button type="button" class="btn btn-xs btn-success mks-pa-build" data-i="${i}">`
                    + `${formOpenNow ? 'Marker hierheen' : 'Hier bouwen'}</button></div>`
                    + `<div style="color:#999;font-size:10px;margin-top:4px">${ATTRIBUTION}</div></div>`;
            }

            const onPopupClick = (e) => {
                const btn = e.target.closest && e.target.closest('.mks-pa-build');
                if (!btn) return;
                const p = shown[Number(btn.dataset.i)];
                if (!p) return;
                map.closePopup();
                buildHere(p);
            };
            const container = map.getContainer();
            container.addEventListener('click', onPopupClick);
            map.on('moveend', draw);
            draw();

            return {
                stop() {
                    map.off('moveend', draw);
                    container.removeEventListener('click', onPopupClick);
                    map.removeLayer(group);
                    map.removeControl(control);
                },
            };
        }

        function startLayer() {
            if (layerHandle || !ctx.cfg.mapLayer || window.top !== window.self || location.pathname !== '/') return;
            let tries = 0;
            const t = setInterval(() => {
                const L = ctx.W.L;
                const map = ctx.W.map;
                if (L && L.Control && map && typeof map.addLayer === 'function') {
                    clearInterval(t);
                    if (!layerHandle && ctx.cfg.mapLayer) layerHandle = initLayer(map, L);
                } else if (++tries > 60) {
                    clearInterval(t);
                }
            }, 500);
        }
        function stopLayer() {
            if (layerHandle) layerHandle.stop();
            layerHandle = null;
        }

        // Settings apply live; no reload needed.
        ctx.onSettings(() => {
            recheck();
            if (ctx.cfg.mapLayer) startLayer(); else stopLayer();
        });

        log('watching for building placement fields...');
        const timer = setInterval(poll, CONFIG.POLL_MS);
        startLayer();

        return {
            stop() {
                clearInterval(timer);
                clearTimeout(debounceTimer);
                seq++;
                removePanel();
                stopLayer();
            },
        };
    },
});
