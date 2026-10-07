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
        { key: 'airKm', label: 'Maximale afstand helikopters', type: 'number', default: 100, min: 1, max: 500, step: 5, unit: 'km',
            help: 'Lifeliner, Politiehelikopter, SAR-heli en FBO-Heli vliegen en mogen van verder komen.' },
        { key: 'needAll', label: 'Alleen als alles beschikbaar is', type: 'bool', default: true,
            help: 'Uit: stuurt ook als het spel meldt dat er voertuigen tekort zijn (stuurt dan wat er wel is).' },
        { key: 'ownJobOnly', label: 'Niet als gewone voertuigen', type: 'text', default: 'TS-BO, TS-GO',
            help: 'Voertuigsoorten met komma\'s ertussen die alleen gaan als een inzet ze zelf vraagt, niet als gewone tankautospuit, '
                + 'slangenwagen of voor water. Bijvoorbeeld: TS-BO, TS-GO, TS-IB, TS-Spoor, DB-RI.' },
        { key: 'ignoreShort', label: 'Tekort negeren bij', type: 'text', default: 'Incidentenbestrijder',
            help: 'Namen met komma\'s ertussen, zoals het spel ze noemt ("te weinig: 1 Incidentenbestrijder"). '
                + 'Is alleen hiervan te weinig, dan gaat de rest toch. Telt nog wel mee in de tekortlijst.' },
        { key: 'topUp', label: 'Bijsturen bij rode melding', type: 'bool', default: true,
            help: 'Ook inzetten waar al voertuigen zijn, maar het spel "Missende voertuigen" meldt: stuurt alleen wat daar staat. '
                + 'Wacht tot er niets meer onderweg is, zodat er niets dubbel gaat.' },
        { key: 'patients', label: 'Patiënten: ambulance, MMT en OvD-G', type: 'bool', default: true,
            help: 'Leest per patiënt wat nodig is ("We benodigen: MMT-Arts, OvD-G"): een ambulance per patiënt, '
                + 'één MMT tegelijk (de volgende in een latere ronde als het nog nodig is) en hooguit één OvD-G per inzet. '
                + 'Ook bij inzetten waar al voertuigen staan.' },
        { key: 'ovdgFrom', label: 'OvD-G vanaf zoveel patiënten', type: 'number', default: 5, min: 0, max: 100, step: 1,
            help: 'Een nieuwe inzet met zoveel patiënten of meer krijgt een OvD-G mee, ook als de inzet er zelf niet om vraagt, '
                + 'als die vrij is en binnen de maximale afstand. '
                + 'Geen OvD-G vrij: de rest gaat toch. 0 = uit.' },
        { key: 'bigCredits', label: 'Grote inzet vanaf', type: 'number', default: 5000, min: 0, max: 100000, step: 500, unit: 'credits',
            help: 'Inzetten gaan altijd op volgorde van credits, hoogste eerst. Wordt een grote inzet overgeslagen omdat er iets te weinig is, '
                + 'dan houdt het zijn zeldzame voertuigen vast: kleinere inzetten krijgen die even niet. 0 = niets vasthouden.' },
        { key: 'rareMax', label: 'Zeldzaam: hooguit zoveel vrij', type: 'number', default: 2, min: 0, max: 20, step: 1,
            help: 'Een voertuigsoort die de grote inzet nodig heeft en waarvan er zoveel of minder vrij zijn (of geen), wordt voor die inzet bewaard.' },
        { key: 'holdMin', label: 'Bewaren voor grote inzet', type: 'number', default: 20, min: 1, max: 120, step: 1, unit: 'min',
            help: 'Daarna mogen kleinere inzetten ze weer gebruiken, zodat niets voorgoed vastloopt. De grote inzet wordt ondertussen elke minuut opnieuw bekeken.' },
        { key: 'bigPatients', label: 'Grote inzet: meer dan zoveel patiënten', type: 'number', default: 30, min: 0, max: 500, step: 5,
            help: 'Daar mogen ambulances in delen: te weinig of te ver weg houdt de rest niet tegen. De patiënten vragen daarna zelf '
                + 'om de rest ("We benodigen: ambulance") en die gaan in de volgende rondes. 0 = uit.' },
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
            // police_horse counts horses: the game's police_horse_count field adds up the
            // horses per truck (its riders), the police_horse field would count trucks.
            bike_police: 'bike_police', police_horse: 'police_horse_count', military_police: 'military_police',
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
            // Only named in the red box ("Verzorgingseenheid"), not a requirement key: the DB-VZ.
            care_service: 'care_service',
        };

        // Trained personnel -> the vehicle whose whole crew has that training, and
        // its minimum crew. "2x Verzorger" = 1 DB-VZ (2 to 4 Verzorgers on board).
        // Keyed by the name in "Missende personeel" and by the einsaetze.json key.
        const PERSONNEL = [
            { names: ['verzorger', 'care_service'], to: 'care_service', crew: 2 },
            { names: ['hygiënemedewerker', 'clean_service'], to: 'vt:122', crew: 2 },
            { names: ['handcrew', 'wildfire'], to: 'vt:86', crew: 7 },
            { names: ['gevaarlijke stoffen eenheid', 'hazard_material_response'], to: 'vt:135', crew: 4 },
            { names: ['ontsmettings eenheid', 'hazard_suits_response'], to: 'vt:140', crew: 6 },
            { names: ['teamlid usar', 'search_and_rescue'], to: 'search_and_rescue', crew: 5 },
        ];
        const personnelFor = (name) => PERSONNEL.find((p) => p.names.includes(String(name).toLowerCase().trim()));
        const VT_CAPTION = { 64: 'ME Aanhoudingseenheid', 77: 'KW-boot', 80: 'SAR-heli', 84: 'Waterwerper', 85: 'FBO-Heli', 124: 'DB-PC-LOG', 129: 'DB-TDV', 87: 'DA-LA-NB', 90: 'TS-STH', 91: 'HVH-STH', 93: 'TS-USAR', 94: 'VW-USAR', 97: 'DB–Speurhonden', 99: 'DB-VOA',
            100: 'GGB', 101: 'NHT', 116: 'DB-Explosievenhonden', 117: 'DB-Explosievenduikers', 118: 'BA-DDG', 119: 'DB-TEV', 128: 'DB-DRONE',
            145: 'OvD-ICB', 146: 'VW-VZ-ICB', 148: 'GM-ICB', 86: 'DB-Handcrew', 122: 'DB-AH', 135: 'DB-GS', 140: 'DB-BO' };

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
            // Seen only in the red box.
            'verzorgingseenheden': 'care_service', 'officier van dienst brandweer': 'battalion_chief_vehicles',
            'hoofd officier van dienst': 'mobile_command_vehicles', 'ab': 'mobile_air_vehicles',
            'slangenwagen, watertankwagen of gelijkwaardige haakarmbak': 'water_tankers',
        };
        // Every vehicle type by its full name, for red boxes that name the type
        // itself ("Officier van Dienst - Politie", "Dienstbus Arrestantenvervoer").
        // Last resort after LABELS: those cover more vehicles per name.
        const VT_NAMES = {
            "SI-2": 0, "TS 8/9": 1, "Autoladder": 2, "DA - Officier van Dienst": 3, "Hulpverleningsvoertuig": 4,
            "Adembeschermingsvoertuig": 5, "TST 8/9": 6, "TST 6/7": 7, "TST 4/5": 8, "TS 4/5": 9, "Slangenwagen": 10,
            "Verkenningseenheid Brandweer": 11, "TST-NB 8/9": 12, "TST-NB 6/7": 14, "TST-NB 4/5": 15, "Ambulance": 16,
            "TS 6/7": 17, "Hoogwerker": 18, "DA - Hoofdofficier van Dienst": 19, "DA": 20, "DB Klein": 21, "DA Noodhulp": 22,
            "Lifeliner": 23, "DA - Adviseur Gevaarlijke stoffen": 24, "DB Noodhulp": 25, "Haakarmvoertuig": 26,
            "Adembeschermingshaakarmbak": 27, "Politiehelikopter": 28, "Watertankhaakarmbak": 29, "Zorgambulance": 30,
            "Commandovoertuig": 31, "Commandohaakarmbak": 32, "Waterongevallenvoertuig": 33, "Watertankwagen": 34,
            "Officier van Dienst - Politie": 35, "Waterongevallenaanhanger": 36, "MMT-Auto": 37,
            "Officier van Dienst - Geneeskunde": 38, "ME Commandovoertuig": 39, "ME Flexbus": 40, "Crashtender (8x8)": 41,
            "Crashtender (6x6)": 42, "Crashtender (4x4)": 43, "Airport Fire Officer / On Scene Commander": 44,
            "Dompelpomphaakarmbak": 45, "DM-Politie": 46, "DA Hondengeleider": 47, "DB Hondengeleider": 48, "PM-OR": 49,
            "Materieelvoertuig - Oppervlakteredding": 49, "TS-OR": 50, "Tankautospuit - Oppervlakteredding": 50,
            "HulpverleningsHaakarmbak": 51, "Rapid Responder": 52, "AT-Commandant": 53, "AT-Operator": 54, "AT-Materiaalwagen": 55,
            "DA Voorlichter": 56, "DA Officier van Dienst - Geneeskundig / Rapid Responder": 57, "DB Arrestantenvervoer": 58,
            "Noodhulp - Onopvallend": 59, "DB Biketeam": 60, "Slangenhaakarmbak": 61, "TS-HV": 62,
            "Tankautospuit-Hulpverlening": 62, "DM - Rapid Responder": 63, "ME Aanhoudingseenheid": 64,
            "DA Terreinwaardig - Reddingsbrigade": 65, "Kusthulpverleningsvoertuig": 66, "Bootaanhanger Reddingsbrigade": 67,
            "SB": 68, "SBH": 69, "SBA": 70, "MSA": 71, "DPA": 72, "Vrachtwagen - Bereden Brigade": 73,
            "Bereden Brigade Aanhanger": 74, "Dienstauto terreinvaardig - Noodhulp": 75, "Quad": 76, "KW-boot": 77, "RB-K": 78,
            "RB-G": 79, "SAR-heli": 80, "DA-RWS": 81, "Dienstvoertuig weginspecteur Rijkswaterstaat": 81, "DM-RWS": 82,
            "Dienstmotor weginspecteur Rijkswaterstaat": 82, "DA-SIG": 83, "Signalisatievoertuig": 83, "Waterwerper": 84,
            "FBO-Heli": 85, "DB-Handcrew": 86, "DA-LA-NB": 87, "VW-NB": 88, "NBH": 89, "TS-STH": 90, "HVH-STH": 91, "DB-USAR": 92,
            "TS-USAR": 93, "VW-USAR": 94, "DM-USAR": 95, "Quad-USAR": 96, "DB–Speurhonden": 97, "SIV-P": 98, "DB-VOA": 99,
            "GGB": 100, "NHT": 101, "MC-Ambulance": 102, "MICU": 103, "Berger-K": 104, "Berger-G": 105, "Berger-K (RWS)": 106,
            "Berger-G (RWS)": 107, "Berger-K (Politie)": 108, "Berger-G (Politie)": 109, "DAT-KMAR": 110, "DB-KMAR": 111,
            "DM-KMAR": 112, "DAT-EOD": 113, "DB-EOD": 114, "VW-EOD": 115, "DB-Explosievenhonden": 116,
            "DB-Explosievenduikers": 117, "BA-DDG": 118, "DB-TEV": 119, "DB-VZ": 120, "VZH": 121, "DB-AH": 122, "VZH-AH": 123,
            "DB-PC-LOG": 124, "DB-LOG": 125, "VW-LOG": 126, "BMH-LOG": 127, "DB-DRONE": 128, "DB-TDV": 129, "SB-BA": 130,
            "SB-IB": 131, "AS": 132, "TS-IB": 133, "GSH": 134, "DB-GS": 135, "GPH": 136, "DB-GP": 137, "BOH-DC": 138, "TS-BO": 139,
            "DB-BO": 140, "GOH-DC": 141, "TS-GO": 142, "DB-GO": 143, "DB-ICB": 144, "OvD-ICB": 145, "VW-VZ-ICB": 146,
            "HA-ICB": 147, "GM-ICB": 148, "HSH-ICB": 149, "VW-HS": 150, "BM-VTHS": 151, "TS-Spoor": 152, "DB-RI": 153, "RIA": 154,
            "DB-VI": 155, "VIA": 156
        };

        // Lower case, no " - ", and the long words the game abbreviates in type names.
        const normName = (s) => String(s).toLowerCase().replace(/\s+[-–]\s+/g, ' ').replace(/\s+/g, ' ').trim()
            .replace(/^dienstbus\b/, 'db').replace(/^dienstauto\b/, 'da').replace(/^dienstmotor\b/, 'dm');
        const VT_BY_NAME = new Map(Object.entries(VT_NAMES).map(([n, id]) => [normName(n), id]));

        // Singular and plural of the same Dutch name, word by word: "Noodhulpeenheid" /
        // "noodhulpeenheden", "ME Flexbus" / "me flexbussen", "Slangenwagen" / "slangenwagens",
        // "Officier van Dienst Politie" / "officiers van dienst politie".
        const pluralsOf = (w) => [w, `${w}s`, `${w}en`, `${w}'s`, `${w}’s`, `${w}${w.slice(-1)}en`, w.replace(/heid$/, 'heden')];
        const sameWord = (a, b) => pluralsOf(a).includes(b) || pluralsOf(b).includes(a);
        function sameName(x, y) {
            const a = x.split(' '), b = y.split(' ');
            return a.length === b.length && a.every((w, i) => sameWord(w, b[i]));
        }

        // One name from the red box -> requirement key. Tries the exact name, a name
        // with extra words after it ("Berger-K om het slepen te beginnen"),
        // singular/plural, a vehicle type by its full name, and finally a vehicle
        // type caption from the page.
        function keyForName(name, typeIds) {
            const n = normName(name.replace(/\.$/, ''));
            if (LABELS[n]) return LABELS[n];
            const prefix = Object.keys(LABELS).filter((l) => n.startsWith(`${l} `)).sort((a, b) => b.length - a.length)[0];
            if (prefix) return LABELS[prefix];
            const loose = Object.keys(LABELS).find((l) => sameName(n, l));
            if (loose) return LABELS[loose];
            if (VT_BY_NAME.has(n)) return `vt:${VT_BY_NAME.get(n)}`;
            if (typeIds && typeIds[n]) return `vt:${typeIds[n]}`;
            return null;
        }

        // "Arrestanten moeten vervoerd worden." has no count. When a police car on scene
        // can take them, the mission window lists cells under that car and the worker
        // picks one (prisonerCell). Only when no car there can: one more Noodhulp each
        // round, and if the box is still red the next round sends another.
        const PRISONERS = /,?\s*arrestanten moeten (?:worden )?vervoerd(?: worden)?\.?/i;
        const addPrisonerCar = (plan) => { plan.slots.fustw = Math.max(plan.slots.fustw || 0, 1); };

        // Text of the red box -> { slots, vt, vtCaptions, unknown }.
        // "Missende voertuigen: 1 DB-PC-LOG, 2 SB-BA, SB-IB of AS, 2.000 Water"
        // Items start with a number; names can contain commas themselves.
        function fromMissing(text, typeIds) {
            const out = { slots: {}, vt: {}, vtCaptions: {}, unknown: [] };
            let body = String(text).replace(/\s+/g, ' ');
            if (PRISONERS.test(body)) { body = body.replace(PRISONERS, ''); addPrisonerCar(out); }
            body = body.replace(/^[^:]*:\s*/, '').replace(/^[\s,]+|[\s,]+$/g, '').trim();
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

        // "Missende personeel: 2x Verzorger, 7x Handcrew" -> [[name, count]].
        const personnelItems = (text) => [...String(text).replace(/\s+/g, ' ').replace(/^[^:]*:\s*/, '')
            .matchAll(/(\d+)\s*x\s*([^,]+)/gi)].map((m) => [m[2].trim().replace(/\.$/, ''), Number(m[1])]);

        // Trained personnel -> vehicles, merged into a plan with max, not sum: a
        // DB-VZ the red box already asks for brings its Verzorgers along.
        function addPersonnel(plan, items, label = (n) => `Personeel: ${n}`) {
            for (const [name, n] of items) {
                const p = personnelFor(name);
                if (!p) { plan.unknown.push(label(name, n)); continue; }
                const need = Math.ceil(n / p.crew);
                if (p.to.startsWith('vt:')) {
                    const id = p.to.slice(3);
                    plan.vt[id] = Math.max(plan.vt[id] || 0, need);
                    plan.vtCaptions[id] = VT_CAPTION[id] || name;
                } else plan.slots[p.to] = Math.max(plan.slots[p.to] || 0, need);
            }
        }

        // Patient needs: "We benodigen: MMT-Arts, OvD-G" per patient (mission list)
        // or "5x We benodigen: OvD-G" for five patients (mission window).
        // One OvD-G leads all patients; MMT and ambulance are one per patient.
        const PATIENT_NEED = { 'ovd-g': 'ovdg', 'mmt-arts': 'mmt', 'mmt': 'mmt', 'ambulance': 'amb', 'ambulances': 'amb' };
        function patientNeeds(text) {
            const out = { ovdg: false, mmt: 0, amb: 0, unknown: [] };
            const re = /(?:(\d+)\s*x\s*)?We benodigen:\s*(.+?)(?=(?:\d+\s*x\s*)?We benodigen:|$)/gi;
            for (const m of String(text).replace(/\s+/g, ' ').matchAll(re)) {
                const n = Number(m[1] || 1);
                for (const raw of m[2].split(',')) {
                    const name = raw.trim().replace(/\.$/, '');
                    if (!name) continue;
                    const k = PATIENT_NEED[name.toLowerCase()];
                    if (k === 'ovdg') out.ovdg = true;
                    else if (k) out[k] += n;
                    else if (!out.unknown.includes(name)) out.unknown.push(name);
                }
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
                // A request page has the "Spraakaanvraag" heading or destination buttons
                // (cells may come without that heading). Neither: already answered.
                const asking = document.getElementById('h2_sprechwunsch')
                    || document.querySelector('a[href*="/patient/"], a[href*="/gefangener/"]');
                if (!asking) {
                    const h = [...document.querySelectorAll('h1, h2, h3')].map((x) => x.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 3).join(' | ');
                    report('skip', { reason: `geen spraakaanvraag op de voertuigpagina (${h || 'geen kopjes'})`, gone: true });
                    return;
                }

                const all = destinations();
                const { best, why } = bestDestination(all, job);
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
                // No candidates at all: keep what the page showed, to find out why from the log.
                const page = all.length ? undefined : {
                    alert: (document.querySelector('.alert')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200),
                    links: [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')).filter((h) => /patient|gefangene|transport/i.test(h)).slice(0, 8),
                    buttons: [...document.querySelectorAll('#h2_sprechwunsch ~ * a.btn, .btn-group a.btn')].map((a) => a.textContent.replace(/\s+/g, ' ').trim().slice(0, 40)).slice(0, 8),
                };
                report('skip', { reason: `geen passende ${kind === 'cell' ? 'cel' : 'ziekenhuis'} (${reasons})`, unknownNeeds: [need], page });
            } catch (e) {
                ctx.err(e);
                report('error', { reason: e.message || String(e) });
            }
        }

        // Drop what does not fit, then: enough room for everyone in the car first
        // (orange cell buttons have fewer free cells than prisoners on board),
        // cheapest, nearest (own buildings get ownKm head start).
        function bestDestination(all, job) {
            const why = {};
            const fit = all.filter((c) => {
                const r = destReason(c, job);
                if (r) why[r] = (why[r] || 0) + 1;
                return !r;
            });
            const rank = (c) => (isNaN(c.dist) ? 1e9 : c.dist) - (c.own ? job.ownKm : 0);
            const short = (c) => (c.a.classList.contains('btn-warning') ? 1 : 0);
            const best = fit.sort((x, y) => short(x) - short(y) || x.cost - y.cost || rank(x) - rank(y))[0];
            return { best, why };
        }

        // Destination rows, as the Bestemmingfilter module reads them. root: the
        // whole page, or one car's cell list in a mission window.
        function destinations(root = document) {
            const num = (s) => {
                const m = String(s).replace(/\./g, '').match(/-?\d+(?:,\d+)?/);
                return m ? parseFloat(m[0].replace(',', '.')) : NaN;
            };
            const txt = (tr, i) => (i >= 0 && tr.cells[i] ? tr.cells[i].textContent.trim() : '');
            const isRed = (el) => !!el && (el.classList.contains('btn-danger') || el.classList.contains('danger') || el.classList.contains('label-danger'));
            const DEST = 'a[href*="/patient/"]:not([href$="/-1"]), a[href*="/gefangener/"]:not([href$="/-1"])';
            const out = [];
            const seen = new Set();
            for (const table of root.querySelectorAll('table')) {
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
            for (const a of root.querySelectorAll('a[href*="/gefangener/"]:not([href$="/-1"])')) {
                if (seen.has(a)) continue;
                const t = a.textContent.replace(/\s+/g, ' ');
                const km = t.match(/(\d+(?:[.,]\d+)?)\s*km/);
                const pct = t.match(/(\d+)\s*%/);
                const freeTxt = t.match(/vrij\w*\s*(?:cel\w*)?\s*:?\s*(\d+)/i);
                out.push({
                    // "Politiebureau Leusden (BT 33) (Vrije cellen: 0, afstand: 0,26 km)"; team cells
                    // have no space before the bracket and end with "Afdrachtpercentage: 0%".
                    a, kind: 'cell', own: !pct, name: t.split(/\s*\(vrij/i)[0].trim().slice(0, 60),
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
                // "Shown" is the box's own display, not offsetParent: in our hidden
                // frame layout-based checks are not reliable.
                const shown = (el) => !!el && el.style.display !== 'none' && getComputedStyle(el).display !== 'none';
                const box = document.getElementById('missing_text');
                const missingText = shown(box) ? box.textContent.replace(/\s+/g, ' ').trim() : '';
                const driving = !!document.querySelector('#mission_vehicle_driving tbody tr');
                const present = !!document.querySelector('#mission_vehicle_at_mission tbody tr');
                // What the patients still need ("5x We benodigen: OvD-G"): the box in
                // this window, or the per-patient lines the controller read in the list.
                const pBox = document.getElementById('patient_missing_requirements');
                const pText = !job.patients ? ''
                    : (shown(pBox) && pBox.textContent.replace(/\s+/g, ' ').trim()) || job.patientText || '';
                const pNeed = patientNeeds(pText);
                const mode = missingText ? 'missing' : present && pText ? 'patients' : 'full';
                // Arrestants on a car on scene: that car needs a cell, not another car
                // sent. Does not wait for vehicles still driving.
                const prisonerCars = [...document.querySelectorAll('.prison-select')].filter((b) => b.querySelector('a[href*="/gefangener/"]'));
                if (prisonerCars.length) { prisonerCell(job, prisonerCars[0], report, doneKey); return; }
                if (driving) { report('wait', { reason: 'wacht: voertuigen onderweg' }); return; }
                if (mode === 'full' && present) { report('skip', { reason: 'al voertuigen ter plaatse, geen rode melding' }); return; }
                if (mode !== 'full' && !job.topUp) { report('skip', { reason: 'rode melding, bijsturen staat uit' }); return; }
                if (pNeed.unknown.length) {
                    report('skip', { reason: `patiënten, kan niet sturen: ${pNeed.unknown.join(', ')}`, unknownNeeds: pNeed.unknown.map((u) => `Patiënt: ${u}`) });
                    return;
                }
                await loadAllVehicles();

                let plan = mode === 'patients' ? { slots: {}, vt: {}, vtCaptions: {} }
                    : { slots: job.slots || {}, vt: job.vt || {}, vtCaptions: job.vtCaptions || {} };
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
                    // "Missende personeel: 2x Verzorger" becomes vehicles with that crew;
                    // any other kind of line is unknown, not ignored.
                    parts.filter((p) => p.getAttribute('data-requirement-type') !== 'vehicles').forEach((p) => {
                        const t = p.textContent.replace(/\s+/g, ' ').trim();
                        // "We missen: 34000 L. water"
                        const amount = t.match(/([\d.]+)\s*l\.?\s*(water|svm|schuim)/i);
                        if (PRISONERS.test(t)) addPrisonerCar(plan);
                        else if (/person/i.test(p.getAttribute('data-requirement-type')) || /^missende? personeel/i.test(t)) addPersonnel(plan, personnelItems(t));
                        else if (amount) {
                            const k = /water/i.test(amount[2]) ? 'wasser_amount' : 'foam_amount';
                            plan.slots[k] = (plan.slots[k] || 0) + Number(amount[1].replace(/\./g, ''));
                        } else plan.unknown.push(t);
                    });
                    if (plan.unknown.length) {
                        report('skip', { reason: `rode melding, kan niet sturen: ${plan.unknown.join(', ')}`, unknownNeeds: plan.unknown });
                        return;
                    }
                }

                const attrs = { ...plan.slots };
                if (job.patients) {
                    const m = (document.getElementById('patient_button_text')?.textContent || '').match(/(\d+)\s+onbehandelde/i);
                    const untreated = m ? Number(m[1]) : 0;
                    // A new mission: one ambulance per untreated patient (the patient lines
                    // do not always say "ambulance"). With vehicles there, only what the
                    // lines ask for: "1x We benodigen: OvD-G, ambulance" with 7 untreated = 1.
                    const amb = Math.max(Number(attrs.rtw) || 0, pNeed.amb, mode === 'full' ? untreated : 0);
                    if (amb) attrs.rtw = amb;
                    // Only a real OvD-G (kdow_orgl) counts for patients: with kdow_orgl_any a
                    // DA OVDG-RR went and the patients kept asking. MMT-Auto and Lifeliner are "nef".
                    // Never more than one OvD-G per mission.
                    if (pNeed.ovdg) attrs.kdow_orgl = 1;
                    // "8x We benodigen: MMT-Arts" does not mean 8 helicopters: send one, and
                    // another in a later round while the patients still ask for it.
                    if (pNeed.mmt) attrs.nef = Math.max(Number(attrs.nef) || 0, 1);
                }
                // Many patients on a new mission: an OvD-G along if one is free and near
                // enough (ovdgFrom or more patients), asked for or not. Optional: without one the rest still goes.
                const patientCount = Number(((document.getElementById('patient_button_text')?.textContent || '').match(/(\d+)\s+Pati/i) || [])[1] || 0);
                const optOvdg = job.patients && mode === 'full' && job.ovdgFrom > 0 && patientCount >= job.ovdgFrom && !attrs.kdow_orgl;
                if (!Object.keys(attrs).length && !Object.keys(plan.vt).length) { report('skip', { reason: 'niets te sturen' }); return; }

                // Vehicles held for a bigger mission that is waiting (key: slot or vt:<id>).
                const AMOUNT_KEYS = ['wasser_amount', 'foam_amount', 'water_damage_pump_value'];
                const needKeys = [...Object.keys(attrs).filter((k) => !AMOUNT_KEYS.includes(k)), ...Object.keys(plan.vt).map((id) => `vt:${id}`)];
                const caption = (k) => (k.startsWith('vt:') ? plan.vtCaptions[k.slice(3)] || k
                    : untranslated(((W.aao_types || []).find((t) => t[0] === k) || [])[1] || k));
                // How many of each needed kind are free right now, and how many this
                // mission wants. A (big) mission that has to wait reports these so the
                // controller can hold the rare ones for it.
                const avail = {};
                const caps = Object.fromEntries(needKeys.map((k) => [k, caption(k)]));
                const want = Object.fromEntries(needKeys.map((k) => [k, Number(k.startsWith('vt:') ? plan.vt[k.slice(3)] : attrs[k]) || 0]));
                for (const k of needKeys) {
                    // Most fields are "1", some carry a number (police_horse_count = horses on board).
                    const sel = k.startsWith('vt:') ? `input.vehicle_checkbox[vehicle_type_id="${k.slice(3)}"]`
                        : `input.vehicle_checkbox[${CSS.escape(k)}]:not([${CSS.escape(k)}="0"])`;
                    const boxes = new Map([...document.querySelectorAll(sel)].map((c) => [c.value, c]));
                    // Horses: the sum over the trucks (one per rider), not the number of trucks.
                    avail[k] = k === 'police_horse_count' ? [...boxes.values()].reduce((s, c) => s + (Number(c.getAttribute(k)) || 0), 0) : boxes.size;
                }
                // Held for a bigger mission: only if taking ours would leave too few for it.
                // Big needs 1 OvD-P and 2 are free: a small mission may still take one.
                const held = needKeys.filter((k) => job.reserved && job.reserved[k] && avail[k] - want[k] < job.reserved[k].need);
                if (held.length) {
                    report('skip', { held: true, reason: `bewaard voor ${job.reserved[held[0]].by}: ${held.map(caption).join(', ')}` });
                    return;
                }

                // The game's own selection, in three passes. In one pass the game fills its
                // slots in a fixed order: water first, and the big fields ("fire",
                // "fustw") long before specialist ones, so a nearby DB-RI or KMAR gets
                // used up as a plain tankautospuit or noodhulp. So: specialist slots and
                // vehicle types first, then the big fields, then the water, foam and pump
                // capacity still short after the tanks of the vehicles already chosen
                // (the game's water slot ignores those and would add a full load).
                const GENERIC = ['fire', 'fustw', 'gwl2wasser', 'rw', 'rtw'];
                const AMOUNTS = ['wasser_amount', 'foam_amount', 'water_damage_pump_value'];
                const only = (keep) => Object.fromEntries(Object.entries(attrs).filter(([k]) => keep(k)));
                const chosen = () => [...new Map([...document.querySelectorAll('input.vehicle_checkbox:checked')].map((c) => [c.value, c])).values()];
                let shortage = '';
                let firstPass = true;
                function pass(slots, vt = {}) {
                    if (!Object.keys(slots).length && !Object.keys(vt).length) return;
                    const el = document.createElement('a');
                    el.id = 'aao_mks_auto';
                    el.className = 'aao_btn';
                    el.style.display = 'none';
                    el.setAttribute('aao_id', 'mks_auto');
                    el.setAttribute('reset', firstPass ? 'true' : 'false');
                    firstPass = false;
                    el.setAttribute('building_ids', '');
                    el.setAttribute('equipment_mode', '0');
                    el.setAttribute('custom', '{}');
                    for (const [k, v] of Object.entries(slots)) el.setAttribute(k, String(v));
                    if (Object.keys(vt).length) {
                        el.setAttribute('vehicle_type_ids', JSON.stringify(vt));
                        el.setAttribute('vehicle_type_captions', JSON.stringify(plan.vtCaptions));
                    }
                    document.body.appendChild(el);
                    // On a shortage the game calls alert(): catch the text instead of a popup.
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
                }
                // Vehicle types that only go for their own job (setting, e.g. TS-BO, TS-GO):
                // hide them from the big fields and water/foam by setting those attributes
                // to 0 on their unticked checkboxes for the pass, then put them back.
                const own = new Set((job.ownJobOnly || []).map(String));
                function hidingOwnJob(fn) {
                    const stash = [];
                    if (own.size) {
                        document.querySelectorAll('input.vehicle_checkbox:not(:checked)').forEach((c) => {
                            if (!own.has(c.getAttribute('vehicle_type_id'))) return;
                            for (const k of [...GENERIC, ...AMOUNTS]) {
                                if (c.hasAttribute(k)) { stash.push([c, k, c.getAttribute(k)]); c.setAttribute(k, '0'); }
                            }
                        });
                    }
                    try { fn(); } finally { stash.forEach(([c, k, v]) => c.setAttribute(k, v)); }
                }
                pass(only((k) => !GENERIC.includes(k) && !AMOUNTS.includes(k)), plan.vt);
                hidingOwnJob(() => pass(only((k) => GENERIC.includes(k))));
                const rest = {};
                for (const k of AMOUNTS) {
                    if (!attrs[k]) continue;
                    const have = chosen().reduce((sum, c) => sum + (Number(c.getAttribute(k)) || 0), 0);
                    if (Number(attrs[k]) > have) rest[k] = Number(attrs[k]) - have;
                }
                hidingOwnJob(() => pass(rest));
                // Its own pass, after the rest; its shortage does not stop the mission.
                if (optOvdg) { const before = shortage; pass({ kdow_orgl: 1 }); shortage = before; }
                await sleep(400);
                shortage = untranslated(shortage);

                // A vehicle can have two rows (helicopters: 22.95 and 36.94 km for one
                // Lifeliner). Count it once, at its shortest distance.
                const dist = (c) => Number(c.getAttribute('data-distance')) || 0;
                const selection = () => {
                    const byId = new Map();
                    document.querySelectorAll('input.vehicle_checkbox:checked').forEach((c) => {
                        const prev = byId.get(c.value);
                        if (!prev || dist(c) < dist(prev)) byId.set(c.value, c);
                    });
                    return [...byId.values()];
                };
                let picked = selection();
                const reset = () => { try { W.vehicleSelectionReset(); } catch (e) { picked.forEach((c) => c.checked && c.click()); } };
                if (!picked.length) { report('skip', { reason: shortage ? `te weinig: ${fewer(shortage)}` : 'geen voertuigen beschikbaar', shortText: shortage }); return; }
                // Shortages on the ignore list (setting) do not stop the rest from going. On a
                // big patient mission ("24 Patiënten - 5 onbehandelde") ambulances may come in
                // parts: the patient lines ask for the rest once these have arrived.
                const big = job.bigPatients > 0 && patientCount > job.bigPatients;
                const ignored = (job.ignoreShort || []).map((n) => n.toLowerCase());
                const blocking = [...String(shortage).matchAll(/beschikbaar:\s*\d+\s+([^.\n]+)/gi)]
                    .map((m) => m[1].trim()).filter((n) => !ignored.includes(n.toLowerCase()) && !(big && /ambulance/i.test(n)));
                if (shortage && job.needAll && (blocking.length || !/beschikbaar:/i.test(shortage))) {
                    reset();
                    report('skip', { reason: `te weinig: ${fewer(shortage)} (de rest is er wel)`, shortText: shortage, avail, caps, want });
                    return;
                }
                // Helicopters fly: they get their own, larger limit.
                const AIR = ['23', '28', '80', '85'];
                const tooFar = (c) => dist(c) > (AIR.includes(c.getAttribute('vehicle_type_id')) ? job.airKm : job.maxKm);
                if (big) {
                    // Big patient mission: leave the far ambulances home instead of skipping it all.
                    picked.filter((c) => tooFar(c) && c.getAttribute('rtw') === '1').forEach((c) => {
                        document.querySelectorAll(`input.vehicle_checkbox[value="${c.value}"]:checked`).forEach((cb) => cb.click());
                    });
                    picked = selection();
                    if (!picked.length) { report('skip', { reason: 'alle ambulances te ver', shortText: shortage }); return; }
                }
                const isOvdg = (c) => c.getAttribute('kdow_orgl') === '1';
                if (optOvdg) {
                    // The optional OvD-G from too far stays home; the rest still goes.
                    picked.filter((c) => tooFar(c) && isOvdg(c)).forEach((c) => {
                        document.querySelectorAll(`input.vehicle_checkbox[value="${c.value}"]:checked`).forEach((cb) => cb.click());
                    });
                    picked = selection();
                    if (!picked.length) { report('skip', { reason: 'niets te sturen' }); return; }
                }
                const ovdgNote = !optOvdg ? '' : picked.some(isOvdg) ? `met OvD-G (${patientCount} patiënten)` : `zonder OvD-G (geen vrij binnen ${job.maxKm} km)`;
                const far = Math.max(...picked.map(dist));
                if (picked.some(tooFar)) {
                    // Which types had to come from too far: those are the ones to buy closer by.
                    const farTypes = {};
                    picked.filter(tooFar).forEach((c) => {
                        const t = c.closest('tr')?.getAttribute('vehicle_type') || `type ${c.getAttribute('vehicle_type_id')}`;
                        farTypes[t] = (farTypes[t] || 0) + 1;
                    });
                    reset();
                    report('skip', { reason: `voertuig op ${far.toFixed(1)} km`, farTypes, shortText: shortage, avail, caps, want });
                    return;
                }

                const btn = document.getElementById('alert_btn');
                if (!btn) { reset(); report('error', { reason: 'knop Alarmeren niet gevonden' }); return; }
                try { sessionStorage.setItem(doneKey, '1'); } catch (e) { /* ignore */ }
                report('sending', { mode, n: picked.length, km: far, short: shortage ? fewer(shortage) : '', shortText: shortage, note: ovdgNote });
                btn.click();
            } catch (e) {
                ctx.err(e);
                report('error', { reason: e.message || String(e) });
            }
        }

        /* ========================================================================
         * ARRESTANTEN in a mission window. Each police car on scene with
         * arrestants has a block under its row in "Voertuigen ter plaatse":
         *   <div id="prison-select-5848090" data-vehicle-id="5848090" class="prison-select">
         *     <a data-prison-id="1769528" class="btn btn-success"
         *        href="/vehicles/5848090/gefangener/1769528?...">Politie Amersfoort-Centrum
         *        (BT 31) (Vrije cellen: 2, afstand: 6,86 km)</a> ...
         * Red buttons are full; team cells add "Afdrachtpercentage: 0%". Same
         * choice as a spraakaanvraag. One car per job: the click loads another page.
         * ==================================================================== */
        function prisonerCell(job, block, report, doneKey) {
            // The car's own row is the one above the cell list ("MD 33.01 NH-OV").
            const vid = block.getAttribute('data-vehicle-id');
            const car = clean(block.closest('tr')?.previousElementSibling?.querySelector(`a[href^="/vehicles/${vid}"]`)?.textContent || '')
                || `voertuig ${vid}`;
            if (!job.transport) { report('skip', { reason: `arrestanten wachten op een cel (${car}), spraakaanvragen afhandelen staat uit` }); return; }
            const go = (a, detail) => {
                try { sessionStorage.setItem(doneKey, '1'); } catch (e) { /* ignore */ }
                report('sending', { mode: 'cell', car, ...detail });
                a.click();
            };
            const all = destinations(block);
            const { best, why } = bestDestination(all, job);
            if (best) { go(best.a, { dest: best.name, km: best.dist, cost: best.cost }); return; }
            const need = why.vol ? 'Cellen (alles vol)' : 'Cel binnen kosten/afstand';
            const reasons = Object.entries(why).map(([k, n]) => `${n} ${k}`).join(', ') || 'geen cellen';
            // A release button for this one car if there is one, else the mission-wide
            // "Arrestant vrijlaten" (data-method="post"; jquery-ujs posts it on click).
            // Every car sees the same cells, so nothing fits for any of them.
            const release = block.querySelector('a[href$="/gefangener/-1"], a[href*="/gefangener/-1?"]')
                || document.querySelector('a[href$="/gefangene/entlassen"][data-method="post"]');
            if (job.release && release) { go(release, { release: true, dest: 'gevangenen vrijgelaten', unknownNeeds: [need] }); return; }
            report('skip', { reason: `arrestanten (${car}): geen passende cel (${reasons})`, unknownNeeds: [need], prisoners: true });
        }

        function clean(t) { return String(t).replace(/\s+/g, ' ').trim().slice(0, 160); }

        // The game's "Niet beschikbaar: 1 SIV-P of DM-P." counts what is missing, not
        // what it found: "1 SIV-P of DM-P, 1 BA-DDG" reads less like "none at all".
        // The game has no Dutch name for some preset fields and writes
        // '[missing "nl_NL.intervention_order.vehicles.<field>" translation]' instead.
        // Function declarations: the workers run before these lines are reached.
        function untranslated(t) {
            const NAMES = { hazard_response_disinfection_large: 'DB-GO, TS-GO of GOH-DC', hazard_response_disinfection: 'DB-BO, TS-BO of BOH-DC' };
            return String(t).replace(/\[missing\s+"[^"]*?\.vehicles\.(\w+)"\s+translation\]/g, (m, k) => NAMES[k] || k);
        }
        function fewer(t) {
            return clean(String(t).replace(/Niet beschikbaar:\s*/gi, '').replace(/\.\s*(?=\S)/g, ', ').replace(/\.\s*$/, ''));
        }

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
            const DATA_KEY = 'mks.autoDispatch.missions.v2';
            try { GM_deleteValue('mks.autoDispatch.missions.v1'); } catch (e) { /* ignore */ }
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

            // Where the mission being handled is ([lat, lon]) and what it pays, set by the
            // loop. Stored per need as [lat, lon, time, credits], so the expansion module
            // knows where to buy and how many credits a shortage blocked.
            let curPos = null;
            let curCredits = 0;
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
                t.credits = (t.credits || 0) + (curCredits || 0);
                if (curPos) {
                    t.pos = t.pos || [];
                    t.pos.push([...curPos, Date.now(), curCredits || 0]);
                    if (t.pos.length > 200) t.pos.shift();
                }
            }

            /* --------------------------------------------------------------------
             * EVENTS — one line per mission or transport handled, the last 3000,
             * kept across sessions. Read by the expansion module, and on the page
             * as window.mksAutoData so it can be inspected from outside.
             * ------------------------------------------------------------------ */
            const EVENTS_KEY = 'mks.autoDispatch.events.v1';
            let events;
            try { events = JSON.parse(GM_getValue(EVENTS_KEY, '[]')) || []; } catch (e) { events = []; }
            let eventsTimer = null;
            function recordEvent(e) {
                events.push({ t: Date.now(), ...e });
                if (events.length > 3000) events.splice(0, events.length - 3000);
                clearTimeout(eventsTimer);
                eventsTimer = setTimeout(() => { try { GM_setValue(EVENTS_KEY, JSON.stringify(events)); } catch (x) { ctx.warn('events not saved', x); } }, 2000);
            }
            W.mksAutoData = {
                get needs() { return needs; },
                get events() { return events; },
                get stats() { return stats; },
                get holds() { return [...holds].map(([id, h]) => ({ id, ...h })); },
                get running() { return running; },
            };

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
                for (const e of await res.json()) {
                    // Towing missions have no requirements: the cars to tow are in
                    // "additional" (cars = Berger-K, trucks = Berger-G).
                    const r = { ...(e.requirements || {}) };
                    const add = e.additional || {};
                    if (add.possible_crashed_car_max) r.car_carrier = Math.max(r.car_carrier || 0, add.possible_crashed_car_max);
                    if (add.possible_crashed_car_large_max) r.car_carrier_large = Math.max(r.car_carrier_large || 0, add.possible_crashed_car_large_max);
                    m[e.id] = r;
                }
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
                let trained = [];
                for (const [k, v] of Object.entries(req)) {
                    if (k === 'personnel_educations' && v && typeof v === 'object') { trained = Object.entries(v); continue; }
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
                const out = { slots, vt, vtCaptions, unknown };
                // Trained personnel last, so a vehicle already required counts toward it.
                addPersonnel(out, trained, (e, n) => `Opleiding ${EDUCATION[e] || e} (${n} pers.)`);
                return out;
            }

            // The red "Missende voertuigen" box the game also shows in the mission list.
            const sidebarMissing = (e) => (document.getElementById(`mission_missing_${e.getAttribute('mission_id')}`)?.textContent || '').replace(/\s+/g, ' ').trim();

            // "We benodigen: ..." under the mission in the list: one red line per patient,
            // or with many patients one summary line ("8x We benodigen: OvD-G").
            const sidebarPatients = (e) => [...document.querySelectorAll(`#mission_patients_${e.getAttribute('mission_id')} .alert-danger`)]
                .filter((x) => x.style.display !== 'none').map((x) => x.textContent).join(' ').replace(/\s+/g, ' ').trim();

            // "Arrestanten moeten vervoerd worden." in the list: a police car is (or will
            // be) stuck there until it gets a cell.
            const prisonersWaiting = (e) => /arrestanten moeten/i.test(sidebarMissing(e));

            function candidates() {
                const now = Date.now();
                return [...document.querySelectorAll('#mission_list .missionSideBarEntry[mission_type_id]')].filter((e) => {
                    const red = ctx.cfg.topUp && (sidebarMissing(e) || (ctx.cfg.patients && sidebarPatients(e)));
                    if (e.getAttribute('data-mission-state-filter') !== 'unattended' && !red) return false;
                    // Arrestants also on hidden missions: our own car is blocked there.
                    if (ctx.cfg.onlyVisible && getComputedStyle(e).display === 'none' && !(ctx.cfg.transport && prisonersWaiting(e))) return false;
                    const t = tried.get(e.getAttribute('mission_id'));
                    return !t || now - t > ctx.cfg.retryMin * 60000;
                }).sort((a, b) => (ctx.cfg.transport ? prisonersWaiting(b) - prisonersWaiting(a) : 0)
                    || creditsOf(b) - creditsOf(a)); // arrestants first (a cell takes seconds), then big missions
            }

            const titleOf = (e) => {
                try { return JSON.parse(e.getAttribute('data-sortable-by')).caption; } catch (x) { return e.getAttribute('search_attribute') || e.getAttribute('mission_id'); }
            };
            // "TS-BO, TS-GO" (setting) -> vehicle type ids, via the full type names.
            const ownJobOnly = () => String(ctx.cfg.ownJobOnly || '').split(',').map((n) => VT_BY_NAME.get(normName(n))).filter((id) => id != null);
            const creditsOf = (e) => {
                try { return Number(JSON.parse(e.getAttribute('data-sortable-by')).average_credits) || 0; } catch (x) { return 0; }
            };

            /* --------------------------------------------------------------------
             * HOLDS — a big mission that has to wait (something short) holds its
             * rare vehicles (rareMax or fewer free, missing ones too), so smaller
             * missions do not take them in the meantime. A hold ends when the
             * mission is sent or gone, or after holdMin, so nothing stays stuck.
             * ------------------------------------------------------------------ */
            const holds = new Map(); // mission id -> { until, name, credits, keys: { key: { cap, need } } }
            // What bigger waiting missions hold: { key: { by, need } }, needs added up.
            function reservedFor(id, credits) {
                const now = Date.now();
                const out = {};
                for (const [hid, h] of holds) {
                    if (h.until < now || !document.getElementById(`mission_${hid}`)) { holds.delete(hid); continue; }
                    if (hid === id || h.credits <= credits) continue;
                    for (const [k, v] of Object.entries(h.keys)) {
                        if (!out[k]) out[k] = { by: `${h.name} (${ctx.nl(h.credits)} cr)`, need: 0 };
                        out[k].need += v.need;
                    }
                }
                return out;
            }
            function updateHold(id, name, credits, res) {
                if (res.result === 'sent' || res.result === 'unconfirmed') { holds.delete(id); return; }
                if (res.result !== 'skip' || !res.avail || !(ctx.cfg.bigCredits > 0) || credits < ctx.cfg.bigCredits) return;
                const keys = {};
                for (const [k, n] of Object.entries(res.avail)) {
                    if (n <= ctx.cfg.rareMax) keys[k] = { cap: (res.caps && res.caps[k]) || k, need: (res.want && res.want[k]) || 1 };
                }
                if (!Object.keys(keys).length) return;
                // The end time is set once: retries do not keep a hold alive forever.
                const known = holds.get(id);
                holds.set(id, { until: known ? known.until : Date.now() + ctx.cfg.holdMin * 60000, name, credits, keys });
                // Look again in a minute, to catch a held vehicle as soon as it is back.
                tried.set(id, Date.now() - ctx.cfg.retryMin * 60000 + 60000);
            }

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
                            if (result.mode !== 'full') return;
                            const entry = document.getElementById(`mission_${job.id}`);
                            if (!entry || entry.getAttribute('data-mission-state-filter') !== 'unattended') cleanup({ ...result, result: 'sent' });
                        }, 500);
                        frame.addEventListener('load', () => {
                            let ok = false;
                            try {
                                ok = result.mode === 'cell' || (transport
                                    ? /^\/vehicles\/\d+\/(patient|gefangener)\/-?\d+/.test(frame.contentWindow.location.pathname)
                                    : !!frame.contentDocument.querySelector('#mission_vehicle_driving tbody tr, #mission_vehicle_at_mission tbody tr'));
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
                    curPos = null;
                    curCredits = 0;
                    recordResult(res, `v${vid}`, v.caption);
                    recordEvent({ kind: 'transport', vehicle: vid, name: v.caption, result: res.result, mode: res.mode, dest: res.dest, km: res.km, cost: res.cost, reason: res.reason, page: res.page });
                    if (res.result === 'sent' || res.result === 'unconfirmed') {
                        stats.transports++;
                        errorStreak = 0;
                        talk.delete(vid);
                        const where = res.mode === 'release' ? res.dest
                            : `naar ${res.dest}${isNaN(res.km) ? '' : `, ${Number(res.km).toFixed(1)} km`}${res.cost ? `, ${res.cost}%` : ''}`;
                        addLog(v.caption, `${res.result === 'sent' ? '' : '(niet bevestigd) '}${where}`, res.mode === 'release' ? 'warn' : 'ok');
                    } else if (res.result === 'skip' && res.gone) {
                        // Logged, not silent: a page we cannot read looked like this before.
                        talk.delete(vid);
                        addLog(v.caption, res.reason, 'idle');
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
                    const list = candidates();
                    const cellRuns = new Map();
                    for (const entry of list) {
                        // A round over many missions takes minutes: answer new
                        // transport requests in between, not only at the start.
                        await transports();
                        if (!running || stopped) break;
                        const hourAgo = Date.now() - 3600000;
                        while (sent.length && sent[0] < hourAgo) sent.shift();
                        if (sent.length >= ctx.cfg.maxPerHour) { status(`Maximum van ${ctx.cfg.maxPerHour} per uur bereikt, wacht…`, 'warn'); break; }

                        const id = entry.getAttribute('mission_id');
                        const name = titleOf(entry);
                        const credits = creditsOf(entry);
                        const lat = Number(entry.getAttribute('latitude')), lon = Number(entry.getAttribute('longitude'));
                        curPos = Number.isFinite(lat) && Number.isFinite(lon) ? [lat, lon] : null;
                        curCredits = credits;
                        tried.set(id, Date.now());
                        const patientText = ctx.cfg.patients ? sidebarPatients(entry) : '';
                        const red = ctx.cfg.topUp && (sidebarMissing(entry) || patientText);
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
                            maxKm: ctx.cfg.maxKm, airKm: ctx.cfg.airKm, needAll: ctx.cfg.needAll, patients: ctx.cfg.patients, patientText, topUp: ctx.cfg.topUp,
                            ignoreShort: String(ctx.cfg.ignoreShort || '').split(',').map((s) => s.trim()).filter(Boolean),
                            bigPatients: Number(ctx.cfg.bigPatients) || 0, reserved: reservedFor(id, credits), ownJobOnly: ownJobOnly(),
                            ovdgFrom: Number(ctx.cfg.ovdgFrom) || 0, transport: ctx.cfg.transport, destCost: Number(ctx.cfg.destCost), destKm: Number(ctx.cfg.destKm), ownKm: Number(ctx.cfg.ownKm), release: ctx.cfg.release });
                        // Sent short (needAll off) or skipped: both say what to buy.
                        recordResult(res, id, name);
                        recordEvent({ kind: 'mission', id, name, type: keyOf(entry), credits, pos: curPos, result: res.result, mode: res.mode, n: res.n, km: res.km,
                            reason: res.reason, short: res.shortText ? fewer(res.shortText) : undefined, far: res.farTypes, held: res.held || undefined,
                            ...(res.result === 'skip' && res.want ? { avail: res.avail, want: res.want } : {}) });
                        if (res.mode !== 'cell') updateHold(id, name, credits, res);
                        if (res.mode === 'cell' && (res.result === 'sent' || res.result === 'unconfirmed')) {
                            // More cars with arrestants: the next one in a minute.
                            stats.transports++;
                            errorStreak = 0;
                            tried.set(id, Date.now() - ctx.cfg.retryMin * 60000 + 60000);
                            // Next car with arrestants right away, not next round (a round
                            // can take many minutes). A release frees them all.
                            const runs = (cellRuns.get(id) || 0) + 1;
                            cellRuns.set(id, runs);
                            if (!res.release && runs < 6) list.splice(list.indexOf(entry) + 1, 0, entry);
                            const where = res.release ? res.dest
                                : `naar ${res.dest}${isNaN(res.km) ? '' : `, ${Number(res.km).toFixed(1)} km`}${res.cost ? `, ${res.cost}%` : ''}`;
                            addLog(name, `arrestanten ${res.car}: ${res.result === 'sent' ? '' : '(niet bevestigd) '}${where}`, res.release ? 'warn' : 'ok');
                        } else if (res.result === 'skip' && res.held) {
                            // Not a shortage: the vehicle is there, but kept for a bigger mission.
                            errorStreak = 0;
                            addLog(name, res.reason, 'idle');
                        } else if (res.result === 'sent' || res.result === 'unconfirmed') {
                            stats.sent++;
                            errorStreak = 0;
                            sent.push(Date.now());
                            const verb = res.mode === 'full' ? 'gealarmeerd' : 'bijgestuurd';
                            addLog(name, `${res.result === 'sent' ? verb : `${verb} (niet bevestigd)`}: ${res.n} voertuig(en), verste ${Number(res.km).toFixed(1)} km${res.note ? `, ${res.note}` : ''}${res.short ? `, te weinig: ${res.short}` : ''}`, 'ok');
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
                const now = Date.now();
                const live = [...holds].filter(([, h]) => h.until > now).sort((a, b) => b[1].credits - a[1].credits);
                const holdHtml = live.length ? `<h4 class="mks-h">Bewaard voor grote inzetten</h4>
                    <div class="mks-tblwrap"><table class="mks-tbl"><thead><tr><th>Inzet</th><th>Credits</th><th>Bewaard</th><th>Nog</th></tr></thead><tbody>
                    ${live.map(([, h]) => `<tr><td>${esc(h.name)}</td><td class="mono">${ctx.nl(h.credits)}</td><td>${esc(Object.values(h.keys).map((v) => `${v.need}× ${v.cap}`).join(', '))}</td>
                        <td class="mono mks-dim">${Math.ceil((h.until - now) / 60000)} min</td></tr>`).join('')}</tbody></table></div>` : '';
                el.innerHTML = `<div class="mks-tiles">
                        <div class="mks-tile"><div class="v">${stats.sent}</div><div class="k">gealarmeerd</div></div>
                        <div class="mks-tile"><div class="v">${stats.transports}</div><div class="k">vervoerd</div></div>
                        <div class="mks-tile"><div class="v">${stats.skipped}</div><div class="k">overgeslagen</div></div>
                        <div class="mks-tile ${stats.errors ? 't-error' : ''}"><div class="v">${stats.errors}</div><div class="k">fouten</div></div>
                    </div>
                    ${holdHtml}
                    <h4 class="mks-h">Tekort per voertuigtype</h4>
                    <p class="mks-note">Sinds ${new Date(needs.since).toLocaleDateString('nl-NL')}. Elke inzet telt één keer per type.
                        <b>Niet beschikbaar</b>: het spel had er niet genoeg vrij (de andere gingen wel). <b>Te ver</b>: alleen verder dan ${ctx.cfg.maxKm} km (helikopters ${ctx.cfg.airKm} km).
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
