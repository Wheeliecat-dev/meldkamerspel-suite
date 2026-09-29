MKS.module({
    id: 'credit-filter',
    name: 'Creditfilter',
    icon: '💶',
    category: 'missions',
    description: 'Drie knoppen in de missiefilterbalk: laag, midden en hoog aantal credits. Groen = tonen, rood = verbergen, net als de filters van het spel zelf. '
        + 'Inzetten zonder bekende credits blijven altijd zichtbaar.',
    at: 'ready',
    frames: 'top',
    settings: [
        { key: 'lowMax', label: 'Grens laag / midden', type: 'number', default: 1000, min: 100, max: 100000, step: 100, unit: 'credits' },
        { key: 'highMin', label: 'Grens midden / hoog', type: 'number', default: 5000, min: 100, max: 100000, step: 100, unit: 'credits' },
    ],

    run(ctx) {
        const STORE_KEY = 'mks-credit-filter';
        const k = (n) => (n % 1000 ? `${(n / 1000).toLocaleString('nl-NL')}k` : `${n / 1000}k`);
        // Lower bound inclusive, upper bound exclusive. Rebuilt when the
        // borders change in the dashboard.
        const BUCKETS = [];
        function buildBuckets() {
            const lo = Math.min(ctx.cfg.lowMax, ctx.cfg.highMin);
            const hi = Math.max(ctx.cfg.lowMax, ctx.cfg.highMin);
            BUCKETS.splice(0, BUCKETS.length,
                { key: 'low', label: `< ${k(lo)}`, title: `0 - ${ctx.nl(lo)} credits`, min: 0, max: lo },
                { key: 'mid', label: `${k(lo)}-${k(hi)}`, title: `${ctx.nl(lo)} - ${ctx.nl(hi)} credits`, min: lo, max: hi },
                { key: 'high', label: `${k(hi)}+`, title: `${ctx.nl(hi)}+ credits`, min: hi, max: Infinity });
        }
        buildBuckets();
        // Planned events and patient transports keep their own toggles, so only
        // filter the emergency and alliance lists.
        const LIST_IDS = ['mission_list', 'mission_list_alliance', 'mission_list_alliance_event'];
        const HIDDEN = 'mks-credit-hidden';

        const row = document.querySelector('.mission-filters-row');
        if (!row) return;

        // Keys of the buckets that are switched off (hidden).
        let off = new Set();
        try { off = new Set(JSON.parse(localStorage.getItem(STORE_KEY)) || []); } catch (e) {}
        const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify([...off])); } catch (e) {} };

        const style = document.createElement('style');
        style.textContent = `
            .${HIDDEN} { display: none !important; }
            .mks-credit-filters { display: inline-block; margin-left: 4px; }
        `;
        document.head.appendChild(style);

        const group = document.createElement('div');
        group.className = 'mks-credit-filters';
        const buttons = {};
        BUCKETS.forEach(b => {
            // No `mission_selection` class: the game binds its own toggle handler to it.
            const a = document.createElement('a');
            a.className = 'btn btn-xs';
            a.href = '#';
            a.onclick = ev => {
                ev.preventDefault();
                off.has(b.key) ? off.delete(b.key) : off.add(b.key);
                save();
                apply();
            };
            buttons[b.key] = a;
            group.appendChild(a);
        });
        row.appendChild(group);

        function bucketOf(entry) {
            let c;
            try { c = JSON.parse(entry.getAttribute('data-sortable-by')).average_credits; } catch (e) { return null; }
            if (typeof c !== 'number') return null;
            return BUCKETS.find(b => c >= b.min && c < b.max) || null;
        }

        function apply() {
            const counts = Object.fromEntries(BUCKETS.map(b => [b.key, 0]));
            LIST_IDS.forEach(id => {
                const list = document.getElementById(id);
                if (!list) return;
                list.querySelectorAll(':scope > .missionSideBarEntry').forEach(entry => {
                    const b = bucketOf(entry);
                    // Unknown credits: keep visible rather than hide by accident.
                    entry.classList.toggle(HIDDEN, !!b && off.has(b.key));
                    if (b) counts[b.key]++;
                });
            });
            BUCKETS.forEach(b => {
                const a = buttons[b.key];
                const isOff = off.has(b.key);
                a.classList.toggle('btn-success', !isOff);
                a.classList.toggle('btn-danger', isOff);
                a.title = b.title;
                a.innerHTML = `<span class="glyphicon glyphicon-euro"></span> ${b.label} ${counts[b.key]}`;
            });
        }

        // The game adds and removes entries as missions spawn and finish.
        let queued = false;
        const schedule = () => {
            if (queued) return;
            queued = true;
            requestAnimationFrame(() => { queued = false; apply(); });
        };
        const observer = new MutationObserver(schedule);
        LIST_IDS.forEach(id => {
            const list = document.getElementById(id);
            if (list) observer.observe(list, { childList: true });
        });

        apply();

        ctx.onSettings(() => { buildBuckets(); apply(); });
    },
});
