MKS.module({
    id: 'destination-filter',
    name: 'Bestemmingfilter',
    icon: '🏥',
    category: 'missions',
    description: 'Verbergt bij een spraakaanvraag de ziekenhuizen en cellen die niet passen: vol, verkeerde afdeling, te duur of te ver. '
        + 'De beste keuze (dichtstbij, passend, laagste kosten) krijgt een markering; <kbd>Enter</kbd> kiest die. '
        + 'Een balk boven de lijst toont hoeveel er verborgen zijn, met een knop om alles te tonen.',
    at: 'ready',
    frames: 'all',
    pages: /^\/vehicles\/\d+\/?$/,
    pageNote: 'Alleen in het voertuigvenster bij een spraakaanvraag',
    live: true,
    settings: [
        { key: 'full', label: 'Volle bestemmingen verbergen', type: 'bool', default: true },
        { key: 'department', label: 'Ziekenhuizen zonder de juiste afdeling verbergen', type: 'bool', default: true },
        { key: 'minBeds', label: 'Minimaal aantal vrije bedden', type: 'number', default: 1, min: 0, max: 50, step: 1 },
        { key: 'cellsShort', label: 'Cellen met te weinig plek verbergen', type: 'bool', default: false,
            help: 'Oranje knoppen: het cellencomplex heeft minder vrije cellen dan er gevangenen in het voertuig zitten.' },
        { key: 'maxCost', label: 'Maximale kosten (team)', type: 'select', default: '50',
            options: [['0', '0 %'], ['10', '10 %'], ['20', '20 %'], ['30', '30 %'], ['40', '40 %'], ['50', '50 % (alles)']] },
        { key: 'maxKm', label: 'Maximale afstand', type: 'number', default: 0, min: 0, max: 500, step: 5, unit: 'km', help: '0 = geen grens.' },
        { key: 'ownKm', label: 'Voorrang eigen ziekenhuis', type: 'number', default: 5, min: 0, max: 100, step: 1, unit: 'km',
            help: 'Bij gelijke kosten wint je eigen ziekenhuis, zolang het niet meer dan zoveel km verder is dan een teamziekenhuis.' },
        { key: 'enter', label: 'Enter kiest de beste bestemming', type: 'bool', default: true },
    ],

    run(ctx) {
        const h2 = document.getElementById('h2_sprechwunsch');
        if (!h2) return;

        const HIDDEN = 'mks-dest-hidden';
        const BEST = 'mks-dest-best';
        const style = document.createElement('style');
        style.textContent = `
            .${HIDDEN} { display: none !important; }
            body.mks-dest-all .${HIDDEN} { display: table-row !important; opacity: .45; }
            body.mks-dest-all a.btn.${HIDDEN} { display: inline-block !important; }
            tr.${BEST} > td { box-shadow: inset 0 2px 0 #3ecf8e, inset 0 -2px 0 #3ecf8e; }
            tr.${BEST} > td:first-child { box-shadow: inset 2px 2px 0 #3ecf8e, inset 0 -2px 0 #3ecf8e; }
            a.btn.${BEST} { outline: 3px solid #3ecf8e; outline-offset: 1px; }
            .mks-dest-tag { display: inline-block; margin-left: 6px; padding: 0 6px; border-radius: 3px; background: #3ecf8e; color: #03241a;
                font-size: 11px; font-weight: 600; vertical-align: middle; }
            .mks-dest-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 6px 0 10px; font-size: 12px; }
            .mks-dest-bar .mks-dest-why { opacity: .75; }
        `;
        document.head.appendChild(style);

        const num = (s) => {
            const m = String(s).replace(/\./g, '').match(/-?\d+(?:,\d+)?/);
            return m ? parseFloat(m[0].replace(',', '.')) : NaN;
        };
        const cell = (tr, i) => (i >= 0 && tr.cells[i] ? tr.cells[i].textContent.trim() : '');

        /* ========================================================================
         * CANDIDATES
         * Hospitals: tables #own-hospitals and #alliance-hospitals, one row per
         * hospital, button a[href*="/patient/"]. Own hospitals have no cost column.
         * Cells: buttons a[href*="/gefangener/"] with distance, free cells and
         * cost in the button text; red = full, orange = not enough room.
         * ==================================================================== */
        function candidates() {
            const out = [];
            for (const table of document.querySelectorAll('table')) {
                const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim().toLowerCase());
                const iDist = heads.findIndex((h) => h.startsWith('afstand'));
                if (iDist < 0) continue;
                const iBeds = heads.findIndex((h) => h.startsWith('vrije'));
                const iCost = heads.findIndex((h) => h.startsWith('kosten'));
                const iDep = heads.findIndex((h) => h.startsWith('afdeling'));
                for (const tr of table.querySelectorAll('tbody > tr')) {
                    const a = tr.querySelector('a.btn[href*="/patient/"]');
                    if (!a) continue;
                    const beds = cell(tr, iBeds);
                    out.push({
                        el: tr, a, kind: 'hospital', own: table.id === 'own-hospitals',
                        dist: num(cell(tr, iDist)),
                        free: iBeds >= 0 ? num(beds.split('/')[0]) : Infinity,
                        cost: iCost >= 0 ? num(cell(tr, iCost)) || 0 : 0,
                        dep: iDep < 0 || !!(tr.cells[iDep] && tr.cells[iDep].querySelector('.label-success')),
                    });
                }
            }
            for (const a of document.querySelectorAll('a.btn[href*="/gefangener/"]')) {
                const t = a.textContent.replace(/\s+/g, ' ');
                const km = t.match(/(\d+(?:[.,]\d+)?)\s*km/);
                const pct = t.match(/(\d+)\s*%/);
                out.push({
                    el: a, a, kind: 'cell',
                    dist: km ? parseFloat(km[1].replace(',', '.')) : NaN,
                    free: a.classList.contains('btn-danger') ? 0 : Infinity,
                    short: a.classList.contains('btn-warning'),
                    cost: pct ? Number(pct[1]) : 0,
                    dep: true,
                });
            }
            return out;
        }

        // Reason a candidate is hidden, or '' when it stays.
        function reason(c) {
            const cfg = ctx.cfg;
            if (c.a.classList.contains('disabled')) return 'niet beschikbaar';
            if (cfg.full && c.free <= 0) return 'vol';
            if (c.kind === 'hospital' && c.free < Number(cfg.minBeds)) return 'te weinig bedden';
            if (c.kind === 'cell' && cfg.cellsShort && c.short) return 'te weinig cellen';
            if (c.kind === 'hospital' && cfg.department && !c.dep) return 'geen afdeling';
            if (c.cost > Number(cfg.maxCost)) return 'te duur';
            if (Number(cfg.maxKm) > 0 && c.dist > Number(cfg.maxKm)) return 'te ver';
            return '';
        }

        const bar = document.createElement('div');
        bar.className = 'mks-dest-bar';
        h2.insertAdjacentElement('afterend', bar);

        let best = null;
        function apply() {
            obs.disconnect();
            document.querySelectorAll(`.${BEST}`).forEach((el) => el.classList.remove(BEST));
            document.querySelectorAll('.mks-dest-tag').forEach((el) => el.remove());
            const list = candidates();
            const why = {};
            const shown = [];
            for (const c of list) {
                const r = reason(c);
                c.el.classList.toggle(HIDDEN, !!r);
                if (r) why[r] = (why[r] || 0) + 1;
                else shown.push(c);
            }
            // Best: cheapest first, then nearest, own hospitals get a head start
            // of ownKm. Unknown distance goes last.
            const rank = (c) => (isNaN(c.dist) ? 1e9 : c.dist) - (c.own ? Number(ctx.cfg.ownKm) || 0 : 0);
            best = shown.slice().sort((x, y) => x.cost - y.cost || rank(x) - rank(y))[0] || null;
            if (best) {
                best.el.classList.add(BEST);
                const tag = document.createElement('span');
                tag.className = 'mks-dest-tag';
                tag.textContent = ctx.cfg.enter ? 'Beste keuze · Enter' : 'Beste keuze';
                (best.kind === 'hospital' ? best.el.cells[0] : best.a).appendChild(tag);
            }
            const hidden = list.length - shown.length;
            const parts = Object.entries(why).map(([k, n]) => `${n} ${k}`).join(', ');
            const all = document.body.classList.contains('mks-dest-all');
            bar.innerHTML = hidden
                ? `<span><b>${shown.length}</b> van ${list.length} bestemmingen</span><span class="mks-dest-why">verborgen: ${ctx.esc(parts)}</span>`
                  + `<a href="#" class="btn btn-xs btn-default">${all ? 'Verborgen weer verbergen' : 'Alles tonen'}</a>`
                : `<span class="mks-dest-why">${list.length} bestemmingen, niets verborgen</span>`;
            const toggle = bar.querySelector('a');
            if (toggle) toggle.onclick = (ev) => { ev.preventDefault(); document.body.classList.toggle('mks-dest-all'); apply(); };
            if (!shown.length && list.length) bar.insertAdjacentHTML('beforeend', '<span class="label label-danger">Geen passende bestemming</span>');
            obs.takeRecords();
            watch();
        }

        function onKey(ev) {
            if (!ctx.cfg.enter || ev.key !== 'Enter' || ev.ctrlKey || ev.altKey || ev.metaKey || ev.shiftKey) return;
            const t = ev.target;
            if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(t.tagName))) return;
            if (!best || !document.contains(best.a)) return;
            ev.preventDefault();
            best.a.click();
        }
        document.addEventListener('keydown', onKey);

        // "Load all" swaps in more alliance hospitals without a page load.
        // apply() changes the DOM itself, so it stops observing while it runs.
        const root = document.getElementById('iframe-inside-container') || document.body;
        let timer = null;
        const obs = new MutationObserver(() => {
            clearTimeout(timer);
            timer = setTimeout(apply, 100);
        });
        const watch = () => obs.observe(root, { childList: true, subtree: true });

        apply();
        ctx.onSettings(apply);

        return {
            stop() {
                obs.disconnect();
                clearTimeout(timer);
                document.removeEventListener('keydown', onKey);
                document.body.classList.remove('mks-dest-all');
                document.querySelectorAll(`.${HIDDEN}, .${BEST}`).forEach((el) => el.classList.remove(HIDDEN, BEST));
                document.querySelectorAll('.mks-dest-tag').forEach((el) => el.remove());
                bar.remove();
                style.remove();
            },
        };
    },
});
