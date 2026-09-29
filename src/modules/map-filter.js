MKS.module({
    id: 'map-filter',
    name: 'Kaartfilter',
    icon: '🗺️',
    category: 'missions',
    description: 'Inzetten die door de missiefilters verborgen zijn, verdwijnen ook van de kaart. '
        + 'Werkt met de filters van het spel zelf, de zoekbalk en het Creditfilter.',
    at: 'ready',
    frames: 'top',
    live: true,

    run(ctx) {
        const W = ctx.W;
        const panel = document.getElementById('missions-panel-body');
        if (!panel || !Array.isArray(W.mission_markers)) return;

        const HIDDEN = 'mks-map-hidden';
        const style = document.createElement('style');
        style.textContent = `.leaflet-marker-icon.${HIDDEN} { display: none !important; }`;
        document.head.appendChild(style);

        // An entry is filtered out when it, or a parent inside the mission
        // panel, is display:none. The game marks filtered entries with the
        // `hidden` class; the credit filter and search use their own classes.
        // Stop at the panel so a collapsed sidebar does not empty the map.
        function filteredOut(entry) {
            for (let el = entry; el && el !== panel; el = el.parentElement) {
                if (getComputedStyle(el).display === 'none') return true;
            }
            return false;
        }

        function sync() {
            W.mission_markers.forEach((m) => {
                if (!m._icon) return;
                const entry = document.getElementById(`mission_${m.mission_id}`);
                // No list entry (yet): leave the marker alone.
                const hide = !!entry && filteredOut(entry);
                m._icon.classList.toggle(HIDDEN, hide);
            });
        }

        // Progress bars in the list change every second, so batch mutations.
        // setTimeout, not requestAnimationFrame: rAF stops in background tabs.
        let timer = null;
        const schedule = () => {
            if (timer) return;
            timer = setTimeout(() => { timer = null; sync(); }, 100);
        };

        // Filter clicks, search and new or finished missions all change the
        // list's classes or children.
        const obs = new MutationObserver(schedule);
        obs.observe(panel, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style'] });

        // Leaflet builds a new icon element when a marker is (re)added or its
        // icon changes (mission turns red/yellow/green), which drops our class.
        const pane = W.map && W.map.getPane && W.map.getPane('markerPane');
        const paneObs = new MutationObserver(schedule);
        if (pane) paneObs.observe(pane, { childList: true });

        sync();

        return {
            stop() {
                obs.disconnect();
                paneObs.disconnect();
                clearTimeout(timer);
                style.remove();
                document.querySelectorAll(`.${HIDDEN}`).forEach((el) => el.classList.remove(HIDDEN));
            },
        };
    },
});
