MKS.module({
    id: 'vehicle-search',
    name: 'Voertuig zoeken',
    icon: '🔎',
    category: 'missions',
    description: 'Zoekbalk boven de voertuigtabs in het alarmeervenster. Filtert op naam, post of huidige inzet, in alle tabs. '
        + 'Meerdere woorden = allemaal, <kbd>,</kbd> = of, <kbd>-woord</kbd> = niet. <kbd>Enter</kbd> vinkt het eerste voertuig aan (alarmeert niet), '
        + '<kbd>Esc</kbd> wist, <kbd>/</kbd> springt naar de balk. Alleen weergave: vinkt of verstuurt nooit zelf.',
    at: 'ready',
    frames: 'all',
    pages: /^\/missions\//,
    pageNote: 'Alleen in het alarmeervenster',
    settings: [],

    run() {
        /* ========================================================================
         * How to search
         *   - Several words = all must match:  "ON NH"  -> ON units from NH.
         *   - Comma = either:                  "ts, hv" -> TS or HV.
         *   - Start a word with - to exclude:  "arnhem -noord".
         *   - Enter ticks the first visible, unticked vehicle (it does NOT alarm).
         *   - Every tab is searched, including Dooralarmeren; each tab name
         *     shows its number of matches while you search.
         *   - Esc clears the search. "/" anywhere on the page jumps to the bar.
         * Ticked vehicles always stay visible, so a search never hides a
         * selection you already made.
         * ==================================================================== */

        const ROW_SEL = 'tr:has(input.vehicle_checkbox)';
        const BAR_ID = 'mks-vehicle-search';

        const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

        // "a b, c -d" -> [[{t:'a'},{t:'b'}], [{t:'c'},{t:'d',not:true}]]
        function parseQuery(q) {
            return norm(q).split(',').map((part) => part.trim().split(' ').filter(Boolean)
                .filter((w) => w !== '-')
                .map((w) => (w.startsWith('-') ? { t: w.slice(1), not: true } : { t: w })))
                .filter((g) => g.length);
        }

        function rowMatches(text, groups) {
            return groups.some((g) => g.every((w) => text.includes(w.t) !== !!w.not));
        }

        function rowText(tr) {
            // Cache per row; the game replaces rows when it reloads a table, so
            // a new row simply gets a new cache entry.
            if (tr.dataset.mksSearch === undefined) tr.dataset.mksSearch = norm(tr.textContent);
            return tr.dataset.mksSearch;
        }

        let input, counter, tabsEl;

        // Every vehicle row in every tab. The "Dooralarmeren" tab may use a
        // different checkbox class than the normal tabs, so besides the game's
        // input.vehicle_checkbox rows, take any checkbox row inside the tab
        // panes that belong to the vehicle tabs.
        function allRows() {
            const rows = new Set(document.querySelectorAll(ROW_SEL));
            for (const pane of tabPanes().map((t) => t.pane)) {
                pane.querySelectorAll('tr:has(input[type="checkbox"])').forEach((tr) => rows.add(tr));
            }
            return [...rows].filter((tr) => !tr.querySelector('th'));
        }
        const rowCheckbox = (tr) => tr.querySelector('input.vehicle_checkbox') || tr.querySelector('input[type="checkbox"]');

        // [{ link, pane }] for each vehicle tab (Alles, …, Dooralarmeren).
        function tabPanes() {
            if (!tabsEl) return [];
            return [...tabsEl.querySelectorAll('a')].map((link) => {
                const id = (link.getAttribute('href') || '').startsWith('#') ? link.getAttribute('href').slice(1) : link.getAttribute('aria-controls');
                const pane = id ? document.getElementById(id) : null;
                return pane ? { link, pane } : null;
            }).filter(Boolean);
        }

        // Some tabs (Dooralarmeren) only fill their table when opened. Open each
        // empty tab once, then switch back, so the search covers it too.
        const preloaded = new WeakSet();
        function preloadEmptyTabs() {
            const tabs = tabPanes();
            const active = tabs.find((t) => t.link.parentElement.classList.contains('active'));
            let clicked = false;
            for (const t of tabs) {
                if (preloaded.has(t.link) || t === active) continue;
                preloaded.add(t.link);
                if (!t.pane.querySelector('tr')) { t.link.click(); clicked = true; }
            }
            if (clicked && active) active.link.click();
        }

        // Show "(n)" matches behind each tab name while searching.
        function updateTabBadges(groups) {
            for (const { link, pane } of tabPanes()) {
                let badge = link.querySelector('.mks-vs-badge');
                if (!groups.length) { if (badge) badge.remove(); continue; }
                if (!badge) {
                    badge = document.createElement('span');
                    badge.className = 'mks-vs-badge badge';
                    badge.style.marginLeft = '5px';
                    link.appendChild(badge);
                }
                const n = [...pane.querySelectorAll('tr')].filter((tr) => rowCheckbox(tr) && tr.style.display !== 'none').length;
                if (badge.textContent !== String(n)) badge.textContent = n; // avoid re-triggering the observer
            }
        }

        function applyFilter() {
            if (!input) return;
            const groups = parseQuery(input.value);
            let shown = 0, total = 0;
            allRows().forEach((tr) => {
                total++;
                const cb = rowCheckbox(tr);
                const show = !groups.length || (cb && cb.checked) || rowMatches(rowText(tr), groups);
                tr.style.display = show ? '' : 'none';
                if (show) shown++;
            });
            counter.textContent = groups.length ? `${shown} / ${total}` : '';
            updateTabBadges(groups);
        }

        function tickFirstVisible() {
            const pane = tabPanes().find((t) => t.link.parentElement.classList.contains('active'))?.pane
                || document.querySelector('.tab-pane.active') || document;
            const rows = [...pane.querySelectorAll('tr')].filter((tr) => rowCheckbox(tr) && tr.style.display !== 'none' && tr.offsetParent !== null);
            for (const tr of rows) {
                const cb = rowCheckbox(tr);
                if (cb && !cb.checked && !cb.disabled) { cb.click(); return; }
            }
        }

        function findTabs() {
            const first = document.querySelector('input.vehicle_checkbox');
            const tabs = [...document.querySelectorAll('ul.nav-tabs')];
            // The vehicle tabs are the nav-tabs list right above the vehicle
            // table; prefer one that contains an "Alles" tab.
            return tabs.find((ul) => /\balles\b/i.test(ul.textContent) && (!first || (ul.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING)))
                || (first && tabs.filter((ul) => ul.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).pop())
                || null;
        }

        function addBar() {
            if (tabsEl && !tabsEl.isConnected) tabsEl = null;
            if (!tabsEl) tabsEl = findTabs();
            if (document.getElementById(BAR_ID)) return;
            const tabs = tabsEl;
            if (!tabs) return;

            const bar = document.createElement('div');
            bar.id = BAR_ID;
            bar.style.cssText = 'display:flex;align-items:center;gap:8px;margin:6px 0;';
            bar.innerHTML = `
                <div class="input-group input-group-sm" style="flex:1;max-width:520px">
                    <span class="input-group-addon"><span class="glyphicon glyphicon-search"></span></span>
                    <input type="search" class="form-control" placeholder="Zoek voertuig, post of inzet…  (komma = of, -woord = niet)" autocomplete="off">
                </div>
                <span class="mks-vs-count" style="color:#888;font-variant-numeric:tabular-nums"></span>`;
            tabs.parentNode.insertBefore(bar, tabs);

            input = bar.querySelector('input');
            counter = bar.querySelector('.mks-vs-count');
            input.addEventListener('input', () => {
                if (input.value.trim()) preloadEmptyTabs();
                applyFilter();
            });
            input.addEventListener('keydown', (e) => {
                // Keep the game's own hotkeys from firing while typing.
                e.stopPropagation();
                if (e.key === 'Enter') { e.preventDefault(); tickFirstVisible(); }
                if (e.key === 'Escape') { input.value = ''; applyFilter(); input.blur(); }
            });
            input.addEventListener('keyup', (e) => e.stopPropagation());
            input.addEventListener('keypress', (e) => e.stopPropagation());
        }

        document.addEventListener('keydown', (e) => {
            if (e.key !== '/' || !input) return;
            const t = e.target;
            if (t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))) return;
            e.preventDefault();
            input.focus();
            input.select();
        });

        addBar();
        applyFilter();

        // Tabs load their tables lazily and "load missing vehicles" appends rows,
        // so re-apply whenever rows are added. Debounced to one pass per frame.
        let queued = false;
        new MutationObserver(() => {
            if (queued) return;
            queued = true;
            requestAnimationFrame(() => {
                queued = false;
                addBar();
                if (input && input.value) applyFilter();
            });
        }).observe(document.body, { childList: true, subtree: true });
    },
});
