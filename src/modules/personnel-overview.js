MKS.module({
    id: 'personnel-overview',
    name: 'Personeel',
    icon: '👥',
    category: 'tools',
    description: 'Al je personeel uit alle gebouwen in één tabel. Sorteer op elke kolom, filter op opleiding, gebouw, status of naam. '
        + 'Met een statistiekentab en een gebouwentab die per gebouw laat zien welke uitbreidingen er zijn, in aanbouw (met aftelling) of uitgeschakeld.',
    tagline: "Openen via menu Wheeliecat's scripts",
    at: 'ready',
    frames: 'top',
    settings: [
        { key: 'concurrency', label: 'Gelijktijdige verzoeken', type: 'number', default: 3, min: 1, max: 6, step: 1,
            help: 'Hoeveel gebouwpagina\'s tegelijk geladen worden. Hoger = sneller, maar zwaarder voor de server.' },
        { key: 'delayMs', label: 'Pauze per verzoek', type: 'number', default: 150, min: 0, max: 2000, step: 50, unit: 'ms' },
    ],

    run(ctx) {

        /* ========================================================================
         * CONFIG
         * ==================================================================== */
        const CONFIG = {
            CONCURRENCY: ctx.cfg.concurrency, // parallel building page requests
            DELAY_MS: ctx.cfg.delayMs,        // pause between requests per worker
            REQUEST_TIMEOUT_MS: 20000,
            CACHE_KEY: 'personnelOverview.cache.v2',
            TAB_KEY: 'personnelOverview.tab',
            TICK_MS: 60000,          // countdown refresh on the buildings tab
        };

        const log = (...a) => console.log('[personnel-overview]', ...a);
        const warn = (...a) => console.warn('[personnel-overview]', ...a);

        /* ========================================================================
         * FETCHING
         * ==================================================================== */
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));

        async function fetchWithTimeout(url, opts) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT_MS);
            try {
                return await fetch(url, { credentials: 'same-origin', ...opts, signal: controller.signal });
            } finally {
                clearTimeout(timer);
            }
        }

        async function getBuildings() {
            const res = await fetchWithTimeout('/api/buildings', { headers: { Accept: 'application/json' } });
            if (!res.ok) throw new Error(`GET /api/buildings failed: ${res.status}`);
            return res.json();
        }

        async function getVehicles() {
            const res = await fetchWithTimeout('/api/vehicles', { headers: { Accept: 'application/json' } });
            if (!res.ok) throw new Error(`GET /api/vehicles failed: ${res.status}`);
            return res.json();
        }

        async function getPersonnelPage(buildingId) {
            const res = await fetchWithTimeout(`/buildings/${buildingId}/personals`);
            if (!res.ok) throw new Error(`GET /buildings/${buildingId}/personals failed: ${res.status}`);
            return res.text();
        }

        const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

        // The personals page is a plain HTML table. Columns are located by
        // header text rather than position so a reordered/extra column does not
        // break parsing. Fallback order if headers are unrecognised:
        // name, education, bound vehicle, status.
        function parsePersonnel(html, building) {
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const table = doc.querySelector('#personal_table')
                || [...doc.querySelectorAll('table')].find(t => /opleiding|education|schooling/i.test(t.textContent));
            if (!table) return [];

            const headers = [...table.querySelectorAll('thead th')].map(th => clean(th.textContent).toLowerCase());
            const col = (re, fallback) => {
                const i = headers.findIndex(h => re.test(h));
                return i >= 0 ? i : fallback;
            };
            const iName = col(/naam|name/, 0);
            const iEdu = col(/opleiding|education|schooling|training/, 1);
            const iVeh = col(/gekoppeld|voertuig|vehicle|bound/, 2);
            const iStatus = col(/status/, 3);
            if (!parsePersonnel.logged) {
                parsePersonnel.logged = true;
                log('personals table headers:', headers, { iName, iEdu, iVeh, iStatus });
                const tr = table.querySelector('tbody tr');
                if (tr) log('first row HTML:', tr.outerHTML);
            }

            const rows = table.querySelectorAll('tbody tr');
            const out = [];
            rows.forEach(tr => {
                const cells = tr.querySelectorAll('td');
                if (!cells.length) return;
                const name = clean(cells[iName]?.textContent);
                if (!name) return;
                const eduCell = cells[iEdu];
                let educations = [];
                if (eduCell) {
                    // Educations are comma separated, sometimes split with <br>.
                    const raw = eduCell.innerHTML.replace(/<br\s*\/?>/gi, ',');
                    const tmp = document.createElement('div');
                    tmp.innerHTML = raw;
                    educations = tmp.textContent.split(',').map(clean).filter(Boolean);
                }
                // Coupling is decided by an actual /vehicles/<id> link in the row,
                // not by column text: the vehicle column's text is unreliable.
                const vehLink = (cells[iVeh]?.querySelector('a[href*="/vehicles/"]'))
                    || [...tr.querySelectorAll('a[href*="/vehicles/"]')].find(a => /\/vehicles\/\d+/.test(a.getAttribute('href')));
                const vehicleId = vehLink ? (vehLink.getAttribute('href').match(/\/vehicles\/(\d+)/) || [])[1] || null : null;
                out.push({
                    name,
                    educations,
                    vehicle: vehicleId ? clean(vehLink.textContent) : '',
                    vehicleId,
                    status: clean(cells[iStatus]?.textContent),
                    buildingId: building.id,
                    building: building.caption,
                });
            });
            return out;
        }

        async function loadAll(onProgress) {
            const buildings = await getBuildings();
            // personal_count is present on buildings that can hold personnel.
            // If the field is missing entirely, just try every building.
            const withStaff = buildings.filter(b => b.personal_count === undefined || b.personal_count > 0);
            const people = [];
            const failed = [];
            let done = 0;
            let next = 0;

            async function worker() {
                while (next < withStaff.length) {
                    const b = withStaff[next++];
                    try {
                        people.push(...parsePersonnel(await getPersonnelPage(b.id), b));
                    } catch (e) {
                        warn('building failed', b.id, b.caption, e);
                        failed.push(b);
                    }
                    done++;
                    onProgress(done, withStaff.length);
                    await sleep(CONFIG.DELAY_MS);
                }
            }
            await Promise.all(Array.from({ length: CONFIG.CONCURRENCY }, worker));
            log(`loaded ${people.length} personnel from ${withStaff.length} buildings (${failed.length} failed)`);
            return { people, failed: failed.length, loadedAt: Date.now() };
        }

        const cache = {
            get() {
                try { return JSON.parse(GM_getValue(CONFIG.CACHE_KEY, 'null')); } catch (e) { return null; }
            },
            set(v) {
                try { GM_setValue(CONFIG.CACHE_KEY, JSON.stringify(v)); } catch (e) { warn('cache write failed', e); }
            },
        };

        /* ========================================================================
         * UI
         * ==================================================================== */
        const CSS = `
        #po-overlay { position: fixed; inset: 0; z-index: 100000; background: rgba(0,0,0,.55); display: flex; }
        #po-panel { margin: 24px auto; width: min(1400px, calc(100vw - 32px)); background: #1e2126; color: #e4e6ea;
            border-radius: 8px; display: flex; flex-direction: column; overflow: hidden; font: 13px/1.4 system-ui, sans-serif;
            box-shadow: 0 10px 40px rgba(0,0,0,.5); }
        #po-panel * { box-sizing: border-box; }
        #po-head { display: flex; gap: 8px; align-items: center; padding: 10px 14px; border-bottom: 1px solid #333841; flex-wrap: wrap; }
        #po-head h3 { margin: 0 12px 0 0; font-size: 16px; color: #fff; }
        #po-head input, #po-head select, #po-head button { background: #2a2e35; color: #e4e6ea; border: 1px solid #3d434d;
            border-radius: 4px; padding: 5px 8px; font: inherit; }
        #po-head button { cursor: pointer; }
        #po-head button:hover { background: #353a43; }
        #po-close { margin-left: auto; }
        #po-body { display: flex; flex: 1; min-height: 0; }
        #po-side { width: 260px; border-right: 1px solid #333841; overflow: auto; padding: 8px 10px; flex-shrink: 0; }
        #po-side h4 { margin: 6px 0; font-size: 12px; text-transform: uppercase; color: #9aa1ab; letter-spacing: .04em; }
        #po-side label { display: flex; gap: 6px; align-items: center; padding: 2px 0; cursor: pointer; }
        #po-side label span.c { margin-left: auto; color: #9aa1ab; font-variant-numeric: tabular-nums; }
        #po-side .po-mode { display: flex; gap: 10px; margin-bottom: 6px; }
        #po-tablewrap { flex: 1; overflow: auto; }
        #po-table { width: 100%; border-collapse: collapse; }
        #po-table th { position: sticky; top: 0; background: #262a30; text-align: left; padding: 6px 8px; cursor: pointer;
            user-select: none; border-bottom: 1px solid #3d434d; white-space: nowrap; }
        #po-table th:hover { background: #2f343b; }
        #po-table td { padding: 5px 8px; border-bottom: 1px solid #2a2e35; vertical-align: top; }
        #po-table tr:hover td { background: #252930; }
        #po-table a { color: #6fb3ff; }
        .po-chip { display: inline-block; background: #2f4a66; color: #d6e8ff; border-radius: 10px; padding: 1px 8px; margin: 1px 3px 1px 0; font-size: 12px; }
        .po-none { color: #7a818b; font-style: italic; }
        #po-foot { padding: 6px 14px; border-top: 1px solid #333841; color: #9aa1ab; display: flex; gap: 16px; }
        #po-msg { padding: 40px; text-align: center; color: #9aa1ab; }
        .po-tabs { display: flex; gap: 2px; margin-right: 8px; }
        #po-head .po-tabs button { border-radius: 4px 4px 0 0; }
        #po-head .po-tabs button.on { background: #2f4a66; border-color: #4a6f96; color: #fff; }
        #po-stats { flex: 1; overflow: auto; padding: 14px 18px; }
        .po-tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; margin-bottom: 18px; }
        .po-tile { background: #262a30; border: 1px solid #333841; border-radius: 6px; padding: 10px 12px; }
        .po-tile .v { font-size: 24px; font-weight: 600; color: #fff; font-variant-numeric: tabular-nums; }
        .po-tile .l { color: #9aa1ab; font-size: 12px; }
        .po-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(380px, 1fr)); gap: 18px; }
        .po-card { background: #22262c; border: 1px solid #333841; border-radius: 6px; padding: 10px 14px; }
        .po-card h4 { margin: 0 0 8px; font-size: 13px; color: #fff; }
        .po-bar { display: grid; grid-template-columns: minmax(90px, 38%) 1fr auto; gap: 8px; align-items: center; padding: 2px 0; }
        .po-bar:hover { background: #2a2e35; }
        .po-bar .n { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #c9cdd3; }
        .po-bar .t { height: 12px; }
        .po-bar .f { height: 100%; min-width: 2px; background: #4a90d9; border-radius: 0 4px 4px 0; }
        .po-bar .c { color: #9aa1ab; font-variant-numeric: tabular-nums; text-align: right; min-width: 70px; }
        .po-facts { list-style: none; margin: 0; padding: 0; }
        .po-facts li { padding: 5px 0; border-bottom: 1px solid #2a2e35; }
        .po-facts li:last-child { border-bottom: 0; }
        .po-facts b { color: #fff; }
        .po-facts .s { color: #9aa1ab; }
        #po-bld { flex: 1; overflow: auto; padding: 14px 18px; flex-direction: column; gap: 14px; }
        .po-bld-ctl { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
        .po-bld-ctl input, .po-bld-ctl select { background: #2a2e35; color: #e4e6ea; border: 1px solid #3d434d;
            border-radius: 4px; padding: 5px 8px; font: inherit; }
        .po-bld-ctl label { display: flex; gap: 4px; align-items: center; cursor: pointer; }
        .po-chip.on { background: #1f4d3a; color: #c9f0dc; }
        .po-chip.off { background: #6b2226; color: #ffd0d0; }
        .po-chip.bld { background: #5a3e12; color: #ffdca3; }
        .po-bld-off td:first-child a { color: #8d939c; text-decoration: line-through; }
        .po-when { color: #ffdca3; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .po-when.due { color: #7fe0a8; }
        .po-free { color: #7fe0a8; font-weight: 600; }
        .po-full { color: #9aa1ab; }
        #po-bld .po-table { width: 100%; border-collapse: collapse; }
        #po-bld .po-table th { text-align: left; padding: 6px 8px; background: #262a30; border-bottom: 1px solid #3d434d; white-space: nowrap; }
        #po-bld .po-table td { padding: 5px 8px; border-bottom: 1px solid #2a2e35; vertical-align: top; }
        #po-bld .po-table tr:hover td { background: #252930; }
        #po-bld a { color: #6fb3ff; }
        `;

        const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
        const NO_EDU = '(geen opleiding)';

        const state = {
            data: null,
            sortKey: 'building',
            sortDir: 1,
            eduSelected: new Set(),
            eduMode: 'any',  // 'any' | 'all'
            search: '',
            building: '',
            status: '',
            tab: 'table',  // 'table' | 'stats' | 'buildings'
            bld: null,     // { buildings, loadedAt } — always fetched live, never cached
            bldSearch: '',
            bldType: '',
            bldShow: 'all', // 'all' | 'building' | 'off'
        };

        let tick;

        let overlay;

        function open() {
            if (!document.getElementById('po-style')) {
                const st = document.createElement('style');
                st.id = 'po-style';
                st.textContent = CSS;
                document.head.appendChild(st);
            }
            overlay = document.createElement('div');
            overlay.id = 'po-overlay';
            overlay.innerHTML = `
            <div id="po-panel">
              <div id="po-head">
                <h3>Personeel</h3>
                <div class="po-tabs">
                  <button data-tab="table">Tabel</button>
                  <button data-tab="stats">📊 Statistieken</button>
                  <button data-tab="buildings">🏗️ Gebouwen</button>
                </div>
                <input id="po-search" type="search" placeholder="Zoek naam / voertuig…" size="24">
                <select id="po-building"><option value="">Alle gebouwen</option></select>
                <select id="po-status"><option value="">Alle statussen</option></select>
                <button id="po-reset">Filters wissen</button>
                <button id="po-refresh">Vernieuwen</button>
                <button id="po-csv">CSV</button>
                <button id="po-close">✕</button>
              </div>
              <div id="po-body">
                <div id="po-side">
                  <h4>Opleiding</h4>
                  <div class="po-mode">
                    <label><input type="radio" name="po-mode" value="any" checked> Eén van</label>
                    <label><input type="radio" name="po-mode" value="all"> Allemaal</label>
                  </div>
                  <div id="po-edu"></div>
                </div>
                <div id="po-tablewrap"><div id="po-msg">Laden…</div></div>
                <div id="po-stats" style="display:none"></div>
                <div id="po-bld" style="display:none">
                  <div class="po-bld-ctl">
                    <input id="po-bld-search" type="search" placeholder="Zoek gebouw / uitbreiding…" size="28">
                    <select id="po-bld-type"><option value="">Alle types</option></select>
                    <label><input type="radio" name="po-bld-show" value="all" checked> Alles</label>
                    <label><input type="radio" name="po-bld-show" value="building"> In aanbouw</label>
                    <label><input type="radio" name="po-bld-show" value="off"> Uitgeschakeld</label>
                    <label><input type="radio" name="po-bld-show" value="free"> Vrije parkeerplekken</label>
                  </div>
                  <div id="po-bld-body"><div id="po-msg">Laden…</div></div>
                </div>
              </div>
              <div id="po-foot"><span id="po-count"></span><span id="po-age"></span></div>
            </div>`;
            document.body.appendChild(overlay);

            overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
            document.addEventListener('keydown', onKey);
            overlay.querySelector('#po-close').onclick = close;
            overlay.querySelector('#po-refresh').onclick = () => (state.tab === 'buildings' ? loadBuildingsTab(true) : refresh());
            overlay.querySelector('#po-csv').onclick = exportCsv;
            overlay.querySelector('#po-reset').onclick = () => {
                Object.assign(state, { search: '', building: '', status: '', eduMode: 'any' });
                state.eduSelected.clear();
                overlay.querySelector('#po-search').value = '';
                overlay.querySelector('input[name=po-mode][value=any]').checked = true;
                buildFilters();
                render();
            };
            overlay.querySelector('#po-search').oninput = e => { state.search = e.target.value.toLowerCase(); render(); };
            overlay.querySelector('#po-building').onchange = e => { state.building = e.target.value; render(); };
            overlay.querySelector('#po-status').onchange = e => { state.status = e.target.value; render(); };
            overlay.querySelectorAll('input[name=po-mode]').forEach(r => r.onchange = e => { state.eduMode = e.target.value; render(); });
            overlay.querySelector('#po-bld-search').oninput = e => { state.bldSearch = e.target.value.toLowerCase(); renderBuildings(); };
            overlay.querySelector('#po-bld-type').onchange = e => { state.bldType = e.target.value; renderBuildings(); };
            overlay.querySelectorAll('input[name=po-bld-show]').forEach(r => r.onchange = e => { state.bldShow = e.target.value; renderBuildings(); });
            overlay.querySelectorAll('.po-tabs button').forEach(b => b.onclick = () => switchTab(b.dataset.tab));
            tick = setInterval(() => { if (state.tab === 'buildings') renderBuildings(); }, CONFIG.TICK_MS);

            state.data = state.data || cache.get();
            if (state.data) buildFilters();
            switchTab(GM_getValue(CONFIG.TAB_KEY, 'table'));
        }

        // Reopens on the last used tab, so the construction list is one click away.
        function switchTab(tab) {
            state.tab = tab;
            GM_setValue(CONFIG.TAB_KEY, tab);
            if (tab === 'buildings') { showTab(tab); loadBuildingsTab(false); return; }
            if (state.data) render(); else refresh();
        }

        function close() {
            clearInterval(tick);
            document.removeEventListener('keydown', onKey);
            overlay?.remove();
            overlay = null;
        }
        const onKey = (e) => { if (e.key === 'Escape') close(); };

        async function refresh() {
            const wrap = overlay.querySelector('#po-tablewrap');
            showTab('table');  // progress messages live in the table area
            wrap.innerHTML = '<div id="po-msg">Gebouwen ophalen…</div>';
            try {
                state.data = await loadAll((d, t) => {
                    const m = overlay?.querySelector('#po-msg');
                    if (m) m.textContent = `Personeel laden… ${d} / ${t} gebouwen`;
                });
                cache.set(state.data);
            } catch (e) {
                warn(e);
                wrap.innerHTML = `<div id="po-msg">Laden mislukt: ${esc(e.message)}</div>`;
                return;
            }
            if (!overlay) return;
            buildFilters();
            render();
        }

        const eduList = (p) => (p.educations.length ? p.educations : [NO_EDU]);

        function buildFilters() {
            const people = state.data.people;
            const eduCounts = new Map();
            people.forEach(p => eduList(p).forEach(e => eduCounts.set(e, (eduCounts.get(e) || 0) + 1)));
            const edus = [...eduCounts.keys()].sort((a, b) => (a === NO_EDU) - (b === NO_EDU) || a.localeCompare(b));
            overlay.querySelector('#po-edu').innerHTML = edus.map(e => `
                <label><input type="checkbox" value="${esc(e)}" ${state.eduSelected.has(e) ? 'checked' : ''}>
                ${esc(e)}<span class="c">${eduCounts.get(e)}</span></label>`).join('');
            overlay.querySelectorAll('#po-edu input').forEach(cb => cb.onchange = () => {
                cb.checked ? state.eduSelected.add(cb.value) : state.eduSelected.delete(cb.value);
                render();
            });

            const fillSelect = (sel, values, allLabel) => {
                const el = overlay.querySelector(sel);
                const cur = el.value;
                el.innerHTML = `<option value="">${allLabel}</option>` +
                    values.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
                el.value = values.includes(cur) ? cur : '';
            };
            fillSelect('#po-building', [...new Set(people.map(p => p.building))].sort((a, b) => a.localeCompare(b)), 'Alle gebouwen');
            fillSelect('#po-status', [...new Set(people.map(p => p.status).filter(Boolean))].sort(), 'Alle statussen');
        }

        function filtered() {
            const sel = [...state.eduSelected];
            return state.data.people.filter(p => {
                if (state.building && p.building !== state.building) return false;
                if (state.status && p.status !== state.status) return false;
                if (state.search && !(`${p.name} ${p.vehicle}`.toLowerCase().includes(state.search))) return false;
                if (sel.length) {
                    const has = eduList(p);
                    if (state.eduMode === 'all' ? !sel.every(e => has.includes(e)) : !sel.some(e => has.includes(e))) return false;
                }
                return true;
            });
        }

        const COLUMNS = [
            { key: 'name', label: 'Naam', val: p => p.name },
            { key: 'building', label: 'Gebouw', val: p => p.building },
            { key: 'educations', label: 'Opleidingen', val: p => p.educations.join(', '), num: p => p.educations.length },
            { key: 'vehicle', label: 'Gekoppeld voertuig', val: p => p.vehicle },
            { key: 'status', label: 'Status', val: p => p.status },
        ];

        function render() {
            const col = COLUMNS.find(c => c.key === state.sortKey);
            const rows = filtered().sort((a, b) => {
                // Education column sorts by count first, then alphabetically.
                const d = col.num ? col.num(a) - col.num(b) : 0;
                return state.sortDir * (d || col.val(a).localeCompare(col.val(b), undefined, { numeric: true }))
                    || a.name.localeCompare(b.name);
            });

            const arrow = k => (k === state.sortKey ? (state.sortDir > 0 ? ' ▲' : ' ▼') : '');
            const html = `<table id="po-table"><thead><tr>${COLUMNS.map(c =>
                `<th data-k="${c.key}">${c.label}${arrow(c.key)}</th>`).join('')}</tr></thead><tbody>${rows.map(p => `
                <tr>
                  <td>${esc(p.name)}</td>
                  <td><a href="/buildings/${p.buildingId}/personals" target="_blank">${esc(p.building)}</a></td>
                  <td>${p.educations.length ? p.educations.map(e => `<span class="po-chip">${esc(e)}</span>`).join('') : `<span class="po-none">${NO_EDU}</span>`}</td>
                  <td>${p.vehicleId ? `<a href="/vehicles/${p.vehicleId}" target="_blank">${esc(p.vehicle)}</a>` : esc(p.vehicle)}</td>
                  <td>${esc(p.status)}</td>
                </tr>`).join('')}</tbody></table>`;
            const wrap = overlay.querySelector('#po-tablewrap');
            wrap.innerHTML = rows.length || state.data.people.length ? html : '<div id="po-msg">Geen personeel gevonden.</div>';
            wrap.querySelectorAll('th').forEach(th => th.onclick = () => {
                const k = th.dataset.k;
                state.sortDir = state.sortKey === k ? -state.sortDir : 1;
                state.sortKey = k;
                render();
            });

            if (state.tab === 'buildings') return;  // personnel finished loading after a tab switch
            overlay.querySelector('#po-count').textContent = `${rows.length} van ${state.data.people.length} personeelsleden`
                + (state.data.failed ? ` · ${state.data.failed} gebouwen mislukt` : '');
            overlay.querySelector('#po-age').textContent = `Geladen: ${new Date(state.data.loadedAt).toLocaleString('nl-NL')}`;
            if (state.tab === 'stats') renderStats(rows);
            showTab(state.tab);
        }

        function showTab(tab) {
            overlay.querySelector('#po-tablewrap').style.display = tab === 'table' ? '' : 'none';
            overlay.querySelector('#po-stats').style.display = tab === 'stats' ? '' : 'none';
            overlay.querySelector('#po-bld').style.display = tab === 'buildings' ? 'flex' : 'none';
            // Personnel filters mean nothing on the buildings tab.
            const personnel = tab !== 'buildings';
            overlay.querySelector('#po-side').style.display = personnel ? '' : 'none';
            ['#po-search', '#po-building', '#po-status', '#po-reset', '#po-csv']
                .forEach(sel => { overlay.querySelector(sel).style.display = personnel ? '' : 'none'; });
            overlay.querySelectorAll('.po-tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
        }

        /* ========================================================================
         * STATS TAB — uses the currently filtered people
         * ==================================================================== */
        // Categorical slots in fixed order (validated for a dark surface); the
        // 5th+ category folds into a neutral "Overig" slice.
        const PIE_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500'];
        const OTHER_COLOR = '#6b7079';
        const PANEL_BG = '#22262c';

        const pct = (n, total) => (total ? Math.round((n / total) * 100) : 0);
        const nl = (n) => n.toLocaleString('nl-NL');

        function countBy(items, keyFn) {
            const m = new Map();
            items.forEach(x => [].concat(keyFn(x)).forEach(k => m.set(k, (m.get(k) || 0) + 1)));
            return [...m.entries()].sort((a, b) => b[1] - a[1]);
        }

        // entries: [[label, count], ...] already sorted. Returns donut + legend.
        function donut(title, entries) {
            let slices = entries.slice(0, PIE_COLORS.length).map(([l, v], i) => ({ l, v, c: PIE_COLORS[i] }));
            const rest = entries.slice(PIE_COLORS.length).reduce((s, [, v]) => s + v, 0);
            if (rest) slices.push({ l: 'Overig', v: rest, c: OTHER_COLOR });
            slices = slices.filter(s => s.v > 0);
            const total = slices.reduce((s, x) => s + x.v, 0);

            const R = 60, r = 38, C = 70;
            const pt = (a, rad) => [C + rad * Math.sin(a), C - rad * Math.cos(a)];
            let a0 = 0;
            const paths = slices.map(s => {
                const tip = `<title>${esc(s.l)}: ${nl(s.v)} (${pct(s.v, total)}%)</title>`;
                if (s.v === total) {
                    // Full ring: an arc path cannot draw 360°, so use a thick circle.
                    return `<circle cx="${C}" cy="${C}" r="${(R + r) / 2}" fill="none" stroke="${s.c}" stroke-width="${R - r}">${tip}</circle>`;
                }
                const a1 = a0 + (s.v / total) * Math.PI * 2;
                const big = a1 - a0 > Math.PI ? 1 : 0;
                const [x0, y0] = pt(a0, R), [x1, y1] = pt(a1, R), [x2, y2] = pt(a1, r), [x3, y3] = pt(a0, r);
                a0 = a1;
                return `<path d="M${x0},${y0} A${R},${R} 0 ${big} 1 ${x1},${y1} L${x2},${y2} A${r},${r} 0 ${big} 0 ${x3},${y3} Z"
                    fill="${s.c}" stroke="${PANEL_BG}" stroke-width="2">${tip}</path>`;
            }).join('');

            const legend = slices.map(s => `
                <div class="po-bar" title="${esc(s.l)}: ${nl(s.v)}" style="grid-template-columns: 12px 1fr auto">
                  <span style="width:10px;height:10px;border-radius:2px;background:${s.c}"></span>
                  <span class="n">${esc(s.l)}</span>
                  <span class="c">${nl(s.v)} · ${pct(s.v, total)}%</span>
                </div>`).join('');

            return `<div class="po-card"><h4>${esc(title)}</h4>
                <div style="display:flex;gap:14px;align-items:center">
                  <svg viewBox="0 0 140 140" width="140" height="140" style="flex-shrink:0">${paths}
                    <text x="${C}" y="${C - 2}" text-anchor="middle" fill="#fff" font-size="18" font-weight="600">${nl(total)}</text>
                    <text x="${C}" y="${C + 14}" text-anchor="middle" fill="#9aa1ab" font-size="10">totaal</text>
                  </svg>
                  <div style="flex:1;min-width:0">${legend}</div>
                </div></div>`;
        }

        function bars(title, entries, total, limit) {
            const shown = entries.slice(0, limit);
            const max = shown.length ? shown[0][1] : 1;
            const more = entries.length - shown.length;
            return `<div class="po-card"><h4>${esc(title)}</h4>${shown.map(([l, v]) => `
                <div class="po-bar" title="${esc(l)}: ${nl(v)} (${pct(v, total)}%)">
                  <span class="n">${esc(l)}</span>
                  <span class="t"><span class="f" style="display:block;width:${(v / max) * 100}%"></span></span>
                  <span class="c">${nl(v)} · ${pct(v, total)}%</span>
                </div>`).join('')}
                ${more > 0 ? `<div class="po-none" style="padding-top:4px">+ ${more} meer</div>` : ''}</div>`;
        }

        function renderStats(people) {
            const box = overlay.querySelector('#po-stats');
            const n = people.length;
            if (!n) { box.innerHTML = '<div id="po-msg">Geen personeel binnen deze filters.</div>'; return; }

            const coupled = people.filter(p => p.vehicleId).length;
            const educated = people.filter(p => p.educations.length).length;
            const eduTotal = people.reduce((s, p) => s + p.educations.length, 0);
            const buildingCount = new Set(people.map(p => p.buildingId)).size;
            const vehicleCount = new Set(people.filter(p => p.vehicleId).map(p => p.vehicleId)).size;

            const eduCounts = countBy(people.filter(p => p.educations.length), p => p.educations);
            const perBuilding = countBy(people, p => p.building);
            const statusCounts = countBy(people, p => p.status || '(onbekend)');
            const eduBuckets = countBy(people, p => {
                const k = p.educations.length;
                return k === 0 ? 'Geen' : k >= 3 ? '3 of meer' : k === 1 ? '1 opleiding' : '2 opleidingen';
            });

            // --- fun facts ---
            const facts = [];
            const maxEdu = Math.max(...people.map(p => p.educations.length));
            if (maxEdu > 0) {
                const nerds = people.filter(p => p.educations.length === maxEdu);
                const nerd = nerds[0];
                facts.push(`🎓 <b>Studiebol:</b> ${esc(nerd.name)} <span class="s">(${esc(nerd.building)})</span> met <b>${maxEdu}</b> opleidingen`
                    + (nerds.length > 1 ? ` <span class="s">— en ${nerds.length - 1} anderen evenveel</span>` : ''));
            }
            const idle = people.filter(p => p.educations.length && !p.vehicleId).length;
            facts.push(`🛋️ <b>Onbenut talent:</b> ${nl(idle)} opgeleide mensen zonder voertuig`);
            if (eduCounts.length) {
                const [rare, rareN] = eduCounts[eduCounts.length - 1];
                facts.push(`🦄 <b>Zeldzaamste opleiding:</b> ${esc(rare)} <span class="s">(${nl(rareN)}×)</span>`);
                facts.push(`🏆 <b>Populairste opleiding:</b> ${esc(eduCounts[0][0])} <span class="s">(${nl(eduCounts[0][1])}×)</span>`);
            }
            const combos = countBy(people.filter(p => p.educations.length >= 2), p => [...p.educations].sort().join(' + '));
            if (combos.length) facts.push(`🧩 <b>Populairste combinatie:</b> ${esc(combos[0][0])} <span class="s">(${nl(combos[0][1])}×)</span>`);
            const firstNames = countBy(people, p => p.name.split(' ')[0]);
            if (firstNames.length) facts.push(`👋 <b>Populairste voornaam:</b> ${esc(firstNames[0][0])} <span class="s">(${nl(firstNames[0][1])}×)</span>`);
            const twins = countBy(people, p => p.name).filter(([, v]) => v > 1);
            facts.push(twins.length
                ? `👯 <b>Naamgenoten:</b> ${nl(twins.length)} namen komen vaker voor, bv. ${esc(twins[0][0])} <span class="s">(${twins[0][1]}×)</span>`
                : '👯 <b>Naamgenoten:</b> geen — iedereen is uniek');
            const longest = people.reduce((a, b) => (b.name.length > a.name.length ? b : a));
            facts.push(`📏 <b>Langste naam:</b> ${esc(longest.name)} <span class="s">(${longest.name.length} tekens)</span>`);
            const smart = countBy(people, p => p.buildingId)
                .filter(([, v]) => v >= 5)
                .map(([id, v]) => {
                    const staff = people.filter(p => p.buildingId === id);
                    return { name: staff[0].building, avg: staff.reduce((s, p) => s + p.educations.length, 0) / v };
                })
                .sort((a, b) => b.avg - a.avg);
            if (smart.length) facts.push(`🧠 <b>Slimste gebouw:</b> ${esc(smart[0].name)} <span class="s">(gem. ${smart[0].avg.toFixed(2)} opleidingen p.p.)</span>`);
            const crews = countBy(people.filter(p => p.vehicleId), p => p.vehicle);
            if (crews.length) facts.push(`🚒 <b>Grootste bemanning:</b> ${esc(crews[0][0])} <span class="s">(${crews[0][1]} personen)</span>`);
            if (perBuilding.length) facts.push(`🏢 <b>Drukste gebouw:</b> ${esc(perBuilding[0][0])} <span class="s">(${nl(perBuilding[0][1])} personen)</span>`);

            const tile = (v, l) => `<div class="po-tile"><div class="v">${v}</div><div class="l">${l}</div></div>`;
            box.innerHTML = `
                <div class="po-tiles">
                  ${tile(nl(n), 'personeelsleden')}
                  ${tile(nl(buildingCount), 'gebouwen')}
                  ${tile(`${pct(coupled, n)}%`, 'gekoppeld aan voertuig')}
                  ${tile(`${pct(educated, n)}%`, 'heeft een opleiding')}
                  ${tile((eduTotal / n).toFixed(2), 'opleidingen per persoon')}
                  ${tile(nl(vehicleCount), 'bemande voertuigen')}
                </div>
                <div class="po-grid">
                  ${donut('Gekoppeld aan voertuig', [['Gekoppeld', coupled], ['Niet gekoppeld', n - coupled]])}
                  ${donut('Aantal opleidingen per persoon', eduBuckets)}
                  ${donut('Status', statusCounts)}
                  ${donut('Opleidingen (verdeling)', eduCounts)}
                  <div class="po-card"><h4>Leuke weetjes</h4><ul class="po-facts">${facts.map(f => `<li>${f}</li>`).join('')}</ul></div>
                  ${bars('Opleidingen', eduCounts, n, 20)}
                  ${bars('Meeste personeel per gebouw', perBuilding, n, 10)}
                </div>`;
        }

        /* ========================================================================
         * BUILDINGS TAB — extensions per building, live from /api/buildings
         * ==================================================================== */
        const BUILDING_TYPE_LABEL = {
            0: 'Brandweer', 17: 'Brandweer',
            3: 'Ambulance', 13: 'Ambulance',
            5: 'Politie', 11: 'Politie', 18: 'Politie',
            6: 'Luchtvaart', 9: 'Luchtvaart', 19: 'Luchtvaart', 21: 'Luchtvaart',
            22: 'RWS',
            23: 'Defensie', 25: 'Defensie',
            1: 'Meldkamer',
            2: 'Ziekenhuis',
            4: 'Opleiding',
            8: 'Politieacademie',
            27: 'Spoor',
        };
        const typeLabel = (b) => BUILDING_TYPE_LABEL[b.building_type] || `Type ${b.building_type}`;

        // Buildings that never hold vehicles get no parking column.
        const NO_PARKING_TYPES = new Set([1, 2, 4, 8]);
        // Level is 0-based and each level adds one parking space: level 0 = 1 space.
        function parking(b) {
            if (NO_PARKING_TYPES.has(b.building_type) || typeof b.level !== 'number') return null;
            const total = b.level + 1;
            const used = state.bld.vehicleCount[b.id] || 0;
            return { total, used, free: Math.max(0, total - used) };
        }

        // An extension still under construction has available=false and an
        // available_at timestamp. enabled=false means built but switched off.
        const extState = (x) => (x.available === false ? 'building' : x.enabled === false ? 'off' : 'on');
        const extDone = (x) => { const t = Date.parse(x.available_at); return Number.isFinite(t) ? t : null; };

        function timeLeft(t) {
            if (t === null) return { text: 'onbekend', due: false };
            const ms = t - Date.now();
            if (ms <= 0) return { text: 'klaar — vernieuwen', due: true };
            const m = Math.ceil(ms / 60000), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
            return { text: d ? `${d}d ${h}u` : h ? `${h}u ${mm}m` : `${mm}m`, due: false };
        }
        const whenFmt = (t) => (t === null ? '' : new Date(t).toLocaleString('nl-NL',
            { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }));

        async function loadBuildingsTab(force) {
            if (state.bld && !force) { renderBuildings(); return; }
            overlay.querySelector('#po-bld-body').innerHTML = '<div id="po-msg">Gebouwen ophalen…</div>';
            try {
                const [buildings, vehicles] = await Promise.all([getBuildings(), getVehicles()]);
                const vehicleCount = {};
                vehicles.forEach(v => { vehicleCount[v.building_id] = (vehicleCount[v.building_id] || 0) + 1; });
                state.bld = { buildings, vehicleCount, loadedAt: Date.now() };
                const sample = buildings.find(b => (b.extensions || []).length);
                if (sample) log('sample building extensions:', sample.extensions, 'level:', sample.level, 'vehicles:', vehicleCount[sample.id]);
            } catch (e) {
                warn(e);
                if (overlay) overlay.querySelector('#po-bld-body').innerHTML = `<div id="po-msg">Laden mislukt: ${esc(e.message)}</div>`;
                return;
            }
            if (!overlay) return;
            const sel = overlay.querySelector('#po-bld-type');
            const types = [...new Set(state.bld.buildings.map(typeLabel))].sort((a, b) => a.localeCompare(b));
            sel.innerHTML = '<option value="">Alle types</option>' + types.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
            sel.value = types.includes(state.bldType) ? state.bldType : '';
            state.bldType = sel.value;
            renderBuildings();
        }

        function renderBuildings() {
            if (!overlay || !state.bld) return;
            const all = state.bld.buildings;
            const exts = (b) => b.extensions || [];
            const q = state.bldSearch;

            const rows = all.filter(b => {
                if (state.bldType && typeLabel(b) !== state.bldType) return false;
                if (q && !`${b.caption} ${exts(b).map(x => x.caption).join(' ')}`.toLowerCase().includes(q)) return false;
                if (state.bldShow === 'building') return exts(b).some(x => extState(x) === 'building');
                if (state.bldShow === 'off') return b.enabled === false || exts(b).some(x => extState(x) === 'off');
                if (state.bldShow === 'free') return (parking(b)?.free || 0) > 0;
                return true;
            }).sort((a, b) => typeLabel(a).localeCompare(typeLabel(b)) || a.caption.localeCompare(b.caption, undefined, { numeric: true }));

            // Construction queue over ALL buildings (ignores filters), soonest first.
            const queue = all.flatMap(b => exts(b).filter(x => extState(x) === 'building').map(x => ({ b, x, t: extDone(x) })))
                .sort((a, b) => (a.t ?? Infinity) - (b.t ?? Infinity));
            const extTotal = all.reduce((s, b) => s + exts(b).length, 0);
            const extOff = all.reduce((s, b) => s + exts(b).filter(x => extState(x) === 'off').length, 0);
            const bldOff = all.filter(b => b.enabled === false).length;
            const freeTotal = all.reduce((s, b) => s + (parking(b)?.free || 0), 0);
            const freeBuildings = all.filter(b => (parking(b)?.free || 0) > 0).length;
            const parkCell = (b) => {
                const p = parking(b);
                if (!p) return '<span class="po-none">—</span>';
                return `<span class="${p.free ? 'po-free' : 'po-full'}" title="${p.used} voertuigen op ${p.total} plekken">`
                    + `${p.free ? `${p.free} vrij` : 'vol'} <span class="po-none">(${p.used}/${p.total})</span></span>`;
            };

            const link = (b) => `<a href="/buildings/${b.id}" target="_blank">${esc(b.caption)}</a>`;
            const tile = (v, l) => `<div class="po-tile"><div class="v">${v}</div><div class="l">${l}</div></div>`;
            const chip = (x) => {
                const st = extState(x);
                if (st !== 'building') return `<span class="po-chip ${st}" title="${st === 'on' ? 'Actief' : 'Uitgeschakeld'}">${esc(x.caption)}</span>`;
                const t = extDone(x);
                return `<span class="po-chip bld" title="In aanbouw — klaar ${esc(whenFmt(t))}">🏗️ ${esc(x.caption)} · ${esc(timeLeft(t).text)}</span>`;
            };

            const queueHtml = queue.length ? `
                <div class="po-card"><h4>In aanbouw (${queue.length})</h4>
                  <table class="po-table"><thead><tr><th>Klaar over</th><th>Klaar op</th><th>Uitbreiding</th><th>Gebouw</th></tr></thead><tbody>
                  ${queue.map(({ b, x, t }) => { const left = timeLeft(t); return `
                    <tr><td class="po-when${left.due ? ' due' : ''}">${esc(left.text)}</td><td>${esc(whenFmt(t))}</td>
                        <td>${esc(x.caption)}</td><td>${link(b)}</td></tr>`; }).join('')}
                  </tbody></table></div>`
                : '<div class="po-card"><h4>In aanbouw</h4><span class="po-none">Er wordt nu niets gebouwd.</span></div>';

            overlay.querySelector('#po-bld-body').innerHTML = `
                <div class="po-tiles">
                  ${tile(nl(all.length), 'gebouwen')}
                  ${tile(nl(extTotal), 'uitbreidingen')}
                  ${tile(nl(queue.length), 'in aanbouw')}
                  ${tile(queue.length ? esc(timeLeft(queue[0].t).text) : '—', 'eerstvolgende klaar')}
                  ${tile(nl(extOff), 'uitbreidingen uit')}
                  ${tile(nl(bldOff), 'gebouwen uit')}
                  ${tile(nl(freeTotal), `vrije parkeerplekken (${nl(freeBuildings)} gebouwen)`)}
                </div>
                ${queueHtml}
                <div class="po-card" style="margin-top:14px"><h4>Alle gebouwen (${rows.length})</h4>
                  <table class="po-table"><thead><tr><th>Gebouw</th><th>Type</th><th>Status</th><th>Parkeerplekken</th><th>Uitbreidingen</th></tr></thead><tbody>
                  ${rows.map(b => `
                    <tr class="${b.enabled === false ? 'po-bld-off' : ''}">
                      <td>${link(b)}</td>
                      <td>${esc(typeLabel(b))}</td>
                      <td>${b.enabled === false ? '<span class="po-none">Uitgeschakeld</span>' : 'Actief'}</td>
                      <td style="white-space:nowrap">${parkCell(b)}</td>
                      <td>${exts(b).length ? exts(b).map(chip).join('') : '<span class="po-none">geen</span>'}</td>
                    </tr>`).join('')}
                  </tbody></table></div>`;

            overlay.querySelector('#po-count').textContent = `${rows.length} van ${all.length} gebouwen`;
            overlay.querySelector('#po-age').textContent = `Geladen: ${new Date(state.bld.loadedAt).toLocaleString('nl-NL')}`;
        }

        function exportCsv() {
            if (!state.data) return;
            const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
            const lines = [COLUMNS.map(c => q(c.label)).join(';')]
                .concat(filtered().map(p => COLUMNS.map(c => q(c.val(p))).join(';')));
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv' }));
            a.download = 'personeel.csv';
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        }

        /* ========================================================================
         * ENTRY BUTTON
         * ==================================================================== */
        function addButton() {
            ctx.menu({ icon: '👥', label: 'Personeel', title: 'Alle personeel', run: () => { if (!overlay) open(); } });
            ctx.actions([{ label: 'Openen', kind: 'primary', run: () => { if (!overlay) open(); } }]);
        }

        addButton();
    },
});
