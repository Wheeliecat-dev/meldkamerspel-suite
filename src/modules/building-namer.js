MKS.module({
    id: 'building-namer',
    name: 'Gebouwnamen',
    short: 'Gebouwnamen',
    icon: '🏢',
    category: 'names',
    description: 'Geeft je kazernes, posten en bureaus hun echte Nederlandse naam (en waar bekend de echte post-/regionummering). '
        + 'Nooit dubbele namen: bij een botsing blijft het gebouw ongemoeid. Ziekenhuizen en meldkamers worden niet hernoemd.',
    warning: '<b>Werk in uitvoering. Hernoemen kan niet ongedaan worden gemaakt.</b> Zodra je dit aanzet, verandert het de namen van je gebouwen '
        + 'in het spel zelf. De oude namen worden nergens bewaard. De namenlijst is nog niet af en kan in een volgende versie weer veranderen.',
    confirmOn: 'Let op: dit hernoemt direct je gebouwen in het spel.\n\nDat kan NIET ongedaan worden gemaakt: de oude namen worden niet bewaard. '
        + 'Het script is nog in ontwikkeling.\n\nToch aanzetten?',
    at: 'load',
    frames: 'top',
    settings: [
        { key: 'osmCheck', label: 'Controleren met OpenStreetMap', type: 'bool', default: true,
            help: 'Vergelijkt namen met OSM (Nominatim) en toont verschillen hieronder. Verandert zelf nooit iets. Max. 1 verzoek per seconde.' },
        { key: 'pollMin', label: 'Zoeken naar nieuwe gebouwen', type: 'number', default: 1, min: 1, max: 60, step: 1, unit: 'min' },
        { key: 'rescanMin', label: 'Volledige controle', type: 'number', default: 30, min: 5, max: 240, step: 5, unit: 'min' },
        { key: 'throttleSec', label: 'Pauze tussen hernoemingen', type: 'number', default: 1.5, min: 0.5, max: 10, step: 0.5, unit: 'sec' },
        { key: 'debug', label: 'Uitgebreid loggen in console', type: 'bool', default: false },
    ],

    run(ctx) {
        /* ========================================================================
         * CONFIG — read this first
         * ====================================================================
         * DRY_RUN starts as `true` on purpose: the very first run only PRINTS
         * what it would rename in the console (F12), nothing is touched
         * in-game. Check the console, then set DRY_RUN to false.
         *
         * Reference data here is only as complete as what could be sourced:
         * Utrecht (09) and the handful of Gelderland-Midden (07) fire stations
         * have exact real post numbers (borrowed from the vehicle namer's own
         * roepnummer reference sheet — those post numbers ARE real). Everywhere
         * else, and every non-fire discipline, only gets the real PLACE name
         * (no fabricated post number) since a verified nationwide address/post
         * list wasn't available to build this from. Extend the dictionaries
         * below as you learn more real names — see PLACE_DISPLAY_NAME.
         *
         * Rename mechanism confirmed via live devtools capture (not guessed):
         * GET /buildings/:id/edit returns a normal Rails edit form
         * (#edit_building_:id, action /buildings/:id, method POST with a
         * hidden _method=patch field), name field is #building_name /
         * name="building[name]". We fetch that form off-screen, copy every
         * field (including the CSRF token), swap in the new name, and POST it
         * ourselves — never touching the live DOM, so it can't get killed by a
         * real page navigation.
         * ==================================================================== */
        const CONFIG = {
            DRY_RUN: false,
            get DEBUG() { return !!ctx.cfg.debug; },
            get POLL_NEW_BUILDINGS_MS() { return ctx.cfg.pollMin * 60000; },
            get FULL_RESCAN_MS() { return ctx.cfg.rescanMin * 60000; },
            get RENAME_THROTTLE_MS() { return ctx.cfg.throttleSec * 1000; },
            REQUEST_TIMEOUT_MS: 10 * 1000,
            MAX_NAME_LENGTH: 150,

            // Crosschecks every computed building name against OpenStreetMap
            // (Nominatim, free/no API key) and logs disagreements for you to
            // review — it NEVER changes what gets renamed in-game by itself.
            // Nominatim's usage policy caps this at ~1 request/sec and requires
            // an identifying User-Agent, both handled below.
            get ENABLE_OSM_CROSSCHECK() { return !!ctx.cfg.osmCheck; },
            OSM_THROTTLE_MS: 1100,
            OSM_REQUEST_TIMEOUT_MS: 12 * 1000,
        };

        const log = (...a) => { if (CONFIG.DEBUG) console.log('%c[BuildingNamer]', 'color:#07a', ...a); };
        const warn = (...a) => console.warn('[BuildingNamer]', ...a);
        const err = (...a) => console.error('[BuildingNamer]', ...a);

        /* ========================================================================
         * PERSISTENT STORAGE (separate GM keys from the vehicle namer, so the two
         * scripts never step on each other)
         * ==================================================================== */
        const store = {
            get(key, def) {
                try {
                    const v = GM_getValue(key, undefined);
                    return v === undefined ? def : JSON.parse(v);
                } catch (e) { return def; }
            },
            set(key, val) {
                try { GM_setValue(key, JSON.stringify(val)); } catch (e) { warn('store.set failed', key, e); }
            },
        };

        // No stored assignments = the old standalone script's memory wasn't
        // imported. Wait until the user imports it or starts fresh.
        const hasMemory = true;

        const DATA_VERSION = 4; // bumped: shorter names (length cap), fixed double-prefix bug, DRY_RUN off
        let assignments = store.get('bn_assignments', {}); // buildingId -> { name }
        let knownBuildingIds = store.get('bn_knownBuildingIds', []);
        let unclassifiedLog = store.get('bn_unclassifiedLog', {});
        let osmCache = store.get('bn_osmCache', {}); // query string -> { result, ts } — never expires, Nominatim data is stable enough and this avoids re-querying every scan
        let osmCrosscheckLog = store.get('bn_osmCrosscheckLog', {}); // buildingId -> crosscheck verdict

        const storedDataVersion = store.get('bn_dataVersion', 0);
        if (storedDataVersion !== DATA_VERSION) {
            log(`data version changed (${storedDataVersion} -> ${DATA_VERSION}) — clearing stored assignments for a full recheck`);
            assignments = {};
            store.set('bn_dataVersion', DATA_VERSION);
        }

        function persistAll() {
            store.set('bn_assignments', assignments);
            store.set('bn_knownBuildingIds', knownBuildingIds);
            store.set('bn_unclassifiedLog', unclassifiedLog);
            store.set('bn_osmCache', osmCache);
            store.set('bn_osmCrosscheckLog', osmCrosscheckLog);
        }

        // computeTarget() returns null for two very different reasons: a
        // genuinely unmapped building_type (worth logging — tell Claude about
        // it) vs. a recognized NO_RENAME_DISCIPLINES type we deliberately never
        // touch (hospitals, meldkamers, ...). Only the first should show up in
        // the unclassified log — otherwise every hospital/meldkamer/kazerne
        // would spam it every single scan for no reason.
        function isDeliberatelySkipped(building) {
            const discipline = classifyDiscipline(building.building_type);
            return !!discipline && NO_RENAME_DISCIPLINES.has(discipline);
        }

        function recordUnclassified(building, reason) {
            unclassifiedLog[building.id] = { buildingId: building.id, currentName: building.caption, buildingType: building.building_type, reason };
        }
        function printUnclassifiedLog() {
            const rows = Object.values(unclassifiedLog);
            if (!rows.length) { log('nothing left unclassified.'); return; }
            console.log(`%c[BuildingNamer] ${rows.length} building(s) left untouched:`, 'color:#e90');
            console.table(rows);
            console.log('[BuildingNamer] copy/paste this to Claude:\n' + JSON.stringify(rows, null, 2));
        }

        /* ========================================================================
         * TEXT HELPERS (same normalization rules as the vehicle namer, so both
         * scripts recognize the same building captions the same way)
         * ==================================================================== */
        function normalize(s) {
            return (s || '')
                .toString()
                .normalize('NFD').replace(/[̀-ͯ]/g, '')
                .toLowerCase()
                .replace(/[()]/g, ' ')
                .replace(/[^a-z0-9\- ]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
        }

        const PREFIX_WORDS = [
            'brandweerkazerne', 'brandweerpost', 'brandweer kazerne', 'brandweer post', 'brandweer',
            'ambulance standplaats', 'ambulancepost', 'standplaats', 'ambulance',
            'politiebureau', 'politiepost', 'politie hoofdbureau', 'politie',
            'ravu', 'rav', 'kazerne',
            // Labels this script writes itself, so a rescan of its own output
            // doesn't stack another label on top ("Vliegbasis Vliegbasis ...").
            'vliegbasis', 'rws steunpunt', 'rws',
        ];
        // Place keys are written with hyphens ("utrecht-leidsche rijn") but the
        // display name can use spaces ("Utrecht Leidsche Rijn"); compare both
        // forms the same so a renamed building still finds its own entry.
        const foldHyphens = (s) => s.replace(/-/g, ' ');
        function stripPrefix(normCaption) {
            let out = normCaption;
            // Strip a leading regio/post code the script itself writes ("09 ",
            // "09-59 ", "06 ") BEFORE matching label words, else a name this
            // script already generated (e.g. "09 Ambulancepost Amersfoort
            // Noord") never matches ^ambulancepost — "09" is in the way — and
            // every rescan bolts another label on top. Confirmed live: produced
            // "09 Ambulancepost 09 Ambulancepost Amersfoort Noord".
            out = out.replace(/^\d{2}(-\d+)?\s+/, '');
            let changed = true;
            while (changed) {
                changed = false;
                for (const w of PREFIX_WORDS) {
                    const re = new RegExp('^' + w + '\\s+');
                    if (re.test(out)) { out = out.replace(re, '').trim(); changed = true; }
                }
            }
            return out;
        }

        function wordBoundaryIncludes(haystack, needle) {
            if (!needle) return false;
            const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const re = new RegExp('(^|[^a-z0-9])' + esc + '($|[^a-z0-9])');
            return re.test(' ' + haystack + ' ');
        }

        function titleCase(normPlace) {
            return normPlace
                .split(' ')
                .map((w) => w.split('-').map((p) => p ? p[0].toUpperCase() + p.slice(1) : p).join('-'))
                .join(' ');
        }

        /* ========================================================================
         * REFERENCE DATA — real place -> regio (25 official Veiligheidsregio's)
         * Same table as the vehicle namer.
         * ==================================================================== */
        const PLACE_TO_REGIO = {
            'amersfoort-centrum': '09', 'amersfoort-noord': '09', 'amersfoort n-oost': '09', 'amersfoort': '09',
            'baarn': '09', 'bunschoten': '09', 'bunnik': '09', 'werkhoven': '09', 'bilthoven': '09',
            'de bilt': '09', 'groenekan': '09', 'maartensdijk': '09', 'westbroek': '09', 'abcoude': '09',
            'mijdrecht': '09', 'vinkeveen': '09', 'wilnis': '09', 'eemnes': '09', 'houten': '09',
            'houten-oost': '09', 'houten-west': '09', 'schalkwijk': '09', 'ijsselstein': '09',
            'achterveld': '09', 'leusden': '09', 'benschop': '09', 'lopik': '09', 'linschoten': '09',
            'montfoort': '09', 'nieuwegein': '09', 'oudewater': '09', 'renswoude': '09', 'elst': '09',
            'rhenen': '09', 'rhenen-achterberg': '09', 'soest': '09', 'soesterberg': '09', 'breukelen': '09',
            'kockengen': '09', 'loenen': '09', 'maarssen': '09', 'nieuwer ter aa': '09', 'nigtevecht': '09',
            'de meern': '09', 'utrecht': '09', 'vleuten': '09', 'amerongen': '09', 'driebergen': '09',
            'doorn': '09', 'leersum': '09', 'maarn-maarsbergen': '09', 'maarn': '09', 'veenendaal': '09',
            'hagestein': '09', 'vianen': '09', 'wijk bij duurstede': '09', 'harmelen': '09', 'kamerik': '09',
            'woerden': '09', 'zegveld': '09', 'woudenberg': '09', 'den dolder': '09', 'zeist': '09',
            'ameide': '09', 'leerdam': '09', 'lexmond': '09', 'meerkerk': '09', 'schoonrewoerd': '09',
            'nieuwegein-noord': '09', 'nieuwegein-zuid': '09',

            'apeldoorn': '06', 'harderwijk': '06', 'putten': '06', 'nunspeet': '06', 'elburg': '06',
            'epe': '06', 'oldebroek': '06', 'hattem': '06', 'zutphen': '06', 'doetinchem': '06',
            'winterswijk': '06', 'lochem': '06', 'voorst': '06', 'garderen': '06',

            'ede': '07', 'ederveen': '07', 'nijkerk': '07', 'scherpenzeel': '07', 'otterlo': '07',
            'barneveld': '07', 'arnhem': '07', 'wageningen': '07', 'renkum': '07', 'de valk': '07',

            'nijmegen': '08', 'tiel': '08', 'zaltbommel': '08', 'wijchen': '08', 'culemborg': '08',

            'groningen': '01', 'leeuwarden': '02', 'assen': '03', 'zwolle': '04', 'enschede': '05',
            'hilversum': '14', 'alkmaar': '10', 'den helder': '10', 'zaandam': '11', 'purmerend': '11',
            'haarlem': '12', 'haarlemmermeer': '12', 'schiphol': '12', 'ijmuiden': '12',
            'amsterdam': '13', 'amstelveen': '13', 'den haag': '15', 's-gravenhage': '15', 'delft': '15',
            'leiden': '16', 'alphen aan den rijn': '16', 'gouda': '16', 'rotterdam': '17', 'schiedam': '17',
            'dordrecht': '18', 'gorinchem': '18', 'middelburg': '19', 'vlissingen': '19', 'goes': '19',
            'breda': '20', 'tilburg': '20', 'den bosch': '21', 's-hertogenbosch': '21', 'oss': '21',
            'eindhoven': '22', 'helmond': '22', 'venlo': '23', 'roermond': '23', 'maastricht': '24',
            'heerlen': '24', 'sittard': '24', 'almere': '25', 'lelystad': '25',
        };

        // "Display" spelling for a place — real, properly capitalized official
        // kazerne-list spelling (source: brandweer.nl/utrecht/kazernes/ and the
        // vehicle namer's own Utrecht roepnummer reference sheet). Falls back to
        // naive title-casing for anything not listed here.
        const PLACE_DISPLAY_NAME = {
            'amersfoort-centrum': 'Amersfoort-Centrum', 'amersfoort-noord': 'Amersfoort-Noord',
            'baarn': 'Baarn', 'bunschoten': 'Bunschoten', 'bunnik': 'Bunnik', 'werkhoven': 'Werkhoven',
            'bilthoven': 'Bilthoven', 'de bilt': 'De Bilt', 'groenekan': 'Groenekan', 'maartensdijk': 'Maartensdijk',
            'westbroek': 'Westbroek-Tienhoven', 'abcoude': 'Abcoude', 'mijdrecht': 'Mijdrecht', 'vinkeveen': 'Vinkeveen',
            'wilnis': 'Wilnis', 'eemnes': 'Eemnes', 'houten': 'Houten', 'houten-oost': 'Houten-Oost',
            'schalkwijk': 'Schalkwijk', 'ijsselstein': 'IJsselstein', 'achterveld': 'Achterveld', 'leusden': 'Leusden',
            'benschop': 'Benschop', 'lopik': 'Lopik', 'linschoten': 'Linschoten', 'montfoort': 'Montfoort',
            'oudewater': 'Oudewater', 'renswoude': 'Renswoude', 'elst': 'Rhenen-Elst', 'rhenen': 'Rhenen',
            'rhenen-achterberg': 'Rhenen-Achterberg', 'soest': 'Soest', 'soesterberg': 'Soesterberg',
            'breukelen': 'Breukelen', 'kockengen': 'Kockengen', 'loenen': 'Loenen aan de Vecht', 'maarssen': 'Maarssen',
            'nieuwer ter aa': 'Nieuwer ter Aa', 'nigtevecht': 'Nigtevecht', 'de meern': 'De Meern', 'utrecht': 'Utrecht',
            'vleuten': 'Vleuten', 'amerongen': 'Amerongen', 'driebergen': 'Driebergen', 'doorn': 'Doorn',
            'leersum': 'Leersum', 'maarn-maarsbergen': 'Maarn-Maarsbergen', 'maarn': 'Maarn', 'veenendaal': 'Veenendaal',
            'hagestein': 'Hagestein', 'vianen': 'Vianen', 'wijk bij duurstede': 'Wijk bij Duurstede',
            'harmelen': 'Harmelen', 'kamerik': 'Kamerik', 'woerden': 'Woerden', 'zegveld': 'Zegveld',
            'woudenberg': 'Woudenberg', 'den dolder': 'Den Dolder', 'zeist': 'Zeist', 'ameide': 'Ameide',
            'leerdam': 'Leerdam', 'lexmond': 'Lexmond', 'meerkerk': 'Meerkerk', 'schoonrewoerd': 'Schoonrewoerd',
            'nieuwegein-noord': 'Nieuwegein-Noord', 'nieuwegein-zuid': 'Nieuwegein-Zuid',
            'utrecht-leidsche rijn': 'Utrecht Leidsche Rijn', 'utrecht-schepenbuurt': 'Utrecht Schepenbuurt',
            'utrecht-tolsteeg': 'Utrecht Tolsteeg',
            'ede': 'Ede', 'ederveen': 'Ederveen', 'nijkerk': 'Nijkerk', 'scherpenzeel': 'Scherpenzeel',
            'otterlo': 'Otterlo', 'garderen': 'Garderen', 'de valk': 'De Valk',
        };

        function displayPlaceName(stripped) {
            if (PLACE_DISPLAY_NAME[stripped]) return PLACE_DISPLAY_NAME[stripped];
            for (const [norm, disp] of Object.entries(PLACE_DISPLAY_NAME)) {
                if (foldHyphens(norm) === foldHyphens(stripped)) return disp;
            }
            for (const [norm, disp] of Object.entries(PLACE_DISPLAY_NAME)) {
                if (wordBoundaryIncludes(stripped, norm) || wordBoundaryIncludes(norm, stripped)) return disp;
            }
            return titleCase(stripped);
        }

        function regioForBuilding(building) {
            const stripped = stripPrefix(normalize(building.caption));
            if (PLACE_TO_REGIO[stripped]) return PLACE_TO_REGIO[stripped];
            let best = null;
            for (const place of Object.keys(PLACE_TO_REGIO)) {
                if (wordBoundaryIncludes(stripped, place) || wordBoundaryIncludes(place, stripped)) {
                    if (!best || place.length > best.length) best = place;
                }
            }
            return best ? PLACE_TO_REGIO[best] : null;
        }

        /* ========================================================================
         * REFERENCE DATA — exact real Utrecht (09) / Gelderland-Midden (07) fire
         * post numbers, borrowed straight from the vehicle namer's own verified
         * roepnummer sheet. Only used to recover the real 2-digit POST code
         * (e.g. "09-32 ...") — the vehicle labels themselves aren't needed here.
         * ==================================================================== */
        const UTRECHT_FIRE_STATIONS = {
            "Amersfoort-Centrum": ["09-0101"], "Amersfoort-Noord": ["09-0231"], "Baarn": ["09-0301"],
            "Bunschoten": ["09-0401"], "Bunnik": ["09-0501"], "Werkhoven": ["09-0601"], "Bilthoven": ["09-0701"],
            "De Bilt": ["09-0801"], "Groenekan": ["09-0931"], "Maartensdijk": ["09-1034"], "Westbroek": ["09-1131"],
            "Abcoude": ["09-1201"], "Mijdrecht": ["09-1311"], "Vinkeveen": ["09-1401"], "Wilnis": ["09-1501"],
            "Eemnes": ["09-1601"], "Houten": ["09-1731"], "Schalkwijk": ["09-1901"], "IJsselstein": ["09-2001"],
            "Achterveld": ["09-2101"], "Leusden": ["09-2231"], "Benschop": ["09-2301"], "Lopik": ["09-2401"],
            "Linschoten": ["09-2531"], "Montfoort": ["09-2601"], "Nieuwegein-Noord": ["09-2701"],
            "Nieuwegein-Zuid": ["09-2801"], "Oudewater": ["09-2901"], "Renswoude": ["09-3001"], "Elst": ["09-3134"],
            "Rhenen": ["09-3201"], "Soest": ["09-3301"], "Soest-Nevenpost": ["09-3441"], "Soesterberg": ["09-3501"],
            "Breukelen": ["09-3601"], "Kockengen": ["09-3731"], "Loenen": ["09-3801"], "Maarssen": ["09-3911"],
            "Nieuwer ter Aa": ["09-4101"], "Nigtevecht": ["09-4201"], "De Meern": ["09-4301"],
            "Utrecht-Leidsche Rijn": ["09-4401"], "Utrecht-Schepenbuurt": ["09-4501"], "Utrecht-Tolsteeg": ["09-4601"],
            "Vleuten": ["09-4701"], "Amerongen": ["09-5001"], "Driebergen": ["09-5101"], "Doorn": ["09-5201"],
            "Leersum": ["09-5301"], "Maarn-Maarsbergen": ["09-5401"], "Veenendaal": ["09-5501"],
            "Hagestein": ["09-5631"], "Vianen": ["09-5710"], "Wijk bij Duurstede": ["09-5901"], "Harmelen": ["09-6001"],
            "Kamerik": ["09-6131"], "Woerden": ["09-6210"], "Zegveld": ["09-6301"], "Woudenberg": ["09-6434"],
            "Den Dolder": ["09-6531"], "Zeist": ["09-6621"], "Ameide": ["09-6701"], "Leerdam": ["09-6801"],
            "Lexmond": ["09-6901"], "Meerkerk": ["09-7001"], "Schoonrewoerd": ["09-7101"],
        };
        const GELDERLAND_MIDDEN_FIRE_STATIONS = {
            "Ede": ["07-2701"], "Ederveen": ["07-2531"], "Nijkerk": ["07-1101"],
            "Scherpenzeel": ["07-1931"], "Garderen": ["07-1341"], "Otterlo": ["07-2341"],
        };
        const FIRE_BUILDING_ALIASES = {
            'brandweer kazerne de valk': 'de valk', 'brandweer kazerne houten': 'houten',
            'brandweer kazerne putten': 'putten', 'brandweer kazerne harderwijk': 'harderwijk',
        };

        function findFirePostCode(building) {
            const stripped = stripPrefix(normalize(building.caption));
            const alias = FIRE_BUILDING_ALIASES[stripped];
            const tryDict = (dict, regio) => {
                for (const key of Object.keys(dict)) {
                    const nkey = normalize(key);
                    if (foldHyphens(nkey) === foldHyphens(stripped) || (alias && nkey === alias)) return { post: dict[key][0].split('-')[1].slice(0, 2), regio };
                }
                let best = null;
                for (const key of Object.keys(dict)) {
                    const nkey = normalize(key);
                    if (wordBoundaryIncludes(stripped, nkey) || wordBoundaryIncludes(nkey, stripped)) {
                        if (!best || nkey.length > best.nkey.length) best = { key, nkey };
                    }
                }
                if (best) return { post: dict[best.key][0].split('-')[1].slice(0, 2), regio };
                return null;
            };
            return tryDict(UTRECHT_FIRE_STATIONS, '09') || tryDict(GELDERLAND_MIDDEN_FIRE_STATIONS, '07') || null;
        }

        /* ========================================================================
         * REFERENCE DATA — real Dutch kazerne name/address/regio/post, parsed
         * from a community export (hulpdienstvoertuigenbenelux.nl scrape,
         * allvehicleseverlmao.txt). Covers mostly regio 01-08 (Noord/Oost-
         * Nederland) plus a handful of national heli/MMT bases; Utrecht (09)
         * already has its own verified sheet above (UTRECHT_FIRE_STATIONS).
         * key = normalize()-d place name, matched the same way building
         * captions are.
         * ==================================================================== */
        const STATION_ADDRESS_DATA = {
            "heliport amsterdam": { display: "Heliport Amsterdam", address: "Hornweg 24, 1045 AR Amsterdam", regio: null, post: null },
            "rotterdam airport": { display: "Rotterdam Airport", address: "Zestienhoven 3045 AS", regio: null, post: null },
            "vliegbasis volkel": { display: "Vliegbasis Volkel", address: "5408 SM Volkel", regio: null, post: null },
            "eelde airport": { display: "Eelde Airport", address: "Machlaan 28", regio: null, post: null },
            "leeuwarden airport": { display: "Leeuwarden Airport", address: "Keegsdijkje 7", regio: null, post: null },
            "lelystad airport": { display: "Lelystad Airport", address: "Emoeweg 16", regio: null, post: null },
            "soesterberg": { display: "Soesterberg", address: "Stemerdingweg 11-13", regio: null, post: null },
            "medisch spectrum twente": { display: "Medisch Spectrum Twente", address: "Koningstraat 1 Enschede", regio: null, post: null },
            "leek": { display: "Leek", address: "Tolberterstraat 66", regio: "01", post: "10" },
            "marum": { display: "Marum", address: "Kruisweg 40", regio: "01", post: "11" },
            "grootegast": { display: "Grootegast", address: "Rondweg 15", regio: "01", post: "12" },
            "grijpskerk": { display: "Grijpskerk", address: "Bouwhuisstraat 20", regio: "01", post: "13" },
            "oldehove": { display: "Oldehove", address: "Englumstraat 6", regio: "01", post: "13" },
            "zuidhorn": { display: "Zuidhorn", address: "Boslaan 16", regio: "01", post: "13" },
            "wehe-den hoorn": { display: "Wehe-Den Hoorn", address: "W.H. Timmermastraat 7", regio: "01", post: "14" },
            "zoutkamp": { display: "Zoutkamp", address: "Marnestraat 1", regio: "01", post: "14" },
            "baflo": { display: "Baflo", address: "Laurentiusstraat 4", regio: "01", post: "15" },
            "winsum": { display: "Winsum", address: "Meenden 2", regio: "01", post: "15" },
            "bedum": { display: "Bedum", address: "Industrieweg 15", regio: "01", post: "16" },
            "ten boer": { display: "Ten Boer", address: "Boltweg 1", regio: "01", post: "17" },
            "groningen hoofdpost": { display: "Groningen Hoofdpost", address: "Sontweg 10", regio: "01", post: "18" },
            "groningen vinkhuizen": { display: "Groningen Vinkhuizen", address: "Diamantlaan 168", regio: "01", post: "18" },
            "haren": { display: "Haren", address: "Felland Noord 2", regio: "01", post: "20" },
            "hoogezand-sappemeer": { display: "Hoogezand-Sappemeer", address: "Rembrandtlaan 8", regio: "01", post: "21" },
            "harkstede": { display: "Harkstede", address: "Dorphuisweg 30a", regio: "01", post: "22" },
            "siddeburen": { display: "Siddeburen", address: "Oudeweg 140a", regio: "01", post: "22" },
            "slochteren": { display: "Slochteren", address: "Verlende Veenlaan 1", regio: "01", post: "22" },
            "zuidbroek": { display: "Zuidbroek", address: "Europaweg 6", regio: "01", post: "23" },
            "nieuwe pekela": { display: "Nieuwe Pekela", address: "Pekelwerk 8", regio: "01", post: "24" },
            "oude pekela": { display: "Oude Pekela", address: "Burg. Snaterlaan 42", regio: "01", post: "24" },
            "veendam": { display: "Veendam", address: "Langeleegte 2E", regio: "01", post: "25" },
            "stadskanaal": { display: "Stadskanaal", address: "Veenstraat 8", regio: "01", post: "26" },
            "ter apel": { display: "Ter Apel", address: "Heemker Akkerstraat 1", regio: "01", post: "27" },
            "vlagtwedde": { display: "Vlagtwedde", address: "Nieuwe Weg 1", regio: "01", post: "27" },
            "bellingwolde": { display: "Bellingwolde", address: "Blijhamsterweg 34a", regio: "01", post: "28" },
            "bad nieuweschans": { display: "Bad Nieuweschans", address: "Noorseweg 2", regio: "01", post: "29" },
            "finsterwolde": { display: "Finsterwolde", address: "Bospad 1", regio: "01", post: "29" },
            "scheemda": { display: "Scheemda", address: "Zwaagsterweg 2e", regio: "01", post: "29" },
            "winschoten": { display: "Winschoten", address: "Molenweg 2", regio: "01", post: "29" },
            "bierum": { display: "Bierum", address: "Spijksterweg 5a", regio: "01", post: "30" },
            "delfzijl": { display: "Delfzijl", address: "Hogelandsterweg 1", regio: "01", post: "30" },
            "wagenborgen": { display: "Wagenborgen", address: "De Elzen 4", regio: "01", post: "30" },
            "woldendorp": { display: "Woldendorp", address: "A.E. Gorterweg 30", regio: "01", post: "30" },
            "appingedam": { display: "Appingedam", address: "Dijkhuizenweg 28", regio: "01", post: "31" },
            "loppersum": { display: "Loppersum", address: "Pomonaweg 3", regio: "01", post: "32" },
            "middelstum": { display: "Middelstum", address: "Delleweg 21", regio: "01", post: "32" },
            "uithuizen": { display: "Uithuizen", address: "Industrieweg 1a", regio: "01", post: "33" },
            "falck chemiepark delfzijl": { display: "Falck Chemiepark Delfzijl", address: "Oosterhorn 4e", regio: "01", post: "39" },
            "bedrijfsbrandweer cosun beet company hoogkerk": { display: "Bedrijfsbrandweer Cosun Beet Company Hoogkerk", address: "Fabriekslaan 12", regio: null, post: null },
            "bosbrandweer noord nl": { display: "Bosbrandweer Noord NL", address: "J.H. de Boerstraat 35 Niebert", regio: "01", post: "39" },
            "hoofdkantoor regio friesland": { display: "Hoofdkantoor Regio Friesland", address: "Harlingertrekweg 58 Leeuwarden", regio: null, post: null },
            "hollum": { display: "Hollum", address: "Fabrieksweg 30", regio: "02", post: "40" },
            "ameland-nes": { display: "Ameland-Nes", address: "Ballumerweg 38", regio: "02", post: "40" },
            "schiermonnikoog": { display: "Schiermonnikoog", address: "Knuppeldam 8", regio: "02", post: "41" },
            "anjum": { display: "Anjum", address: "Buorfinne 11", regio: "02", post: "42" },
            "dokkum": { display: "Dokkum", address: "Rondweg Noord 28", regio: "02", post: "42" },
            "ternaard": { display: "Ternaard", address: "Gysbert Japiksstrjitte 10", regio: "02", post: "42" },
            "damwald": { display: "Damwâld", address: "De Moarrewei 24", regio: "02", post: "43" },
            "de westereen": { display: "De Westereen", address: "Roazeloane 103,", regio: "02", post: "43" },
            "kollum": { display: "Kollum", address: "Tochmalaan 3", regio: "02", post: "44" },
            "buitenpost": { display: "Buitenpost", address: "Vaart 4", regio: "02", post: "45" },
            "drogeham": { display: "Drogeham", address: "Droegehamster Feart 6", regio: "02", post: "45" },
            "surhuisterveen": { display: "Surhuisterveen", address: "Lauwersweg 20", regio: "02", post: "45" },
            "harlingen": { display: "Harlingen", address: "Almenumerweg 4", regio: "02", post: "46" },
            "vlieland": { display: "Vlieland", address: "Willem de Vlaminghweg 43", regio: "02", post: "47" },
            "franeker": { display: "Franeker", address: "Burg. J. Dijkstraweg 13", regio: "02", post: "48" },
            "midsland": { display: "Midsland", address: "Midslander Hoofdweg 9", regio: "02", post: "49" },
            "west terschelling": { display: "West Terschelling", address: "Burg. Eschauzierstraat 51", regio: "02", post: "49" },
            "sint annaparochie": { display: "Sint Annaparochie", address: "Warmoesstraat 61", regio: "02", post: "50" },
            "marssum": { display: "Marssum", address: "Sasker van Heringawei 41", regio: "02", post: "51" },
            "menaldum": { display: "Menaldum", address: "Bitgumerdyk 17", regio: "02", post: "51" },
            "stiens": { display: "Stiens", address: "It Noarderfjild 28", regio: "02", post: "52" },
            "ferwert": { display: "Ferwert", address: "Prof. Heijmansstraat 2", regio: "02", post: "53" },
            "hallum": { display: "Hallum", address: "It Blikkelan 15", regio: "02", post: "53" },
            "bakhuizen": { display: "Bakhuizen", address: "Teeuwes de Boerstraat 23", regio: "02", post: "54" },
            "balk": { display: "Balk", address: "Herman Gorterstraat 12", regio: "02", post: "54" },
            "sloten": { display: "Sloten", address: "Wijckelerweg 171b", regio: "02", post: "54" },
            "bolsward": { display: "Bolsward", address: "Hichtumerweg 17", regio: "02", post: "56" },
            "heeg": { display: "Heeg", address: "De Draei 17", regio: "02", post: "56" },
            "ijlst": { display: "IJlst", address: "De Finne 1", regio: "02", post: "56" },
            "koudum": { display: "Koudum", address: "Tjalke van der Walstraat 32", regio: "02", post: "56" },
            "makkum": { display: "Makkum", address: "Suderseewei 1b", regio: "02", post: "56" },
            "parrega": { display: "Parrega", address: "Trekweg 116a", regio: "02", post: "56" },
            "sneek": { display: "Sneek", address: "Malta 1", regio: "02", post: "57" },
            "stavoren": { display: "Stavoren", address: "Meerweg 10", regio: "02", post: "57" },
            "witmarsum": { display: "Witmarsum", address: "Ulbe Hiemstrastrjitte 21", regio: "02", post: "57" },
            "workum": { display: "Workum", address: "Konvintsdyk 2", regio: "02", post: "57" },
            "woudsend": { display: "Woudsend", address: "Yndyksterleane 1a", regio: "02", post: "57" },
            "mantgum": { display: "Mantgum", address: "Skillaerderdyk 15", regio: "02", post: "60" },
            "wommels": { display: "Wommels", address: "Terp 31", regio: "02", post: "60" },
            "leeuwarden hoofdpost": { display: "Leeuwarden Hoofdpost", address: "Aldlânsdyk 11", regio: "02", post: "61" },
            "leeuwarden noord": { display: "Leeuwarden Noord", address: "Ludinga 1", regio: "02", post: "61" },
            "akkrum": { display: "Akkrum", address: "It Vegelinskampke 12", regio: "02", post: "63" },
            "grou": { display: "Grou", address: "Oedsmawei 17", regio: "02", post: "63" },
            "heerenveen": { display: "Heerenveen", address: "It Hege Stik 8", regio: "02", post: "64" },
            "jubbega": { display: "Jubbega", address: "Siemen Brinkmaweg 26", regio: "02", post: "64" },
            "nieuwehorne": { display: "Nieuwehorne", address: "Schoterlandseweg 69", regio: "02", post: "64" },
            "tjalleberd": { display: "Tjalleberd", address: "De Kluft 1", regio: "02", post: "64" },
            "joure": { display: "Joure", address: "Tolhuswei 6", regio: "02", post: "65" },
            "langweer": { display: "Langweer", address: "Pontdyk 1", regio: "02", post: "65" },
            "sint-nicolaasga": { display: "Sint-Nicolaasga", address: "Slotweg 15", regio: "02", post: "65" },
            "echten": { display: "Echten", address: "Middenweg 21", regio: "02", post: "66" },
            "lemmer": { display: "Lemmer", address: "Albert Koopmanstraat 1", regio: "02", post: "66" },
            "noordwolde": { display: "Noordwolde", address: "Hellingstraat 2", regio: "02", post: "67" },
            "scherpenzeel": { display: "Scherpenzeel (Frl)", address: "Grindweg 135", regio: "02", post: "67" },
            "wolvega": { display: "Wolvega", address: "Grafietstraat 1", regio: "02", post: "67" },
            "appelscha": { display: "Appelscha", address: "Industrieweg 8c", regio: "02", post: "68" },
            "haulerwijk": { display: "Haulerwijk", address: "Eikensingel 18", regio: "02", post: "68" },
            "oldeberkoop": { display: "Oldeberkoop", address: "Willinge Prinsstraat 18c", regio: "02", post: "68" },
            "oosterwolde": { display: "Oosterwolde", address: "Dertien Aprilstraat 42a", regio: "02", post: "68" },
            "beetsterzwaag": { display: "Beetsterzwaag", address: "Van Lyndenlaan 3", regio: "02", post: "69" },
            "gorredijk": { display: "Gorredijk", address: "Leitswei 3", regio: "02", post: "69" },
            "ureterp": { display: "Ureterp", address: "De Gilden 21", regio: "02", post: "69" },
            "drachten": { display: "Drachten", address: "Loswal 1", regio: "02", post: "70" },
            "oudega": { display: "Oudega", address: "Gariperwei 30", regio: "02", post: "70" },
            "burgum": { display: "Burgum", address: "Meester W.M. Oppedijk van Veenweg 24A", regio: "02", post: "71" },
            "giekerk": { display: "Giekerk", address: "Rinia van Nautaweg 4d", regio: "02", post: "71" },
            "philips drachten": { display: "Philips Drachten", address: "De Lange West 17", regio: "02", post: "75" },
            "norg": { display: "Norg", address: "Eenerstraat 69", regio: "03", post: "80" },
            "peize": { display: "Peize", address: "De Aanleg 4", regio: "03", post: "80" },
            "roden": { display: "Roden", address: "Westeresch 20", regio: "03", post: "80" },
            "veenhuizen": { display: "Veenhuizen", address: "Oude Gracht 6", regio: "03", post: "80" },
            "eelde": { display: "Eelde", address: "Burg. J.G. Legroweg 29a", regio: "03", post: "81" },
            "vries": { display: "Vries", address: "Westerstraat 26", regio: "03", post: "81" },
            "zuidlaren": { display: "Zuidlaren", address: "Havenstraat 6", regio: "03", post: "81" },
            "assen hoofdpost west": { display: "Assen Hoofdpost (west)", address: "Mien Ruysweg 1", regio: "03", post: "82" },
            "assen nevenpost": { display: "Assen Nevenpost", address: "Stelmakerstraat 28", regio: "03", post: "82" },
            "beilen": { display: "Beilen", address: "Gentiaan 34", regio: "03", post: "83" },
            "smilde": { display: "Smilde", address: "Hoofdweg 27", regio: "03", post: "83" },
            "westerbork": { display: "Westerbork", address: "Sliemkampen 2", regio: "03", post: "83" },
            "annen": { display: "Annen", address: "Spijkerboorsdijk 3", regio: "03", post: "84" },
            "gasselternijveen": { display: "Gasselternijveen", address: "Vogelshemweg 20", regio: "03", post: "84" },
            "gieten": { display: "Gieten", address: "Oelenboom 8a", regio: "03", post: "84" },
            "rolde": { display: "Rolde", address: "Grote Brink 22", regio: "03", post: "84" },
            "2e exloermond": { display: "2e Exloërmond", address: "Middenkijl 1", regio: "03", post: "85" },
            "borger": { display: "Borger", address: "IJzertijdstraat 1", regio: "03", post: "85" },
            "emmen": { display: "Emmen", address: "Nijbracht 43a", regio: "03", post: "86" },
            "emmer-compascuum": { display: "Emmer-Compascuum", address: "Kijlweg 1", regio: "03", post: "87" },
            "klazienaveen": { display: "Klazienaveen", address: "Derksweg 267", regio: "03", post: "87" },
            "schoonebeek": { display: "Schoonebeek", address: "De Pienhoek 16", regio: "03", post: "87" },
            "coevorden": { display: "Coevorden", address: "Hulsvoorderdijk 2", regio: "03", post: "88" },
            "schoonoord": { display: "Schoonoord", address: "Alle Boelensstraat 29", regio: "03", post: "88" },
            "sleen": { display: "Sleen", address: "Boelkenweg 7", regio: "03", post: "88" },
            "zweeloo": { display: "Zweeloo", address: "Burg. Tonkensstraat 5", regio: "03", post: "88" },
            "zwinderen": { display: "Zwinderen", address: "Brinkweg 5b", regio: "03", post: "88" },
            "hoogeveen": { display: "Hoogeveen", address: "Industrieweg 2", regio: "03", post: "89" },
            "noordwijk-de wijk": { display: "Noordwijk-De Wijk", address: "Zuiderkanaalweg 16", regio: "03", post: "90" },
            "ruinen": { display: "Ruinen", address: "Kloosterstraat 5", regio: "03", post: "90" },
            "ruinerwold": { display: "Ruinerwold", address: "Gieser Wildemans 1", regio: "03", post: "90" },
            "zuidwolde": { display: "Zuidwolde", address: "Industrieweg 34", regio: "03", post: "90" },
            "dwingeloo": { display: "Dwingeloo", address: "Valderseweg 77", regio: "03", post: "91" },
            "havelte": { display: "Havelte", address: "Molenweg 3a", regio: "03", post: "91" },
            "vledder": { display: "Vledder", address: "Kerkhoflaan 2", regio: "03", post: "91" },
            "meppel": { display: "Meppel", address: "Paradijsweg 1", regio: "03", post: "92" },
            "bedrijfsbrandweer forbo novilon coevorden": { display: "Bedrijfsbrandweer Forbo Novilon Coevorden", address: "De Holwert 12", regio: "03", post: "88" },
            "fokker aircraft hoogeveen": { display: "Fokker Aircraft Hoogeveen", address: "Europaweg 7903 TD", regio: "03", post: "93" },
            "bon wijster": { display: "BON Wijster", address: "Weegbrugweg 2a", regio: "03", post: "94" },
            "bedrijfsbrandweer falck emmen": { display: "Bedrijfsbrandweer FALCK Emmen", address: "Eerste Bokslootweg 17", regio: null, post: null },
            "eelde airport-03": { display: "03-XX Eelde Airport", address: "Machlaan", regio: null, post: null },
            "tt circuit assen": { display: "03-XX TT Circuit Assen", address: "De Haar", regio: null, post: null },
            "giethoorn": { display: "Giethoorn", address: "Bartus Warnersweg 1", regio: "04", post: "12" },
            "kuinre": { display: "Kuinre", address: "De Schans 2a", regio: "04", post: "12" },
            "oldemarkt": { display: "Oldemarkt", address: "Industrieweg 3", regio: "04", post: "12" },
            "steenwijk": { display: "Steenwijk", address: "Vendelweg 3", regio: "04", post: "12" },
            "vollenhove": { display: "Vollenhove", address: "De Weyert 1", regio: "04", post: "12" },
            "ijsselmuiden": { display: "IJsselmuiden", address: "Goudplevier 121", regio: "04", post: "14" },
            "kampen": { display: "Kampen", address: "Jan Ligthartstraat 9", regio: "04", post: "14" },
            "zwolle hoofdpost": { display: "Zwolle (Hoofdpost)", address: "Marsweg 39", regio: "04", post: "16" },
            "zwolle noord": { display: "Zwolle Noord", address: "Middelweg 235", regio: "04", post: "16" },
            "genemuiden": { display: "Genemuiden", address: "Stuivenbergstraat 15", regio: "04", post: "18" },
            "hasselt": { display: "Hasselt", address: "Tijlswegje 2", regio: "04", post: "18" },
            "zwartsluis": { display: "Zwartsluis", address: "Zomerdijk 41", regio: "04", post: "18" },
            "staphorst": { display: "Staphorst", address: "Gemeenteweg 36", regio: "04", post: "19" },
            "dalfsen": { display: "Dalfsen", address: "Prins Hendrikstraat 2", regio: "04", post: "20" },
            "lemelerveld": { display: "Lemelerveld", address: "Nijverheidstraat 8", regio: "04", post: "20" },
            "nieuwleusen": { display: "Nieuwleusen", address: "Westeinde 19b", regio: "04", post: "20" },
            "ommen": { display: "Ommen", address: "Schurinkstraat 44a", regio: "04", post: "22" },
            "balkbrug": { display: "Balkbrug", address: "Meppelerweg 2", regio: "04", post: "23" },
            "bergentheim": { display: "Bergentheim", address: "Kanaalweg West 65a", regio: "04", post: "23" },
            "de krim": { display: "De Krim", address: "Hoofdweg 70", regio: "04", post: "23" },
            "dedemsvaart": { display: "Dedemsvaart", address: "Hoofdvaart 51", regio: "04", post: "23" },
            "gramsbergen": { display: "Gramsbergen", address: "De Oostermaat 59b", regio: "04", post: "23" },
            "hardenberg": { display: "Hardenberg", address: "Europaweg 10", regio: "04", post: "23" },
            "slagharen": { display: "Slagharen", address: "Coevorderweg-Noord 36a", regio: "04", post: "23" },
            "olst": { display: "Olst", address: "Industrieweg 3", regio: "04", post: "25" },
            "welsum": { display: "Welsum", address: "Kapellenkamp 2", regio: "04", post: "25" },
            "wesepe": { display: "Wesepe", address: "Eikenweg 3", regio: "04", post: "25" },
            "wijhe": { display: "Wijhe", address: "Industrieweg 6", regio: "04", post: "25" },
            "heeten": { display: "Heeten", address: "IJzerweg 23", regio: "04", post: "26" },
            "heino": { display: "Heino", address: "Marktstraat 72", regio: "04", post: "26" },
            "luttenberg": { display: "Luttenberg", address: "Witte Hekke 8", regio: "04", post: "26" },
            "raalte": { display: "Raalte", address: "Aakstraat 2", regio: "04", post: "26" },
            "bathmen": { display: "Bathmen", address: "Koekendijk 9", regio: "04", post: "28" },
            "deventer": { display: "Deventer", address: "Schonenvaardersstraat 5", regio: "04", post: "28" },
            "diepenveen": { display: "Diepenveen", address: "Oranjelaan 63a", regio: "04", post: "28" },
            "opleidingscentrum bogo": { display: "OpleidingsCentrum BOGO", address: "De Netelhorst 17", regio: null, post: null },
            "hengelo centrum": { display: "Hengelo Centrum", address: "Lansinkesweg 59 Hengelo", regio: "05", post: "11" },
            "hengelo noord": { display: "Hengelo Noord", address: "Torenlaan 2a", regio: "05", post: "12" },
            "borne": { display: "Borne", address: "De Bieffel 11", regio: "05", post: "13" },
            "goor": { display: "Goor", address: "Van Kollaan 19", regio: "05", post: "14" },
            "delden": { display: "Delden", address: "De Berken 2b", regio: "05", post: "15" },
            "markelo": { display: "Markelo", address: "Schoolstraat 13a", regio: "05", post: "16" },
            "diepenheim": { display: "Diepenheim", address: "Wilsonweg 6", regio: "05", post: "17" },
            "oldenzaal": { display: "Oldenzaal", address: "Ossenmaatstraat 1", regio: "05", post: "21" },
            "losser": { display: "Losser", address: "Broekhoekweg 40", regio: "05", post: "22" },
            "denekamp": { display: "Denekamp", address: "Nordhornsestraat 66", regio: "05", post: "23" },
            "tubbergen": { display: "Tubbergen", address: "Reutummerweg 6", regio: "05", post: "24" },
            "de lutte": { display: "De Lutte", address: "Lossersestraat 16", regio: "05", post: "25" },
            "ootmarsum": { display: "Ootmarsum", address: "Laagestraat 4", regio: "05", post: "26" },
            "weerselo": { display: "Weerselo", address: "Legtenbergerstraat 3-5", regio: "05", post: "27" },
            "almelo": { display: "Almelo", address: "Henri Dunantstraat 11", regio: "05", post: "31" },
            "den ham": { display: "Den Ham", address: "Dorpsstraat 49", regio: "05", post: "34" },
            "vroomshoop": { display: "Vroomshoop", address: "Plantsoen 8", regio: "05", post: "35" },
            "vriezenveen": { display: "Vriezenveen", address: "De Zuivering 30", regio: "05", post: "36" },
            "enschede hoofdpost": { display: "Enschede Hoofdpost", address: "Spaansland 20", regio: "05", post: "41" },
            "enschede noord": { display: "Enschede Noord", address: "Lijsterstraat 15", regio: "05", post: "42" },
            "glanerbrug": { display: "Glanerbrug", address: "Heidevlinder 2a", regio: "05", post: "43" },
            "boekelo": { display: "Boekelo", address: "Verzetslaan 21", regio: "05", post: "44" },
            "haaksbergen": { display: "Haaksbergen", address: "Parallelweg 2", regio: "05", post: "45" },
            "rijssen": { display: "Rijssen", address: "Molenstalweg 17", regio: "05", post: "51" },
            "holten": { display: "Holten", address: "Eg 6", regio: "05", post: "52" },
            "hellendoorn": { display: "Hellendoorn", address: "Kasteelstraat 9", regio: "05", post: "53" },
            "nijverdal": { display: "Nijverdal", address: "Kerkstraat 140", regio: "05", post: "54" },
            "wierden": { display: "Wierden", address: "Tulpenstraat 1", regio: "05", post: "55" },
            "enter": { display: "Enter", address: "Vonderweg 2", regio: "05", post: "56" },
            "oefencentrum troned": { display: "Oefencentrum Troned", address: "Oude Vliegveldstraat", regio: "05", post: "80" },
            "bedrijfsbrandweer elementis": { display: "Bedrijfsbrandweer Elementis", address: "Langestraat 167 Delden", regio: "05", post: "82" },
            "apollo vredestein enschede": { display: "Apollo Vredestein Enschede", address: "Ingenieur Schiffstraat 370", regio: "05", post: "84" },
            "hierden": { display: "Hierden", address: "Ooster Mheenweg 6", regio: "06", post: "10" },
            "harderwijk": { display: "Harderwijk", address: "Maltezerlaan 1", regio: "06", post: "11" },
            "ermelo": { display: "Ermelo", address: "Oude Telgterweg 181", regio: "06", post: "12" },
            "wapenveld": { display: "Wapenveld", address: "W.H. van de Pollstraat 48", regio: "06", post: "13" },
            "heerde": { display: "Heerde", address: "Rhijnsburglaan 52", regio: "06", post: "14" },
            "elburg": { display: "Elburg", address: "Oostendorperstraatweg 8", regio: "06", post: "15" },
            "nunspeet": { display: "Nunspeet", address: "Elburgerweg 13", regio: "06", post: "16" },
            "elspeet": { display: "Elspeet", address: "Vierhouterweg 22a", regio: "06", post: "17" },
            "oldebroek": { display: "Oldebroek", address: "Zuiderzeestraatweg 213b", regio: "06", post: "18" },
            "wezep": { display: "Wezep", address: "Rondweg 15", regio: "06", post: "19" },
            "hattem": { display: "Hattem", address: "Verlengde Parklaan 36", regio: "06", post: "20" },
            "putten": { display: "Putten", address: "Kelnarijstraat 10", regio: "06", post: "21" },
            "epe": { display: "Epe", address: "Kweekweg 1", regio: "06", post: "22" },
            "oene": { display: "Oene", address: "Dorpsstraat 5", regio: "06", post: "23" },
            "vaassen": { display: "Vaassen", address: "Laan van Fasna 69", regio: "06", post: "24" },
            "uddel": { display: "Uddel", address: "Uttilochweg 8", regio: "06", post: "25" },
            "apeldoorn-centrum": { display: "Apeldoorn-Centrum", address: "Vosselmanstraat 203", regio: "06", post: "26" },
            "ugchelen": { display: "Ugchelen", address: "G.P. Duuringlaan 13", regio: "06", post: "27" },
            "hoog soeren": { display: "Hoog Soeren", address: "Hoog Soeren 53", regio: "06", post: "28" },
            "beekbergen": { display: "Beekbergen", address: "Van Schaffelaarweg 2", regio: "06", post: "29" },
            "hoenderloo": { display: "Hoenderloo", address: "Brinkenbergweg 6", regio: "06", post: "30" },
            "loenen": { display: "Loenen (Gld)", address: "Leeuwenbergweg 13", regio: "06", post: "31" },
            "apeldoorn de maten": { display: "Apeldoorn de Maten", address: "Beatrijsgaarde 2", regio: "06", post: "32" },
            "apeldoorn zuid": { display: "Apeldoorn Zuid", address: "Saba 6", regio: "06", post: "33" },
            "klarenbeek": { display: "Klarenbeek", address: "Klarenbeekseweg 127a", regio: "06", post: "34" },
            "terwolde": { display: "Terwolde", address: "Dorpsstraat 57", regio: "06", post: "35" },
            "twello": { display: "Twello", address: "Zuiderlaan 9", regio: "06", post: "36" },
            "voorst": { display: "Voorst", address: "Wilhelminaweg 24", regio: "06", post: "37" },
            "eerbeek": { display: "Eerbeek", address: "Smeestraat 4a", regio: "06", post: "38" },
            "brummen": { display: "Brummen", address: "Oude Eerbeekseweg 44", regio: "06", post: "39" },
            "zutphen": { display: "Zutphen", address: "Gerard Doustraat 129", regio: "06", post: "40" },
            "gorssel": { display: "Gorssel", address: "Hoofdstraat 14a", regio: "06", post: "41" },
            "laren": { display: "Laren (Gld)", address: "Zutphenseweg 22", regio: "06", post: "42" },
            "almen": { display: "Almen", address: "Binnenweg 46", regio: "06", post: "43" },
            "lochem": { display: "Lochem", address: "Albert Hahnweg 7", regio: "06", post: "44" },
            "barchem": { display: "Barchem", address: "Van Damstraat 2", regio: "06", post: "45" },
            "neede": { display: "Neede", address: "Oude Eibergseweg 20", regio: "06", post: "46" },
            "borculo": { display: "Borculo", address: "Haarloseweg 202", regio: "06", post: "47" },
            "eibergen": { display: "Eibergen", address: "Nijverheidsstraat 2", regio: "06", post: "48" },
            "ruurlo": { display: "Ruurlo", address: "Groenloseweg 10a", regio: "06", post: "49" },
            "didam": { display: "Didam", address: "Vincwijkcweg 1c", regio: "06", post: "50" },
            "s-heerenberg": { display: "'s-Heerenberg", address: "Zeddamseweg 77b", regio: "06", post: "51" },
            "wehl": { display: "Wehl", address: "Didamseweg 26", regio: "06", post: "52" },
            "doetinchem": { display: "Doetinchem", address: "Stokhorstweg 1", regio: "06", post: "53" },
            "gendringen": { display: "Gendringen", address: "Nijverheidsweg 27", regio: "06", post: "54" },
            "silvolde": { display: "Silvolde", address: "De Breide 74", regio: "06", post: "55" },
            "varsseveld": { display: "Varsseveld", address: "Klaproosstraat 28", regio: "06", post: "56" },
            "vorden": { display: "Vorden", address: "Rondweg 6", regio: "06", post: "57" },
            "steenderen": { display: "Steenderen", address: "Dr. Alfons Ariënsstraat 33c", regio: "06", post: "58" },
            "hengelo gd": { display: "Hengelo GD", address: "Zelhemseweg 27", regio: "06", post: "59" },
            "zelhem": { display: "Zelhem", address: "Industriepark 2", regio: "06", post: "60" },
            "dinxperlo": { display: "Dinxperlo", address: "Nieuwstraat 2", regio: "06", post: "61" },
            "aalten": { display: "Aalten", address: "Tramstraat 1", regio: "06", post: "62" },
            "lichtenvoorde": { display: "Lichtenvoorde", address: "Vragenderweg 5", regio: "06", post: "63" },
            "groenlo": { display: "Groenlo", address: "Oude Winterswijkseweg 22", regio: "06", post: "64" },
            "winterswijk": { display: "Winterswijk", address: "Europark 16", regio: "06", post: "65" },
            "loenen-vakbekwaamheidsplein": { display: "Loenen (Vakbekwaamheidsplein)", address: "Veldhuizen 3", regio: null, post: null },
            "bedrijfsbrandweer folding boxboard eerbeek": { display: "Bedrijfsbrandweer Folding Boxboard Eerbeek", address: "Coldenhovenseweg 12", regio: null, post: null },
            "bedrijfsbrandweer aviko steenderen": { display: "Bedrijfsbrandweer Aviko Steenderen", address: "Nijverheidsweg 6, 7221 CK Steenderen", regio: null, post: null },
            "hoofdkantoor vnog": { display: "Hoofdkantoor VNOG", address: "Europaweg 77", regio: null, post: null },
            "nijkerk": { display: "Nijkerk", address: "Havenstraat 5", regio: "07", post: "11" },
            "hoevelaken": { display: "Hoevelaken", address: "De Wel 5", regio: "07", post: "12" },
            "garderen": { display: "Garderen", address: "Oud Milligenseweg 12", regio: "07", post: "13" },
            "voorthuizen": { display: "Voorthuizen", address: "Wheemstraat 10", regio: "07", post: "14" },
            "zwartebroek": { display: "Zwartebroek", address: "Eendrachtstraat 48", regio: "07", post: "15" },
            "kootwijkerbroek": { display: "Kootwijkerbroek", address: "Drieenhuizerweg 5", regio: "07", post: "16" },
            "barneveld beekstraat": { display: "Barneveld Beekstraat", address: "Beekstraat 53", regio: "07", post: "17" },
            "barneveld nijkerkerweg": { display: "Barneveld Nijkerkerweg", address: "Nijkerkerweg 119", regio: "07", post: "17" },
            "harskamp": { display: "Harskamp", address: "Dorpsstraat 106a", regio: "07", post: "21" },
            "de valk": { display: "De Valk", address: "Lage Valkseweg 119", regio: "07", post: "22" },
            "otterlo": { display: "Otterlo", address: "Harskamperweg 30a", regio: "07", post: "23" },
            "lunteren": { display: "Lunteren", address: "Zilvervoslaan 29", regio: "07", post: "24" },
            "ederveen": { display: "Ederveen", address: "Sneeuwbesstraat 8", regio: "07", post: "25" },
            "ede centrum": { display: "Ede Centrum", address: "Breelaan 4", regio: "07", post: "27" },
            "ede stadspoort": { display: "Ede Stadspoort", address: "Willy Brandtlaan 1", regio: "07", post: "28" },
            "bennekom": { display: "Bennekom", address: "Bergakkerplein 1", regio: "07", post: "29" },
            "wageningen": { display: "Wageningen", address: "Marijkeweg 25", regio: "07", post: "31" },
            "wolfheze": { display: "Wolfheze", address: "Parallelweg 2", regio: "07", post: "32" },
            "oosterbeek": { display: "Oosterbeek", address: "Steynweg 3", regio: "07", post: "33" },
            "doorwerth": { display: "Doorwerth", address: "Van der Mollenalle 10", regio: "07", post: "34" },
            "renkum-heelsum": { display: "Renkum-Heelsum", address: "Utrechtseweg 131", regio: "07", post: "35" },
            "arnhem noord": { display: "Arnhem Noord", address: "Rietgrachtstraat 74", regio: "07", post: "36" },
            "arnhem zuid": { display: "Arnhem Zuid", address: "Groningensingel 1249", regio: "07", post: "37" },
            "heteren": { display: "Heteren", address: "Polderstraat 1", regio: "07", post: "41" },
            "elst": { display: "Elst", address: "De Korte Helster 1", regio: "07", post: "42" },
            "zetten": { display: "Zetten", address: "Sint Walburg 1b", regio: "07", post: "43" },
            "valburg": { display: "Valburg", address: "De Vang 1", regio: "07", post: "44" },
            "oosterhout": { display: "Oosterhout (Gld)", address: "Dorpsstraat 3a", regio: "07", post: "45" },
            "huissen": { display: "Huissen", address: "Kampstuk 21", regio: "07", post: "46" },
            "doornenburg": { display: "Doornenburg", address: "Vijzelpad 9", regio: "07", post: "47" },
            "bemmel": { display: "Bemmel", address: "Karstraat 18", regio: "07", post: "48" },
            "gendt": { display: "Gendt", address: "Dorpstraat 72a", regio: "07", post: "49" },
            "dieren": { display: "Dieren", address: "Burgemeester Bloemersstraat 1", regio: "07", post: "51" },
            "rheden": { display: "Rheden", address: "Worth Rhedenseweg 66", regio: "07", post: "52" },
            "velp": { display: "Velp", address: "Noorder Parallelweg 21", regio: "07", post: "53" },
            "giesbeek": { display: "Giesbeek", address: "Dorpsplein 7", regio: "07", post: "54" },
            "zevenaar": { display: "Zevenaar", address: "Professor Aalbersestraat 3", regio: "07", post: "55" },
            "duiven": { display: "Duiven", address: "Ploenstraat 3", regio: "07", post: "56" },
            "doesburg": { display: "Doesburg", address: "Halve Maanweg 3", regio: "07", post: "57" },
            "pannerden": { display: "Pannerden", address: "Renbaan 1c", regio: "07", post: "58" },
            "lobith-tolkamer": { display: "Lobith-Tolkamer", address: "Industrieweg 1a", regio: "07", post: "59" },
            "norske skog parneco-renkum": { display: "Norske Skog Parneco-Renkum", address: "Veerweg 1 (Bedrijfsbrandweer)", regio: "07", post: "83" },
            "logistiek gelderland-midden": { display: "Logistiek — Poort van Midden Gelderland", address: "Rood 5", regio: null, post: null },
            "groesbeek": { display: "Groesbeek", address: "Industrieweg 9", regio: "08", post: "11" },
            "millingen aan den rijn": { display: "Millingen aan den Rijn", address: "Heerbaan 65", regio: "08", post: "12" },
            "ubbergen": { display: "Ubbergen", address: "Nieuwe Rijksweg 1", regio: "08", post: "13" },
            "nijmegen centrum": { display: "Nijmegen Centrum", address: "Prof. Bellefroidstraat 11", regio: "08", post: "21" },
            "lent": { display: "Lent", address: "Spoorstraat 31", regio: "08", post: "22" },
            "nijmegen west": { display: "Nijmegen West", address: "Nieuwe Dukenburgseweg 23", regio: "08", post: "23" },
            "malden": { display: "Malden", address: "Ambachtsweg 9", regio: "08", post: "31" },
            "overasselt": { display: "Overasselt", address: "Kasteelsestraat 3", regio: "08", post: "32" },
            "wijchen": { display: "Wijchen", address: "Bronckhorstlaan 5", regio: "08", post: "33" },
            "beneden leeuwen": { display: "Beneden Leeuwen", address: "Van Heemstraweg 64c", regio: "08", post: "41" },
            "beuningen": { display: "Beuningen", address: "Van Heemstraweg 95", regio: "08", post: "42" },
            "dreumel": { display: "Dreumel", address: "Margrietstraat 12b", regio: "08", post: "43" },
            "druten": { display: "Druten", address: "Van Heemstraweg 52a", regio: "08", post: "44" },
            "maasbommel": { display: "Maasbommel", address: "Kapelstraat 21a", regio: "08", post: "45" },
            "brakel": { display: "Brakel", address: "Molenkampsweg 9", regio: "08", post: "51" },
            "gameren": { display: "Gameren", address: "Middelkampseweg 4", regio: "08", post: "52" },
        };

        // Looks up STATION_ADDRESS_DATA for a building's caption. Exact
        // normalized match ONLY — several real Dutch place names repeat across
        // regions (Loenen exists in both Gelderland and Utrecht, Scherpenzeel
        // in both Gelderland and Friesland, Oosterhout in both Gelderland and
        // Noord-Brabant). A fuzzy/word-boundary fallback here would risk
        // silently attaching the wrong region's address to a building — exact
        // match is the only way to stay safe without cross-checking regio too.
        function findStationAddress(building) {
            const stripped = stripPrefix(normalize(building.caption));
            return STATION_ADDRESS_DATA[stripped] || null;
        }

        /* ========================================================================
         * REFERENCE DATA — real Politie Midden-Nederland basisteam numbers
         * (district Oost-Utrecht) — same table as the vehicle namer.
         * ==================================================================== */
        const MD_BASISTEAMS = {
            'amersfoort': { num: 31, team: 'Amersfoort' },
            'baarn': { num: 32, team: 'Eemland-Noord' }, 'eemland': { num: 32, team: 'Eemland-Noord' }, 'soest': { num: 32, team: 'Eemland-Noord' },
            'zeist': { num: 33, team: 'Heuvelrug' }, 'bunnik': { num: 33, team: 'Heuvelrug' }, 'leusden': { num: 33, team: 'Heuvelrug' }, 'woudenberg': { num: 33, team: 'Heuvelrug' },
            'veenendaal': { num: 34, team: 'Veenendaal' }, 'doorn': { num: 34, team: 'Veenendaal' }, 'heuvelrug': { num: 34, team: 'Veenendaal' }, 'wijk bij duurstede': { num: 34, team: 'Veenendaal' },
        };
        const POLICE_UNIT_ABBR = {
            '01': 'Noord-Nederland', '02': 'Noord-Nederland', '03': 'Noord-Nederland', '04': 'Oost-Nederland',
            '05': 'Oost-Nederland', '06': 'Oost-Nederland', '07': 'Oost-Nederland', '08': 'Oost-Nederland',
            '09': 'Midden-Nederland', '10': 'Noord-Holland', '11': 'Noord-Holland', '12': 'Noord-Holland',
            '13': 'Amsterdam', '14': 'Midden-Nederland', '15': 'Den Haag', '16': 'Den Haag', '17': 'Rotterdam',
            '18': 'Rotterdam', '19': 'Zeeland-West-Brabant', '20': 'Zeeland-West-Brabant', '21': 'Oost-Brabant',
            '22': 'Oost-Brabant', '23': 'Limburg', '24': 'Limburg', '25': 'Midden-Nederland',
        };

        /* ========================================================================
         * REFERENCE DATA — known real aircraft bases (matched by keyword, same
         * list as the vehicle namer).
         * ==================================================================== */
        const KNOWN_AIRCRAFT_BASES = [
            { match: /amsterdam.*heliport|vumc|\bamc\b/i, name: 'Traumaheli Standplaats AMC (Lifeliner 1)' },
            { match: /radboud|nijmeg/i, name: 'Traumaheli Standplaats Radboudumc (Lifeliner 3)' },
            { match: /luchtvaartpolitie|politiehelikopter/i, name: 'Landelijke Eenheid — Dienst Luchtvaartpolitie' },
            { match: /schiphol/i, name: 'Vliegbasis / Brandweer Schiphol' },
        ];

        /* ========================================================================
         * REFERENCE DATA — building_type -> discipline & Dutch generic label
         * ==================================================================== */
        const BUILDING_TYPE_DISCIPLINE = {
            0: 'fire', 17: 'fire',
            3: 'ambulance', 13: 'ambulance',
            5: 'police', 11: 'police', 18: 'police',
            6: 'aviation', 9: 'aviation', 19: 'aviation', 21: 'aviation',
            22: 'rws',
            23: 'military', 25: 'military', // 25 confirmed live (KMar kazernes: Generaal-Majoor Kootkazerne, Van Braam Houckgeestkazerne, Sergeant-Majoor Scheickkazerne) — same discipline/label as 23
            1: 'meldkamer', // confirmed live: "Meldkamer Huis Ter Heide", "Meldkamer Amerongen"
            2: 'hospital', // confirmed live: hospitals (Meander Medisch Centrum, Ziekenhuis Gelderse Vallei, St Antonius Nieuwegein, Gelre Ziekenhuizen, Diakonessenhuis Utrecht, UMC Utrecht) — carries a `patient_count` field too
            4: 'education', // confirmed live: training institutes (Nederlands Instituut Publieke Veiligheid, Stichting Brandweeropleidingen Bogo)
            8: 'police_academy', // confirmed live: "Politieacademie Leusden" (Loes van Overeemlaan 11, Leusden) — distinct from regular police (5/11/18)
            27: 'rail', // confirmed live: "Prorail Amersfoort Centraal"
        };
        // Game silently drops a rename that runs too long (POST returns 200,
        // caption unchanged) — confirmed live at 41 and 45 chars, confirmed OK
        // at 33. Cap conservatively and shorten the label word before ever
        // truncating the actual place name.
        const SAFE_NAME_LENGTH = 38;
        const LABEL_SHORTENING = {
            'Brandweerkazerne': 'Brandweer',
            'Ambulancepost': 'Ambulance',
            'Politiebureau': 'Politie',
            'Opleidingsinstituut': 'Opleiding',
            'Kazerne (Defensie)': 'Defensie',
            'RWS Steunpunt': 'RWS',
            'Politieacademie': 'Politieacad.',
        };
        function enforceNameLength(name) {
            let out = name;
            if (out.length <= SAFE_NAME_LENGTH) return out;
            for (const [long, short] of Object.entries(LABEL_SHORTENING)) {
                if (out.includes(long)) {
                    out = out.replace(long, short);
                    if (out.length <= SAFE_NAME_LENGTH) return out;
                }
            }
            if (out.length > SAFE_NAME_LENGTH) {
                out = out.slice(0, SAFE_NAME_LENGTH).replace(/\s+\S*$/, '').trim();
            }
            return out;
        }

        const DISCIPLINE_LABEL = {
            fire: 'Brandweerkazerne',
            ambulance: 'Ambulancepost',
            police: 'Politiebureau',
            aviation: 'Vliegbasis',
            rws: 'RWS Steunpunt',
            military: 'Kazerne (Defensie)',
            meldkamer: 'Meldkamer',
            hospital: 'Ziekenhuis',
            education: 'Opleidingsinstituut',
            police_academy: 'Politieacademie',
            rail: 'Spoor',
        };
        // Disciplines that are NEVER auto-renamed. Hospitals, meldkamers,
        // training institutes, police academies, military kazernes, and rail
        // posts are each named after a SPECIFIC real-world institution (a
        // hospital's actual name, a named kazerne, ...) — there's no "place +
        // generic label" formula that reconstructs that correctly, unlike
        // fire/ambulance/police which follow a real, regular numbering/naming
        // convention. Guessing one is exactly what corrupted several real
        // hospitals/kazernes into "Post <place>" before. These get recognized
        // (so they don't spam the unclassified log) but always left exactly as
        // they are.
        const NO_RENAME_DISCIPLINES = new Set(['meldkamer', 'hospital', 'education', 'police_academy', 'military', 'rail']);

        // Any building_type NOT in BUILDING_TYPE_DISCIPLINE at all (something we
        // haven't seen live yet) returns null here — NEVER a guessed generic
        // label. An unclassified building is left completely untouched in-game
        // and shows up in the "unclassified" log — tell Claude its building_type
        // and real caption so it can be added properly.
        function classifyDiscipline(buildingType) {
            return BUILDING_TYPE_DISCIPLINE[buildingType] || null;
        }

        /* ========================================================================
         * Manual overrides — put exact names you want here, keyed by building id.
         * Always wins over everything else.
         * ==================================================================== */
        const MANUAL_BUILDING_OVERRIDES = {
            // 123456: 'Brandweerkazerne Amersfoort-Noord',

            // Real names, restored 2026-09-14 after an earlier version of this
            // script wrongly renamed these to generic "Post <place>" — verified
            // either directly (the real name was still visible after "Post ")
            // or via live OSM/Overpass coordinate lookup against the building's
            // own latitude/longitude.
            2570149: 'Meander Medisch Centrum',
            3146758: 'Generaal-Majoor Kootkazerne',
            3146759: 'Van Braam Houckgeestkazerne',
            3145075: 'Meldkamer Huis Ter Heide',
            2555705: 'Ziekenhuis Gelderse Vallei',
            2596197: 'Stichting Brandweeropleidingen Bogo',
            3148143: 'St Antonius Nieuwegein',
            3143906: 'Prorail Amersfoort Centraal',
            3147502: 'Sergeant-Majoor Scheickkazerne',
            2570083: 'Gelre Ziekenhuizen',
            425940: 'Meldkamer Amerongen',
            3148146: 'Diakonessenhuis Utrecht', // OSM Overpass: exact coordinate match (52.0816,5.1385)
            3147450: 'UMC Utrecht', // OSM Overpass: exact coordinate match (52.0870,5.1803)
            3147469: 'Meander Medisch Centrum Baarn', // OSM Overpass: exact coordinate match (52.2147,5.2769)
            2596153: 'Politieacademie Leusden', // confirmed via politieacademie.nl's own locations page
            2571136: 'VRU Opleidingen', // OSM Overpass: exact coordinate match (52.0950,5.1533) with Archimedeslaan 6, Utrecht — VRU's own HQ address
        };

        /* ========================================================================
         * NAME GENERATION
         * ==================================================================== */
        function computeTarget(building) {
            if (MANUAL_BUILDING_OVERRIDES[building.id]) {
                return { name: MANUAL_BUILDING_OVERRIDES[building.id], manual: true };
            }

            const discipline = classifyDiscipline(building.building_type);
            if (!discipline) return null; // unknown building_type — leave completely untouched, never guess a label
            if (NO_RENAME_DISCIPLINES.has(discipline)) return null; // recognized, but never auto-renamed — see NO_RENAME_DISCIPLINES
            const stripped = stripPrefix(normalize(building.caption));
            if (!stripped) return null; // nothing to derive a place name from

            if (discipline === 'aviation') {
                for (const base of KNOWN_AIRCRAFT_BASES) {
                    if (base.match.test(building.caption)) return { name: base.name, exact: true };
                }
            }

            const label = DISCIPLINE_LABEL[discipline];
            const rawStationData = findStationAddress(building);

            // Several real Dutch place names repeat across regions (Elst exists
            // in both Utrecht and Gelderland, Loenen in both Gelderland and
            // Utrecht, Scherpenzeel in both Gelderland and Friesland,
            // Oosterhout in both Gelderland and Noord-Brabant, ...). Only trust
            // STATION_ADDRESS_DATA's address/display for a given building once
            // its region is confirmed to match — either the entry has no region
            // of its own (a one-off heliport/hospital/etc., unambiguous by
            // name), or it agrees with the regio this building was independently
            // resolved to. Otherwise silently drop the address rather than risk
            // attaching the wrong town's street to this building.
            // Trust the data unless we have a SPECIFIC, resolved regio for this
            // building that actively disagrees with it (that's the real Elst/
            // Loenen/Scherpenzeel/Oosterhout collision case). When nothing else
            // is known about the building's region, there's nothing to conflict
            // with, so the entry's own region stands — rejecting it in that case
            // would just silently drop addresses for most of the newly-covered
            // towns, which aren't in the older, much smaller PLACE_TO_REGIO list.
            function stationDataForRegio(expectedRegio) {
                if (!rawStationData) return null;
                if (!rawStationData.regio || !expectedRegio) return rawStationData;
                return rawStationData.regio === expectedRegio ? rawStationData : null;
            }

            if (discipline === 'fire') {
                // Utrecht/Gelderland-Midden's own verified sheet is authoritative
                // for the post number when it has one. Otherwise, if
                // STATION_ADDRESS_DATA itself carries a regio+post for this exact
                // place, that IS the confirmed region for this building (the
                // number came from that same entry) — use it as-is, no
                // cross-check needed since there's nothing else to cross-check
                // it against yet.
                const post = findFirePostCode(building)
                    || (rawStationData && rawStationData.regio && rawStationData.post
                        ? { regio: rawStationData.regio, post: rawStationData.post }
                        : null);
                const regio = post ? post.regio : regioForBuilding(building);
                const stationData = stationDataForRegio(regio);
                const place = stationData ? stationData.display : displayPlaceName(stripped);
                // The real address is NOT put in the display name — the game
                // silently rejected a name that included one (POST returned 200
                // but the caption never actually changed, likely a server-side
                // length cap). Kept as `address` on the returned object purely
                // for the OSM crosscheck to use internally.
                const address = stationData ? stationData.address : null;
                if (post) return { name: `${post.regio}-${post.post} ${label} ${place}`, exact: true, place, address, regio };
                return { name: `${regio ? regio + ' ' : ''}${label} ${place}`, place, address, regio };
            }

            const regio = regioForBuilding(building);
            const stationData = stationDataForRegio(regio);
            const place = stationData ? stationData.display : displayPlaceName(stripped);
            const address = stationData ? stationData.address : null;

            if (discipline === 'police') {
                // No parenthetical team-name / "Eenheid X" suffix — same info,
                // shorter. The game silently drops renames that run too long
                // (confirmed live), so keep police names to label+place, plus
                // just the basisteam number when known.
                const teamInfo = Object.entries(MD_BASISTEAMS).find(([p]) => wordBoundaryIncludes(stripped, p));
                if (teamInfo) return { name: `${label} ${place} (BT ${teamInfo[1].num})`, exact: true, place, address, regio };
                return { name: `${label} ${place}`, place, address, regio };
            }

            if (discipline === 'ambulance') {
                return { name: `${regio ? regio + ' ' : ''}${label} ${place}`, place, address, regio };
            }

            // aviation (no exact match), rws, military, other
            return { name: `${label} ${place}`, place, address, regio };
        }

        /* ========================================================================
         * UNIQUENESS
         * ==================================================================== */
        // Never invents a suffix like " (2)". Returns the name if free, or null
        // on a real collision — caller then leaves the building untouched and
        // logs it. usedNames holds every building's CURRENT caption, so a
        // building whose computed name equals its own caption must not count as
        // colliding with itself (that self-collision was what produced "(2)").
        // "Is this what I would have named it?" Feed the computed name back in as
        // if it were the building's caption: a correct name must come out the
        // same. If it drifts (label stacking, place lookup changing), renaming
        // would repeat on every scan or update, so the building is left alone.
        function stableTarget(building) {
            const target = computeTarget(building);
            if (!target) return { target: null };
            target.name = enforceNameLength(target.name);
            if (target.name === building.caption) return { target };
            const again = computeTarget({ ...building, caption: target.name });
            if (again && enforceNameLength(again.name) !== target.name) return { target: null, unstable: target.name };
            return { target };
        }

        function claimName(name, building, usedNames) {
            if (name === building.caption) return name;
            if (usedNames.has(name)) return null;
            usedNames.add(name);
            return name;
        }

        /* ========================================================================
         * GAME API
         * ==================================================================== */
        async function fetchWithTimeout(url, opts, timeoutMs) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs || CONFIG.REQUEST_TIMEOUT_MS);
            try {
                return await fetch(url, { ...opts, signal: controller.signal });
            } finally {
                clearTimeout(timer);
            }
        }
        async function apiGet(path) {
            const res = await fetchWithTimeout(path, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
            if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
            return res.json();
        }
        const getBuildings = () => apiGet('/api/buildings');
        const getBuilding = (id) => apiGet(`/api/buildings/${id}`);

        /* ========================================================================
         * IN-GAME RENAME MECHANISM — mirrors the vehicle namer's approach exactly:
         * fetch the rename form off-screen, copy every field, swap in the new
         * name, POST it ourselves via fetch() so a real page navigation can never
         * kill an in-progress rename queue.
         *
         * ASSUMPTION: /buildings/:id/editName exists and behaves like
         * /vehicles/:id/editName. If meldkamerspel.com's building rename uses a
         * different URL or field names, this will fail loudly below (check the
         * console) — tell Claude the actual endpoint/form and it can be fixed
         * in one line.
         * ==================================================================== */
        async function renameBuildingInGame(buildingId, newName) {
            const trimmed = newName.slice(0, CONFIG.MAX_NAME_LENGTH);

            // Last-line guard: never write a "(n)" collision-style suffix in-game.
            if (/\s\(\d+\)$/.test(trimmed)) {
                err(`(${buildingId}) refusing to rename to "${trimmed}" — collision-style suffix`);
                return false;
            }

            if (CONFIG.DRY_RUN) {
                log(`[DRY RUN] would rename building ${buildingId} -> "${trimmed}"`);
                return true;
            }

            log(`(${buildingId}) fetching edit form...`);
            // Confirmed via live devtools capture: GET /buildings/:id/edit
            // returns a normal Rails edit form — id="edit_building_:id", action
            // /buildings/:id, method POST with a hidden _method=patch field, and
            // the name field is #building_name / name="building[name]".
            const html = await fetchWithTimeout(`/buildings/${buildingId}/edit`, { credentials: 'same-origin' }).then((r) => r.text());

            const doc = new DOMParser().parseFromString(html, 'text/html');
            const form = doc.querySelector(`#edit_building_${buildingId}`) || doc.querySelector('form');
            if (!form) {
                err(`(${buildingId}) no <form> found in the fetched edit page. Raw HTML:`, html);
                return false;
            }

            const nameInput = form.querySelector('#building_name')
                || form.querySelector('input[name="building[name]"]')
                || form.querySelector('input[name*=name]')
                || form.querySelector('input[type=text]');
            if (!nameInput || !nameInput.name) {
                err(`(${buildingId}) no usable name <input> (with a "name" attribute) found. Form HTML:`, form.outerHTML);
                return false;
            }

            const action = form.getAttribute('action') || `/buildings/${buildingId}`;
            const url = new URL(action, location.origin);

            const body = new URLSearchParams();
            form.querySelectorAll('input[name], select[name], textarea[name]').forEach((el) => {
                if (el === nameInput) return;
                if ((el.type === 'checkbox' || el.type === 'radio') && !el.checked) return;
                body.append(el.name, el.value);
            });
            body.append(nameInput.name, trimmed);

            log(`(${buildingId}) posting to ${url.pathname} ...`);
            let res;
            try {
                res = await fetchWithTimeout(url.toString(), {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: {
                        'X-Requested-With': 'XMLHttpRequest',
                        'Content-Type': 'application/x-www-form-urlencoded',
                    },
                    body: body.toString(),
                });
            } catch (e) {
                err(`(${buildingId}) rename POST failed/timed out`, e);
                return false;
            }
            if (!res.ok) {
                err(`(${buildingId}) rename POST returned HTTP ${res.status}`);
                return false;
            }

            try {
                const fresh = await getBuilding(buildingId);
                if (fresh && fresh.caption === trimmed) {
                    log(`(${buildingId}) confirmed: caption is now "${trimmed}"`);
                    return true;
                }
                err(`(${buildingId}) POST succeeded but caption is still "${fresh && fresh.caption}" (expected "${trimmed}") — the form field name may be wrong for this site version.`);
                return false;
            } catch (e) {
                warn(`(${buildingId}) could not verify rename (network error on re-fetch), assuming it worked since POST returned OK`, e);
                return true;
            }
        }

        /* ========================================================================
         * MAIN ENGINE
         * ==================================================================== */
        const renameQueue = [];
        let queueRunning = false;
        let queueTotal = 0;
        let queueDone = 0;
        let queueFailed = 0;

        // What the dashboard shows.
        const captionById = new Map();
        const planned = new Map();   // dry run: buildingId -> { from, to }
        const recent = [];           // last renames: { id, from, to, at, ok }
        const stats = { buildings: 0, lastScan: 0, scanning: false };

        function enqueueRename(buildingId, name) {
            if (CONFIG.DRY_RUN) {
                planned.set(buildingId, { from: captionById.get(buildingId) || '', to: name });
                return;
            }
            if (renameQueue.some((q) => q.buildingId === buildingId)) return;
            renameQueue.push({ buildingId, name });
            queueTotal++;
            if (!queueRunning) runQueue();
        }

        async function runQueue() {
            queueRunning = true;
            while (renameQueue.length) {
                const { buildingId, name } = renameQueue.shift();
                setStatus(`Hernoemen ${queueDone + 1}/${queueTotal}: ${name}`, 'busy', [queueDone, queueTotal]);
                try {
                    const ok = await renameBuildingInGame(buildingId, name);
                    recent.unshift({ id: buildingId, from: captionById.get(buildingId) || '', to: name, at: Date.now(), ok });
                    recent.length = Math.min(recent.length, 100);
                    if (ok) captionById.set(buildingId, name);
                    if (ok) { log(`renamed building ${buildingId} -> "${name}"`); queueDone++; }
                    else { queueFailed++; }
                } catch (e) {
                    err(`failed to rename building ${buildingId}`, e);
                    queueFailed++;
                }
                ctx.refresh();
                await new Promise((r) => setTimeout(r, CONFIG.RENAME_THROTTLE_MS));
            }
            queueRunning = false;
            queueTotal = 0; queueDone = 0; queueFailed = 0;
            idleStatus();
            persistAll();
            ctx.refresh();
        }

        /* ========================================================================
         * OSM (NOMINATIM) CROSSCHECK
         *
         * Advisory only — this NEVER changes what gets renamed in-game. It runs
         * alongside the rename queue and logs, per building, whether OpenStreetMap
         * data agrees with what we're about to name it. Review with the "Show
         * OSM crosscheck log" panel button (or bn.printCrosscheckLog() in the
         * console).
         *
         * Rate-limited to Nominatim's own usage policy (~1 req/sec, identifying
         * Referer/User-Agent) via a throttled queue, same pattern as the rename
         * queue. Results are cached indefinitely in GM storage so re-scans don't
         * re-query the same place over and over.
         * ==================================================================== */
        function osmRequest(cacheKey, url) {
            if (osmCache[cacheKey] !== undefined) return Promise.resolve(osmCache[cacheKey]);
            return new Promise((resolve) => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url,
                    timeout: CONFIG.OSM_REQUEST_TIMEOUT_MS,
                    headers: { 'Accept-Language': 'nl' },
                    onload: (res) => {
                        let parsed = null;
                        try { parsed = JSON.parse(res.responseText); } catch (e) { /* fall through with null */ }
                        // /search returns an array, /reverse returns a single object (or {error: ...})
                        const result = Array.isArray(parsed) ? (parsed[0] || null) : (parsed && !parsed.error ? parsed : null);
                        osmCache[cacheKey] = result;
                        resolve(result);
                    },
                    onerror: () => resolve(undefined), // undefined = request failed, distinct from null = confirmed no match
                    ontimeout: () => resolve(undefined),
                });
            });
        }
        function osmSearch(query) {
            return osmRequest(`search:${query}`, `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=1&countrycodes=nl&q=${encodeURIComponent(query)}`);
        }
        function osmReverse(lat, lon) {
            const key = `reverse:${lat},${lon}`;
            return osmRequest(key, `https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`);
        }

        // The game's /api/buildings shape isn't documented anywhere we could
        // check — this tries every plausible field-name pair a building object
        // might carry its real-world coordinates under. If none match, the
        // caller falls back to a forward text search instead. If you know the
        // actual field names, tell Claude and this can just be two lines.
        const LAT_KEYS = ['lat', 'latitude', 'y', 'pos_lat', 'position_lat', 'map_lat'];
        const LON_KEYS = ['lon', 'lng', 'longitude', 'x', 'pos_lon', 'pos_lng', 'position_lng', 'map_lon', 'map_lng'];
        function extractCoords(building) {
            let lat, lon;
            for (const k of LAT_KEYS) if (building[k] !== undefined && building[k] !== null) { lat = Number(building[k]); break; }
            for (const k of LON_KEYS) if (building[k] !== undefined && building[k] !== null) { lon = Number(building[k]); break; }
            if (building.location && typeof building.location === 'object') {
                if (lat === undefined) lat = Number(building.location.lat ?? building.location.latitude);
                if (lon === undefined) lon = Number(building.location.lon ?? building.location.lng ?? building.location.longitude);
            }
            if (building.coordinates && typeof building.coordinates === 'object') {
                if (lat === undefined) lat = Number(building.coordinates.lat ?? building.coordinates.latitude);
                if (lon === undefined) lon = Number(building.coordinates.lon ?? building.coordinates.lng ?? building.coordinates.longitude);
            }
            // Sanity range check — real Dutch coordinates only, so a stray
            // unrelated numeric field (id, building_type, ...) can't get read as
            // a coordinate and sent off to Nominatim.
            if (Number.isFinite(lat) && Number.isFinite(lon) && lat > 50 && lat < 54 && lon > 2 && lon < 8) {
                return { lat, lon };
            }
            return null;
        }

        // Loose overlap check: does any "word" (4+ chars, to skip "de"/"van"/etc)
        // from `needle` appear in `haystack`? Good enough for "does this address
        // text plausibly describe the same place" without demanding an exact
        // string match, which real-world address formatting differences would
        // never satisfy anyway.
        function looseTextOverlap(haystack, needle) {
            const h = normalize(haystack);
            const words = normalize(needle).split(' ').filter((w) => w.length >= 4);
            if (!words.length) return null; // nothing meaningful to compare
            return words.some((w) => h.includes(w));
        }

        async function crosscheckBuilding(building, target) {
            // Reuse EXACTLY what computeTarget already resolved (target.place /
            // target.address) rather than re-deriving them here. Re-deriving via
            // a fresh findStationAddress() call would bypass computeTarget's
            // region-collision guard (see stationDataForRegio there) and could
            // crosscheck an ambiguous place — e.g. "Elst" — against the WRONG
            // region's address even though the assigned name itself was correct.
            const discipline = classifyDiscipline(building.building_type);
            const place = target.place || displayPlaceName(stripPrefix(normalize(building.caption)));
            const ourAddress = target.address || null;

            // Strongest check available: if the building object itself carries
            // real-world coordinates, reverse-geocode THOSE instead of guessing
            // a search query from the name — this confirms the actual building,
            // not just "a place with a similar name somewhere in NL".
            const coords = extractCoords(building);
            let osmResult;
            let query;
            if (coords) {
                query = `reverse ${coords.lat.toFixed(5)},${coords.lon.toFixed(5)}`;
                osmResult = await osmReverse(coords.lat, coords.lon);
            } else if (ourAddress) {
                query = `${ourAddress}, ${place}, Netherlands`;
                osmResult = await osmSearch(query);
            } else {
                query = `${DISCIPLINE_LABEL[discipline]} ${place}, Netherlands`;
                osmResult = await osmSearch(query);
            }

            let entry;
            if (osmResult === undefined) {
                entry = { status: 'request_failed' };
            } else if (!osmResult) {
                entry = { status: 'no_osm_result' };
            } else {
                const osmAddressText = [osmResult.display_name, osmResult.address && osmResult.address.postcode].filter(Boolean).join(' ');
                if (coords) {
                    // Reverse geocode: compare against whichever real place name we
                    // assigned (from the address data if we have it, else the
                    // display place name) — this is checking "does the real
                    // location agree with what we called it", the actual point of
                    // having coordinates at all.
                    const overlap = looseTextOverlap(osmAddressText, place) || (ourAddress && looseTextOverlap(osmAddressText, ourAddress));
                    entry = overlap === false
                        ? { status: 'possible_mismatch', ourPlace: place, ourAddress, osmAddress: osmResult.display_name, source: 'coords' }
                        : { status: 'consistent', source: 'coords' };
                } else if (ourAddress) {
                    const overlap = looseTextOverlap(osmAddressText, ourAddress) || looseTextOverlap(osmAddressText, place);
                    entry = overlap === false
                        ? { status: 'possible_mismatch', ourAddress, osmAddress: osmResult.display_name, source: 'name-search' }
                        : { status: 'consistent', source: 'name-search' };
                } else {
                    // We had no address of our own for this one — surface what OSM
                    // found as a candidate to manually add to STATION_ADDRESS_DATA.
                    entry = { status: 'suggested_address', osmAddress: osmResult.display_name, osmType: osmResult.type };
                }
            }

            osmCrosscheckLog[building.id] = {
                buildingId: building.id,
                place,
                ourName: target.name,
                query,
                ...entry,
            };
        }

        const crosscheckQueue = [];
        let crosscheckRunning = false;

        function enqueueCrosscheck(building, target) {
            if (!CONFIG.ENABLE_OSM_CROSSCHECK) return;
            crosscheckQueue.push({ building, target });
            if (!crosscheckRunning) runCrosscheckQueue();
        }

        async function runCrosscheckQueue() {
            crosscheckRunning = true;
            while (crosscheckQueue.length) {
                const { building, target } = crosscheckQueue.shift();
                try {
                    await crosscheckBuilding(building, target);
                } catch (e) {
                    warn(`(${building.id}) OSM crosscheck failed`, e);
                }
                store.set('bn_osmCache', osmCache);
                store.set('bn_osmCrosscheckLog', osmCrosscheckLog);
                await new Promise((r) => setTimeout(r, CONFIG.OSM_THROTTLE_MS));
            }
            crosscheckRunning = false;
            if (CONFIG.DEBUG) printCrosscheckLog(true);
            ctx.refresh();
        }

        function printCrosscheckLog(summaryOnly) {
            const rows = Object.values(osmCrosscheckLog);
            if (!rows.length) { log('no OSM crosscheck data yet.'); return; }
            const mismatches = rows.filter((r) => r.status === 'possible_mismatch');
            const suggestions = rows.filter((r) => r.status === 'suggested_address');
            const noResult = rows.filter((r) => r.status === 'no_osm_result' || r.status === 'request_failed');
            log(`OSM crosscheck: ${rows.length} checked — ${mismatches.length} possible mismatch(es), ${suggestions.length} address suggestion(s), ${noResult.length} unconfirmed.`);
            if (summaryOnly && !mismatches.length && !suggestions.length) return;
            if (mismatches.length) {
                console.log('%c[BuildingNamer] possible mismatches — our data disagrees with OSM, review by hand:', 'color:#e33');
                console.table(mismatches);
            }
            if (suggestions.length) {
                console.log('%c[BuildingNamer] OSM found an address we didn\'t have — candidates to add to STATION_ADDRESS_DATA:', 'color:#0a7');
                console.table(suggestions);
            }
        }

        async function fullScan() {
            if (!hasMemory) return memoryMissing();
            if (stats.scanning) return;
            stats.scanning = true;
            setStatus('Controleren…', 'busy');
            if (CONFIG.DRY_RUN) planned.clear();
            try { await fullScanInner(); } finally { stats.scanning = false; }
            if (!queueRunning) idleStatus();
            ctx.refresh();
        }

        async function fullScanInner() {
            log('running full scan...');
            let buildings;
            try {
                buildings = await getBuildings();
            } catch (e) {
                err('could not fetch /api/buildings', e);
                setStatus(`Kon gebouwen niet ophalen: ${e.message}`, 'error');
                return;
            }
            unclassifiedLog = {};

            const usedNames = new Set(buildings.map((b) => b.caption));
            captionById.clear();
            buildings.forEach((b) => captionById.set(b.id, b.caption));
            stats.buildings = buildings.length;
            stats.lastScan = Date.now();
            let renameCount = 0;

            for (const building of buildings) {
                const existing = assignments[building.id];
                if (existing && existing.name === building.caption) continue;

                let target;
                if (existing) {
                    target = existing;
                    usedNames.add(target.name);
                } else {
                    const res = stableTarget(building);
                    target = res.target;
                    if (res.unstable) {
                        recordUnclassified(building, `computed name "${res.unstable}" would change again on the next scan — left untouched`);
                        continue;
                    }
                    if (!target) {
                        if (!isDeliberatelySkipped(building)) recordUnclassified(building, 'unknown building_type or no place name could be derived');
                        continue;
                    }
                    const claimed = claimName(target.name, building, usedNames);
                    if (!claimed) {
                        recordUnclassified(building, `name collision: "${target.name}" already used by another building — left untouched`);
                        continue;
                    }
                    target.name = claimed;
                    assignments[building.id] = target;
                }

                if (target.name !== building.caption) {
                    enqueueRename(building.id, target.name);
                    renameCount++;
                }
                if (!osmCrosscheckLog[building.id]) enqueueCrosscheck(building, target);
            }

            knownBuildingIds = buildings.map((b) => b.id);
            persistAll();
            log(`full scan complete — ${renameCount} building(s) queued for rename`);
            if (CONFIG.DEBUG) printUnclassifiedLog();
        }

        async function pollNewBuildings() {
            if (!hasMemory || stats.scanning) return;
            let buildings;
            try {
                buildings = await getBuildings();
            } catch (e) {
                err('poll: could not fetch /api/buildings', e);
                return;
            }
            const known = new Set(knownBuildingIds);
            const fresh = buildings.filter((b) => !known.has(b.id));
            if (!fresh.length) return;

            log(`found ${fresh.length} newly acquired building(s)`);
            const usedNames = new Set(buildings.map((b) => b.caption));
            buildings.forEach((b) => captionById.set(b.id, b.caption));
            stats.buildings = buildings.length;

            for (const building of fresh) {
                const { target, unstable } = stableTarget(building);
                if (unstable) {
                    recordUnclassified(building, `computed name "${unstable}" would change again on the next scan — left untouched`);
                    continue;
                }
                if (!target) {
                    if (!isDeliberatelySkipped(building)) recordUnclassified(building, 'unknown building_type or no place name could be derived');
                    continue;
                }
                const claimed = claimName(target.name, building, usedNames);
                if (!claimed) {
                    recordUnclassified(building, `name collision: "${target.name}" already used by another building — left untouched`);
                    continue;
                }
                target.name = claimed;
                assignments[building.id] = target;
                if (target.name !== building.caption) enqueueRename(building.id, target.name);
                enqueueCrosscheck(building, target);
            }

            knownBuildingIds = buildings.map((b) => b.id);
            persistAll();
            if (CONFIG.DEBUG) printUnclassifiedLog();
            ctx.refresh();
        }

        /* ========================================================================
         * DASHBOARD
         * ==================================================================== */
        function setStatus(text, tone = 'idle', progress) {
            // Only busy/error states go to the dock; idle stays in the dashboard.
            ctx.status(text, { tone, progress, dock: tone === 'busy' || tone === 'error' });
            if (CONFIG.DEBUG) log('status:', text);
        }

        function idleStatus() {
            if (!hasMemory) return memoryMissing();
            const unknown = Object.keys(unclassifiedLog).length;
            const when = stats.lastScan ? new Date(stats.lastScan).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }) : '–';
            setStatus(`${stats.buildings} gebouwen in orde · controle ${when}${unknown ? ` · ${unknown} niet hernoemd` : ''}`, unknown ? 'warn' : 'ok');
        }

        function memoryMissing() {
            setStatus('Wacht: geheugen van het oude script ontbreekt', 'warn');
        }

        const esc = ctx.esc;
        const table = (head, rows) => `<div class="mks-tblwrap"><table class="mks-tbl"><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
            <tbody>${rows.join('')}</tbody></table></div>`;
        const bLink = (id, text) => `<a href="/buildings/${id}" target="_blank">${esc(text)}</a>`;

        ctx.panel((el) => {
            const unknown = Object.values(unclassifiedLog);
            const failed = recent.filter((r) => !r.ok).length;
            const osm = Object.values(osmCrosscheckLog);
            const mismatches = osm.filter((r) => r.status === 'possible_mismatch');
            const suggestions = osm.filter((r) => r.status === 'suggested_address');
            let html = `<h4 class="mks-h">Stand</h4><div class="mks-tiles">
                <div class="mks-tile"><div class="v">${ctx.nl(stats.buildings)}</div><div class="k">gebouwen</div></div>
                <div class="mks-tile"><div class="v">${renameQueue.length}</div><div class="k">in wachtrij</div></div>
                <div class="mks-tile"><div class="v">${recent.filter((r) => r.ok).length}</div><div class="k">hernoemd (deze sessie)</div></div>
                <div class="mks-tile ${failed ? 't-error' : ''}"><div class="v">${failed}</div><div class="k">mislukt</div></div>
                <div class="mks-tile ${unknown.length ? 't-warn' : ''}"><div class="v">${unknown.length}</div><div class="k">niet hernoemd</div></div>
                ${CONFIG.ENABLE_OSM_CROSSCHECK ? `<div class="mks-tile ${mismatches.length ? 't-warn' : ''}"><div class="v">${mismatches.length}</div><div class="k">OSM-verschillen (${osm.length} gecontroleerd)</div></div>` : ''}
            </div>`;

            if (recent.length) {
                html += '<h4 class="mks-h">Laatst hernoemd</h4>' + table(['Tijd', 'Was', 'Nu', ''], recent.slice(0, 50).map((r) => `<tr>
                    <td class="mono">${new Date(r.at).toLocaleTimeString('nl-NL')}</td><td>${esc(r.from)}</td><td>${bLink(r.id, r.to)}</td>
                    <td>${r.ok ? '<span class="mks-pill t-ok">ok</span>' : '<span class="mks-pill t-error">mislukt</span>'}</td></tr>`));
            }

            if (unknown.length) {
                html += `<h4 class="mks-h">Niet hernoemd (${unknown.length})</h4>`
                    + table(['Gebouw', 'Type', 'Reden'], unknown.map((u) => `<tr><td>${bLink(u.buildingId, u.currentName)}</td>
                        <td class="mono">${esc(u.buildingType)}</td><td>${esc(u.reason)}</td></tr>`));
            }

            if (mismatches.length || suggestions.length) {
                html += `<h4 class="mks-h">OpenStreetMap</h4>
                    <p class="mks-note">Alleen ter controle: <b>verschil</b> = onze gegevens en OSM zijn het oneens, kijk zelf even.
                    <b>adres</b> = OSM vond een adres dat nog niet in de lijst stond.</p>`
                    + table(['Gebouw', '', 'Onze naam', 'OSM'], [...mismatches, ...suggestions].map((r) => `<tr>
                        <td>${bLink(r.buildingId, captionById.get(r.buildingId) || r.buildingId)}</td>
                        <td>${r.status === 'possible_mismatch' ? '<span class="mks-pill t-warn">verschil</span>' : '<span class="mks-pill t-busy">adres</span>'}</td>
                        <td>${esc(r.ourName)}</td><td class="mks-dim">${esc(r.osmAddress)}</td></tr>`));
            }
            el.innerHTML = html;
        });

        if (hasMemory) {
            ctx.actions([
                { label: 'Nu controleren', kind: 'primary', run: () => fullScan(), title: 'Alle gebouwen nalopen' },
                { label: 'Kopieer niet-hernoemde (JSON)', run: async () => {
                    const text = JSON.stringify(Object.values(unclassifiedLog), null, 2);
                    try { await navigator.clipboard.writeText(text); } catch (e) { prompt('Kopieer:', text); }
                } },
            ]);
        }

        ctx.onSettings(() => {
            {
                idleStatus();
                ctx.refresh();
            }
        });

        /* ========================================================================
         * BOOT
         * ==================================================================== */
        log('starting — DRY_RUN =', CONFIG.DRY_RUN);
        window.bn = { fullScan, printUnclassifiedLog, printCrosscheckLog, extractCoords };
        if (!hasMemory) {
            memoryMissing();
            return;
        }
        fullScan();
        setInterval(pollNewBuildings, CONFIG.POLL_NEW_BUILDINGS_MS);
        setInterval(fullScan, CONFIG.FULL_RESCAN_MS);
    },
});
