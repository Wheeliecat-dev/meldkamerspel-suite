MKS.module({
    id: 'mission-helper',
    name: 'Meldinghelper',
    icon: '📋',
    category: 'missions',
    description: 'Een compact vak bovenin het alarmeervenster met wat de inzet vraagt: benodigde voertuigen, kansen op extra voertuigen, '
        + 'patiënten, transportkans, afdeling, gevangenen en credits. De gegevens komen uit de hulppagina van het spel zelf, dus altijd actueel. '
        + 'Klik op de titel om het vak in of uit te klappen.',
    at: 'ready',
    frames: 'all',
    pages: /^\/missions\/\d+/,
    pageNote: 'Alleen in het alarmeervenster',
    live: true,
    settings: [
        { key: 'chances', label: 'Kansen op extra voertuigen tonen', type: 'bool', default: true },
        { key: 'credits', label: 'Credits tonen', type: 'bool', default: true },
        { key: 'prereq', label: 'Voorwaarden tonen', type: 'bool', default: false, help: 'Benodigde posten en uitbreidingen om de inzet te krijgen.' },
        { key: 'variants', label: 'Missievariaties tonen', type: 'bool', default: false },
    ],

    run(ctx) {
        const header = document.querySelector('.mission_header_info');
        const link = document.querySelector('#mission-type-helper-mobile, a[href^="/einsaetze/"]');
        if (!header || !link) return;

        const STATE_KEY = 'mks-mission-helper-open';
        const CACHE_KEY = 'mks-mission-helper-cache';
        const CACHE_MS = 24 * 3600 * 1000;

        // The help page depends on the mission type and its overlays, not on
        // the mission itself, so cache it per type + overlays for a day.
        const url = new URL(link.getAttribute('href'), location.origin);
        const typeKey = url.pathname + '?' + (url.searchParams.get('additive_overlays') || '') + '|' + (url.searchParams.get('overlay_index') || '');

        const style = document.createElement('style');
        style.textContent = `
            .mks-mh { margin: 6px 0 10px; border: 1px solid rgba(128,128,128,.35); border-left: 4px solid #31c4dd; border-radius: 6px;
                padding: 6px 10px; font-size: 13px; background: rgba(128,128,128,.06); }
            .mks-mh-head { display: flex; align-items: center; gap: 8px; cursor: pointer; user-select: none; font-weight: 600; }
            .mks-mh-head .mks-mh-sum { font-weight: normal; opacity: .75; font-size: 12px; }
            .mks-mh-head .mks-mh-arrow { margin-left: auto; opacity: .6; }
            .mks-mh-body { margin-top: 6px; }
            .mks-mh.closed .mks-mh-body { display: none; }
            .mks-mh-chips { display: flex; flex-wrap: wrap; gap: 4px; margin: 2px 0 6px; }
            .mks-mh-chip { display: inline-flex; gap: 4px; align-items: baseline; padding: 1px 7px; border-radius: 10px;
                background: rgba(128,128,128,.18); white-space: nowrap; }
            .mks-mh-chip b { font-variant-numeric: tabular-nums; }
            .mks-mh-chip.chance { background: transparent; border: 1px dashed rgba(128,128,128,.6); }
            .mks-mh-info { display: grid; grid-template-columns: max-content 1fr; gap: 1px 12px; font-size: 12px; }
            .mks-mh-info dt { font-weight: normal; opacity: .7; }
            .mks-mh-info dd { margin: 0; }
            .mks-mh-sec { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; opacity: .6; margin-top: 4px; }
        `;
        document.head.appendChild(style);

        const box = document.createElement('div');
        box.className = 'mks-mh';
        let open = true;
        try { open = localStorage.getItem(STATE_KEY) !== '0'; } catch (e) { /* ignore */ }
        box.classList.toggle('closed', !open);
        box.innerHTML = '<div class="mks-mh-head">Meldinghelper <span class="mks-mh-sum">laden…</span><span class="mks-mh-arrow"></span></div><div class="mks-mh-body"></div>';
        header.insertAdjacentElement('afterend', box);
        const head = box.querySelector('.mks-mh-head');
        const body = box.querySelector('.mks-mh-body');
        const arrow = () => { box.querySelector('.mks-mh-arrow').textContent = box.classList.contains('closed') ? '▸' : '▾'; };
        arrow();
        head.addEventListener('click', () => {
            box.classList.toggle('closed');
            try { localStorage.setItem(STATE_KEY, box.classList.contains('closed') ? '0' : '1'); } catch (e) { /* ignore */ }
            arrow();
        });

        /* ========================================================================
         * DATA — the game's own help page (/einsaetze/{type}), three tables:
         *   "Beloning en voorwaarden"        credits, POI, needed buildings
         *   "Voertuig en personeel vereisten" "Benodigde X" = n, "X benodigd waarschijnlijkheid" = %
         *   "Overige informatie"              patients, transport chance, department, ...
         * ==================================================================== */
        function readCache() {
            try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; } catch (e) { return {}; }
        }
        function writeCache(all) {
            const now = Date.now();
            for (const k in all) if (now - all[k].at > CACHE_MS) delete all[k];
            try { localStorage.setItem(CACHE_KEY, JSON.stringify(all)); } catch (e) { /* ignore */ }
        }

        async function load() {
            const all = readCache();
            const hit = all[typeKey];
            if (hit && Date.now() - hit.at < CACHE_MS) return hit.tables;
            const res = await fetch(url.pathname + url.search, { credentials: 'same-origin' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
            const tables = [...doc.querySelectorAll('table')].map((t) => ({
                title: (t.querySelector('thead th') || {}).textContent || '',
                rows: [...t.querySelectorAll('tbody tr')].map((tr) => [...tr.cells].map((td) => td.textContent.trim().replace(/\s+/g, ' ')))
                    .filter((r) => r.length >= 2 && r[0]),
            })).map((t) => ({ ...t, title: t.title.trim() }));
            all[typeKey] = { at: Date.now(), tables };
            writeCache(all);
            return tables;
        }

        const esc = ctx.esc;
        const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

        function render(tables) {
            const find = (re) => tables.find((t) => re.test(t.title)) || { rows: [] };
            const reward = find(/beloning|voorwaarden/i).rows;
            const vehicles = find(/voertuig|personeel/i).rows;
            const other = find(/overige/i).rows;

            const need = [], chance = [], extra = [];
            for (const [label, value] of vehicles) {
                let m;
                if ((m = label.match(/^(.*?)\s+benodigd waarschijnlijkheid$/i))) chance.push({ name: m[1], v: `${value}%` });
                else if ((m = label.match(/^Benodigd(?:e)?(?: aantal)?\s+(.*)$/i))) need.push({ name: m[1], v: value });
                else if ((m = label.match(/^(.*?)\s+benodigd$/i))) need.push({ name: m[1], v: value });
                else extra.push([label, value]);
            }

            let credits = null, poi = null;
            const prereq = [];
            for (const [label, value] of reward) {
                if (/credits/i.test(label)) credits = value;
                else if (/point of interest/i.test(label)) poi = value;
                else if (!/incident keuze/i.test(label)) prereq.push([label.replace(/^Benodigd(?:e)?(?: aantal)?\s+/i, ''), value]);
            }

            const info = [];
            for (const [label, value] of other) {
                if (/variaties/i.test(label) && !ctx.cfg.variants) continue;
                if (/benodigd waarschijnlijkheid$/i.test(label)) { chance.push({ name: label.replace(/\s+benodigd waarschijnlijkheid$/i, ''), v: `${value}%` }); continue; }
                const short = label
                    .replace(/^Waarschijnlijkheid dat een patiënt getransporteerd moet worden$/i, 'Transportkans')
                    .replace(/^Gespecialiseerde afdeling voor patiënten$/i, 'Afdeling');
                const val = /kans|waarschijnlijkheid/i.test(short) && /^\d+$/.test(value) ? `${value}%` : value;
                info.push([short, val]);
            }
            info.push(...extra);

            const chips = (list, cls) => `<div class="mks-mh-chips">${list.map((x) =>
                `<span class="mks-mh-chip ${cls}"><b>${esc(x.v)}</b>${/^\d+$/.test(x.v) ? '×' : ''} ${esc(cap(x.name))}</span>`).join('')}</div>`;
            const dl = (list) => `<dl class="mks-mh-info">${list.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;

            let html = '';
            if (need.length) html += chips(need, '');
            else html += '<div class="mks-mh-chips"><span class="mks-mh-chip">Geen voertuigeisen (alleen ambulance of patiënten)</span></div>';
            if (ctx.cfg.chances && chance.length) html += `<div class="mks-mh-sec">Kans op</div>${chips(chance, 'chance')}`;
            const top = [];
            if (poi) top.push(['POI', poi]);
            if (info.length || top.length) html += dl(top.concat(info));
            if (ctx.cfg.prereq && prereq.length) html += `<div class="mks-mh-sec">Voorwaarden</div>${dl(prereq)}`;
            body.innerHTML = html;

            const total = need.reduce((a, x) => a + (/^\d+$/.test(x.v) ? Number(x.v) : 0), 0);
            const sum = [total ? `${total} voertuigen` : '', ctx.cfg.credits && credits ? `${ctx.nl(Number(credits.replace(/\D/g, '')))} credits` : '']
                .filter(Boolean).join(' · ');
            head.querySelector('.mks-mh-sum').textContent = sum;
        }

        let tables = null;
        load()
            .then((t) => { tables = t; render(t); })
            .catch((e) => {
                ctx.warn('help page failed', e);
                head.querySelector('.mks-mh-sum').textContent = 'kon de hulppagina niet laden';
            });
        ctx.onSettings(() => { if (tables) render(tables); });

        return {
            stop() {
                box.remove();
                style.remove();
            },
        };
    },
});
