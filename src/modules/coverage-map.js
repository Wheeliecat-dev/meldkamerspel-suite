MKS.module({
    id: 'coverage-map',
    name: 'Dekkingskaart',
    icon: '🗺️',
    category: 'map',
    description: 'Kaartlaag die kleurt hoe snel je nearest (of 2e) brandweer-, ambulance- of politiepost ergens is: hemelsbreed of over echte wegen (OSRM). '
        + 'Laat zien waar een nieuwe post nodig is. Aan/uit en discipline kies je in het vakje rechtsboven op de kaart. Alleen lezen: koopt of verplaatst nooit iets.',
    tagline: 'Bediening rechtsboven op de kaart',
    at: 'ready',
    frames: 'top',
    pages: /^\/$/,
    pageNote: 'Alleen op de kaartpagina',
    settings: [
        { key: 'fireKmh', label: 'Snelheid brandweer', type: 'number', default: 60, min: 20, max: 150, step: 5, unit: 'km/u',
            help: 'Het spel rijdt elke weg even snel. IJk dit: vergelijk de reistijd van een voertuig in een inzet met wat de kaart daar toont.' },
        { key: 'ambuKmh', label: 'Snelheid ambulance', type: 'number', default: 70, min: 20, max: 150, step: 5, unit: 'km/u' },
        { key: 'policeKmh', label: 'Snelheid politie', type: 'number', default: 70, min: 20, max: 150, step: 5, unit: 'km/u' },
        { key: 'roadFactor', label: 'Omrijfactor hemelsbreed', type: 'number', default: 1.35, min: 1, max: 2, step: 0.05,
            help: 'Hemelsbrede afstand × deze factor ≈ afstand over de weg.' },
        { key: 'samplePx', label: 'Detail', type: 'range', default: 8, min: 4, max: 16, step: 2, unit: ' px', help: 'Grootte van een kleurvlak. Kleiner = scherper maar trager.' },
        { key: 'gridKm', label: 'Rasterafstand over de weg', type: 'number', default: 1.5, min: 0.5, max: 5, step: 0.5, unit: 'km',
            help: 'Kleiner = fijner, maar veel meer verzoeken aan de OSRM-server (eerste keer enkele minuten).' },
        { key: 'requireVehicles', label: 'Alleen posten met voertuigen', type: 'bool', default: true, help: 'Een lege post dekt niets.' },
    ],

    run(ctx) {
        /* ========================================================================
         * CONFIG
         * ====================================================================
         * Two modes:
         *   - Hemelsbreed: straight-line distance x ROAD_FACTOR. Instant, but
         *     draws circles.
         *   - Over de weg: real driving distance from the public OSRM router
         *     (router.project-osrm.org, OpenStreetMap roads) to a grid of
         *     points GRID_KM apart. This sends your post locations to that
         *     server. First run takes a few minutes (max 1 request/second, the
         *     server's usage policy); results are cached in this browser, and
         *     only new posts cause new requests later.
         * Time = turnoutMin + distance / speedKmh (the game drives every road
         * at the same speed). Calibrate speedKmh: open a mission, compare the
         * game's travel time for a vehicle with what this layer shows there.
         *
         * NORM_MIN is the real Dutch response norm per discipline:
         *   brandweer 8 min (Besluit veiligheidsregio's, prio 1 woonfunctie),
         *   ambulance 15 min (A1), politie 15 min (prio 1).
         * Colour bands: green <= 60% of norm, yellow <= norm,
         * orange <= 150% of norm, red beyond that.
         * ==================================================================== */
        const CONFIG = {
            DEBUG: false,
            ROAD_FACTOR: ctx.cfg.roadFactor,
            REFRESH_MS: 5 * 60 * 1000,   // re-read /api/buildings + /api/vehicles
            SAMPLE_PX: ctx.cfg.samplePx,                // colour cell size in screen pixels; lower = sharper but slower
            DEFAULT_OPACITY: 0.35,
            // Road mode
            OSRM_URL: 'https://router.project-osrm.org/table/v1/driving/',
            OSRM_MAX_COORDS: 100,        // public server's table limit
            OSRM_DELAY_MS: 1100,         // public server allows 1 request/second
            GRID_KM: ctx.cfg.gridKm,                // road grid spacing; smaller = finer but many more requests
            MARGIN_KM: 12,               // only compute points within this distance of a post
            CANDIDATES: 4,               // route to this many straight-line-nearest posts per point
            SNAP_MAX_M: 1500,            // point further than this from any road (water, forest) = no colour
            ROAD_CACHE_KEY: 'mks-coverage-roads-v1',
            // Only count a building if it has at least one vehicle. A post you
            // bought but never filled covers nothing.
            REQUIRE_VEHICLES: ctx.cfg.requireVehicles,
            DISCIPLINES: {
                fire:      { label: 'Brandweer', types: [0, 17],     speedKmh: ctx.cfg.fireKmh, turnoutMin: 0, normMin: 8 },
                ambulance: { label: 'Ambulance', types: [3, 13],     speedKmh: ctx.cfg.ambuKmh, turnoutMin: 0, normMin: 15 },
                police:    { label: 'Politie',   types: [5, 11, 18], speedKmh: ctx.cfg.policeKmh, turnoutMin: 0, normMin: 15 },
            },
        };

        const STORE_KEY = 'mks-coverage-map';
        const log = (...a) => { if (CONFIG.DEBUG) console.log('%c[CoverageMap]', 'color:#0a6', ...a); };
        const warn = (...a) => console.warn('[CoverageMap]', ...a);

        /* ========================================================================
         * SETTINGS (per browser, convenience only)
         * ==================================================================== */
        function loadSettings() {
            const def = { discipline: 'off', rank: 1, opacity: CONFIG.DEFAULT_OPACITY, mode: 'line' };
            try {
                return { ...def, ...JSON.parse(localStorage.getItem(STORE_KEY) || '{}') };
            } catch (e) {
                return def;
            }
        }
        function saveSettings(s) {
            try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
        }
        const settings = loadSettings();

        /* ========================================================================
         * DATA
         * ==================================================================== */
        async function apiGet(path) {
            const res = await fetch(path, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
            if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
            return res.json();
        }

        // discipline -> [{ lat, lon, name, vehicles }]
        let stations = {};

        async function loadStations() {
            const [buildings, vehicles] = await Promise.all([
                apiGet('/api/buildings'),
                CONFIG.REQUIRE_VEHICLES ? apiGet('/api/vehicles') : Promise.resolve([]),
            ]);
            const vehicleCount = {};
            for (const v of vehicles) vehicleCount[v.building_id] = (vehicleCount[v.building_id] || 0) + 1;

            const out = {};
            for (const [key, d] of Object.entries(CONFIG.DISCIPLINES)) {
                const types = new Set(d.types);
                out[key] = buildings
                    .filter((b) => types.has(b.building_type))
                    .filter((b) => b.enabled !== false)
                    .filter((b) => !CONFIG.REQUIRE_VEHICLES || vehicleCount[b.id] > 0)
                    .map((b) => ({ lat: Number(b.latitude), lon: Number(b.longitude), name: b.caption, vehicles: vehicleCount[b.id] || 0 }))
                    .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon));
            }
            stations = out;
            log('stations loaded', Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length])));
        }

        /* ========================================================================
         * TRAVEL TIME
         * ==================================================================== */
        const KM_PER_DEG_LAT = 110.57;

        // Minutes to the rank-th nearest station (rank 1 = nearest).
        function travelMinutes(lat, lon, list, d, rank) {
            const kmPerDegLon = 111.32 * Math.cos((lat * Math.PI) / 180);
            let best1 = Infinity, best2 = Infinity;
            for (const s of list) {
                const dx = (s.lon - lon) * kmPerDegLon;
                const dy = (s.lat - lat) * KM_PER_DEG_LAT;
                const d2 = dx * dx + dy * dy;
                if (d2 < best1) { best2 = best1; best1 = d2; } else if (d2 < best2) { best2 = d2; }
            }
            const km = Math.sqrt(rank === 2 ? best2 : best1) * CONFIG.ROAD_FACTOR;
            return d.turnoutMin + (km / d.speedKmh) * 60;
        }

        /* ========================================================================
         * ROAD MODE
         * ====================================================================
         * Fixed lattice (same cells every time) so cache keys stay valid when
         * posts are added. Cache: "i,j" -> { "<post lat,lon>": metres | -1 }
         * plus x: 1 when the point itself is too far from any road.
         * ==================================================================== */
        const DLAT = CONFIG.GRID_KM / KM_PER_DEG_LAT;
        const DLON = CONFIG.GRID_KM / (111.32 * Math.cos((52.2 * Math.PI) / 180));
        const stationKey = (s) => `${s.lat.toFixed(5)},${s.lon.toFixed(5)}`;
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

        ctx.actions([
            { label: 'Wegen-cache wissen', kind: 'danger', title: 'Alle berekende weg-afstanden vergeten (bijv. na een andere rasterafstand).',
                confirm: 'Alle opgeslagen weg-afstanden wissen? De volgende keer "Over de weg" rekent alles opnieuw uit.',
                run: () => { roadCache = {}; try { localStorage.removeItem(CONFIG.ROAD_CACHE_KEY); } catch (e) { /* ignore */ } } },
        ]);

        let roadCache = {};
        try { roadCache = JSON.parse(localStorage.getItem(CONFIG.ROAD_CACHE_KEY) || '{}'); } catch (e) { roadCache = {}; }
        function saveRoadCache() {
            try { localStorage.setItem(CONFIG.ROAD_CACHE_KEY, JSON.stringify(roadCache)); } catch (e) { warn('road cache not saved (storage full?)', e); }
        }

        function straightKm(lat, lon, s) {
            const dx = (s.lon - lon) * 111.32 * Math.cos((lat * Math.PI) / 180);
            const dy = (s.lat - lat) * KM_PER_DEG_LAT;
            return Math.sqrt(dx * dx + dy * dy);
        }

        // Grid points near the posts, each with its nearest candidate posts.
        function gridPoints(list) {
            if (!list.length) return [];
            const lats = list.map((s) => s.lat), lons = list.map((s) => s.lon);
            const mLat = CONFIG.MARGIN_KM / KM_PER_DEG_LAT, mLon = CONFIG.MARGIN_KM / 68;
            const i0 = Math.floor((Math.min(...lats) - mLat) / DLAT), i1 = Math.ceil((Math.max(...lats) + mLat) / DLAT);
            const j0 = Math.floor((Math.min(...lons) - mLon) / DLON), j1 = Math.ceil((Math.max(...lons) + mLon) / DLON);
            const out = [];
            for (let i = i0; i <= i1; i++) {
                for (let j = j0; j <= j1; j++) {
                    const lat = i * DLAT, lon = j * DLON;
                    const near = list.map((s) => [straightKm(lat, lon, s), s]).sort((a, b) => a[0] - b[0]);
                    if (near[0][0] > CONFIG.MARGIN_KM) continue;
                    out.push({ i, j, lat, lon, key: `${i},${j}`, cands: near.slice(0, CONFIG.CANDIDATES).map((x) => x[1]) });
                }
            }
            return out;
        }

        async function osrmTable(srcs, dests) {
            const coords = srcs.concat(dests).map((p) => `${p.lon.toFixed(5)},${p.lat.toFixed(5)}`).join(';');
            const q = `sources=${srcs.map((_, k) => k).join(';')}&destinations=${dests.map((_, k) => k + srcs.length).join(';')}&annotations=distance`;
            for (let attempt = 0; ; attempt++) {
                const res = await fetch(`${CONFIG.OSRM_URL}${coords}?${q}`);
                if (res.status === 429 && attempt < 3) { await sleep(5000 * (attempt + 1)); continue; }
                if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
                const data = await res.json();
                if (data.code !== 'Ok') throw new Error(`OSRM ${data.code}`);
                return data;
            }
        }

        // Fill the cache for one discipline. Only asks for pairs not cached yet.
        // Returns false when cancelled.
        async function computeRoads(list, isCancelled, onProgress, onBatch) {
            const todo = gridPoints(list).filter((p) => {
                const c = roadCache[p.key];
                return !(c && (c.x || p.cands.every((s) => stationKey(s) in c)));
            });
            // Group spatially so neighbouring points share their candidate posts.
            const blocks = new Map();
            for (const p of todo) {
                const bk = `${Math.floor(p.i / 6)},${Math.floor(p.j / 6)}`;
                if (!blocks.has(bk)) blocks.set(bk, []);
                blocks.get(bk).push(p);
            }
            const jobs = [];
            for (const pts of blocks.values()) {
                const srcMap = new Map();
                for (const p of pts) {
                    for (const s of p.cands) {
                        if (!(roadCache[p.key] && stationKey(s) in roadCache[p.key])) srcMap.set(stationKey(s), s);
                    }
                }
                const srcs = [...srcMap.values()];
                const room = Math.max(1, CONFIG.OSRM_MAX_COORDS - srcs.length);
                for (let k = 0; k < pts.length; k += room) jobs.push({ srcs, dests: pts.slice(k, k + room) });
            }
            log(`road mode: ${todo.length} points, ${jobs.length} requests`);
            for (let n = 0; n < jobs.length; n++) {
                if (isCancelled()) return false;
                onProgress(n, jobs.length);
                const { srcs, dests } = jobs[n];
                const data = await osrmTable(srcs, dests);
                dests.forEach((p, di) => {
                    const c = roadCache[p.key] = roadCache[p.key] || {};
                    if ((data.destinations[di]?.distance ?? 0) > CONFIG.SNAP_MAX_M) c.x = 1;
                    srcs.forEach((s, si) => {
                        const m = data.distances[si][di];
                        c[stationKey(s)] = m == null ? -1 : Math.round(m);
                    });
                });
                if (n % 5 === 4) { saveRoadCache(); onBatch(); }
                await sleep(CONFIG.OSRM_DELAY_MS);
            }
            saveRoadCache();
            onProgress(jobs.length, jobs.length);
            return true;
        }

        // "i,j" -> minutes to the rank-th nearest post by road, for rendering.
        function roadMinutesGrid(list, d, rank) {
            const keys = new Set(list.map(stationKey));
            const out = new Map();
            for (const [pk, c] of Object.entries(roadCache)) {
                if (c.x) continue;
                const metres = [];
                for (const [sk, m] of Object.entries(c)) if (m >= 0 && keys.has(sk)) metres.push(m);
                if (metres.length < rank) continue;
                metres.sort((a, b) => a - b);
                out.set(pk, d.turnoutMin + (metres[rank - 1] / 1000 / d.speedKmh) * 60);
            }
            return out;
        }

        // Bilinear blend of the 4 surrounding grid points; null when none known.
        function roadMinutesAt(grid, lat, lon) {
            const fi = lat / DLAT, fj = lon / DLON;
            const i = Math.floor(fi), j = Math.floor(fj), t = fi - i, u = fj - j;
            let sum = 0, w = 0;
            for (const [di, dj, wt] of [[0, 0, (1 - t) * (1 - u)], [1, 0, t * (1 - u)], [0, 1, (1 - t) * u], [1, 1, t * u]]) {
                const v = grid.get(`${i + di},${j + dj}`);
                if (v !== undefined && wt > 0) { sum += v * wt; w += wt; }
            }
            return w > 0.2 ? sum / w : null;
        }

        const BANDS = [
            { upTo: 0.6, color: [40, 167, 69], label: (n) => `≤ ${Math.round(n * 0.6)} min` },
            { upTo: 1.0, color: [255, 193, 7], label: (n) => `≤ ${n} min (norm)` },
            { upTo: 1.5, color: [253, 126, 20], label: (n) => `≤ ${Math.round(n * 1.5)} min` },
            { upTo: Infinity, color: [220, 53, 69], label: (n) => `> ${Math.round(n * 1.5)} min` },
        ];
        function bandColor(minutes, normMin) {
            const r = minutes / normMin;
            for (const b of BANDS) if (r <= b.upTo) return b.color;
            return BANDS[BANDS.length - 1].color;
        }

        /* ========================================================================
         * LAYER + CONTROL
         * ==================================================================== */
        function init(map, L) {
            const CoverageLayer = L.GridLayer.extend({
                createTile(coords) {
                    const size = this.getTileSize();
                    const canvas = L.DomUtil.create('canvas', 'mks-coverage-tile');
                    canvas.width = size.x;
                    canvas.height = size.y;
                    const key = settings.discipline;
                    const d = CONFIG.DISCIPLINES[key];
                    const list = stations[key] || [];
                    if (!d || !list.length) return canvas;

                    const ctx = canvas.getContext('2d');
                    const img = ctx.createImageData(size.x, size.y);
                    const step = CONFIG.SAMPLE_PX;
                    const origin = coords.scaleBy(size);
                    const rank = list.length >= 2 ? settings.rank : 1;
                    const road = settings.mode === 'road' ? roadGrid : null;

                    for (let y = 0; y < size.y; y += step) {
                        for (let x = 0; x < size.x; x += step) {
                            const ll = map.unproject(origin.add([x + step / 2, y + step / 2]), coords.z);
                            const min = road ? roadMinutesAt(road, ll.lat, ll.lng) : travelMinutes(ll.lat, ll.lng, list, d, rank);
                            if (min === null) continue;
                            const [r, g, b] = bandColor(min, d.normMin);
                            for (let yy = y; yy < Math.min(y + step, size.y); yy++) {
                                for (let xx = x; xx < Math.min(x + step, size.x); xx++) {
                                    const i = (yy * size.x + xx) * 4;
                                    img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
                                }
                            }
                        }
                    }
                    ctx.putImageData(img, 0, 0);
                    return canvas;
                },
            });

            let roadGrid = new Map();
            let roadJob = null; // { discipline, cancelled }
            let roadStatus = '';

            const layer = new CoverageLayer({ opacity: settings.opacity, zIndex: 250, pane: 'overlayPane' });

            const Control = L.Control.extend({
                options: { position: 'topright' },
                onAdd() {
                    const box = L.DomUtil.create('div', 'leaflet-bar mks-coverage-control');
                    box.style.cssText = 'background:#fff;color:#222;padding:6px 8px;font-size:12px;line-height:1.5;min-width:170px;';
                    const discOptions = ['<option value="off">Uit</option>']
                        .concat(Object.entries(CONFIG.DISCIPLINES).map(([k, d]) => `<option value="${k}">${d.label}</option>`))
                        .join('');
                    box.innerHTML = `
                        <b>Dekking</b>
                        <select class="mks-cov-disc" style="width:100%;margin:2px 0;color:#222">${discOptions}</select>
                        <div class="mks-cov-more">
                            <select class="mks-cov-mode" style="width:100%;margin:2px 0;color:#222">
                                <option value="line">Hemelsbreed (snel)</option>
                                <option value="road">Over de weg</option>
                            </select>
                            <label style="font-weight:normal;margin:0"><input type="checkbox" class="mks-cov-rank"> 2e post (back-up)</label>
                            <input type="range" class="mks-cov-opacity" min="0.1" max="0.8" step="0.05" style="width:100%" title="Doorzichtigheid">
                            <div class="mks-cov-legend"></div>
                            <div class="mks-cov-status" style="color:#777"></div>
                        </div>`;
                    L.DomEvent.disableClickPropagation(box);
                    L.DomEvent.disableScrollPropagation(box);

                    const sel = box.querySelector('.mks-cov-disc');
                    const rank = box.querySelector('.mks-cov-rank');
                    const opacity = box.querySelector('.mks-cov-opacity');
                    const mode = box.querySelector('.mks-cov-mode');
                    mode.value = settings.mode === 'road' ? 'road' : 'line';
                    mode.addEventListener('change', () => { settings.mode = mode.value; saveSettings(settings); apply(); });
                    sel.value = CONFIG.DISCIPLINES[settings.discipline] ? settings.discipline : 'off';
                    rank.checked = settings.rank === 2;
                    opacity.value = settings.opacity;

                    sel.addEventListener('change', () => { settings.discipline = sel.value; saveSettings(settings); apply(); });
                    rank.addEventListener('change', () => { settings.rank = rank.checked ? 2 : 1; saveSettings(settings); apply(); });
                    opacity.addEventListener('input', () => {
                        settings.opacity = Number(opacity.value);
                        layer.setOpacity(settings.opacity);
                        saveSettings(settings);
                    });

                    this.box = box;
                    return box;
                },
                render() {
                    const d = CONFIG.DISCIPLINES[settings.discipline];
                    this.box.querySelector('.mks-cov-more').style.display = d ? '' : 'none';
                    if (!d) return;
                    this.box.querySelector('.mks-cov-legend').innerHTML = BANDS.map((b) =>
                        `<div><span style="display:inline-block;width:10px;height:10px;margin-right:4px;background:rgb(${b.color.join(',')})"></span>${b.label(d.normMin)}</div>`
                    ).join('');
                    const n = (stations[settings.discipline] || []).length;
                    const status = n ? `${n} posten meegeteld` : 'Geen posten gevonden';
                    this.box.querySelector('.mks-cov-status').textContent = settings.mode === 'road' && roadStatus ? `${status} · ${roadStatus}` : status;
                },
            });
            const control = new Control();
            map.addControl(control);

            function rebuildRoadGrid() {
                const d = CONFIG.DISCIPLINES[settings.discipline];
                const list = stations[settings.discipline] || [];
                roadGrid = d ? roadMinutesGrid(list, d, list.length >= 2 ? settings.rank : 1) : new Map();
            }

            function startRoads() {
                const key = settings.discipline;
                if (roadJob && roadJob.discipline === key && !roadJob.cancelled) return;
                if (roadJob) roadJob.cancelled = true;
                const job = roadJob = { discipline: key, cancelled: false };
                const isCancelled = () => job.cancelled || settings.mode !== 'road' || settings.discipline !== key;
                computeRoads(stations[key] || [], isCancelled,
                    (done, total) => { roadStatus = done < total ? `wegen ${done}/${total}` : ''; control.render(); },
                    () => { rebuildRoadGrid(); layer.redraw(); })
                    .then((finished) => { if (finished) { rebuildRoadGrid(); layer.redraw(); } })
                    .catch((e) => { warn('road mode failed', e); roadStatus = `wegen mislukt: ${e.message}`; control.render(); })
                    .finally(() => { if (roadJob === job) roadJob = null; });
            }

            function apply() {
                const on = !!CONFIG.DISCIPLINES[settings.discipline];
                if (on && !map.hasLayer(layer)) layer.addTo(map);
                if (!on && map.hasLayer(layer)) map.removeLayer(layer);
                if (on && settings.mode === 'road') { rebuildRoadGrid(); startRoads(); }
                if (on) layer.redraw();
                control.render();
            }

            async function refresh() {
                try {
                    await loadStations();
                    apply();
                } catch (e) {
                    warn('could not load buildings/vehicles', e);
                }
            }

            control.render();
            refresh();
            setInterval(() => { if (map.hasLayer(layer)) refresh(); }, CONFIG.REFRESH_MS);
        }

        /* ========================================================================
         * BOOT — wait for the game's Leaflet map (global `map`)
         * ==================================================================== */
        let tries = 0;
        const timer = setInterval(() => {
            const L = ctx.W.L;
            const map = ctx.W.map;
            if (L && L.GridLayer && map && typeof map.addLayer === 'function') {
                clearInterval(timer);
                log('map found');
                init(map, L);
            } else if (++tries > 60) {
                clearInterval(timer);
                log('no Leaflet map on this page');
            }
        }, 500);
    },
});
