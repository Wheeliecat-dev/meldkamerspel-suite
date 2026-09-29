MKS.module({
    id: 'placement-advisor',
    name: 'Plaatsingsadvies',
    icon: '📍',
    category: 'map',
    description: 'Tijdens het bouwen of verplaatsen van een gebouw: toont welke echte OpenStreetMap-objecten binnen een straal van de gekozen plek liggen, '
        + 'zodat je ziet of het een geloofwaardige echte locatie is. Blokkeert of vult nooit iets in.',
    tagline: 'Verschijnt bij gebouw plaatsen',
    at: 'load',
    frames: 'all',
    settings: [
        { key: 'radius', label: 'Zoekstraal', type: 'range', default: 25, min: 10, max: 150, step: 5, unit: ' m' },
        { key: 'debug', label: 'Uitgebreid loggen in console', type: 'bool', default: false },
    ],

    run(ctx) {
        /* ========================================================================
         * CONFIG
         * ====================================================================
         * Purely advisory — this never fills in a name, never blocks the submit
         * button, never touches the form. It only shows you a panel of what
         * OpenStreetMap says is really at the coordinates the game's own
         * lat/lng fields currently hold.
         * ==================================================================== */
        const CONFIG = {
            get DEBUG() { return ctx.cfg.debug; },
            get RADIUS_METERS() { return ctx.cfg.radius; },
            POLL_MS: 500,       // how often to check whether the lat/lng fields changed
            DEBOUNCE_MS: 900,   // wait this long after the last change before querying
            OVERPASS_ENDPOINTS: [
                'https://overpass-api.de/api/interpreter',
                'https://overpass.kumi.systems/api/interpreter',
                'https://overpass.openstreetmap.ru/api/interpreter',
                'https://overpass.private.coffee/api/interpreter',
            ],
            REQUEST_TIMEOUT_MS: 15 * 1000,
        };

        const log = (...a) => { if (CONFIG.DEBUG) console.log('%c[PlacementAdvisor]', 'color:#a06', ...a); };
        const warn = (...a) => console.warn('[PlacementAdvisor]', ...a);

        /* ========================================================================
         * Gebouwtype (building_type) -> what a real one is usually tagged as in
         * OSM. Purely descriptive/best-effort — shown as a hint in the panel,
         * never used to filter or validate automatically. Values match the
         * game's own <select id="building_building_type"> options exactly
         * (confirmed live from /buildings/new).
         * ==================================================================== */
        const GEBOUWTYPE_HINTS = {
            '0': 'amenity=fire_station', '17': 'amenity=fire_station',
            '4': 'brandweer/veiligheid opleiding (geen vaste OSM-tag)',
            '23': 'military=* (hangar)',
            '3': 'emergency=ambulance_station', '13': 'emergency=ambulance_station',
            '2': 'amenity=hospital',
            '5': 'amenity=police', '18': 'amenity=police', '11': 'amenity=police',
            '8': 'politieopleiding (geen vaste OSM-tag)',
            '9': 'aeroway=helipad',
            '7': 'amenity=university',
            '6': 'aeroway=helipad (traumahelikopter)',
            '16': 'emergency=lifeguard / reddingsbrigade',
            '19': 'kustwacht (geen vaste OSM-tag)',
            '20': 'SAR-opleiding (geen vaste OSM-tag)',
            '21': 'aeroway=helipad',
            '10': 'uitgangsstelling (geen vaste OSM-tag)',
            '22': 'Rijkswaterstaat steunpunt (office=government)',
            '24': 'bergingsbedrijf (geen vaste OSM-tag)',
            '25': 'military=barracks',
            '26': 'militaire opleiding (geen vaste OSM-tag)',
            '27': 'railway=* (spoor incidentbestrijding)',
        };

        /* ========================================================================
         * OVERPASS QUERY
         * ==================================================================== */
        // POST, not GET — a live run hit HTTP 406 from overpass-api.de on GET
        // requests fired from inside a userscript context (GM_xmlhttpRequest
        // doesn't send quite the same headers a normal browser navigation
        // would, and Overpass can be picky about that on GET). POST with the
        // query as form-encoded body is Overpass's own documented way to submit
        // a query and sidesteps the issue entirely.
        function gmFetch(url, body) {
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'POST',
                    url,
                    data: body,
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    timeout: CONFIG.REQUEST_TIMEOUT_MS,
                    onload: (res) => {
                        if (res.status >= 200 && res.status < 300) resolve(res.responseText);
                        else reject(new Error(`HTTP ${res.status}`));
                    },
                    onerror: () => reject(new Error('network error')),
                    ontimeout: () => reject(new Error('timeout')),
                });
            });
        }

        async function queryOverpass(lat, lon, radius) {
            const query = `[out:json][timeout:15];(node(around:${radius},${lat},${lon});way(around:${radius},${lat},${lon}););out center tags 40;`;
            const body = `data=${encodeURIComponent(query)}`;
            let text;
            let lastErr;
            for (const endpoint of CONFIG.OVERPASS_ENDPOINTS) {
                try {
                    text = await gmFetch(endpoint, body);
                    lastErr = null;
                    break;
                } catch (e) {
                    lastErr = e;
                    warn(`Overpass endpoint ${endpoint} failed, trying next`, e);
                }
            }
            if (lastErr) throw lastErr;
            return JSON.parse(text);
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
            const interesting = ['amenity', 'emergency', 'office', 'military', 'railway', 'aeroway', 'shop', 'healthcare', 'building'];
            for (const key of interesting) {
                if (tags[key] && tags[key] !== 'yes') return `${key}=${tags[key]}`;
            }
            if (tags.building === 'yes') return 'building';
            return null;
        }

        // Tag keys worth showing even without a name — genuinely institutional
        // categories. Bare infrastructure (railway=rail/beacon, building=roof,
        // plain highway geometry, ...) is real OSM data but just clutter for
        // "is this a plausible real venue" — excluded unless it also has a name.
        const NAMELESS_WORTHY_KEYS = new Set(['amenity', 'emergency', 'office', 'military', 'healthcare', 'aeroway']);
        // NOTE: for a "way" (a long platform, a building outline, ...), Overpass's
        // `out center` reports the centroid of the WHOLE way, which can sit well
        // outside the query radius even though the way's geometry does pass
        // through it (confirmed live: a train platform showed up "210m" away
        // under a 25m query). Distances shown here are a good-enough estimate,
        // not a guarantee every row is truly within RADIUS_METERS.
        function relevantElements(elements, lat, lon) {
            const rows = [];
            for (const el of elements) {
                const tags = el.tags || {};
                const desc = describeElement(tags);
                const descKey = desc ? desc.split('=')[0] : null;
                if (!tags.name && !(descKey && NAMELESS_WORTHY_KEYS.has(descKey))) continue;
                const elat = el.lat ?? (el.center && el.center.lat);
                const elon = el.lon ?? (el.center && el.center.lon);
                if (elat === undefined || elon === undefined) continue;
                rows.push({
                    name: tags.name || '(zonder naam)',
                    desc: desc || '',
                    distance: Math.round(distanceMeters(lat, lon, elat, elon)),
                });
            }
            rows.sort((a, b) => a.distance - b.distance);
            return rows.slice(0, 15);
        }

        /* ========================================================================
         * PANEL
         * ==================================================================== */
        let panelEl = null;
        function ensurePanel() {
            if (panelEl && document.body.contains(panelEl)) return panelEl;
            panelEl = document.createElement('div');
            panelEl.id = 'pa-panel';
            panelEl.style.cssText = 'position:fixed;top:70px;right:8px;z-index:99999;background:#111;color:#eee;font:12px/1.4 sans-serif;padding:10px 12px;border-radius:6px;opacity:0.95;max-width:340px;max-height:70vh;overflow-y:auto;box-shadow:0 2px 8px rgba(0,0,0,0.5);';
            document.body.appendChild(panelEl);
            return panelEl;
        }

        function renderIdle() {
            const el = ensurePanel();
            el.innerHTML = '<div style="font-weight:bold;margin-bottom:4px;">Placement Advisor</div><div style="color:#999;">Kies een gebouwtype en typ een adres of sleep de kaart-icoon om te controleren wat hier echt staat (OSM, straal 25m).</div>';
        }

        function renderLoading(lat, lon) {
            const el = ensurePanel();
            el.innerHTML = `<div style="font-weight:bold;margin-bottom:4px;">Placement Advisor</div><div style="color:#999;">Zoeken rond ${lat.toFixed(5)}, ${lon.toFixed(5)} ...</div>`;
        }

        function renderError(msg) {
            const el = ensurePanel();
            el.innerHTML = `<div style="font-weight:bold;margin-bottom:4px;">Placement Advisor</div><div style="color:#e66;">${msg}</div>`;
        }

        function renderResults(lat, lon, rows, gebouwtypeLabel, hint) {
            const el = ensurePanel();
            const header = `<div style="font-weight:bold;margin-bottom:2px;">Placement Advisor</div>`
                + `<div style="color:#999;margin-bottom:6px;">${lat.toFixed(5)}, ${lon.toFixed(5)} — straal ${CONFIG.RADIUS_METERS}m</div>`
                + (gebouwtypeLabel ? `<div style="color:#7ad;margin-bottom:6px;">Gekozen type: ${gebouwtypeLabel}${hint ? ` <span style="color:#999;">(meestal: ${hint})</span>` : ''}</div>` : '');
            if (!rows.length) {
                el.innerHTML = header + '<div style="color:#e90;">Niets gevonden binnen ${CONFIG.RADIUS_METERS}m — dit is geen bekende naam/echt object volgens OpenStreetMap.</div>';
                return;
            }
            const rowsHtml = rows.map((r) => `<div style="padding:3px 0;border-top:1px solid #333;"><b>${r.name}</b><br><span style="color:#999;">${r.desc} — ${r.distance}m</span></div>`).join('');
            el.innerHTML = header + rowsHtml;
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
        let debounceTimer = null;
        let seenLatLng = false;

        function scheduleCheck(latVal, lonVal, gebouwtypeSelect) {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(async () => {
                const lat = Number(latVal);
                const lon = Number(lonVal);
                if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
                const key = `${lat.toFixed(6)},${lon.toFixed(6)}`;
                if (key === lastKey) return;
                lastKey = key;

                const gebouwtypeLabel = gebouwtypeSelect && gebouwtypeSelect.selectedOptions[0] ? gebouwtypeSelect.selectedOptions[0].textContent.trim() : '';
                const hint = gebouwtypeSelect ? GEBOUWTYPE_HINTS[gebouwtypeSelect.value] : '';

                renderLoading(lat, lon);
                try {
                    const data = await queryOverpass(lat, lon, CONFIG.RADIUS_METERS);
                    const rows = relevantElements(data.elements || [], lat, lon);
                    renderResults(lat, lon, rows, gebouwtypeLabel, hint);
                    log(`checked ${key} — ${rows.length} feature(s) within ${CONFIG.RADIUS_METERS}m`);
                } catch (e) {
                    warn('Overpass query failed', e);
                    renderError('Overpass-query mislukt — zie console (F12).');
                }
            }, CONFIG.DEBOUNCE_MS);
        }

        let lastRawFieldValue = null;
        function poll() {
            const fields = findLatLngInputs();
            if (!fields) return; // not on a page with a placement map right now
            if (!seenLatLng) { seenLatLng = true; renderIdle(); }
            const latVal = fields.lat.value;
            const lonVal = fields.lon.value;
            if (!latVal || !lonVal) return;
            // Only (re)schedule when the raw value actually changed since the
            // last poll tick. POLL_MS (500ms) is shorter than DEBOUNCE_MS
            // (900ms) on purpose — polling that often is what makes the panel
            // feel responsive — but scheduleCheck() unconditionally resets its
            // own debounce timer, so calling it every tick regardless of change
            // meant the debounce could never elapse: it kept getting reset by
            // the next poll tick before it ever fired. Confirmed live — the
            // panel silently stayed on the idle message forever until this
            // check was added.
            const rawKey = `${latVal}|${lonVal}`;
            if (rawKey === lastRawFieldValue) return;
            lastRawFieldValue = rawKey;
            scheduleCheck(latVal, lonVal, findGebouwtypeSelect());
        }

        function boot() {
            log('watching for building placement fields...');
            setInterval(poll, CONFIG.POLL_MS);
        }

        if (document.readyState === 'complete') boot();
        else window.addEventListener('load', boot);
    },
});
