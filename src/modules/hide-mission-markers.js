MKS.module({
    id: 'hide-mission-markers',
    name: 'Inzetmarkers verbergen',
    icon: '🙈',
    category: 'map',
    description: 'Een knop die alle inzetmarkers op de kaart verbergt of weer toont. Alleen wat je ziet verandert: '
        + 'de inzettenlijst, de missiefilters en Automatisch alarmeren werken gewoon door. Gebouwen blijven zichtbaar.',
    at: 'ready',
    frames: 'top',
    live: true,
    settings: [],

    run(ctx) {
        const W = ctx.W;
        if (!Array.isArray(W.mission_markers)) return;
        const KEY = 'mks.hideMissionMarkers.on';
        const HIDDEN = 'mks-marker-hidden';
        const style = document.createElement('style');
        style.textContent = `.leaflet-marker-icon.${HIDDEN}, .leaflet-marker-shadow.${HIDDEN}, .leaflet-tooltip.${HIDDEN} { display: none !important; }`;
        document.head.appendChild(style);
        let on = !!GM_getValue(KEY, false);

        // The game adds and removes markers all the time: mark them on a short timer.
        // Only the map is touched; the sidebar list (what the filters and the
        // auto dispatcher read) stays as it is.
        function apply() {
            for (const m of W.mission_markers) {
                for (const el of [m._icon, m._shadow, m.getTooltip && m.getTooltip() && m.getTooltip()._container]) {
                    if (el) el.classList.toggle(HIDDEN, on);
                }
            }
        }
        function set(v) {
            on = v;
            GM_setValue(KEY, on);
            apply();
            ctx.status(on ? 'Inzetmarkers verborgen' : 'Inzetmarkers zichtbaar', { tone: on ? 'ok' : 'idle' });
            ctx.refresh();
        }
        const timer = setInterval(apply, 1000);
        apply();
        ctx.status(on ? 'Inzetmarkers verborgen' : 'Inzetmarkers zichtbaar', { tone: on ? 'ok' : 'idle' });
        ctx.actions([{ label: 'Markers verbergen / tonen', kind: 'primary', run: () => set(!on) }]);
        ctx.menu({ icon: '🙈', label: 'Inzetmarkers verbergen/tonen', run: () => set(!on) });

        return {
            stop() {
                clearInterval(timer);
                on = false;
                apply();
                style.remove();
            },
        };
    },
});
