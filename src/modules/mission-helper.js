MKS.module({
    id: 'mission-helper',
    name: 'Meldinghelper',
    icon: '📋',
    category: 'missions',
    description: 'Rechtsboven in het alarmeervenster een lijstje met wat je moet sturen: de benodigde voertuigen, water en personeel. '
        + 'De gegevens komen uit de hulppagina van het spel zelf. Op de kaartpagina worden ze alvast opgehaald voor de inzetten in je lijst, '
        + 'zodat het lijstje meteen staat als je een inzet opent.',
    at: 'ready',
    frames: 'all',
    pages: /^\/(missions\/\d+\/?)?$/,
    pageNote: 'In het alarmeervenster (en op de kaartpagina om vooruit te laden)',
    live: true,
    settings: [
        { key: 'chances', label: 'Ook kansen op extra voertuigen tonen', type: 'bool', default: true,
            help: 'Bijvoorbeeld "Hoogwerker 80%". Die hoef je niet meteen te sturen.' },
        { key: 'moveMissing', label: 'Ontbrekende voertuigen links ernaast', type: 'bool', default: true,
            help: 'Zet het rode vak "Missende voertuigen" van het spel in de linkerhelft, naast het lijstje, in plaats van eronder.' },
    ],

    run(ctx) {
        const CACHE_KEY = 'mks-mission-helper-v4';
        const CACHE_MS = 3 * 24 * 3600 * 1000;
        const esc = ctx.esc;
        // Left over from the first beta version.
        try { ['mks-mission-helper-cache', 'mks-mission-helper-open', 'mks-mission-helper-v2', 'mks-mission-helper-v3'].forEach((k) => localStorage.removeItem(k)); } catch (e) { /* ignore */ }

        /* ========================================================================
         * DATA — the game's own help page (/einsaetze/{type}?additive_overlays=x).
         * From the "Voertuig en personeel vereisten" table:
         *   "Benodigde X" = n       -> send n × X
         *   "X benodigd" = amount   -> e.g. water in litres
         *   "X benodigd waarschijnlijkheid" = % -> chance (optional)
         * and "Benodigde Personeel" from "Overige informatie".
         * Parsed result is cached per type + overlays in localStorage.
         * ==================================================================== */
        // A mission is its type plus optional variants: overlay_index picks a
        // numbered variant (e.g. 878 with index 1 needs 3 instead of 1 police
        // car), additive_overlays adds letters like "a". Both come from the
        // data-overlay-index / data-additive-overlays attributes.
        const attr = (el, name) => (el.getAttribute(name) || '').replace(/^null$/, '');
        const keyOf = (type, overlays, index) => `${type}|${overlays || ''}|${index || ''}`;
        function urlOf(type, overlays, index) {
            const q = new URLSearchParams();
            if (overlays) q.set('additive_overlays', overlays);
            if (index) q.set('overlay_index', index);
            const qs = q.toString();
            return `/einsaetze/${type}${qs ? `?${qs}` : ''}`;
        }

        function readCache() {
            try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; } catch (e) { return {}; }
        }
        function cached(key) {
            const hit = readCache()[key];
            return hit && Date.now() - hit.at < CACHE_MS ? hit : null;
        }
        function store(key, data) {
            const all = readCache();
            const now = Date.now();
            for (const k in all) if (now - all[k].at > CACHE_MS) delete all[k];
            all[key] = { at: now, ...data };
            try { localStorage.setItem(CACHE_KEY, JSON.stringify(all)); } catch (e) { /* ignore */ }
        }

        function parse(html) {
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const need = [], chance = [], patients = {};
            for (const table of doc.querySelectorAll('table')) {
                const title = ((table.querySelector('thead th') || {}).textContent || '').trim();
                const vehicles = /voertuig|personeel/i.test(title);
                const other = /overige/i.test(title);
                if (!vehicles && !other) continue;
                for (const tr of table.querySelectorAll('tbody tr')) {
                    if (tr.cells.length < 2) continue;
                    const label = tr.cells[0].textContent.trim().replace(/\s+/g, ' ');
                    const value = tr.cells[1].textContent.trim().replace(/\s+/g, ' ');
                    let m;
                    if ((m = label.match(/^(.*?)\s+benodigd waarschijnlijkheid$/i))) chance.push({ name: m[1], v: value });
                    else if (/^Minimaal aantal patiënten$/i.test(label)) patients.min = value;
                    else if (/^Maximale? aantal patiënten$/i.test(label)) patients.max = value;
                    else if (/patiënt getransporteerd/i.test(label)) patients.transport = value;
                    else if (other && !/^Benodigde? Personeel$/i.test(label)) continue;
                    else if ((m = label.match(/^Benodigd(?:e)?(?: aantal)?\s+(.*)$/i))) need.push({ name: m[1], v: value });
                    else if ((m = label.match(/^(.*?)\s+benodigd$/i))) need.push({ name: m[1], v: value });
                }
            }
            return { need, chance, patients };
        }

        async function fetchType(type, overlays, index) {
            const res = await fetch(urlOf(type, overlays, index), { credentials: 'same-origin' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = parse(await res.text());
            store(keyOf(type, overlays, index), data);
            return data;
        }

        /* ========================================================================
         * MAP PAGE — warm the cache for the missions in the list, slowly
         * (one help page every 1.5 s, only types not cached yet).
         * ==================================================================== */
        if (location.pathname === '/') {
            if (window.top !== window.self) return;
            let stopped = false;
            let busy = false;
            async function warm() {
                if (busy || stopped) return;
                busy = true;
                try {
                    const todo = new Map();
                    document.querySelectorAll('.missionSideBarEntry[mission_type_id]').forEach((el) => {
                        const type = el.getAttribute('mission_type_id');
                        const ov = attr(el, 'data-additive-overlays');
                        const idx = attr(el, 'data-overlay-index');
                        if (!/^\d+$/.test(type)) return;
                        const k = keyOf(type, ov, idx);
                        if (!todo.has(k) && !cached(k)) todo.set(k, [type, ov, idx]);
                    });
                    for (const [type, ov, idx] of todo.values()) {
                        if (stopped) break;
                        try { await fetchType(type, ov, idx); } catch (e) { ctx.warn('prefetch failed', type, e); }
                        await new Promise((r) => setTimeout(r, 1500));
                    }
                } finally { busy = false; }
            }
            const first = setTimeout(warm, 5000);
            const timer = setInterval(warm, 60000);
            return { stop() { stopped = true; clearTimeout(first); clearInterval(timer); } };
        }

        /* ========================================================================
         * MISSION WINDOW — list in the right half of the header, under the
         * progress bar. Drawn synchronously from cache, so nothing moves.
         * ==================================================================== */
        const info = document.getElementById('mission_general_info');
        const right = document.getElementById('mission_progress_info');
        if (!info || !right) return;
        const type = info.getAttribute('data-mission-type');
        if (!/^\d+$/.test(type || '')) return; // own/alliance large-scale events have no type
        const overlays = attr(info, 'data-additive-overlays');
        const index = attr(info, 'data-overlay-index');
        const key = keyOf(type, overlays, index);

        const style = document.createElement('style');
        style.textContent = `
            .mks-mh.alert { margin: 8px 0 0; padding: 8px 12px; font-size: 14px; line-height: 1.35; min-height: 44px; }
            .mks-mh-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 2px 14px; }
            .mks-mh-row { display: flex; gap: 6px; align-items: baseline; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .mks-mh-n { min-width: 2.2em; text-align: right; font-weight: 700; font-variant-numeric: tabular-nums; }
            .mks-mh-name { overflow: hidden; text-overflow: ellipsis; }
            .mks-mh-rest { display: flex; flex-wrap: wrap; gap: 2px 16px; margin-top: 3px; }
            .mks-mh-chance { opacity: .75; font-size: 13px; margin-top: 3px; }
            .mks-mh-note { opacity: .6; font-size: 12px; }
            #mission_general_info > .alert-missing-vehicles { clear: both; margin: 8px 0 0; }
        `;
        document.head.appendChild(style);

        const box = document.createElement('div');
        // Same Bootstrap alert as the game's red missing-vehicles box, in green.
        box.className = 'mks-mh alert alert-success';
        right.appendChild(box);

        const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
        function render(data) {
            if (!data) { box.innerHTML = '<span class="mks-mh-note">Meldinghelper laden…</span>'; return; }
            // Plain counts go in the grid; water, foam and personnel rules
            // ("1 per 100 reddingswerkers") go on one line underneath.
            const litres = (x) => /water|schuim/i.test(x.name) && /^\d+$/.test(x.v.replace(/\./g, ''));
            const counts = data.need.filter((x) => /^\d+$/.test(x.v) && !litres(x));
            const rest = data.need.filter((x) => !counts.includes(x));
            if (!data.need.length) {
                box.innerHTML = '<span class="mks-mh-note">Geen voertuigeisen: alleen patiënten of ambulance.</span>';
            } else {
                box.innerHTML = `<div class="mks-mh-list">${counts.map((x) =>
                    `<div class="mks-mh-row" title="${esc(`${x.v}× ${x.name}`)}"><span class="mks-mh-n">${esc(x.v)}×</span>`
                    + `<span class="mks-mh-name">${esc(cap(x.name))}</span></div>`).join('')}</div>`;
                if (rest.length) {
                    box.insertAdjacentHTML('beforeend', `<div class="mks-mh-rest">${rest.map((x) => `<span><b>${esc(cap(x.name))}</b> `
                        + `${esc(litres(x) ? `${ctx.nl(Number(x.v.replace(/\./g, '')))} l` : x.v)}</span>`).join('')}</div>`);
                }
            }
            const p = data.patients || {};
            if (p.max) {
                const n = p.min && p.min !== p.max ? `${p.min}-${p.max}` : p.max;
                box.insertAdjacentHTML('beforeend', `<div class="mks-mh-rest"><span><b>Patiënten</b> ${esc(n)}</span>`
                    + `${p.transport ? `<span><b>Transport</b> ${esc(p.transport)}%</span>` : ''}</div>`);
            }
            if (ctx.cfg.chances && data.chance.length) {
                box.insertAdjacentHTML('beforeend', `<div class="mks-mh-chance">Kans: ${data.chance.map((x) => esc(`${cap(x.name)} ${x.v}%`)).join(' · ')}</div>`);
            }
        }

        // The game's "missing vehicles" alert, moved into the left half of the
        // header so it sits next to the list. The game updates its contents in
        // place, so moving the element itself is safe; stop() puts it back.
        const missing = document.querySelector('.alert.alert-missing-vehicles');
        const home = missing && { parent: missing.parentNode, next: missing.nextSibling };
        function placeMissing() {
            if (!missing) return;
            if (ctx.cfg.moveMissing) info.appendChild(missing);
            else if (missing.parentNode !== home.parent) home.parent.insertBefore(missing, home.next);
        }
        placeMissing();

        let data = cached(key);
        render(data);
        if (!data) {
            fetchType(type, overlays, index)
                .then((d) => { data = d; render(d); })
                .catch((e) => { ctx.warn('help page failed', e); box.innerHTML = '<span class="mks-mh-note">Meldinghelper: hulppagina niet geladen.</span>'; });
        }
        ctx.onSettings(() => { render(data); placeMissing(); });

        return {
            stop() {
                box.remove();
                style.remove();
                if (missing && missing.parentNode !== home.parent) home.parent.insertBefore(missing, home.next);
            },
        };
    },
});
