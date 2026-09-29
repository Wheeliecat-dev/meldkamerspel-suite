MKS.module({
    id: 'transport-requests',
    name: 'Verbeterde spraakaanvragen',
    icon: '📻',
    category: 'missions',
    description: 'Werk spraakaanvragen snel achter elkaar af. Een knop in de missiefilterbalk telt je open spraakaanvragen en opent de oudste. '
        + 'Een inzet met een spraakaanvraag opent die meteen. Na het kiezen van een bestemming ga je vanzelf door naar het volgende voertuig, '
        + 'daarna terug naar de inzet of dicht. Kiest nooit zelf een ziekenhuis of cel.',
    at: 'ready',
    frames: 'all',
    settings: [
        { key: 'counter', label: 'Teller in de missiefilterbalk', type: 'bool', default: true,
            help: 'Groen met het aantal open spraakaanvragen. Klik = oudste openen.' },
        { key: 'autoOpen', label: 'Spraakaanvraag openen vanuit de inzet', type: 'bool', default: true,
            help: 'Open je een inzet waar een voertuig spraak aanvraagt, dan ga je direct naar dat voertuig.' },
        { key: 'after', label: 'Na het kiezen van een bestemming', type: 'select', default: 'next',
            options: [
                ['next', 'Volgende voertuig, dan terug naar de inzet'],
                ['nextClose', 'Volgende voertuig, dan venster dicht'],
                ['mission', 'Terug naar de inzet'],
                ['close', 'Venster dicht'],
                ['none', 'Niets doen'],
            ] },
    ],

    run(ctx) {
        const W = ctx.W;
        const path = location.pathname;
        const IN_FRAME = window.top !== window.self;

        /* ========================================================================
         * MISSION WINDOW — jump to the vehicle that asks for a transport.
         * The game lists status-5 vehicles in a red alert with a green button
         * to /vehicles/{id}. The missing-vehicles alert is also red, skip it.
         * A vehicle we already jumped to recently is not opened again, so going
         * back to the mission never loops (e.g. when no hospital fits).
         * ==================================================================== */
        if (/^\/missions\/\d+\/?$/.test(path)) {
            if (!ctx.cfg.autoOpen) return;
            const btn = document.querySelector('.alert.alert-danger:not(.alert-missing-vehicles) a.btn.btn-success[href^="/vehicles/"]');
            if (!btn) return;
            const KEY = 'mks-transport-opened';
            let seen = {};
            try { seen = JSON.parse(sessionStorage.getItem(KEY)) || {}; } catch (e) { /* ignore */ }
            const now = Date.now();
            for (const k in seen) if (now - seen[k] > 120000) delete seen[k];
            const href = btn.getAttribute('href');
            if (seen[href]) return;
            seen[href] = now;
            try { sessionStorage.setItem(KEY, JSON.stringify(seen)); } catch (e) { /* ignore */ }
            btn.click();
            return;
        }

        /* ========================================================================
         * AFTER ANSWERING — the game shows the result on
         * /vehicles/{id}/patient/{building} or /vehicles/{id}/gefangener/{building}
         * with "next vehicle in status 5" (#next-vehicle-fms-5) and a green
         * button back to the mission.
         * ==================================================================== */
        const answered = /^\/vehicles\/\d+\/(patient|gefangener)\/-?\d+\/?$/.test(path);
        const next = document.getElementById('next-vehicle-fms-5');
        if (answered || (next && /^\/vehicles\/\d+\/?$/.test(path) && !document.getElementById('h2_sprechwunsch'))) {
            const mode = ctx.cfg.after;
            if (mode === 'none') return;
            const close = () => {
                if (!IN_FRAME) return;
                if (typeof W.tellParent === 'function') W.tellParent('lightboxClose();');
                else if (W.parent && typeof W.parent.lightboxClose === 'function') W.parent.lightboxClose();
            };
            if ((mode === 'next' || mode === 'nextClose') && next) return next.click();
            if (mode === 'next' || mode === 'mission') {
                const back = document.querySelector('#iframe-inside-container a.btn.btn-success[href^="/missions/"]');
                if (back) return back.click();
            }
            close();
            return;
        }

        /* ========================================================================
         * MAP PAGE — counter button in the mission filter bar.
         * Starts from /api/vehicles once, then follows the game's live status
         * messages (radioMessage). Oldest request first.
         * ==================================================================== */
        if (path !== '/' || IN_FRAME || !ctx.cfg.counter) return;
        const row = document.querySelector('.mission-filters-row');
        if (!row) return;

        const open = new Map(); // vehicleId -> { caption, since }

        const btn = document.createElement('a');
        btn.href = '#';
        btn.className = 'btn btn-xs btn-default';
        btn.style.marginLeft = '4px';
        btn.onclick = (ev) => {
            ev.preventDefault();
            const first = [...open.entries()].sort((a, b) => a[1].since - b[1].since)[0];
            if (first && typeof W.lightboxOpen === 'function') W.lightboxOpen(`/vehicles/${first[0]}`);
        };
        row.appendChild(btn);

        function render() {
            const n = open.size;
            btn.classList.toggle('btn-success', n > 0);
            btn.classList.toggle('btn-default', n === 0);
            btn.innerHTML = `<span class="glyphicon glyphicon-earphone"></span> ${n}`;
            btn.title = n
                ? `${n} open spraakaanvra${n === 1 ? 'ag' : 'gen'}. Klik om de oudste te openen:\n`
                    + [...open.values()].sort((a, b) => a.since - b.since).slice(0, 15).map((v) => v.caption).join('\n')
                : 'Geen open spraakaanvragen';
        }

        function onStatus(id, fms, caption) {
            if (Number(fms) === 5) {
                if (!open.has(id)) open.set(id, { caption: caption || String(id), since: Date.now() });
            } else {
                open.delete(id);
            }
            render();
        }

        // The game defines radioMessage in its own scripts; wait for it.
        let tries = 0;
        (function hook() {
            const orig = W.radioMessage;
            if (typeof orig !== 'function') {
                if (++tries <= 30) setTimeout(hook, 1000);
                else ctx.warn('radioMessage not found; counter only updates on page load');
                return;
            }
            W.radioMessage = function (msg) {
                try {
                    if (msg && msg.type === 'vehicle_fms' && (msg.user_id == null || msg.user_id === W.user_id)) {
                        onStatus(Number(msg.id), msg.fms_real, msg.caption);
                    }
                } catch (e) { ctx.warn('radio hook failed', e); }
                return orig.apply(this, arguments);
            };
        })();

        render();
        fetch('/api/vehicles', { credentials: 'same-origin' })
            .then((r) => (r.ok ? r.json() : []))
            .then((list) => {
                for (const v of list) if (v.fms_real === 5 && !open.has(v.id)) open.set(v.id, { caption: v.caption, since: 0 });
                render();
            })
            .catch((e) => ctx.warn('could not load vehicles', e));
    },
});
