MKS.module({
    id: 'auto-dispatch',
    name: 'Automatisch alarmeren',
    short: 'Auto-alarm',
    icon: '🤖',
    category: 'auto',
    description: 'Alarmeert je eigen nieuwe inzetten (rood, nog niets onderweg) voor je, één voor één, terwijl jij iets anders doet. '
        + 'Meldt het spel bij een inzet in rood "Missende voertuigen", dan stuurt het precies die erbij. '
        + 'Per inzet leest het de eisen uit de spelgegevens, laat het spel zelf de dichtstbijzijnde voertuigen kiezen (net als een inzetvoorstel) '
        + 'en drukt op Alarmeren. Alleen als alles beschikbaar is en binnen de maximale afstand; anders slaat het de inzet over. '
        + 'Spraakaanvragen (patiënten en gevangenen) krijgen vanzelf het beste passende ziekenhuis of de beste cel. '
        + 'Gebruikt de missiefilters: inzetten die je verbergt (ook met Creditfilter) worden niet aangeraakt. '
        + 'Start en stop met de knop in de missiefilterbalk of in het menu. Na herladen gaat het in hetzelfde tabblad vanzelf verder.',
    tagline: 'Handmatig starten',
    warning: '<b>Dit speelt het spel voor je.</b> Het verstuurt echte voertuigen naar echte inzetten en kiest ziekenhuizen en cellen, '
        + 'zonder dat jij elke keer kijkt. Automatisch spelen kan tegen de spelregels van Meldkamerspel zijn; je account is je eigen risico. '
        + 'Inzetten met eisen die het script niet kent (bijv. opleidingen of uitrusting) worden overgeslagen. '
        + 'Het draait zolang dit tabblad open is, ook na herladen; in een tweede tabblad start het niet.',
    confirmOn: 'Let op: deze module alarmeert inzetten automatisch voor je, met echte voertuigen.\n\n'
        + 'Automatisch spelen kan tegen de spelregels zijn. Er gebeurt pas iets als je op Start klikt.\n\nAanzetten?',
    at: 'ready',
    frames: 'all',
    pages: /^\/(missions\/\d+\/?|vehicles\/\d+(\/(patient|gefangener)\/-?\d+)?\/?)?$/,
    pageNote: 'Op de kaartpagina (en onzichtbaar in het alarmeer- en voertuigvenster)',
    live: true,
    settings: [
        { key: 'maxKm', label: 'Maximale afstand', type: 'number', default: 25, min: 1, max: 500, step: 1, unit: 'km',
            help: 'Hemelsbreed. Is één van de gekozen voertuigen verder weg, dan wordt de inzet overgeslagen.' },
        { key: 'needAll', label: 'Alleen als alles beschikbaar is', type: 'bool', default: true,
            help: 'Uit: stuurt ook als het spel meldt dat er voertuigen tekort zijn (stuurt dan wat er wel is).' },
        { key: 'topUp', label: 'Bijsturen bij rode melding', type: 'bool', default: true,
            help: 'Ook inzetten waar al voertuigen zijn, maar het spel "Missende voertuigen" meldt: stuurt alleen wat daar staat. '
                + 'Wacht tot er niets meer onderweg is, zodat er niets dubbel gaat.' },
        { key: 'patients', label: 'Ambulances voor patiënten', type: 'bool', default: true,
            help: 'Eén ambulance per onbehandelde patiënt die al bij de inzet staat.' },
        { key: 'onlyVisible', label: 'Alleen zichtbare inzetten', type: 'bool', default: true,
            help: 'Inzetten die je met de missiefilters verbergt, worden overgeslagen.' },
        { key: 'pauseSec', label: 'Pauze tussen inzetten', type: 'number', default: 4, min: 1, max: 60, step: 1, unit: 'sec' },
        { key: 'scanSec', label: 'Lijst opnieuw bekijken', type: 'number', default: 20, min: 5, max: 300, step: 5, unit: 'sec' },
        { key: 'retryMin', label: 'Overgeslagen inzet opnieuw proberen na', type: 'number', default: 5, min: 1, max: 120, step: 1, unit: 'min' },
        { key: 'maxPerHour', label: 'Maximaal per uur', type: 'number', default: 100, min: 1, max: 1000, step: 1 },
        { key: 'transport', label: 'Spraakaanvragen afhandelen', type: 'bool', default: true,
            help: 'Patiënten naar het beste passende ziekenhuis, gevangenen naar de beste cel: goedkoopst, dan dichtstbij. '
                + 'Volle, te dure of te verre bestemmingen en ziekenhuizen zonder de juiste afdeling vallen af.' },
        { key: 'destCost', label: 'Maximale kosten bestemming (team)', type: 'select', default: '20',
            options: [['0', '0 %'], ['10', '10 %'], ['20', '20 %'], ['30', '30 %'], ['40', '40 %'], ['50', '50 % (alles)']] },
        { key: 'destKm', label: 'Maximale afstand bestemming', type: 'number', default: 0, min: 0, max: 500, step: 5, unit: 'km', help: '0 = geen grens.' },
        { key: 'ownKm', label: 'Voorrang eigen ziekenhuis', type: 'number', default: 5, min: 0, max: 100, step: 1, unit: 'km',
            help: 'Bij gelijke kosten wint je eigen ziekenhuis of cel, zolang die niet meer dan zoveel km verder is.' },
        { key: 'release', label: 'Vrijlaten als er geen bestemming is', type: 'bool', default: false,
            help: 'Geen passend ziekenhuis of cel: patiënt niet vervoeren of gevangenen vrijlaten, zodat het voertuig weer vrij is. '
                + 'Kost je de credits voor dat vervoer. Uit: de spraakaanvraag blijft staan en komt in de tekortlijst.' },
        { key: 'reloadMin', label: 'Pagina verversen elke', type: 'number', default: 120, min: 0, max: 1440, step: 10, unit: 'min',
            help: 'Een lang open spelpagina wordt traag en zwaar. Ververst tussen twee rondes door en gaat daarna vanzelf verder. 0 = nooit '
                + '(behalve als het geheugen bijna vol is).' },
    ],

    run(ctx) {
        const W = ctx.W;
        const WORKER = 'mks-auto-worker:';
        const MSG = 'mks-auto-dispatch';
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const missionId = (location.pathname.match(/^\/missions\/(\d+)/) || [])[1];

        // Requirement key (einsaetze.json) -> AAO slot, or vt:<vehicle type id> for
        // vehicles that only exist as a type. Checked against the help pages.
        const MAP = {
            firetrucks: 'fire', battalion_chief_vehicles: 'elw', elw3: 'elw3', mobile_command_vehicles: 'elw2',
            platform_trucks: 'dlk', heavy_rescue_vehicles: 'rw', water_tankers: 'gwl2wasser', mobile_air_vehicles: 'gwa',
            gwmess: 'gwmesstechnik', hazmat_vehicles: 'gwgefahrgut', spokesman: 'spokesman', foam: 'foam', arff: 'arff',
            elw_airport: 'elw_airport', brush_truck: 'brush_truck', search_and_rescue: 'search_and_rescue', boats: 'boot',
            diver_units: 'gw_taucher', water_rescue: 'gw_wasserrettung',
            police_cars: 'fustw', police_motorcycle: 'police_motorcycle', police_helicopters: 'polizeihubschrauber',
            ovdp: 'ovd_p', hondengeleider: 'hondengeleider', lebefkw: 'lebefkw', grukw: 'grukw', gefkw: 'gefkw',
            bike_police: 'bike_police', police_horse: 'police_horse', military_police: 'military_police',
            bomb_disposal: 'bomb_disposal', bomb_disposal_robot: 'bomb_disposal_robot', traffic_patrol: 'traffic_patrol',
            traffic_unit: 'any_traffic_unit', car_carrier: 'car_carrier', car_carrier_large: 'car_carrier_large',
            coastal_boat: 'coastal_boat',
            at_c: 'at_c', at_o: 'at_o', at_m: 'at_m',
            industrial_response_engine: 'industrial_response_engine', industrial_response_fire_engine: 'industrial_response_fire_engine',
            hazard_response_material: 'hazard_response_material', hazard_response_suits: 'hazard_response_suits',
            hazard_response_disinfection: 'hazard_response_disinfection', hazard_response_disinfection_large: 'hazard_response_disinfection_large',
            railway_fire_engine: 'railway_fire_engine', railway_fire_equipment_container: 'railway_fire_equipment_container',
            railway_electric_response: 'railway_electric_response', thatched_firefighting: 'thatched_firefighting',
            livestock_hoist: 'livestock_hoist',
            water_needed: 'wasser_amount', foam_needed: 'foam_amount', min_pump_speed: 'water_damage_pump_value',
            ambulances: 'rtw',
            // "tankautospuiten of hulpverleningsvoertuigen" / "hulpverleningsvoertuigen of redvoertuigen"
            oneof_fire_engine_or_rescue: 'fire', oneof_fire_rescue_or_ladder: 'rw',
            mass_casualty: 'vt:101', mass_casualty_advanced: 'vt:100', traffic_inspector: 'vt:99',
            railway_elw: 'vt:145', railway_recovery: 'vt:146', wildfire_command: 'vt:87',
            disaster_response: 'vt:90', disaster_response_equipment: 'vt:91', drone_police: 'vt:128',
            bomb_disposal_dogs: 'vt:116', bomb_disposal_patrol: 'vt:119', bomb_disposal_diver: 'vt:117', bomb_disposal_boat: 'vt:118',
            railway_material: 'vt:148',
            // Not a slot on the game's preset form (or the slot picks another vehicle,
            // like care_service = Verzorger): send the exact vehicle type.
            care_service_command: 'vt:124', coastal_guard_boat: 'vt:77', coastal_helicopter: 'vt:80', drone_fire: 'vt:129',
            wasserwerfer: 'vt:84', detention_unit: 'vt:64', fire_aviation: 'vt:85', search_and_rescue_engine: 'vt:93', search_and_rescue_equipment: 'vt:94', rescue_dog_units: 'vt:97',
        };
        const VT_CAPTION = { 64: 'ME Aanhoudingseenheid', 77: 'KW-boot', 80: 'SAR-heli', 84: 'Waterwerper', 85: 'FBO-Heli', 124: 'DB-PC-LOG', 129: 'DB-TDV', 87: 'DA-LA-NB', 90: 'TS-STH', 91: 'HVH-STH', 93: 'TS-USAR', 94: 'VW-USAR', 97: 'DB–Speurhonden', 99: 'DB-VOA',
            100: 'GGB', 101: 'NHT', 116: 'DB-Explosievenhonden', 117: 'DB-Explosievenduikers', 118: 'BA-DDG', 119: 'DB-TEV', 128: 'DB-DRONE',
            145: 'OvD-ICB', 146: 'VW-VZ-ICB', 148: 'GM-ICB' };

        // Names the game uses in "Benodigde X" and in the red "Missende voertuigen"
        // box -> requirement key. Solved from 229 help pages against /einsaetze.json.
        const LABELS = {
            'tankautospuiten': 'firetrucks', 'slangenwagens': 'water_tankers', 'redvoertuigen': 'platform_trucks',
            "ovd-b's": 'battalion_chief_vehicles', 'water': 'water_needed', 'tankautospuiten (terreinvaardig)': 'brush_truck',
            'hulpverleningsvoertuigen': 'heavy_rescue_vehicles', 'signalisatie voertuigen': 'traffic_unit', 'noodhulpeenheden': 'police_cars',
            'schuimblusvoertuig': 'foam', 'svm': 'foam_needed', "hovd's": 'mobile_command_vehicles', 'biketeams': 'bike_police',
            'adviseurs gevaarlijke stoffen': 'hazmat_vehicles', 'me flexbussen': 'grukw', 'ambulances': 'ambulances', 'dm-p': 'police_motorcycle',
            'tankautospuiten of hulpverleningsvoertuigen': 'oneof_fire_engine_or_rescue', 'voorlichters': 'spokesman', 'da-la-nb': 'wildfire_command',
            'fbo-heli': 'fire_aviation', 'commandowagen': 'elw3', 'adembeschermingsvoertuigen': 'mobile_air_vehicles',
            'waterongevallenvoertuigen / oppervlaktereddingsteams': 'diver_units', 'min. pomp capaciteit': 'min_pump_speed',
            'officiers van dienst politie': 'ovdp', 'natuurbrandbestrijding uitrusting': 'wildfire_equipment', 'me commandovoertuigen': 'lebefkw',
            'crashtender': 'arff', 'afo/osc': 'elw_airport', 'bootaanhanger (woa of ba-rb)': 'boats', 'verkenningseenheden': 'gwmess',
            'hondengeleider': 'hondengeleider', 'aanhoudingseenheden': 'detention_unit', 'siv-p of dm-p': 'traffic_patrol', 'db-voa': 'traffic_inspector',
            'at operators': 'at_o', 'at commandanten': 'at_c', 'at materiaalwagens': 'at_m',
            'strandvoertuigen (quad, dat-rb of khv)': 'water_rescue', 'bereden brigade (paarden)': 'police_horse',
            'waterwerper': 'wasserwerfer', 'db-av': 'gefkw', 'rb-k of rb-g': 'coastal_boat', 'sar-heli(s)': 'coastal_helicopter', 'kw-boot': 'coastal_guard_boat',
            'politie helikopters': 'police_helicopters', 'nht': 'mass_casualty', 'ggb': 'mass_casualty_advanced', 'berger-k': 'car_carrier',
            'hulpverleningsvoertuigen of redvoertuigen': 'oneof_fire_rescue_or_ladder', 'kmar eenheid': 'military_police', 'db-tev': 'bomb_disposal_patrol',
            'db-icb of ts-spoor': 'railway_fire_engine', 'ovd-icb': 'railway_elw', 'ts-sth': 'disaster_response', 'hvh-sth': 'disaster_response_equipment',
            'berger-g': 'car_carrier_large', 'db-drone': 'drone_police', 'db-ri of ria': 'thatched_firefighting', 'sb-ba, sb-ib of as': 'industrial_response_engine',
            'db-tdv': 'drone_fire', 'gph, db-gp of rc-gaspakken': 'hazard_response_suits', 'db-bo, ts-bo of boh-dc': 'hazard_response_disinfection',
            'gsh, db-gs of rc-gevaarlijke stoffen': 'hazard_response_material', 'db-vi of via': 'livestock_hoist', 'db-pc-log': 'care_service_command',
            'dienstvoertuigen usar': 'search_and_rescue', 'db–speurhonden': 'rescue_dog_units', 'vw-usar': 'search_and_rescue_equipment',
            'ts-ib': 'industrial_response_fire_engine', 'db-go, ts-go of goh-dc': 'hazard_response_disinfection_large',
            'db-explosievenhonden': 'bomb_disposal_dogs', 'vw-vz-icb': 'railway_recovery', 'bm-vths of bu-vths': 'railway_electric_response',
            'gm-icb': 'railway_material', 'ts-usar': 'search_and_rescue_engine', 'hsh-icb of vw-hs': 'railway_fire_equipment_container',
            'eod eenheid': 'bomb_disposal', 'rc-explosievenrobot': 'bomb_disposal_robot', 'db-explosievenduikers': 'bomb_disposal_diver', 'ba-ddg': 'bomb_disposal_boat',
        };
        const plural = (s) => s.replace(/['’]s\b/g, '').replace(/(en|s)$/, '').trim();

        // One name from the red box -> requirement key. Tries the exact name, a name
        // with extra words after it ("Berger-K om het slepen te beginnen"),
        // singular/plural, and finally a vehicle type caption from the page.
        function keyForName(name, typeIds) {
            const n = name.toLowerCase().replace(/\.$/, '').replace(/\s+/g, ' ').trim();
            if (LABELS[n]) return LABELS[n];
            const prefix = Object.keys(LABELS).filter((l) => n.startsWith(`${l} `)).sort((a, b) => b.length - a.length)[0];
            if (prefix) return LABELS[prefix];
            const p = plural(n);
            const loose = Object.keys(LABELS).find((l) => plural(l) === p);
            if (loose) return LABELS[loose];
            if (typeIds && typeIds[n]) return `vt:${typeIds[n]}`;
            return null;
        }

        // Text of the red box -> { slots, vt, vtCaptions, unknown }.
        // "Missende voertuigen: 1 DB-PC-LOG, 2 SB-BA, SB-IB of AS, 2.000 Water"
        // Items start with a number; names can contain commas themselves.
        function fromMissing(text, typeIds) {
            const out = { slots: {}, vt: {}, vtCaptions: {}, unknown: [] };
            const body = String(text).replace(/\s+/g, ' ').replace(/^[^:]*:\s*/, '').trim();
            for (const item of body.split(/,\s*(?=[\d.]+\s)/)) {
                const m = item.trim().match(/^([\d.]+)\s+(.+?)\.?$/);
                if (!m) { if (item.trim()) out.unknown.push(item.trim()); continue; }
                const count = Number(m[1].replace(/\./g, ''));
                const key = keyForName(m[2], typeIds);
                const to = key && (key.startsWith('vt:') ? key : MAP[key]);
                if (!to) { out.unknown.push(m[2].trim()); continue; }
                if (to.startsWith('vt:')) {
                    const id = to.slice(3);
                    out.vt[id] = (out.vt[id] || 0) + count;
                    out.vtCaptions[id] = VT_CAPTION[id] || m[2].trim();
                } else out.slots[to] = (out.slots[to] || 0) + count;
            }
            return out;
        }

        const vehicleId = (location.pathname.match(/^\/vehicles\/(\d+)/) || [])[1];
        if (missionId || vehicleId) {
            // Inside a mission or vehicle window: only act in our own hidden iframe.
            if (window.top === window.self || !window.name.startsWith(WORKER)) return { stop() {} };
            if (missionId) worker();
            else if (/^\/vehicles\/\d+\/?$/.test(location.pathname)) transportWorker();
            return { stop() {} };
        }
        if (window.top !== window.self) return { stop() {} };
        return controller();

        /* ========================================================================
         * TRANSPORT WORKER — hidden iframe on /vehicles/:id for a vehicle in
         * status 5. Same choice as the Bestemmingfilter module: drop full,
         * too expensive, too far and wrong-department destinations, then
         * cheapest first, then nearest (own buildings get ownKm head start).
         * Clicking the button is the game's own GET to /patient/:id or
         * /gefangener/:id.
         * ==================================================================== */
        async function transportWorker() {
            let job;
            try { job = JSON.parse(window.name.slice(WORKER.length)); } catch (e) { return; }
            const report = (result, detail = {}) => window.parent.postMessage({ [MSG]: true, id: job.id, result, ...detail }, location.origin);
            const doneKey = `mks-auto-sent-v${job.id}-${job.token}`;
            if (job.kind !== 'transport' || String(job.id) !== vehicleId) return;
            try { if (sessionStorage.getItem(doneKey)) return; } catch (e) { /* ignore */ }
            const go = (a, detail) => {
                try { sessionStorage.setItem(doneKey, '1'); } catch (e) { /* ignore */ }
                report('sending', detail);
                a.click();
            };

            try {
                if (document.readyState !== 'complete') await new Promise((r) => window.addEventListener('load', r, { once: true }));
                await sleep(300);
                if (!document.getElementById('h2_sprechwunsch')) { report('skip', { reason: 'geen spraakaanvraag (meer)', gone: true }); return; }

                const all = destinations();
                const why = {};
                const fit = all.filter((c) => {
                    const r = destReason(c, job);
                    if (r) why[r] = (why[r] || 0) + 1;
                    return !r;
                });
                const rank = (c) => (isNaN(c.dist) ? 1e9 : c.dist) - (c.own ? job.ownKm : 0);
                const best = fit.sort((x, y) => x.cost - y.cost || rank(x) - rank(y))[0];
                if (best) {
                    go(best.a, { mode: best.kind, dest: best.name, km: best.dist, cost: best.cost });
                    return;
                }

                // Nothing fits. Kind from the page when there are no candidates at all.
                // "...met een specialisatie vervoerd worden: Cardiologie" names the department.
                const kind = all[0]?.kind || (document.querySelector('a[href*="/gefangener/"]') ? 'cell' : 'hospital');
                const dep = ((document.querySelector('.alert')?.textContent || '').replace(/\s+/g, ' ').match(/worden:\s*([^.]+)/) || [])[1];
                const need = kind === 'cell'
                    ? (why.vol ? 'Cellen (alles vol)' : 'Cel binnen kosten/afstand')
                    : why['geen afdeling'] && !why.vol ? `Ziekenhuis met afdeling ${dep ? dep.trim() : '(onbekend)'}`
                        : why.vol ? 'Ziekenhuisbedden (alles vol)' : 'Ziekenhuis binnen kosten/afstand';
                const reasons = Object.entries(why).map(([k, n]) => `${n} ${k}`).join(', ') || 'geen bestemmingen';
                const release = document.querySelector(`a[href$="/${kind === 'cell' ? 'gefangener' : 'patient'}/-1"]`);
                if (job.release && release) {
                    go(release, { mode: 'release', dest: kind === 'cell' ? 'gevangenen vrijgelaten' : 'patiënt niet vervoerd', unknownNeeds: [need] });
                    return;
                }
                report('skip', { reason: `geen passende ${kind === 'cell' ? 'cel' : 'ziekenhuis'} (${reasons})`, unknownNeeds: [need] });
            } catch (e) {
                ctx.err(e);
                report('error', { reason: e.message || String(e) });
            }
        }

        // Destination rows, as the Bestemmingfilter module reads them.
        function destinations() {
            const num = (s) => {
                const m = String(s).replace(/\./g, '').match(/-?\d+(?:,\d+)?/);
                return m ? parseFloat(m[0].replace(',', '.')) : NaN;
            };
            const txt = (tr, i) => (i >= 0 && tr.cells[i] ? tr.cells[i].textContent.trim() : '');
            const isRed = (el) => !!el && (el.classList.contains('btn-danger') || el.classList.contains('danger') || el.classList.contains('label-danger'));
            const DEST = 'a[href*="/patient/"]:not([href$="/-1"]), a[href*="/gefangener/"]:not([href$="/-1"])';
            const out = [];
            const seen = new Set();
            for (const table of document.querySelectorAll('table')) {
                const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim().toLowerCase());
                const iDist = heads.findIndex((h) => h.startsWith('afstand'));
                if (iDist < 0) continue;
                const iFree = heads.findIndex((h) => h.startsWith('vrij'));
                const iCost = heads.findIndex((h) => h.startsWith('kosten') || h.startsWith('belasting'));
                const iDep = heads.findIndex((h) => h.startsWith('afdeling'));
                for (const tr of table.querySelectorAll('tbody > tr')) {
                    const a = tr.querySelector(DEST);
                    if (!a) continue;
                    seen.add(a);
                    const kind = /\/gefangener\//.test(a.getAttribute('href')) ? 'cell' : 'hospital';
                    const free = iFree >= 0 ? num(txt(tr, iFree).split('/')[0]) : Infinity;
                    const red = isRed(a) || isRed(tr) || (iFree >= 0 && isRed(tr.cells[iFree] && tr.cells[iFree].querySelector('.label')));
                    out.push({
                        // The name cell also holds distance and bed badges: keep the part before them.
                        a, kind, own: table.id === 'own-hospitals', name: txt(tr, 0).replace(/\s+/g, ' ').split(/\s\d+(?:,\d+)?\s*km\b/)[0],
                        dist: num(txt(tr, iDist)),
                        free: red ? 0 : (isNaN(free) ? Infinity : free),
                        cost: iCost >= 0 ? num(txt(tr, iCost)) || 0 : 0,
                        dep: kind === 'cell' || iDep < 0 || !!(tr.cells[iDep] && tr.cells[iDep].querySelector('.label-success')),
                    });
                }
            }
            // Cells can also be loose buttons with distance, free cells and cost in the text.
            for (const a of document.querySelectorAll('a[href*="/gefangener/"]:not([href$="/-1"])')) {
                if (seen.has(a)) continue;
                const t = a.textContent.replace(/\s+/g, ' ');
                const km = t.match(/(\d+(?:[.,]\d+)?)\s*km/);
                const pct = t.match(/(\d+)\s*%/);
                const freeTxt = t.match(/vrij\w*\s*(?:cel\w*)?\s*:?\s*(\d+)/i);
                out.push({
                    a, kind: 'cell', own: !pct, name: t.trim().slice(0, 60),
                    dist: km ? parseFloat(km[1].replace(',', '.')) : NaN,
                    free: isRed(a) ? 0 : (freeTxt ? Number(freeTxt[1]) : Infinity),
                    cost: pct ? Number(pct[1]) : 0,
                    dep: true,
                });
            }
            return out;
        }

        function destReason(c, job) {
            if (c.a.classList.contains('disabled')) return 'niet beschikbaar';
            if (c.free <= 0) return 'vol';
            if (c.kind === 'hospital' && !c.dep) return 'geen afdeling';
            if (c.cost > job.destCost) return 'te duur';
            if (job.destKm > 0 && c.dist > job.destKm) return 'te ver';
            return '';
        }

        /* ========================================================================
         * WORKER — runs in the hidden iframe on /missions/:id. The controller
         * puts the job in window.name. Selection is the game's own AAO code
         * (aaoClickHandler) on a hidden preset element, so nearest vehicles,
         * trailers, "X of Y" groups and ignore_aao work exactly as in the game.
         * ==================================================================== */
        async function worker() {
            let job;
            try { job = JSON.parse(window.name.slice(WORKER.length)); } catch (e) { return; }
            const report = (result, detail = {}) => window.parent.postMessage({ [MSG]: true, id: job.id, result, ...detail }, location.origin);
            // window.name survives the post after Alarmeren: never act twice on one job.
            const doneKey = `mks-auto-sent-${job.id}-${job.token}`;
            if (job.kind === 'transport' || String(job.id) !== missionId) return;
            try { if (sessionStorage.getItem(doneKey)) return; } catch (e) { /* ignore */ }

            try {
                // The game finishes its vehicle table (distances, AAO data) on load.
                if (document.readyState !== 'complete') await new Promise((r) => window.addEventListener('load', r, { once: true }));
                await sleep(300);

                // The red "Missende voertuigen" box is what the mission still needs
                // now. It only counts vehicles that have arrived, so wait while
                // anything is still driving there.
                const box = document.getElementById('missing_text');
                const missingText = box && box.offsetParent !== null ? box.textContent.replace(/\s+/g, ' ').trim() : '';
                const driving = !!document.querySelector('#mission_vehicle_driving tbody tr');
                const present = !!document.querySelector('#mission_vehicle_at_mission tbody tr');
                const mode = missingText ? 'missing' : 'full';
                if (driving) { report('wait', { reason: 'wacht: voertuigen onderweg' }); return; }
                if (mode === 'full' && present) { report('skip', { reason: 'al voertuigen ter plaatse, geen rode melding' }); return; }
                if (mode === 'missing' && !job.topUp) { report('skip', { reason: 'rode melding, bijsturen staat uit' }); return; }
                await loadAllVehicles();

                let plan = { slots: job.slots || {}, vt: job.vt || {}, vtCaptions: job.vtCaptions || {} };
                if (mode === 'missing') {
                    // Vehicle type captions in this window, for names that are a type ("DB-PC-LOG").
                    const typeIds = {};
                    document.querySelectorAll('input.vehicle_checkbox[vehicle_type_id]').forEach((c) => {
                        const cap = c.closest('tr')?.getAttribute('vehicle_type');
                        if (cap) typeIds[cap.toLowerCase()] = c.getAttribute('vehicle_type_id');
                    });
                    // Only the vehicles part: personnel or other lines are unknown, not ignored.
                    const parts = [...box.querySelectorAll('[data-requirement-type]')];
                    const vehText = parts.length ? parts.filter((p) => p.getAttribute('data-requirement-type') === 'vehicles').map((p) => p.textContent).join(', ') : missingText;
                    plan = fromMissing(vehText, typeIds);
                    parts.filter((p) => p.getAttribute('data-requirement-type') !== 'vehicles')
                        .forEach((p) => plan.unknown.push(p.textContent.replace(/\s+/g, ' ').trim()));
                    if (plan.unknown.length) {
                        report('skip', { reason: `rode melding, kan niet sturen: ${plan.unknown.join(', ')}`, unknownNeeds: plan.unknown });
                        return;
                    }
                }

                const attrs = { ...plan.slots };
                if (job.patients) {
                    const m = (document.getElementById('patient_button_text')?.textContent || '').match(/(\d+)\s+onbehandelde/i);
                    const n = m ? Number(m[1]) : 0;
                    if (n > (Number(attrs.rtw) || 0)) attrs.rtw = n;
                }
                if (!Object.keys(attrs).length && !Object.keys(plan.vt).length) { report('skip', { reason: 'niets te sturen' }); return; }

                const el = document.createElement('a');
                el.id = 'aao_mks_auto';
                el.className = 'aao_btn';
                el.style.display = 'none';
                el.setAttribute('aao_id', 'mks_auto');
                el.setAttribute('reset', 'true');
                el.setAttribute('building_ids', '');
                el.setAttribute('equipment_mode', '0');
                el.setAttribute('custom', '{}');
                for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
                if (Object.keys(plan.vt).length) {
                    el.setAttribute('vehicle_type_ids', JSON.stringify(plan.vt));
                    el.setAttribute('vehicle_type_captions', JSON.stringify(plan.vtCaptions));
                }
                document.body.appendChild(el);

                // On a shortage the game calls alert(): catch the text instead of a popup.
                let shortage = '';
                const realAlert = W.alert;
                W.alert = (t) => { shortage += String(t); };
                try {
                    W.aaoClickHandler(el);
                } catch (e) {
                    // aao_update_after_click() does not know our fake preset; the selection is already made.
                    ctx.warn('aaoClickHandler', e);
                } finally {
                    W.alert = realAlert;
                    el.remove();
                }
                await sleep(400);

                const picked = [...new Map([...document.querySelectorAll('input.vehicle_checkbox:checked')].map((c) => [c.value, c])).values()];
                const reset = () => { try { W.vehicleSelectionReset(); } catch (e) { picked.forEach((c) => c.checked && c.click()); } };
                if (!picked.length) { report('skip', { reason: shortage ? `tekort: ${clean(shortage)}` : 'geen voertuigen beschikbaar', shortText: shortage }); return; }
                if (shortage && job.needAll) { reset(); report('skip', { reason: `tekort: ${clean(shortage)}`, shortText: shortage }); return; }
                const dist = (c) => Number(c.getAttribute('data-distance')) || 0;
                const far = Math.max(...picked.map(dist));
                if (far > job.maxKm) {
                    // Which types had to come from too far: those are the ones to buy closer by.
                    const farTypes = {};
                    picked.filter((c) => dist(c) > job.maxKm).forEach((c) => {
                        const t = c.closest('tr')?.getAttribute('vehicle_type') || `type ${c.getAttribute('vehicle_type_id')}`;
                        farTypes[t] = (farTypes[t] || 0) + 1;
                    });
                    reset();
                    report('skip', { reason: `voertuig op ${far.toFixed(1)} km`, farTypes, shortText: shortage });
                    return;
                }

                const btn = document.getElementById('alert_btn');
                if (!btn) { reset(); report('error', { reason: 'knop Alarmeren niet gevonden' }); return; }
                try { sessionStorage.setItem(doneKey, '1'); } catch (e) { /* ignore */ }
                report('sending', { mode, n: picked.length, km: far, short: shortage ? clean(shortage) : '', shortText: shortage });
                btn.click();
            } catch (e) {
                ctx.err(e);
                report('error', { reason: e.message || String(e) });
            }
        }

        function clean(t) { return String(t).replace(/\s+/g, ' ').trim().slice(0, 160); }

        // Same as the "load missing vehicles" module: click until the list stops growing.
        async function loadAllVehicles() {
            const count = () => document.querySelectorAll('input.vehicle_checkbox').length;
            let last = -1, stable = 0;
            for (let i = 0; i < 40 && stable < 3; i++) {
                const more = document.querySelector('a[href*="/missing_vehicles"]');
                if (more && !more.dataset.mksClicked) { more.dataset.mksClicked = '1'; more.click(); stable = 0; }
                await sleep(250);
                const n = count();
                stable = n === last && !document.querySelector('a[href*="/missing_vehicles"]:not([data-mks-clicked])') ? stable + 1 : 0;
                last = n;
            }
        }

        /* ========================================================================
         * CONTROLLER — map page. Picks own unattended missions, turns their
         * requirements (/einsaetze.json) into AAO slots and hands one at a
         * time to a hidden iframe.
         * ==================================================================== */
        function controller() {
            const DATA_KEY = 'mks.autoDispatch.missions.v1';
            const DATA_MS = 24 * 3600 * 1000;

            let running = false;
            let busy = false;
            let stopped = false;
            let timer = null;
            let heartbeat = null;
            let missions = null;
            let errorStreak = 0;

            /* --------------------------------------------------------------------
             * SESSION — kept in sessionStorage, so it survives a reload of this
             * tab (auto mode resumes by itself) while a new tab starts clean.
             * A lock with a heartbeat in localStorage keeps it to one tab.
             * ------------------------------------------------------------------ */
            const SESSION_KEY = 'mks-auto-dispatch.session';
            const LOCK_KEY = 'mks-auto-dispatch.lock';
            const INSTANCE = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
            const loadedAt = Date.now();
            let saved = null;
            try { saved = JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch (e) { saved = null; }
            saved = saved || {};
            const tried = new Map(saved.tried || []); // mission id or v<vehicle id> -> time of last attempt
            const sent = saved.sent || [];            // send times, for the hourly cap
            const log = (saved.log || []).map((l) => ({ ...l, at: new Date(l.at) }));
            const stats = { sent: 0, skipped: 0, errors: 0, transports: 0, ...(saved.stats || {}) };

            function saveSession() {
                const now = Date.now();
                try {
                    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
                        running, stats, sent,
                        tried: [...tried].filter(([, t]) => now - t < 3 * 3600000),
                        log: log.slice(0, 100),
                    }));
                } catch (e) { /* ignore */ }
            }

            // Another live auto mode (other tab), or null.
            function lockHolder() {
                try {
                    const l = JSON.parse(localStorage.getItem(LOCK_KEY));
                    return l && l.inst !== INSTANCE && Date.now() - l.at < 15000 ? l : null;
                } catch (e) { return null; }
            }
            const takeLock = () => { try { localStorage.setItem(LOCK_KEY, JSON.stringify({ inst: INSTANCE, at: Date.now() })); } catch (e) { /* ignore */ } };
            function releaseLock() {
                try {
                    const l = JSON.parse(localStorage.getItem(LOCK_KEY));
                    if (l && l.inst === INSTANCE) localStorage.removeItem(LOCK_KEY);
                } catch (e) { /* ignore */ }
            }
            const onPageHide = () => { saveSession(); releaseLock(); };
            window.addEventListener('pagehide', onPageHide);

            function addLog(name, text, tone) {
                log.unshift({ at: new Date(), name, text, tone });
                if (log.length > 200) log.pop();
                saveSession();
                ctx.refresh();
            }

            /* --------------------------------------------------------------------
             * TRANSPORT REQUESTS — vehicles in status 5, oldest first. Filled
             * from /api/vehicles, then kept current by the game's radio messages
             * (same hook as the Verbeterde spraakaanvragen module).
             * ------------------------------------------------------------------ */
            const talk = new Map(); // vehicle id -> { caption, since }
            let talkLoaded = 0;
            async function loadTalk() {
                const list = await fetch('/api/vehicles', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : []));
                const now = Date.now();
                const live = new Set();
                for (const v of list) {
                    if (v.fms_real !== 5) continue;
                    live.add(String(v.id));
                    if (!talk.has(String(v.id))) talk.set(String(v.id), { caption: v.caption, since: now });
                }
                for (const id of [...talk.keys()]) if (!live.has(id)) talk.delete(id);
                talkLoaded = now;
            }
            let radioTries = 0;
            (function hookRadio() {
                const orig = W.radioMessage;
                if (typeof orig !== 'function') {
                    if (++radioTries <= 30 && !stopped) setTimeout(hookRadio, 1000);
                    return;
                }
                W.radioMessage = function (msg) {
                    try {
                        if (!stopped && msg && msg.type === 'vehicle_fms' && (msg.user_id == null || msg.user_id === W.user_id)) {
                            const id = String(msg.id);
                            if (Number(msg.fms_real) === 5) { if (!talk.has(id)) talk.set(id, { caption: msg.caption || id, since: Date.now() }); } else talk.delete(id);
                        }
                    } catch (e) { ctx.warn('radio hook failed', e); }
                    return orig.apply(this, arguments);
                };
            })();

            /* --------------------------------------------------------------------
             * NEEDS — every reason a mission could not be (fully) sent, kept
             * across sessions, so the dashboard shows which vehicle types to buy.
             *   short: the game had none of that type available
             *   far:   only available beyond the maximum distance
             *   other: a requirement this script cannot send (training, equipment)
             * Each mission counts once per type, however often it is retried.
             * ------------------------------------------------------------------ */
            const NEEDS_KEY = 'mks.autoDispatch.needs.v1';
            const UNKNOWN_LABEL = {
                wildfire_equipment: 'Natuurbrandbestrijding uitrusting', railway_material: 'Spoormaterieel',
                search_and_rescue_engine: 'TS-USAR', search_and_rescue_equipment: 'USAR uitrusting', rescue_dog_units: 'Speurhonden',
            };
            let needs;
            try { needs = JSON.parse(GM_getValue(NEEDS_KEY, 'null')); } catch (e) { needs = null; }
            if (!needs || !needs.types) needs = { since: Date.now(), types: {}, other: {} };
            const saveNeeds = () => { try { GM_setValue(NEEDS_KEY, JSON.stringify(needs)); } catch (e) { ctx.warn('needs not saved', e); } };

            function addNeed(kind, name, units, id, missionName) {
                const bucket = kind === 'other' ? needs.other : needs.types;
                const t = bucket[name] || (bucket[name] = { missions: 0, short: 0, far: 0, units: 0, ids: [], last: 0, example: '' });
                if (t.ids.includes(id)) return;
                t.ids.push(id);
                if (t.ids.length > 100) t.ids.shift();
                t.missions++;
                if (kind === 'short') t.short++;
                if (kind === 'far') t.far++;
                t.units += units || 0;
                t.last = Date.now();
                t.example = missionName;
            }

            // "Niet beschikbaar: 1 AT-Commandant. Niet beschikbaar: 2 TS 8/9. "
            function recordShortage(text, id, name) {
                if (!text) return;
                let hit = false;
                for (const m of String(text).matchAll(/beschikbaar:\s*(\d+)\s+([^.\n]+)/gi)) {
                    addNeed('short', m[2].trim(), Number(m[1]), id, name);
                    hit = true;
                }
                if (!hit) addNeed('short', clean(text), 0, id, name);
            }

            function recordResult(res, id, name) {
                recordShortage(res.shortText, id, name);
                (res.unknownNeeds || []).forEach((u) => addNeed('other', u, 0, id, name));
                for (const [type, n] of Object.entries(res.farTypes || {})) addNeed('far', type, n, id, name);
                saveNeeds();
            }

            // /einsaetze.json is ~2.7 MB: keep only the requirements, once a day.
            async function loadMissions() {
                if (missions) return missions;
                try {
                    const c = JSON.parse(GM_getValue(DATA_KEY, 'null'));
                    if (c && Date.now() - c.at < DATA_MS) return (missions = c.m);
                } catch (e) { /* refetch */ }
                ctx.status('Inzetgegevens ophalen…', { tone: 'busy', dock: true });
                const res = await fetch('/einsaetze.json', { credentials: 'same-origin' });
                if (!res.ok) throw new Error(`/einsaetze.json: ${res.status}`);
                const m = {};
                for (const e of await res.json()) m[e.id] = e.requirements || {};
                GM_setValue(DATA_KEY, JSON.stringify({ at: Date.now(), m }));
                return (missions = m);
            }

            const attr = (el, n) => (el.getAttribute(n) || '').replace(/^null$/, '');
            function keyOf(entry) {
                const idx = attr(entry, 'data-overlay-index');
                const ov = attr(entry, 'data-additive-overlays');
                return `${entry.getAttribute('mission_type_id')}${idx !== '' ? `-${idx}` : ''}${ov ? `/${ov}` : ''}`;
            }

            // Training keys as the game's education filter names them.
            const EDUCATION = { wildfire: 'Handcrew', care_service: 'Verzorger', clean_service: 'Hygiënemedewerker',
                hazard_material_response: 'Gevaarlijke Stoffen Eenheid', hazard_suits_response: 'Ontsmettings Eenheid', wechsellader: 'Brandweerchauffeur-zwaar' };

            // Requirements -> { slots, vt } plus readable names of what cannot be sent.
            function plan(req) {
                const slots = {}, vt = {}, vtCaptions = {}, unknown = [];
                for (const [k, v] of Object.entries(req)) {
                    if (k === 'personnel_educations' && v && typeof v === 'object') {
                        for (const [e, n] of Object.entries(v)) unknown.push(`Opleiding ${EDUCATION[e] || e} (${n} pers.)`);
                        continue;
                    }
                    if (typeof v !== 'number') { unknown.push(UNKNOWN_LABEL[k] || k); continue; }
                    if (v <= 0) continue;
                    const to = MAP[k];
                    if (!to) unknown.push(UNKNOWN_LABEL[k] || k);
                    else if (to.startsWith('vt:')) {
                        const id = to.slice(3);
                        vt[id] = (vt[id] || 0) + v;
                        vtCaptions[id] = VT_CAPTION[id] || id;
                    } else slots[to] = (slots[to] || 0) + v;
                }
                return { slots, vt, vtCaptions, unknown };
            }

            // The red "Missende voertuigen" box the game also shows in the mission list.
            const sidebarMissing = (e) => (document.getElementById(`mission_missing_${e.getAttribute('mission_id')}`)?.textContent || '').replace(/\s+/g, ' ').trim();

            function candidates() {
                const now = Date.now();
                return [...document.querySelectorAll('#mission_list .missionSideBarEntry[mission_type_id]')].filter((e) => {
                    const red = ctx.cfg.topUp && sidebarMissing(e);
                    if (e.getAttribute('data-mission-state-filter') !== 'unattended' && !red) return false;
                    if (ctx.cfg.onlyVisible && getComputedStyle(e).display === 'none') return false;
                    const t = tried.get(e.getAttribute('mission_id'));
                    return !t || now - t > ctx.cfg.retryMin * 60000;
                });
            }

            const titleOf = (e) => {
                try { return JSON.parse(e.getAttribute('data-sortable-by')).caption; } catch (x) { return e.getAttribute('search_attribute') || e.getAttribute('mission_id'); }
            };

            // One mission in a hidden iframe. Resolves with the worker's report.
            function runJob(job) {
                return new Promise((resolve) => {
                    const frame = document.createElement('iframe');
                    frame.name = WORKER + JSON.stringify(job);
                    frame.setAttribute('aria-hidden', 'true');
                    frame.tabIndex = -1;
                    frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:1200px;height:900px;border:0;visibility:hidden;pointer-events:none';
                    let result = null;
                    let finish, poll;
                    let done = false;
                    const cleanup = (r) => {
                        if (done) return;
                        done = true;
                        clearTimeout(finish);
                        clearInterval(poll);
                        window.removeEventListener('message', onMsg);
                        setTimeout(() => frame.remove(), 200);
                        resolve(r);
                    };
                    const transport = job.kind === 'transport';
                    function onMsg(ev) {
                        if (ev.origin !== location.origin || ev.source !== frame.contentWindow || !ev.data || !ev.data[MSG]) return;
                        result = ev.data;
                        if (result.result !== 'sending') return cleanup(result);
                        // Confirmed by our own list (mission no longer red, vehicle no longer
                        // status 5) or by the page the frame lands on afterwards. A top-up
                        // starts from a mission that is not red, so it waits for the page.
                        clearTimeout(finish);
                        finish = setTimeout(() => cleanup({ ...result, result: 'unconfirmed' }), 20000);
                        poll = setInterval(() => {
                            if (transport) { if (!talk.has(String(job.id))) cleanup({ ...result, result: 'sent' }); return; }
                            if (result.mode === 'missing') return;
                            const entry = document.getElementById(`mission_${job.id}`);
                            if (!entry || entry.getAttribute('data-mission-state-filter') !== 'unattended') cleanup({ ...result, result: 'sent' });
                        }, 500);
                        frame.addEventListener('load', () => {
                            let ok = false;
                            try {
                                ok = transport
                                    ? /^\/vehicles\/\d+\/(patient|gefangener)\/-?\d+/.test(frame.contentWindow.location.pathname)
                                    : !!frame.contentDocument.querySelector('#mission_vehicle_driving tbody tr, #mission_vehicle_at_mission tbody tr');
                            } catch (e) { /* ignore */ }
                            if (ok) cleanup({ ...result, result: 'sent' });
                        }, { once: true });
                    }
                    window.addEventListener('message', onMsg);
                    finish = setTimeout(() => cleanup({ result: 'error', reason: `${transport ? 'voertuigvenster' : 'alarmeervenster'} reageerde niet (60 s)` }), 60000);
                    frame.src = transport ? `/vehicles/${job.id}` : `/missions/${job.id}`;
                    document.body.appendChild(frame);
                });
            }

            // Answer transport requests first: they keep ambulances and police cars busy.
            async function transports() {
                if (!ctx.cfg.transport) return;
                if (Date.now() - talkLoaded > 5 * 60000) await loadTalk();
                const now = Date.now();
                const todo = [...talk].sort((a, b) => a[1].since - b[1].since)
                    .filter(([vid]) => { const t = tried.get(`v${vid}`); return !t || now - t > ctx.cfg.retryMin * 60000; });
                for (const [vid, v] of todo) {
                    if (!running || stopped) return;
                    tried.set(`v${vid}`, Date.now());
                    status(`Spraakaanvraag: ${v.caption}`, 'busy');
                    const res = await runJob({ kind: 'transport', id: vid, token: Date.now(), destCost: Number(ctx.cfg.destCost),
                        destKm: Number(ctx.cfg.destKm), ownKm: Number(ctx.cfg.ownKm), release: ctx.cfg.release });
                    recordResult(res, `v${vid}`, v.caption);
                    if (res.result === 'sent' || res.result === 'unconfirmed') {
                        stats.transports++;
                        errorStreak = 0;
                        talk.delete(vid);
                        const where = res.mode === 'release' ? res.dest
                            : `naar ${res.dest}${isNaN(res.km) ? '' : `, ${Number(res.km).toFixed(1)} km`}${res.cost ? `, ${res.cost}%` : ''}`;
                        addLog(v.caption, `${res.result === 'sent' ? '' : '(niet bevestigd) '}${where}`, res.mode === 'release' ? 'warn' : 'ok');
                    } else if (res.result === 'skip' && res.gone) {
                        talk.delete(vid);
                    } else if (res.result === 'skip') {
                        stats.skipped++;
                        errorStreak = 0;
                        addLog(v.caption, `spraakaanvraag blijft staan: ${res.reason}`, 'warn');
                    } else {
                        stats.errors++;
                        addLog(v.caption, `fout: ${res.reason}`, 'error');
                        if (++errorStreak >= 3) { stop('Gestopt na 3 fouten op rij. Zie logboek.'); return; }
                    }
                    await sleep(ctx.cfg.pauseSec * 1000);
                }
            }

            // A game page that stays open for hours gets slow and heavy. Reload
            // between two rounds; the session makes auto mode resume afterwards.
            function maybeReload() {
                if (!running || stopped) return;
                const mem = W.performance && W.performance.memory;
                const heavy = !!(mem && mem.jsHeapSizeLimit && mem.usedJSHeapSize > 0.7 * mem.jsHeapSizeLimit);
                const old = ctx.cfg.reloadMin > 0 && Date.now() - loadedAt > ctx.cfg.reloadMin * 60000;
                if (!heavy && !old) return;
                addLog('—', heavy ? 'pagina ververst (geheugen bijna vol), gaat zo verder' : 'pagina ververst, gaat zo verder', 'idle');
                onPageHide();
                location.reload();
            }

            async function cycle() {
                if (!running || busy || stopped) return;
                busy = true;
                try {
                    await transports();
                    const req = await loadMissions();
                    for (const entry of candidates()) {
                        // A round over many missions takes minutes: answer new
                        // transport requests in between, not only at the start.
                        await transports();
                        if (!running || stopped) break;
                        const hourAgo = Date.now() - 3600000;
                        while (sent.length && sent[0] < hourAgo) sent.shift();
                        if (sent.length >= ctx.cfg.maxPerHour) { status(`Maximum van ${ctx.cfg.maxPerHour} per uur bereikt, wacht…`, 'warn'); break; }

                        const id = entry.getAttribute('mission_id');
                        const name = titleOf(entry);
                        tried.set(id, Date.now());
                        const red = ctx.cfg.topUp && sidebarMissing(entry);
                        const r = req[keyOf(entry)];
                        const p = r ? plan(r) : { slots: {}, vt: {}, vtCaptions: {}, unknown: [] };
                        // With a red box the worker sends only what that box lists, so
                        // unknown full requirements do not matter.
                        if (!r && !red) {
                            stats.skipped++;
                            addNeed('other', 'Onbekend inzettype (inzetgegevens vernieuwen)', 0, id, name);
                            saveNeeds();
                            addLog(name, `overgeslagen: onbekend inzettype ${keyOf(entry)}`, 'warn');
                            continue;
                        }
                        if (p.unknown.length && !red) {
                            stats.skipped++;
                            p.unknown.forEach((u) => addNeed('other', u, 0, id, name));
                            saveNeeds();
                            addLog(name, `overgeslagen: kan niet sturen: ${p.unknown.join(', ')}`, 'warn');
                            continue;
                        }

                        status(`Bezig: ${name}`, 'busy');
                        const res = await runJob({ id, token: Date.now(), slots: p.slots, vt: p.vt, vtCaptions: p.vtCaptions,
                            maxKm: ctx.cfg.maxKm, needAll: ctx.cfg.needAll, patients: ctx.cfg.patients, topUp: ctx.cfg.topUp });
                        // Sent short (needAll off) or skipped: both say what to buy.
                        recordResult(res, id, name);
                        if (res.result === 'sent' || res.result === 'unconfirmed') {
                            stats.sent++;
                            errorStreak = 0;
                            sent.push(Date.now());
                            const verb = res.mode === 'missing' ? 'bijgestuurd' : 'gealarmeerd';
                            addLog(name, `${res.result === 'sent' ? verb : `${verb} (niet bevestigd)`}: ${res.n} voertuig(en), verste ${Number(res.km).toFixed(1)} km${res.short ? `, tekort: ${res.short}` : ''}`, 'ok');
                        } else if (res.result === 'wait') {
                            // Vehicles still driving: look again in a minute, not after retryMin.
                            tried.set(id, Date.now() - ctx.cfg.retryMin * 60000 + 60000);
                            addLog(name, res.reason, 'idle');
                        } else if (res.result === 'skip') {
                            stats.skipped++;
                            errorStreak = 0;
                            addLog(name, `overgeslagen: ${res.reason}`, 'warn');
                        } else {
                            stats.errors++;
                            addLog(name, `fout: ${res.reason}`, 'error');
                            if (++errorStreak >= 3) { stop('Gestopt na 3 fouten op rij. Zie logboek.'); break; }
                        }
                        await sleep(ctx.cfg.pauseSec * 1000);
                    }
                    if (running) status();
                } catch (e) {
                    ctx.err(e);
                    stop(`Gestopt: ${e.message}`);
                } finally {
                    busy = false;
                    saveSession();
                }
                maybeReload();
            }

            function status(text, tone) {
                const done = `${stats.sent} gealarmeerd, ${stats.transports} vervoerd, ${stats.skipped} overgeslagen`;
                if (!running) ctx.status(text || `Uit. ${done} deze sessie.`, { tone: tone || 'idle' });
                else ctx.status(text || `Actief: ${done}`, { tone: tone || 'ok', dock: true });
                paint();
            }

            function start(resumed) {
                if (running || stopped) return;
                const other = lockHolder();
                if (other) {
                    status('Draait al in een ander tabblad. Stop het daar eerst.', 'warn');
                    if (!resumed) alert('Automatisch alarmeren draait al in een ander tabblad. Stop het daar eerst.');
                    return;
                }
                running = true;
                errorStreak = 0;
                takeLock();
                heartbeat = setInterval(takeLock, 5000);
                addLog('—', resumed ? 'hervat na herladen' : 'gestart', 'ok');
                status();
                cycle();
                timer = setInterval(cycle, ctx.cfg.scanSec * 1000);
            }

            function stop(text) {
                if (!running) return;
                running = false;
                clearInterval(timer);
                clearInterval(heartbeat);
                releaseLock();
                addLog('—', text || 'gestopt', text ? 'error' : 'idle');
                status(text, text ? 'error' : 'idle');
            }

            // Resume after a reload. Right after a crash the old page's lock can
            // still look alive for up to 15 s, so try a few times.
            function resume(tries = 0) {
                if (stopped || running) return;
                if (lockHolder() && tries < 3) {
                    status('Wacht even om te hervatten…', 'busy');
                    setTimeout(() => resume(tries + 1), 6000);
                    return;
                }
                start(true);
            }

            // Start/stop button in the mission filter bar.
            const row = document.querySelector('.mission-filters-row');
            const btn = document.createElement('a');
            btn.href = '#';
            btn.className = 'btn btn-xs';
            btn.style.marginLeft = '4px';
            btn.onclick = (ev) => {
                ev.preventDefault();
                if (running) stop();
                else if (confirm('Automatisch alarmeren starten?\n\nHet script alarmeert je nieuwe inzetten met echte voertuigen tot je op Stop klikt.')) start();
            };
            if (row) row.appendChild(btn);
            function paint() {
                btn.classList.toggle('btn-danger', running);
                btn.classList.toggle('btn-default', !running);
                btn.innerHTML = running ? `<span class="glyphicon glyphicon-stop"></span> Auto ${stats.sent}` : '<span class="glyphicon glyphicon-play"></span> Auto';
                btn.title = running ? 'Automatisch alarmeren staat aan. Klik om te stoppen.' : 'Automatisch alarmeren starten';
            }

            ctx.actions([
                { label: 'Start', kind: 'primary', run: start,
                    confirm: 'Automatisch alarmeren starten?\n\nHet script alarmeert je nieuwe inzetten met echte voertuigen tot je op Stop klikt.' },
                { label: 'Stop', kind: 'danger', run: () => stop() },
                { label: 'Inzetgegevens vernieuwen', run: async () => {
                    missions = null;
                    GM_deleteValue(DATA_KEY);
                    try { await loadMissions(); status(); } catch (e) { status(`Mislukt: ${e.message}`, 'error'); }
                } },
                { label: 'Tekortlijst kopiëren', run: async () => {
                    const rows = (b) => sorted(b).map(([n, t]) => `${n}\t${t.missions}\t${t.short}\t${t.far}\t${t.units}\t${t.example}`);
                    const text = ['Voertuig\tInzetten\tNiet beschikbaar\tTe ver\tEenheden\tLaatste inzet', ...rows(needs.types),
                        '', 'Kan script niet sturen\tInzetten', ...sorted(needs.other).map(([n, t]) => `${n}\t${t.missions}`)].join('\n');
                    try { await navigator.clipboard.writeText(text); } catch (e) { prompt('Kopieer:', text); }
                } },
                { label: 'Tekortlijst wissen', kind: 'danger', run: () => {
                    needs = { since: Date.now(), types: {}, other: {} };
                    saveNeeds();
                    ctx.refresh();
                }, confirm: 'De tekortlijst leegmaken en opnieuw beginnen met tellen?' },
            ]);
            ctx.menu({ icon: '🤖', label: 'Automatisch alarmeren', title: 'Start of stop', run: () => (running ? stop() : ctx.open()) });

            const sorted = (bucket) => Object.entries(bucket).sort((a, b) => b[1].missions - a[1].missions || b[1].last - a[1].last);
            const ago = (t) => {
                const m = Math.round((Date.now() - t) / 60000);
                return m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} uur` : `${Math.round(m / 1440)} d`;
            };

            ctx.panel((el) => {
                const esc = ctx.esc;
                const tone = { ok: 't-ok', warn: 't-warn', error: 't-error', idle: '' };
                const types = sorted(needs.types);
                const other = sorted(needs.other);
                el.innerHTML = `<div class="mks-tiles">
                        <div class="mks-tile"><div class="v">${stats.sent}</div><div class="k">gealarmeerd</div></div>
                        <div class="mks-tile"><div class="v">${stats.transports}</div><div class="k">vervoerd</div></div>
                        <div class="mks-tile"><div class="v">${stats.skipped}</div><div class="k">overgeslagen</div></div>
                        <div class="mks-tile ${stats.errors ? 't-error' : ''}"><div class="v">${stats.errors}</div><div class="k">fouten</div></div>
                    </div>
                    <h4 class="mks-h">Tekort per voertuigtype</h4>
                    <p class="mks-note">Sinds ${new Date(needs.since).toLocaleDateString('nl-NL')}. Elke inzet telt één keer per type.
                        <b>Niet beschikbaar</b>: het spel had er geen vrij. <b>Te ver</b>: alleen verder dan ${ctx.cfg.maxKm} km.
                        Bovenaan staat wat je het vaakst mist: daar heb je er meer van nodig (of dichterbij).</p>
                    ${types.length ? `<div class="mks-tblwrap"><table class="mks-tbl"><thead><tr><th>Voertuig</th><th>Inzetten</th>
                        <th>Niet beschikbaar</th><th>Te ver</th><th>Eenheden</th><th>Laatst</th></tr></thead><tbody>
                        ${types.map(([n, t]) => `<tr title="${esc(`Laatste inzet: ${t.example}`)}"><td>${esc(n)}</td><td class="mono"><b>${t.missions}</b></td>
                            <td class="mono">${t.short || ''}</td><td class="mono">${t.far || ''}</td><td class="mono">${t.units || ''}</td>
                            <td class="mono mks-dim">${ago(t.last)}</td></tr>`).join('')}</tbody></table></div>`
                        : '<p class="mks-note">Nog geen tekorten geteld.</p>'}
                    ${other.length ? `<h4 class="mks-h">Kan het script niet sturen</h4>
                        <p class="mks-note">Eisen die dit script (nog) niet kan vervullen. Deze inzetten moet je zelf alarmeren.</p>
                        <div class="mks-tblwrap"><table class="mks-tbl"><thead><tr><th>Eis</th><th>Inzetten</th><th>Laatst</th></tr></thead><tbody>
                        ${other.map(([n, t]) => `<tr title="${esc(`Laatste inzet: ${t.example}`)}"><td>${esc(n)}</td><td class="mono"><b>${t.missions}</b></td>
                            <td class="mono mks-dim">${ago(t.last)}</td></tr>`).join('')}</tbody></table></div>` : ''}
                    ${log.length ? `<h4 class="mks-h">Logboek</h4><div class="mks-tblwrap"><table class="mks-tbl"><tbody>
                        ${log.map((l) => `<tr><td class="mono">${l.at.toLocaleTimeString('nl-NL')}</td><td>${esc(l.name)}</td>
                        <td><span class="mks-pill ${tone[l.tone] || ''}">${esc(l.text)}</span></td></tr>`).join('')}</tbody></table></div>`
                        : '<p class="mks-note">Nog niets gedaan. Klik op Start of op de knop <b>Auto</b> in de missiefilterbalk.</p>'}`;
            });

            ctx.onSettings((cfg, key) => {
                if (key === 'scanSec' && running) { clearInterval(timer); timer = setInterval(cycle, ctx.cfg.scanSec * 1000); }
            });
            status();
            if (saved.running) resume();

            return {
                stop() {
                    // Turning the module off ends the session: no resume after a reload.
                    stopped = true;
                    running = false;
                    clearInterval(timer);
                    clearInterval(heartbeat);
                    saveSession();
                    releaseLock();
                    window.removeEventListener('pagehide', onPageHide);
                    btn.remove();
                    document.querySelectorAll('iframe').forEach((f) => { if (f.name.startsWith(WORKER)) f.remove(); });
                },
            };
        }
    },
});
