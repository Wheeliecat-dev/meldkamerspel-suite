MKS.module({
    id: 'placement-advisor',
    name: 'Plaatsingsadvies',
    icon: '📍',
    category: 'map',
    description: 'Tijdens het bouwen of verplaatsen van een gebouw: toont het adres en welke echte OpenStreetMap-objecten binnen een straal van de gekozen plek liggen, '
        + 'zodat je ziet of het een geloofwaardige echte locatie is. Een echte post van hetzelfde type wordt groen gemarkeerd. Blokkeert of vult nooit iets in.',
    tagline: 'Verschijnt bij gebouw plaatsen',
    at: 'load',
    frames: 'all',
    live: true,
    settings: [
        { key: 'radius', label: 'Zoekstraal', type: 'range', default: 50, min: 10, max: 150, step: 5, unit: ' m' },
        { key: 'address', label: 'Adres tonen (Nominatim)', type: 'bool', default: true },
        { key: 'debug', label: 'Uitgebreid loggen in console', type: 'bool', default: false },
    ],

    run(ctx) {
        /* ========================================================================
         * CONFIG
         * ====================================================================
         * Purely advisory: never fills in a name, never blocks the submit
         * button, never touches the form. It only shows a panel of what
         * OpenStreetMap says is at the coordinates the game's own lat/lng
         * fields currently hold.
         * ==================================================================== */
        const CONFIG = {
            get DEBUG() { return ctx.cfg.debug; },
            get RADIUS_METERS() { return ctx.cfg.radius; },
            POLL_MS: 500,       // how often to check whether the lat/lng fields changed
            DEBOUNCE_MS: 900,   // wait this long after the last change before querying
            // overpass-api.de is the only reliable public instance. The others
            // are fallbacks and often down.
            OVERPASS_ENDPOINTS: [
                'https://overpass-api.de/api/interpreter',
                'https://overpass.private.coffee/api/interpreter',
                'https://overpass.kumi.systems/api/interpreter',
            ],
            NOMINATIM_URL: 'https://nominatim.openstreetmap.org/reverse',
            // Sent only by the GM_xmlhttpRequest fallback; page fetch() cannot
            // set a User-Agent.
            USER_AGENT: 'Meldkamerspel-Suite (github.com/Wheeliecat-dev/meldkamerspel-suite)',
            REQUEST_TIMEOUT_MS: 20 * 1000,
            RETRIES: 2,         // extra tries per endpoint on 429/504 (server busy)
            MAX_ROWS: 15,
        };

        const esc = ctx.esc;
        const log = (...a) => { if (CONFIG.DEBUG) console.log('%c[PlacementAdvisor]', 'color:#a06', ...a); };
        const warn = (...a) => console.warn('[PlacementAdvisor]', ...a);
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

        /* ========================================================================
         * Gebouwtype (building_type) -> the OSM tags a real one has. `match` is
         * used to highlight a real post of the same type in the list; `hint` is
         * shown next to the chosen type. Values match the game's own
         * <select id="building_building_type"> options.
         * ==================================================================== */
        const is = (key, ...values) => (t) => values.includes(t[key]);
        const any = (...fns) => (t) => fns.some((f) => f(t));
        const TYPES = {
            '0': { hint: 'brandweerkazerne', match: is('amenity', 'fire_station') },
            '17': { hint: 'brandweerkazerne', match: is('amenity', 'fire_station') },
            '3': { hint: 'ambulancepost', match: is('emergency', 'ambulance_station') },
            '13': { hint: 'ambulancepost', match: is('emergency', 'ambulance_station') },
            '2': { hint: 'ziekenhuis', match: any(is('amenity', 'hospital'), is('healthcare', 'hospital')) },
            '5': { hint: 'politiebureau', match: is('amenity', 'police') },
            '11': { hint: 'politiebureau', match: is('amenity', 'police') },
            '18': { hint: 'politiebureau', match: is('amenity', 'police') },
            '6': { hint: 'helikopterplatform', match: is('aeroway', 'helipad', 'heliport') },
            '9': { hint: 'helikopterplatform', match: is('aeroway', 'helipad', 'heliport') },
            '21': { hint: 'helikopterplatform', match: is('aeroway', 'helipad', 'heliport') },
            '7': { hint: 'hogeschool/universiteit', match: is('amenity', 'university', 'college') },
            '16': { hint: 'reddingsbrigade', match: any(is('emergency', 'lifeguard', 'lifeguard_base'), is('amenity', 'lifeboat_station')) },
            '19': { hint: 'kustwacht/reddingsstation', match: any(is('emergency', 'lifeboat_station', 'water_rescue'), is('amenity', 'lifeboat_station')) },
            '22': { hint: 'overheidskantoor', match: is('office', 'government') },
            '23': { hint: 'militair terrein', match: (t) => !!t.military },
            '25': { hint: 'kazerne (militair)', match: (t) => !!t.military },
        };

        /* ========================================================================
         * HTTP
         * ====================================================================
         * Page fetch() first: overpass-api.de answers HTTP 406 to requests that
         * carry a browser User-Agent but no Origin/Sec-Fetch headers, which is
         * exactly what GM_xmlhttpRequest sends. A real page fetch has those
         * headers, and both Overpass and Nominatim allow CORS. GM is only the
         * fallback (e.g. when fetch is blocked), with our own User-Agent.
         * ==================================================================== */
        class HttpError extends Error {
            constructor(status) { super(`HTTP ${status}`); this.status = status; }
        }

        async function pageFetch(url, opts) {
            const ac = new AbortController();
            const t = setTimeout(() => ac.abort(), CONFIG.REQUEST_TIMEOUT_MS);
            try {
                const res = await fetch(url, { ...opts, signal: ac.signal, credentials: 'omit' });
                if (!res.ok) throw new HttpError(res.status);
                return await res.text();
            } finally {
                clearTimeout(t);
            }
        }

        function gmFetch(url, opts) {
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: opts.method || 'GET',
                    url,
                    data: opts.body,
                    headers: { ...(opts.headers || {}), 'User-Agent': CONFIG.USER_AGENT },
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

        // Retries on "server busy" (429, 504), then falls back to GM.
        async function request(url, opts = {}) {
            for (let attempt = 0; ; attempt++) {
                try {
                    return await pageFetch(url, opts);
                } catch (e) {
                    const busy = e instanceof HttpError && (e.status === 429 || e.status === 504);
                    if (busy && attempt < CONFIG.RETRIES) { await sleep(2000 * (attempt + 1)); continue; }
                    if (e instanceof HttpError) throw e;
                    log(`fetch ${url} failed (${e.message}), trying GM_xmlhttpRequest`);
                    return gmFetch(url, opts);
                }
            }
        }

        /* ========================================================================
         * OVERPASS + NOMINATIM
         * ==================================================================== */
        const QUERY_KEYS = ['name', 'amenity', 'emergency', 'office', 'military', 'healthcare', 'aeroway'];

        async function queryOverpass(lat, lon, radius) {
            // Only tagged objects with a key we care about. A bare
            // node(around) also returns every untagged way vertex.
            const around = `around:${radius},${lat},${lon}`;
            const parts = QUERY_KEYS.map((k) => `nwr(${around})[${k}];`).join('');
            const query = `[out:json][timeout:15];(${parts});out center tags;`;
            const body = `data=${encodeURIComponent(query)}`;
            let lastErr;
            for (const endpoint of CONFIG.OVERPASS_ENDPOINTS) {
                try {
                    const text = await request(endpoint, {
                        method: 'POST',
                        body,
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    });
                    return JSON.parse(text);
                } catch (e) {
                    lastErr = e;
                    warn(`Overpass ${endpoint} failed, trying next`, e);
                }
            }
            throw lastErr;
        }

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

        // Which tag on an element best describes it, for display.
        function describeElement(tags) {
            const keys = ['amenity', 'emergency', 'healthcare', 'office', 'military', 'aeroway', 'shop', 'tourism', 'leisure', 'railway', 'highway', 'building'];
            for (const key of keys) {
                if (tags[key] && tags[key] !== 'yes') return `${key}=${tags[key]}`;
            }
            return tags.building ? 'building' : '';
        }

        // Tag keys worth showing even without a name (institutional).
        const NAMELESS_WORTHY_KEYS = ['amenity', 'emergency', 'office', 'military', 'healthcare', 'aeroway'];

        // NOTE: for a way (a building outline, a platform, ...) `out center`
        // gives the centroid of the whole way, which can lie outside the
        // radius although the way crosses it. Distances are an estimate.
        function relevantElements(elements, lat, lon, type) {
            const rows = [];
            for (const el of elements) {
                const tags = el.tags || {};
                if (!tags.name && !NAMELESS_WORTHY_KEYS.some((k) => tags[k])) continue;
                const elat = el.lat ?? el.center?.lat;
                const elon = el.lon ?? el.center?.lon;
                if (elat === undefined || elon === undefined) continue;
                rows.push({
                    name: tags.name || '(zonder naam)',
                    desc: describeElement(tags),
                    distance: Math.round(distanceMeters(lat, lon, elat, elon)),
                    match: !!(type && type.match(tags)),
                    osm: `https://www.openstreetmap.org/${el.type}/${el.id}`,
                });
            }
            // A real post of the chosen type first, then by distance.
            rows.sort((a, b) => (b.match - a.match) || (a.distance - b.distance));
            return rows;
        }

        /* ========================================================================
         * PANEL
         * ==================================================================== */
        let panelEl = null;
        let dismissedKey = null; // coordinates the user closed the panel for

        function ensurePanel() {
            if (panelEl && document.body.contains(panelEl)) return panelEl;
            panelEl = document.createElement('div');
            panelEl.id = 'pa-panel';
            panelEl.style.cssText = 'position:fixed;top:70px;right:8px;z-index:99999;background:#111;color:#eee;font:12px/1.4 sans-serif;padding:10px 12px;border-radius:6px;opacity:0.95;width:320px;max-height:70vh;overflow-y:auto;box-shadow:0 2px 8px rgba(0,0,0,0.5);';
            panelEl.addEventListener('click', (e) => {
                if (e.target.closest('.pa-close')) { dismissedKey = lastKey; removePanel(); }
                if (e.target.closest('.pa-retry')) { lastKey = null; lastRawFieldValue = null; }
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

        function renderIdle() {
            show(muted(`Typ een adres of sleep de marker. Dan zie je wat daar echt staat (OpenStreetMap, straal ${CONFIG.RADIUS_METERS} m).`));
        }

        function headerHtml(lat, lon, typeLabel, type, address) {
            return muted(`${lat.toFixed(5)}, ${lon.toFixed(5)} · straal ${CONFIG.RADIUS_METERS} m`)
                + (address ? `<div style="margin:2px 0;">🏠 ${esc(address)}</div>` : '')
                + (typeLabel ? `<div style="color:#7ad;margin:2px 0 6px;">Gekozen type: ${esc(typeLabel)}${type ? ` <span style="color:#999;">(zoek: ${esc(type.hint)})</span>` : ''}</div>` : '');
        }

        function renderLoading(lat, lon) {
            show(muted(`Zoeken rond ${lat.toFixed(5)}, ${lon.toFixed(5)} ...`));
        }

        function renderError(msg) {
            show(`<div style="color:#e66;">${esc(msg)}</div>`
                + '<button type="button" class="pa-retry" style="margin-top:6px;color:#222;">Opnieuw proberen</button>');
        }

        function renderResults(lat, lon, rows, typeLabel, type, address) {
            let html = headerHtml(lat, lon, typeLabel, type, address);
            if (type) {
                const hit = rows.find((r) => r.match);
                html += hit
                    ? `<div style="color:#5c5;margin-bottom:6px;">✔ Echte ${esc(type.hint)} op ${hit.distance} m</div>`
                    : `<div style="color:#e90;margin-bottom:6px;">Geen ${esc(type.hint)} binnen ${CONFIG.RADIUS_METERS} m</div>`;
            }
            if (!rows.length) {
                show(html + muted(`Niets met een naam binnen ${CONFIG.RADIUS_METERS} m volgens OpenStreetMap.`));
                return;
            }
            html += rows.slice(0, CONFIG.MAX_ROWS).map((r) => `<div style="padding:3px 0;border-top:1px solid #333;${r.match ? 'color:#5c5;' : ''}">`
                + `<a href="${r.osm}" target="_blank" rel="noopener" style="color:inherit;font-weight:bold;">${esc(r.name)}</a><br>`
                + `<span style="color:#999;">${esc(r.desc)} · ${r.distance} m</span></div>`).join('');
            if (rows.length > CONFIG.MAX_ROWS) html += muted(`+ ${rows.length - CONFIG.MAX_ROWS} meer`);
            show(html);
        }

        /* ========================================================================
         * FORM WATCHER
         * ==================================================================== */
        function findLatLngInputs() {
            const lat = document.querySelector('#building_latitude') || document.querySelector('input[name="building[latitude]"]');
            const lon = document.querySelector('#building_longitude') || document.querySelector('input[name="building[longitude]"]');
            return lat && lon ? { lat, lon } : null;
        }
        function findGebouwtypeSelect() {
            return document.querySelector('#building_building_type') || document.querySelector('select[name="building[building_type]"]');
        }

        let lastKey = null;
        let lastRawFieldValue = null;
        let debounceTimer = null;
        let seq = 0;            // drops answers for coordinates that are no longer current
        let formOpen = false;

        function scheduleCheck(latVal, lonVal, typeSelect) {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(async () => {
                const lat = Number(latVal);
                const lon = Number(lonVal);
                if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) return;
                const key = `${lat.toFixed(6)},${lon.toFixed(6)},${typeSelect ? typeSelect.value : ''},${CONFIG.RADIUS_METERS}`;
                if (key === lastKey) return;
                lastKey = key;
                const mySeq = ++seq;

                const typeLabel = typeSelect?.selectedOptions[0]?.textContent.trim() || '';
                const type = typeSelect ? TYPES[typeSelect.value] : null;

                renderLoading(lat, lon);
                const addressP = ctx.cfg.address
                    ? reverseGeocode(lat, lon).catch((e) => { warn('Nominatim failed', e); return ''; })
                    : Promise.resolve('');
                try {
                    const [data, address] = await Promise.all([queryOverpass(lat, lon, CONFIG.RADIUS_METERS), addressP]);
                    if (mySeq !== seq) return;
                    const rows = relevantElements(data.elements || [], lat, lon, type);
                    renderResults(lat, lon, rows, typeLabel, type, address);
                    log(`checked ${key}: ${rows.length} feature(s)`);
                } catch (e) {
                    if (mySeq !== seq) return;
                    warn('Overpass query failed', e);
                    renderError(`OpenStreetMap-server reageert niet (${e.message}). Probeer het zo opnieuw.`);
                }
            }, CONFIG.DEBOUNCE_MS);
        }

        function poll() {
            const fields = findLatLngInputs();
            if (!fields) {
                // Form closed: hide the panel and start fresh next time.
                if (formOpen) {
                    formOpen = false;
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
            const typeSelect = findGebouwtypeSelect();
            // Only reschedule on a real change: scheduleCheck() resets its
            // debounce timer, so calling it every tick would never let it fire.
            const rawKey = `${latVal}|${lonVal}|${typeSelect ? typeSelect.value : ''}|${CONFIG.RADIUS_METERS}`;
            if (rawKey === lastRawFieldValue) return;
            lastRawFieldValue = rawKey;
            scheduleCheck(latVal, lonVal, typeSelect);
        }

        log('watching for building placement fields...');
        const timer = setInterval(poll, CONFIG.POLL_MS);

        return {
            stop() {
                clearInterval(timer);
                clearTimeout(debounceTimer);
                seq++;
                removePanel();
            },
        };
    },
});
