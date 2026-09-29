MKS.module({
    id: 'preset-search',
    name: 'AAO zoeken',
    icon: '🔍',
    category: 'missions',
    description: 'Zoekbalk boven de AAO\'s in het alarmeervenster. Zoekt door alle categorieën tegelijk. '
        + 'Meerdere woorden = allemaal. <kbd>Enter</kbd> klikt de eerste AAO (vinkt voertuigen aan, alarmeert niet), '
        + '<kbd>Esc</kbd> wist.',
    at: 'ready',
    frames: 'all',
    pages: /^\/missions\//,
    pageNote: 'Alleen in het alarmeervenster',
    live: true,
    settings: [],

    run() {
        // While searching, every category pane is shown at once and the
        // category tabs are hidden, so the result ignores categories.
        // Buttons stay the game's own elements, so clicking works as usual.
        const BTN_SEL = '.aao_btn';
        const BAR_ID = 'mks-preset-search';
        const ON = 'mks-ps-on';
        const HIDE = 'mks-ps-hide';

        const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

        const style = document.createElement('style');
        style.textContent = `
            .${ON} > .tab-pane { display: block !important; opacity: 1 !important; }
            .${HIDE} { display: none !important; }`;
        document.head.appendChild(style);

        let input, counter, content, tabs;

        const buttons = () => [...document.querySelectorAll(BTN_SEL)];
        const btnText = (b) => norm(`${b.getAttribute('title') || ''} ${b.textContent}`);

        // The category tabs (Klein / Middel / ...) and the .tab-content that
        // holds their panes. Both are null when the player has no categories.
        function findContainers() {
            const first = document.querySelector(BTN_SEL);
            content = first ? first.closest('.tab-content') : null;
            let prev = content && content.previousElementSibling;
            while (prev && !prev.matches('ul.nav-tabs')) prev = prev.previousElementSibling;
            tabs = prev || null;
        }

        function applyFilter() {
            if (!input) return;
            const words = norm(input.value).split(' ').filter(Boolean);
            const searching = words.length > 0;
            if (content) content.classList.toggle(ON, searching);
            if (tabs) tabs.classList.toggle(HIDE, searching);

            let shown = 0;
            const all = buttons();
            all.forEach((b) => {
                const show = !searching || words.every((w) => btnText(b).includes(w));
                b.classList.toggle(HIDE, !show);
                if (show) shown++;
            });
            // Hide categories without a match, so no empty gaps.
            if (content) {
                [...content.children].filter((p) => p.classList.contains('tab-pane')).forEach((p) => {
                    p.classList.toggle(HIDE, searching && !p.querySelector(`${BTN_SEL}:not(.${HIDE})`));
                });
            }
            counter.textContent = searching ? `${shown} / ${all.length}` : '';
        }

        function addBar() {
            if (document.getElementById(BAR_ID)) return;
            findContainers();
            const first = document.querySelector(BTN_SEL);
            if (!first) return;
            const anchor = tabs || content || first.parentElement;

            const bar = document.createElement('div');
            bar.id = BAR_ID;
            bar.style.cssText = 'display:flex;align-items:center;gap:8px;margin:6px 0;';
            bar.innerHTML = `
                <div class="input-group input-group-sm" style="flex:1;max-width:360px">
                    <span class="input-group-addon"><span class="glyphicon glyphicon-search"></span></span>
                    <input type="search" class="form-control" placeholder="Zoek AAO…" autocomplete="off">
                </div>
                <span class="mks-ps-count" style="color:#888;font-variant-numeric:tabular-nums"></span>`;
            anchor.parentNode.insertBefore(bar, anchor);

            input = bar.querySelector('input');
            counter = bar.querySelector('.mks-ps-count');
            input.addEventListener('input', applyFilter);
            input.addEventListener('keydown', (e) => {
                // Keep the game's preset hotkeys from firing while typing.
                e.stopPropagation();
                if (e.key === 'Enter') {
                    e.preventDefault();
                    const hit = buttons().find((b) => !b.classList.contains(HIDE));
                    if (hit && input.value.trim()) hit.click();
                }
                if (e.key === 'Escape') { input.value = ''; applyFilter(); input.blur(); }
            });
            input.addEventListener('keyup', (e) => e.stopPropagation());
            input.addEventListener('keypress', (e) => e.stopPropagation());
        }

        addBar();

        // The mission window can re-render parts of the page; put the bar
        // back and re-apply the search when that happens.
        let queued = false;
        const observer = new MutationObserver(() => {
            if (queued) return;
            queued = true;
            requestAnimationFrame(() => {
                queued = false;
                if (input && !input.isConnected) input = null;
                addBar();
                if (input && input.value) applyFilter();
            });
        });
        observer.observe(document.body, { childList: true, subtree: true });

        return {
            stop() {
                observer.disconnect();
                if (input) { input.value = ''; applyFilter(); }
                document.getElementById(BAR_ID)?.remove();
                style.remove();
                input = null;
            },
        };
    },
});
