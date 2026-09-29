MKS.module({
    id: 'auto-load-vehicles',
    name: 'Ontbrekende voertuigen laden',
    icon: '⏬',
    category: 'missions',
    description: 'Klikt in het alarmeervenster automatisch op <i>"Voertuigenweergave limiet is bereikt! Laad ontbrekende voertuigen!"</i>, zodat je altijd de hele lijst ziet.',
    at: 'ready',
    frames: 'all',
    pages: /^\/missions\//,
    pageNote: 'Alleen in het alarmeervenster',
    live: true,
    settings: [],

    run() {
        // The button is a link to /missions/<id>/missing_vehicles?... The game's own
        // click handler fetches the missing rows via AJAX and appends them to the
        // vehicle table, so we just trigger that handler.
        const SEL = 'a[href*="/missing_vehicles"]';
        const clicked = new WeakSet();

        function load() {
            document.querySelectorAll(SEL).forEach((a) => {
                if (clicked.has(a)) return;
                clicked.add(a);
                a.click();
            });
        }

        load();

        // The button can appear later (tab switch, table reload), so keep watching.
        const obs = new MutationObserver(load);
        obs.observe(document.body, { childList: true, subtree: true });
        return { stop: () => obs.disconnect() };
    },
});
