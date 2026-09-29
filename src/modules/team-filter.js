MKS.module({
    id: 'team-filter',
    name: 'Teamfilter',
    icon: '🤝',
    category: 'missions',
    description: 'Een knop in de missiefilterbalk die alle gedeelde teaminzetten verbergt: noodgevallen, geplande inzetten en patiëntenvervoer. '
        + 'Je eigen geplande inzetten en vervoer blijven zichtbaar. Groen = tonen, rood = verbergen.',
    at: 'ready',
    frames: 'top',
    live: true,

    run(ctx) {
        const STORE_KEY = 'mks-team-filter';
        const LIST_IDS = [
            'mission_list_alliance',
            'mission_list_alliance_event',
            'mission_list_sicherheitswache_alliance',
            'mission_list_krankentransporte_alliance',
        ];
        const HIDDEN = 'mks-teamfilter-hidden';

        const row = document.querySelector('.mission-filters-row');
        if (!row) return;

        let off = false;
        try { off = localStorage.getItem(STORE_KEY) === 'off'; } catch (e) {}
        const save = () => { try { localStorage.setItem(STORE_KEY, off ? 'off' : 'on'); } catch (e) {} };

        const style = document.createElement('style');
        style.textContent = `
            .${HIDDEN} { display: none !important; }
            .mks-teamfilter { display: inline-block; margin-left: 4px; }
        `;
        document.head.appendChild(style);

        // No `mission_selection` class: the game binds its own toggle handler to it.
        const btn = document.createElement('a');
        btn.className = 'btn btn-xs mks-teamfilter';
        btn.href = '#';
        btn.onclick = (ev) => {
            ev.preventDefault();
            off = !off;
            save();
            apply();
        };
        row.appendChild(btn);

        function apply() {
            let count = 0;
            LIST_IDS.forEach((id) => {
                const list = document.getElementById(id);
                if (!list) return;
                list.querySelectorAll(':scope > .missionSideBarEntry').forEach((entry) => {
                    entry.classList.toggle(HIDDEN, off);
                    count++;
                });
            });
            btn.classList.toggle('btn-success', !off);
            btn.classList.toggle('btn-danger', off);
            btn.title = off ? 'Teaminzetten verborgen. Klik om te tonen.' : 'Klik om alle teaminzetten te verbergen.';
            btn.innerHTML = `<span class="glyphicon glyphicon-user"></span> Team ${count}`;
        }

        // The game adds and removes entries as missions spawn and finish.
        // setTimeout, not requestAnimationFrame: rAF stops in background tabs.
        let timer = null;
        const schedule = () => {
            if (timer) return;
            timer = setTimeout(() => { timer = null; apply(); }, 50);
        };
        const obs = new MutationObserver(schedule);
        LIST_IDS.forEach((id) => {
            const list = document.getElementById(id);
            if (list) obs.observe(list, { childList: true });
        });

        apply();

        return {
            stop() {
                obs.disconnect();
                clearTimeout(timer);
                btn.remove();
                style.remove();
                document.querySelectorAll(`.${HIDDEN}`).forEach((el) => el.classList.remove(HIDDEN));
            },
        };
    },
});
