MKS.module({
    id: 'small-vehicle-icons',
    name: 'Kleinere kaarticonen',
    short: 'Iconen',
    icon: '🔍',
    category: 'look',
    description: 'Maakt voertuig- en gebouwiconen op de kaart kleiner, zodat drukke gebieden overzichtelijk blijven. Inzetten houden hun grootte.',
    at: 'ready',
    frames: 'top',
    live: true,
    settings: [
        { key: 'vehicleScale', label: 'Voertuigen', type: 'range', default: 0.6, min: 0.3, max: 1, step: 0.05, format: (v) => `${Math.round(v * 100)}%` },
        { key: 'buildingScale', label: 'Gebouwen', type: 'range', default: 0.6, min: 0.3, max: 1, step: 0.05, format: (v) => `${Math.round(v * 100)}%` },
    ],

    run(ctx) {
        const VEHICLE_SEL = '.leaflet-marker-icon[src*="vehicle_graphic_images"]';
        // Covers building_*.png and policechief_building_*.png. Same bottom-centre anchor.
        const BUILDING_SEL = '.leaflet-marker-icon[src*="/images/"][src*="building_"]';
        const SEL = `${VEHICLE_SEL}, ${BUILDING_SEL}`;
        const SCALE_RE = /\s*scale\([^)]*\)/;

        // Leaflet positions markers with an inline `transform: translate3d(x, y, 0)`.
        // The CSS `scale` property is applied BEFORE `transform`, so it would scale
        // that translate too and pull icons toward the map corner. Instead, append
        // scale() to the transform itself so it applies to the icon only. Leaflet
        // rewrites the transform on every zoom/move, so re-append when it does.
        // Origin 50% 100% is Leaflet's bottom-centre anchor for these icons.
        const style = document.createElement('style');
        style.textContent = `${SEL} { transform-origin: 50% 100%; }`;
        document.head.appendChild(style);

        const scaleOf = (el) => (el.matches(BUILDING_SEL) ? ctx.cfg.buildingScale : ctx.cfg.vehicleScale);

        function fix(el) {
            const t = el.style.transform;
            if (!t) return;
            const want = `scale(${scaleOf(el)})`;
            if (t.includes(want)) return;
            el.style.transform = `${t.replace(SCALE_RE, '')} ${want}`;
        }

        function scan(node) {
            if (node.nodeType !== 1) return;
            if (node.matches(SEL)) fix(node);
            node.querySelectorAll(SEL).forEach(fix);
        }

        scan(document.documentElement);

        const obs = new MutationObserver((muts) => {
            for (const m of muts) {
                if (m.type === 'attributes') {
                    if (m.target.matches(SEL)) fix(m.target);
                } else {
                    m.addedNodes.forEach(scan);
                }
            }
        });
        obs.observe(document.documentElement, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ['style'],
        });

        ctx.onSettings(() => scan(document.documentElement));

        return {
            stop() {
                obs.disconnect();
                style.remove();
                document.querySelectorAll(SEL).forEach((el) => {
                    el.style.transform = el.style.transform.replace(SCALE_RE, '');
                });
            },
        };
    },
});
