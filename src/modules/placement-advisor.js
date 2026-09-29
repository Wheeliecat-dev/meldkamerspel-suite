MKS.module({
    id: 'placement-advisor',
    name: 'Plaatsingsadvies',
    icon: '📍',
    category: 'map',
    description: 'Tijdens het bouwen of verplaatsen van een gebouw: toont de echte hulpdienstposten (brandweer, ambulance, politie, ziekenhuis, heli, KNRM, '
        + 'Rijkswaterstaat, defensie) in de buurt van de marker, volgens OpenStreetMap. Klik op een post en de marker springt erheen. '
        + 'Vult verder niets in en koopt nooit iets: bouwen doe je zelf.',
    tagline: 'Verschijnt bij gebouw plaatsen',
    at: 'load',
    frames: 'all',
    live: true,
    settings: [
        { key: 'radiusKm', label: 'Zoekstraal', type: 'range', default: 5, min: 0.5, max: 10, step: 0.5, unit: ' km' },
        { key: 'onlyType', label: 'Alleen posten van het gekozen gebouwtype', type: 'bool', default: true,
            help: 'Uit: alle soorten hulpdienstposten. Bij een gebouwtype zonder echte tegenhanger zie je altijd alles.' },
        { key: 'address', label: 'Adres van de marker tonen (Nominatim)', type: 'bool', default: true },
        { key: 'debug', label: 'Uitgebreid loggen in console', type: 'bool', default: false },
    ],

    run(ctx) {
        /* ========================================================================
         * CONFIG
         * ====================================================================
         * The posts come from dist/data/posts-nl.json in the suite repo
         * (made by `node build.js osm`), not from a live Overpass query: that
         * query takes minutes and the public server is often overloaded. The
         * file is cached in GM storage and refreshed once a week.
         *
         * The only thing this module changes is the position of the game's
         * own placement marker, and only when you click a post.
         * ==================================================================== */
        const CONFIG = {
            get DEBUG() { return ctx.cfg.debug; },
            get RADIUS_M() { return ctx.cfg.radiusKm * 1000; },
            POLL_MS: 500,       // how often to check whether the lat/lng fields changed
            DEBOUNCE_MS: 400,   // wait this long after the last change before searching
            DATA_URL: '{{DATA_URL}}',
            DATA_CACHE_KEY: 'mks.placementAdvisor.posts',
            DATA_MAX_AGE_MS: 7 * 24 * 60 * 60 * 1000,
            NOMINATIM_URL: 'https://nominatim.openstreetmap.org/reverse',
            // Sent only by the GM_xmlhttpRequest fallback; page fetch() cannot
            // set a User-Agent.
            USER_AGENT: 'Meldkamerspel-Suite (github.com/Wheeliecat-dev/meldkamerspel-suite)',
            REQUEST_TIMEOUT_MS: 20 * 1000,
            ON_SPOT_M: 60,      // marker this close to a post = "on" that post
            MAX_ROWS: 25,
        };

        const esc = ctx.esc;
        const log = (...a) => { if (CONFIG.DEBUG) console.log('%c[PlacementAdvisor]', 'color:#a06', ...a); };
        const warn = (...a) => console.warn('[PlacementAdvisor]', ...a);

        /* ========================================================================
         * Post categories (codes as written by build.js) and which category
         * belongs to each game building type (<select id="building_building_type">).
         * Types without a real counterpart (e.g. uitgangsstelling) show all.
         * ==================================================================== */
        const CATS = {
            F: { icon: '🚒', label: 'Brandweerkazerne' },
            A: { icon: '🚑', label: 'Ambulancepost' },
            P: { icon: '🚓', label: 'Politiebureau' },
            H: { icon: '🏥', label: 'Ziekenhuis' },
            L: { icon: '🚁', label: 'Helikopterplatform' },
            W: { icon: '🛟', label: 'Reddingsbrigade / KNRM' },
            R: { icon: '🚧', label: 'Rijkswaterstaat' },
            M: { icon: '🪖', label: 'Defensie' },
        };
        const TYPE_CAT = {
            0: 'F', 17: 'F', 4: 'F',
            3: 'A', 13: 'A',
            2: 'H',
            5: 'P', 11: 'P', 18: 'P', 8: 'P',
            6: 'L', 9: 'L', 21: 'L',
            16: 'W', 19: 'W', 20: 'W',
            22: 'R',
            23: 'M', 25: 'M', 26: 'M',
        };

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
         * DATA
         * ==================================================================== */
        function readCache() {
            try { return JSON.parse(GM_getValue(CONFIG.DATA_CACHE_KEY, 'null')); } catch (e) { return null; }
        }

        let postsPromise = null;
        // -> [[lat, lon, cat, name, osmId], ...]
        function loadPosts() {
            if (postsPromise) return postsPromise;
            const cached = readCache();
            if (cached && Date.now() - cached.t < CONFIG.DATA_MAX_AGE_MS) {
                postsPromise = Promise.resolve(cached.posts);
                return postsPromise;
            }
            postsPromise = request(CONFIG.DATA_URL)
                .then((text) => {
                    const data = JSON.parse(text);
                    GM_setValue(CONFIG.DATA_CACHE_KEY, JSON.stringify({ t: Date.now(), date: data.date, posts: data.posts }));
                    log(`loaded ${data.posts.length} posts (OSM ${data.date})`);
                    return data.posts;
                })
                .catch((e) => {
                    postsPromise = null;
                    if (cached) { warn('could not refresh posts, using old copy', e); return cached.posts; }
                    throw e;
                });
            return postsPromise;
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
         * GAME MARKER
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
                    if (W.map && W.L && typeof W.map.eachLayer === 'function') return { map: W.map, L: W.L };
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

        /* ========================================================================
         * PANEL
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
                    if (r) moveMarker(r.lat, r.lon);
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
            html += muted('<div style="margin-top:6px;">Klik op een post om de marker erheen te zetten.</div>'
                + '<div style="font-size:10px;">Gegevens © OpenStreetMap-bijdragers (ODbL)</div>');
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

                if (!postsPromise) renderLoading();
                try {
                    const posts = await loadPosts();
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
                    clearTimeout(debounceTimer);
                    seq++;
                    lastKey = lastRawFieldValue = dismissedKey = null;
                    removePanel();
                }
                return;
            }
            if (!formOpen) { formOpen = true; renderIdle(); loadPosts().catch(() => {}); }
            const latVal = fields.lat.value;
            const lonVal = fields.lon.value;
            if (!latVal || !lonVal) return;
            const typeSelect = findGebouwtypeSelect();
            // Only reschedule on a real change: scheduleCheck() resets its
            // debounce timer, so calling it every tick would never let it fire.
            const rawKey = `${latVal}|${lonVal}|${typeSelect ? typeSelect.value : ''}|${CONFIG.RADIUS_M}|${ctx.cfg.onlyType}`;
            if (rawKey === lastRawFieldValue) return;
            lastRawFieldValue = rawKey;
            scheduleCheck(latVal, lonVal, typeSelect);
        }

        // Settings apply on the next check; no reload needed.
        ctx.onSettings(recheck);

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
