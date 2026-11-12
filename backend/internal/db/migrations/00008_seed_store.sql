-- +goose Up
INSERT INTO genres (slug, name) VALUES
    ('action', 'Action'),
    ('adventure', 'Adventure'),
    ('co-op', 'Co-op'),
    ('fighting', 'Fighting'),
    ('horror', 'Horror'),
    ('indie', 'Indie'),
    ('platformer', 'Platformer'),
    ('racing', 'Racing'),
    ('roguelike', 'Roguelike'),
    ('rpg', 'RPG'),
    ('shooter', 'Shooter'),
    ('simulation', 'Simulation'),
    ('sports', 'Sports'),
    ('strategy', 'Strategy'),
    ('survival', 'Survival');

UPDATE products p SET search_keywords = v.keywords
FROM (VALUES
    ('grand-theft-auto-v', 'gta gta5 gtav gta 5 gta v'),
    ('red-dead-redemption-2', 'rdr2 rdr 2'),
    ('baldurs-gate-3', 'bg3'),
    ('cyberpunk-2077', 'cp2077'),
    ('the-witcher-3-wild-hunt', 'tw3 witcher 3'),
    ('monster-hunter-wilds', 'mh wilds'),
    ('kingdom-come-deliverance-ii', 'kcd2 kcd 2 kingdom come 2'),
    ('civilization-vii', 'civ 7 civ7 civilization 7'),
    ('skyrim-special-edition', 'tes 5 tes v elder scrolls 5'),
    ('the-last-of-us-part-i', 'tlou'),
    ('hades-ii', 'hades 2'),
    ('clair-obscur-expedition-33', 'e33'),
    ('resident-evil-4', 're4 remake'),
    ('forza-horizon-5', 'fh5')
) AS v (slug, keywords)
WHERE p.slug = v.slug;

-- An unknown genre slug yields a NULL genre_id, which fails the migration instead of silently dropping the genre.
INSERT INTO product_genres (product_id, genre_id)
SELECT p.id, (SELECT g.id FROM genres g WHERE g.slug = gs.slug)
FROM (VALUES
    ('elden-ring', 'action,rpg'),
    ('cyberpunk-2077', 'rpg,shooter,action'),
    ('red-dead-redemption-2', 'action,adventure'),
    ('the-witcher-3-wild-hunt', 'rpg,adventure'),
    ('baldurs-gate-3', 'rpg,strategy,co-op'),
    ('hogwarts-legacy', 'rpg,adventure'),
    ('grand-theft-auto-v', 'action,adventure'),
    ('stardew-valley', 'simulation,indie,co-op'),
    ('hades', 'action,roguelike,indie'),
    ('hades-ii', 'action,roguelike,indie'),
    ('sekiro-shadows-die-twice', 'action,adventure'),
    ('monster-hunter-wilds', 'action,rpg,co-op'),
    ('black-myth-wukong', 'action,rpg'),
    ('helldivers-2', 'shooter,co-op,action'),
    ('palworld', 'survival,co-op,adventure'),
    ('terraria', 'adventure,indie,survival'),
    ('hollow-knight', 'platformer,indie,action'),
    ('hollow-knight-silksong', 'platformer,indie,action'),
    ('forza-horizon-5', 'racing'),
    ('diablo-iv', 'rpg,action'),
    ('god-of-war', 'action,adventure'),
    ('resident-evil-4', 'horror,action,shooter'),
    ('it-takes-two', 'co-op,adventure,platformer'),
    ('split-fiction', 'co-op,adventure,action'),
    ('kingdom-come-deliverance-ii', 'rpg'),
    ('clair-obscur-expedition-33', 'rpg,adventure'),
    ('doom-the-dark-ages', 'shooter,action'),
    ('civilization-vii', 'strategy'),
    ('satisfactory', 'simulation,co-op'),
    ('lies-of-p', 'action,rpg'),
    ('street-fighter-6', 'fighting'),
    ('silent-hill-2', 'horror,adventure'),
    ('indiana-jones-and-the-great-circle', 'adventure,action'),
    ('stalker-2-heart-of-chornobyl', 'shooter,survival,horror'),
    ('valheim', 'survival,co-op,indie'),
    ('marvels-spider-man-remastered', 'action,adventure'),
    ('sea-of-thieves', 'adventure,co-op'),
    ('fallout-4', 'rpg,shooter'),
    ('skyrim-special-edition', 'rpg,adventure'),
    ('the-last-of-us-part-i', 'action,adventure,horror')
) AS v (slug, genres)
JOIN products p ON p.slug = v.slug
CROSS JOIN LATERAL unnest(string_to_array(v.genres, ',')) AS gs (slug);

-- More products so every platform, region, and genre has results. Console and launcher editions
-- reuse the game's Steam artwork; like Eneba, each platform/region edition is its own product.
WITH v (app_id, slug, title, description, platform, region, msrp_cents, release_date, sold_count, genres, keywords) AS (VALUES
    (504230, 'celeste', 'Celeste', 'Help Madeline climb Celeste Mountain in a tight, demanding platformer.', 'steam', 'global', 1999, '2018-01-25', 3120, 'platformer,indie', ''),
    (588650, 'dead-cells', 'Dead Cells', 'Roguevania action platformer on an ever-changing island.', 'steam', 'global', 2499, '2018-08-07', 2860, 'roguelike,platformer,indie', ''),
    (268910, 'cuphead', 'Cuphead', 'Run-and-gun boss fights drawn in a 1930s cartoon style.', 'steam', 'global', 1999, '2017-09-29', 2710, 'platformer,indie,co-op', ''),
    (1057090, 'ori-and-the-will-of-the-wisps', 'Ori and the Will of the Wisps', 'Hand-painted platforming adventure to uncover Ori''s destiny.', 'steam', 'global', 2999, '2020-03-11', 2240, 'platformer,adventure', ''),
    (646570, 'slay-the-spire', 'Slay the Spire', 'Deck-building roguelike: craft a unique deck and climb the Spire.', 'steam', 'global', 2499, '2019-01-23', 2930, 'roguelike,strategy,indie', 'sts'),
    (1794680, 'vampire-survivors', 'Vampire Survivors', 'Gothic horde survival with roguelite upgrades.', 'steam', 'global', 499, '2022-10-20', 4010, 'roguelike,indie,action', ''),
    (2379780, 'balatro', 'Balatro', 'Poker-inspired roguelike deck builder.', 'steam', 'global', 1499, '2024-02-20', 4870, 'roguelike,strategy,indie', ''),
    (250900, 'the-binding-of-isaac-rebirth', 'The Binding of Isaac: Rebirth', 'Randomly generated action roguelike in a dark basement.', 'steam', 'global', 1499, '2014-11-04', 2380, 'roguelike,indie,action', 'tboi'),
    (632360, 'risk-of-rain-2', 'Risk of Rain 2', 'Third-person roguelike shooter for up to four players.', 'steam', 'global', 2499, '2020-08-11', 2150, 'roguelike,shooter,co-op', 'ror2'),
    (1942280, 'brotato', 'Brotato', 'Top-down arena roguelite starring a potato with six weapons.', 'steam', 'global', 499, '2023-06-23', 1980, 'roguelike,indie,action', ''),
    (1966720, 'lethal-company', 'Lethal Company', 'Co-op horror: scavenge abandoned moons to meet the Company''s quota.', 'steam', 'global', 999, '2023-10-23', 5320, 'horror,co-op,indie', ''),
    (548430, 'deep-rock-galactic', 'Deep Rock Galactic', 'Co-op shooter: dwarven miners dig through procedurally generated caves.', 'steam', 'global', 2999, '2020-05-13', 3360, 'shooter,co-op', 'drg'),
    (945360, 'among-us', 'Among Us', 'Find the impostor before the crew is sabotaged.', 'steam', 'global', 499, '2018-11-16', 2470, 'co-op,indie', ''),
    (1326470, 'sons-of-the-forest', 'Sons of the Forest', 'Survival horror on a cannibal-infested island.', 'steam', 'global', 2999, '2024-02-22', 3710, 'survival,horror,co-op', ''),
    (264710, 'subnautica', 'Subnautica', 'Underwater survival on an alien ocean planet.', 'steam', 'global', 2999, '2018-01-23', 2620, 'survival,adventure', ''),
    (427520, 'factorio', 'Factorio', 'Build and automate factories on an alien planet.', 'steam', 'global', 3200, '2020-08-14', 2890, 'simulation,strategy', ''),
    (1203620, 'enshrouded', 'Enshrouded', 'Co-op survival action RPG in a voxel world.', 'steam', 'global', 2999, '2024-01-24', 2310, 'survival,rpg,co-op', ''),
    (1604030, 'v-rising', 'V Rising', 'Vampire survival: build your castle and rule the night.', 'steam', 'global', 3499, '2024-05-08', 1640, 'survival,action', ''),
    (322330, 'dont-starve-together', 'Don''t Starve Together', 'Co-op wilderness survival with a gothic art style.', 'steam', 'global', 1499, '2016-04-21', 1880, 'survival,co-op,indie', 'dst'),
    (1366540, 'dyson-sphere-program', 'Dyson Sphere Program', 'Build an interstellar factory spanning a star cluster.', 'steam', 'global', 1999, '2021-01-21', 1420, 'simulation,strategy,indie', 'dsp'),
    (1158310, 'crusader-kings-iii', 'Crusader Kings III', 'Medieval grand strategy: secure your dynasty''s legacy.', 'steam', 'global', 4999, '2020-09-01', 1730, 'strategy,rpg', 'ck3 crusader kings 3'),
    (394360, 'hearts-of-iron-iv', 'Hearts of Iron IV', 'WWII grand strategy: lead any nation to victory.', 'steam', 'global', 3999, '2016-06-06', 1590, 'strategy', 'hoi4 hearts of iron 4'),
    (281990, 'stellaris', 'Stellaris', 'Sci-fi grand strategy: explore and conquer the galaxy.', 'steam', 'global', 3999, '2016-05-09', 1810, 'strategy', ''),
    (289070, 'civilization-vi', 'Sid Meier''s Civilization VI', 'Turn-based strategy: build an empire across history.', 'steam', 'global', 5999, '2016-10-21', 3450, 'strategy', 'civ 6 civ6 civilization 6'),
    (813780, 'age-of-empires-ii-definitive-edition', 'Age of Empires II: Definitive Edition', 'Remastered real-time strategy classic.', 'steam', 'global', 1999, '2019-11-14', 2080, 'strategy', 'aoe2 aoe 2 age of empires 2'),
    (1142710, 'total-war-warhammer-iii', 'Total War: WARHAMMER III', 'Turn-based campaigns and real-time battles in the Realm of Chaos.', 'steam', 'global', 5999, '2022-02-17', 1490, 'strategy', 'tww3 warhammer 3'),
    (435150, 'divinity-original-sin-2', 'Divinity: Original Sin 2 - Definitive Edition', 'Party-based RPG with deep tactical turn-based combat.', 'steam', 'global', 4499, '2018-08-31', 2120, 'rpg,strategy,co-op', 'dos2'),
    (1888160, 'armored-core-vi-fires-of-rubicon', 'ARMORED CORE VI FIRES OF RUBICON', 'Build your mech and fight across planet Rubicon 3.', 'steam', 'global', 5999, '2023-08-25', 1370, 'action,shooter', 'ac6 armored core 6'),
    (374320, 'dark-souls-iii', 'DARK SOULS III', 'Brutal action RPG in a dying, ash-covered kingdom.', 'steam', 'global', 5999, '2016-04-12', 2540, 'action,rpg', 'ds3 dark souls 3'),
    (1778820, 'tekken-8', 'TEKKEN 8', 'The King of Iron Fist Tournament returns with Heat battles.', 'steam', 'global', 6999, '2024-01-26', 1660, 'fighting', ''),
    (1971870, 'mortal-kombat-1', 'Mortal Kombat 1', 'A reborn Mortal Kombat universe with Kameo fighters.', 'steam', 'global', 6999, '2023-09-19', 1280, 'fighting', 'mk1'),
    (1384160, 'guilty-gear-strive', 'GUILTY GEAR -STRIVE-', 'Anime fighting game with rollback netcode.', 'steam', 'global', 3999, '2021-06-11', 870, 'fighting', 'ggst'),
    (1462040, 'final-fantasy-vii-remake-intergrade', 'FINAL FANTASY VII REMAKE INTERGRADE', 'Reimagined Midgar story with hybrid action combat.', 'steam', 'global', 6999, '2021-12-16', 1920, 'rpg,action', 'ff7 ff7r ffvii final fantasy 7'),
    (2909400, 'final-fantasy-vii-rebirth', 'FINAL FANTASY VII REBIRTH', 'Cloud and his friends leave Midgar for a vast open world.', 'steam', 'global', 6999, '2025-01-23', 2260, 'rpg,action', 'ff7 ffvii final fantasy 7'),
    (1687950, 'persona-5-royal', 'Persona 5 Royal', 'Stylish JRPG: phantom thieves steal hearts by night.', 'steam', 'global', 5999, '2022-10-21', 1840, 'rpg', 'p5r'),
    (2161700, 'persona-3-reload', 'Persona 3 Reload', 'Remake of the JRPG about the hidden Dark Hour.', 'steam', 'global', 6999, '2024-02-02', 1510, 'rpg', 'p3r'),
    (524220, 'nier-automata', 'NieR:Automata', 'Androids fight machines on a ruined Earth.', 'steam', 'global', 3999, '2017-03-17', 1690, 'action,rpg', ''),
    (2072450, 'like-a-dragon-infinite-wealth', 'Like a Dragon: Infinite Wealth', 'Turn-based RPG adventure from Yokohama to Hawaii.', 'steam', 'global', 6999, '2024-01-26', 1160, 'rpg,adventure', 'yakuza'),
    (2183900, 'warhammer-40000-space-marine-2', 'Warhammer 40,000: Space Marine 2', 'Third-person action against the Tyranid swarm.', 'steam', 'global', 5999, '2024-09-09', 2790, 'action,shooter,co-op', 'space marine 2 sm2'),
    (1092790, 'inscryption', 'Inscryption', 'Dark deck-building roguelike with escape-room puzzles.', 'steam', 'global', 1999, '2021-10-19', 1270, 'roguelike,horror,indie', ''),
    (753640, 'outer-wilds', 'Outer Wilds', 'Explore a solar system trapped in a 22-minute time loop.', 'steam', 'global', 2499, '2020-06-18', 1580, 'adventure,indie', ''),
    (620, 'portal-2', 'Portal 2', 'Puzzle adventure with portals, test chambers, and a co-op campaign.', 'steam', 'global', 999, '2011-04-18', 3020, 'adventure,co-op', ''),
    (546560, 'half-life-alyx', 'Half-Life: Alyx', 'VR return to the Half-Life series, set before Half-Life 2.', 'steam', 'global', 5499, '2020-03-23', 980, 'shooter,adventure', 'hla'),
    (739630, 'phasmophobia', 'Phasmophobia', 'Co-op ghost hunting with voice-recognition horror.', 'steam', 'global', 1999, '2020-09-18', 2950, 'horror,co-op,indie', ''),
    (381210, 'dead-by-daylight', 'Dead by Daylight', 'Asymmetric horror: four survivors against one killer.', 'steam', 'global', 1999, '2016-06-14', 2170, 'horror,action', 'dbd'),
    (1290000, 'powerwash-simulator', 'PowerWash Simulator', 'Wash away the dirt with the satisfying power of pressure.', 'steam', 'global', 2499, '2022-07-14', 1390, 'simulation,co-op', ''),
    (1868140, 'dave-the-diver', 'DAVE THE DIVER', 'Dive by day, run a sushi restaurant by night.', 'steam', 'global', 1999, '2023-06-28', 1730, 'adventure,indie,simulation', ''),
    (1150690, 'omori', 'OMORI', 'Psychological horror RPG between dreams and reality.', 'steam', 'global', 1999, '2020-12-25', 1050, 'rpg,horror,indie', ''),
    (391540, 'undertale', 'Undertale', 'The RPG where nobody has to die.', 'steam', 'global', 999, '2015-09-15', 1940, 'rpg,indie', ''),
    (2322010, 'god-of-war-ragnarok', 'God of War Ragnarök', 'Kratos and Atreus face the end of the Norse realms.', 'steam', 'global', 5999, '2024-09-19', 3240, 'action,adventure', 'gow ragnarok'),
    (2215430, 'ghost-of-tsushima-directors-cut', 'Ghost of Tsushima DIRECTOR''S CUT', 'Samurai Jin Sakai defends Tsushima from the Mongol invasion.', 'steam', 'global', 5999, '2024-05-16', 2980, 'action,adventure', 'got'),
    (2420110, 'horizon-forbidden-west-complete-edition', 'Horizon Forbidden West Complete Edition', 'Aloy explores a far-future frontier ruled by machines.', 'steam', 'global', 5999, '2024-03-21', 1870, 'action,rpg,adventure', 'hfw'),
    (1817190, 'marvels-spider-man-miles-morales', 'Marvel''s Spider-Man: Miles Morales', 'Miles Morales protects a snowy Harlem.', 'steam', 'global', 4999, '2022-11-18', 1760, 'action,adventure', ''),
    (1850570, 'death-stranding-directors-cut', 'DEATH STRANDING DIRECTOR''S CUT', 'Reconnect a fractured America as porter Sam Bridges.', 'steam', 'global', 3999, '2022-03-30', 1340, 'action,adventure', ''),
    (1196590, 'resident-evil-village', 'Resident Evil Village', 'Ethan Winters searches a mysterious village for his daughter.', 'steam', 'global', 3999, '2021-05-07', 1990, 'horror,action,shooter', 're8 resident evil 8'),
    (883710, 'resident-evil-2', 'Resident Evil 2', 'Survival horror remake set in Raccoon City.', 'steam', 'global', 3999, '2019-01-25', 2140, 'horror,action', 're2 remake'),
    (2054970, 'dragons-dogma-2', 'Dragon''s Dogma 2', 'Single-player action RPG with a party of Pawns.', 'steam', 'global', 6999, '2024-03-22', 1210, 'rpg,action', 'dd2'),
    (582010, 'monster-hunter-world', 'Monster Hunter: World', 'Hunt giant monsters across a living New World.', 'steam', 'global', 2999, '2018-08-09', 2850, 'action,rpg,co-op', 'mhw'),
    (1446780, 'monster-hunter-rise', 'Monster Hunter Rise', 'Hunt with Wirebugs and Palamutes from Kamura Village.', 'steam', 'global', 3999, '2022-01-12', 1460, 'action,rpg,co-op', 'mhr'),
    (2694490, 'path-of-exile-2', 'Path of Exile 2', 'Dark action RPG sequel across the acts of Wraeclast.', 'steam', 'global', 2999, '2024-12-06', 2560, 'rpg,action,co-op', 'poe2 poe 2'),
    (1313140, 'cult-of-the-lamb', 'Cult of the Lamb', 'Build a cult and crusade through roguelike dungeons.', 'steam', 'global', 2499, '2022-08-11', 1690, 'roguelike,action,indie', ''),
    (1144200, 'ready-or-not', 'Ready or Not', 'Tactical SWAT shooter for solo or co-op play.', 'steam', 'global', 4999, '2023-12-13', 1330, 'shooter,co-op', ''),
    (594650, 'hunt-showdown-1896', 'Hunt: Showdown 1896', 'Competitive bounty-hunting shooter set in 1896 America.', 'steam', 'global', 1999, '2019-08-27', 1120, 'shooter,horror', ''),
    (218620, 'payday-2', 'PAYDAY 2', 'Co-op heist shooter: plan, gear up, and rob.', 'steam', 'global', 999, '2013-08-13', 1840, 'shooter,co-op', ''),
    (379430, 'kingdom-come-deliverance', 'Kingdom Come: Deliverance', 'Realistic medieval RPG in 15th-century Bohemia.', 'steam', 'europe', 2999, '2018-02-13', 1980, 'rpg', 'kcd kcd1'),
    (2252570, 'football-manager-2024', 'Football Manager 2024', 'Manage your club, from transfers to tactics.', 'steam', 'europe', 5499, '2023-11-06', 1560, 'sports,simulation', 'fm24 fm 2024'),
    (2195250, 'ea-sports-fc-24', 'EA SPORTS FC 24', 'Football with HyperMotionV and Evolutions.', 'steam', 'europe', 6999, '2023-09-29', 1730, 'sports', 'fifa 24 fc24 fc 24'),
    (1716740, 'starfield', 'Starfield', 'Bethesda''s open-universe RPG among the stars.', 'xbox', 'global', 6999, '2023-09-06', 2470, 'rpg,shooter', ''),
    (976730, 'halo-the-master-chief-collection', 'Halo: The Master Chief Collection', 'Master Chief''s saga across six Halo games.', 'xbox', 'global', 3999, '2019-12-03', 2110, 'shooter,action', 'halo mcc'),
    (1293830, 'forza-horizon-4', 'Forza Horizon 4', 'Open-world racing through changing seasons in Britain.', 'xbox', 'europe', 4999, '2021-03-09', 1720, 'racing', 'fh4'),
    (2440510, 'forza-motorsport', 'Forza Motorsport', 'Track racing with a deep car-building career.', 'xbox', 'global', 6999, '2023-10-10', 860, 'racing,sports', ''),
    (1250410, 'microsoft-flight-simulator', 'Microsoft Flight Simulator', 'Fly anywhere on a detailed digital Earth.', 'xbox', 'global', 6999, '2020-08-18', 1250, 'simulation', 'msfs flight sim'),
    (2461850, 'senuas-saga-hellblade-ii', 'Senua''s Saga: Hellblade II', 'Senua''s brutal journey through Viking-age Iceland.', 'xbox', 'global', 4999, '2024-05-21', 740, 'action,adventure', 'hellblade 2'),
    (2322010, 'god-of-war-ragnarok-playstation', 'God of War Ragnarök', 'Kratos and Atreus face the end of the Norse realms.', 'playstation', 'europe', 7999, '2022-11-09', 2680, 'action,adventure', 'gow ragnarok'),
    (2651280, 'marvels-spider-man-2-playstation', 'Marvel''s Spider-Man 2', 'Peter Parker and Miles Morales face Kraven and Venom.', 'playstation', 'europe', 7999, '2023-10-20', 2390, 'action,adventure', 'spiderman 2'),
    (2909400, 'final-fantasy-vii-rebirth-playstation', 'FINAL FANTASY VII REBIRTH', 'Cloud and his friends leave Midgar for a vast open world.', 'playstation', 'north_america', 6999, '2024-02-29', 1310, 'rpg,action', 'ff7 ffvii final fantasy 7'),
    (2215430, 'ghost-of-tsushima-playstation', 'Ghost of Tsushima', 'Samurai Jin Sakai defends Tsushima from the Mongol invasion.', 'playstation', 'united_kingdom', 5999, '2020-07-17', 1470, 'action,adventure', 'got'),
    (1888930, 'the-last-of-us-part-i-playstation', 'The Last of Us Part I', 'Joel and Ellie cross a post-pandemic United States.', 'playstation', 'europe', 6999, '2022-09-02', 1150, 'action,adventure,horror', 'tlou'),
    (2420110, 'horizon-forbidden-west-playstation', 'Horizon Forbidden West', 'Aloy explores a far-future frontier ruled by machines.', 'playstation', 'north_america', 6999, '2022-02-18', 990, 'action,rpg,adventure', 'hfw'),
    (1145360, 'hades-nintendo', 'Hades', 'Rogue-like dungeon crawler: battle out of the Underworld.', 'nintendo', 'europe', 2450, '2020-09-17', 1730, 'action,roguelike,indie', ''),
    (413150, 'stardew-valley-nintendo', 'Stardew Valley', 'Farming life sim: restore your grandfather''s old farm.', 'nintendo', 'europe', 1399, '2017-10-05', 2050, 'simulation,indie,co-op', ''),
    (367520, 'hollow-knight-nintendo', 'Hollow Knight', 'Hand-drawn action adventure through a vast ruined insect kingdom.', 'nintendo', 'europe', 1499, '2018-06-12', 1610, 'platformer,indie,action', ''),
    (504230, 'celeste-nintendo', 'Celeste', 'Help Madeline climb Celeste Mountain in a tight, demanding platformer.', 'nintendo', 'north_america', 1999, '2018-01-25', 940, 'platformer,indie', ''),
    (2379780, 'balatro-nintendo', 'Balatro', 'Poker-inspired roguelike deck builder.', 'nintendo', 'europe', 1499, '2024-02-20', 1380, 'roguelike,strategy,indie', ''),
    (1446780, 'monster-hunter-rise-nintendo', 'Monster Hunter Rise', 'Hunt with Wirebugs and Palamutes from Kamura Village.', 'nintendo', 'europe', 3999, '2021-03-26', 1240, 'action,rpg,co-op', 'mhr'),
    (921570, 'octopath-traveler-nintendo', 'OCTOPATH TRAVELER', 'Eight travelers, eight stories, in an HD-2D world.', 'nintendo', 'united_kingdom', 4999, '2018-07-13', 820, 'rpg', ''),
    (2208920, 'assassins-creed-valhalla', 'Assassin''s Creed Valhalla', 'Viking raider Eivor builds a new home in England.', 'ubisoft_connect', 'europe', 5999, '2020-11-10', 2240, 'action,rpg,adventure', 'ac valhalla acv'),
    (812140, 'assassins-creed-odyssey', 'Assassin''s Creed Odyssey', 'Forge your destiny as a mercenary in Ancient Greece.', 'ubisoft_connect', 'global', 5999, '2018-10-05', 2010, 'action,rpg', 'ac odyssey'),
    (582160, 'assassins-creed-origins', 'Assassin''s Creed Origins', 'Bayek uncovers the Brotherhood''s origins in Ptolemaic Egypt.', 'ubisoft_connect', 'global', 5999, '2017-10-27', 1530, 'action,rpg', 'ac origins'),
    (3159330, 'assassins-creed-shadows', 'Assassin''s Creed Shadows', 'Shinobi Naoe and samurai Yasuke fight in feudal Japan.', 'ubisoft_connect', 'europe', 6999, '2025-03-20', 2620, 'action,rpg,adventure', 'ac shadows'),
    (2369390, 'far-cry-6', 'Far Cry 6', 'Guerrilla revolution on the tropical island of Yara.', 'ubisoft_connect', 'global', 5999, '2021-10-07', 1680, 'shooter,action', 'fc6'),
    (552520, 'far-cry-5', 'Far Cry 5', 'Take down a doomsday cult in Hope County, Montana.', 'ubisoft_connect', 'north_america', 5999, '2018-03-27', 1410, 'shooter,action,co-op', 'fc5'),
    (2842040, 'star-wars-outlaws', 'Star Wars Outlaws', 'Scoundrel Kay Vess pulls off heists across the galaxy.', 'ubisoft_connect', 'global', 6999, '2024-08-30', 1190, 'action,adventure', ''),
    (359550, 'rainbow-six-siege', 'Tom Clancy''s Rainbow Six Siege', 'Tactical 5v5 shooter with destructible environments.', 'ubisoft_connect', 'global', 1999, '2015-12-01', 2330, 'shooter', 'r6 r6s rainbow 6'),
    (2840770, 'avatar-frontiers-of-pandora', 'Avatar: Frontiers of Pandora', 'Open-world Na''vi adventure in the Western Frontier.', 'ubisoft_connect', 'europe', 6999, '2023-12-07', 760, 'action,adventure,shooter', ''),
    (1091500, 'cyberpunk-2077-gog', 'Cyberpunk 2077', 'Story-driven open-world RPG set in the megalopolis of Night City.', 'gog', 'global', 5999, '2020-12-10', 2970, 'rpg,shooter,action', 'cp2077'),
    (292030, 'the-witcher-3-wild-hunt-gog', 'The Witcher 3: Wild Hunt', 'Monster hunter Geralt searches a war-torn world for his adopted daughter.', 'gog', 'global', 2999, '2015-05-18', 2410, 'rpg,adventure', 'tw3 witcher 3'),
    (1086940, 'baldurs-gate-3-gog', 'Baldur''s Gate 3', 'Party-based RPG set in the Dungeons & Dragons Forgotten Realms.', 'gog', 'global', 5999, '2023-08-03', 2750, 'rpg,strategy,co-op', 'bg3'),
    (632470, 'disco-elysium-the-final-cut', 'Disco Elysium - The Final Cut', 'Detective RPG: solve a murder and rebuild your own mind.', 'gog', 'global', 3999, '2021-03-30', 1290, 'rpg,adventure,indie', ''),
    (22380, 'fallout-new-vegas', 'Fallout: New Vegas', 'Post-apocalyptic RPG in the Mojave Wasteland.', 'gog', 'global', 999, '2010-10-19', 1520, 'rpg,shooter', 'fnv'),
    (870780, 'control-ultimate-edition', 'Control Ultimate Edition', 'Supernatural action in the shifting Oldest House.', 'epic', 'global', 3999, '2020-08-27', 1160, 'action,shooter', ''),
    (397540, 'borderlands-3', 'Borderlands 3', 'Looter shooter with billions of guns and four new Vault Hunters.', 'epic', 'global', 5999, '2019-09-13', 1580, 'shooter,rpg,co-op', 'bl3'),
    (934700, 'dead-island-2', 'Dead Island 2', 'First-person zombie slaying through a ruined Los Angeles.', 'epic', 'europe', 6999, '2023-04-21', 1070, 'horror,action,co-op', ''),
    (526870, 'satisfactory-epic', 'Satisfactory', 'First-person open-world factory building and exploration.', 'epic', 'global', 3899, '2024-09-10', 940, 'simulation,co-op', ''),
    (1328670, 'mass-effect-legendary-edition', 'Mass Effect Legendary Edition', 'Remastered trilogy: Commander Shepard saves the galaxy.', 'ea_app', 'global', 5999, '2021-05-14', 1820, 'rpg,shooter', 'mele'),
    (1237970, 'titanfall-2', 'Titanfall 2', 'A pilot and his Titan in a fast-paced shooter campaign.', 'ea_app', 'global', 2999, '2016-10-28', 1340, 'shooter,action', ''),
    (1517290, 'battlefield-2042', 'Battlefield 2042', 'All-out warfare on massive near-future battlefields.', 'ea_app', 'global', 5999, '2021-11-19', 1470, 'shooter', 'bf2042'),
    (1693980, 'dead-space', 'Dead Space', 'Remake: Isaac Clarke fights Necromorphs aboard the USG Ishimura.', 'ea_app', 'global', 5999, '2023-01-27', 1230, 'horror,shooter', ''),
    (1774580, 'star-wars-jedi-survivor', 'STAR WARS Jedi: Survivor', 'Cal Kestis fights to survive as the Empire tightens its grip.', 'ea_app', 'europe', 6999, '2023-04-28', 1390, 'action,adventure', 'jedi survivor'),
    (1846380, 'need-for-speed-unbound', 'Need for Speed Unbound', 'Street racing with a graffiti-inspired style in Lakeshore City.', 'ea_app', 'global', 6999, '2022-12-02', 1010, 'racing', 'nfs unbound'),
    (1845910, 'dragon-age-the-veilguard', 'Dragon Age: The Veilguard', 'Unite a team of companions to stop rogue gods.', 'ea_app', 'north_america', 6999, '2024-10-31', 880, 'rpg,action', ''),
    (1222700, 'a-way-out', 'A Way Out', 'Two prisoners break out and stay on the run, in split-screen co-op only.', 'ea_app', 'global', 2999, '2018-03-23', 1060, 'co-op,adventure,action', ''),
    (2669320, 'ea-sports-fc-25', 'EA SPORTS FC 25', 'Football with Rush 5v5 and FC IQ tactics.', 'ea_app', 'global', 6999, '2024-09-27', 2140, 'sports', 'fifa 25 fc25 fc 25'),
    (2488620, 'ea-sports-f1-24', 'EA SPORTS F1 24', 'The official 2024 Formula 1 season with a refreshed Career mode.', 'ea_app', 'global', 6999, '2024-05-31', 760, 'racing,sports', 'f1 2024 formula 1'),
    (1238840, 'battlefield-1', 'Battlefield 1', 'All-out warfare on the battlefields of World War I.', 'ea_app', 'united_kingdom', 3999, '2016-10-21', 970, 'shooter', 'bf1')
),
inserted AS (
    INSERT INTO products (slug, title, description, cover_url, banner_url, platform, region, msrp_cents, release_date, sold_count, search_keywords)
    SELECT v.slug, v.title, v.description,
           'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/' || v.app_id || '/library_600x900.jpg',
           'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/' || v.app_id || '/library_hero.jpg',
           v.platform, v.region, v.msrp_cents, v.release_date::date, v.sold_count, v.keywords
    FROM v
    RETURNING id, slug
)
INSERT INTO product_genres (product_id, genre_id)
SELECT i.id, (SELECT g.id FROM genres g WHERE g.slug = gs.slug)
FROM inserted i
JOIN v ON v.slug = i.slug
CROSS JOIN LATERAL unnest(string_to_array(v.genres, ',')) AS gs (slug);

-- Same deterministic offer pricing as 00004, applied to products that have no offers yet.
INSERT INTO offers (product_id, seller_id, price_cents)
SELECT p.id, s.id, greatest(99, (round(p.msrp_cents * (0.30 + (abs(hashtext(p.slug || ':' || s.name)) % 56) / 100.0) / 10) * 10)::int - 1)
FROM products p CROSS JOIN sellers s
WHERE abs(hashtext(s.name || '/' || p.slug)) % 3 <> 0
  AND NOT EXISTS (SELECT 1 FROM offers o WHERE o.product_id = p.id)
UNION
SELECT p.id, s.id, greatest(99, (round(p.msrp_cents * 0.80 / 10) * 10)::int - 1)
FROM products p JOIN sellers s ON s.id = (p.id % 6) + 1
WHERE NOT EXISTS (SELECT 1 FROM offers o WHERE o.product_id = p.id)
ON CONFLICT (product_id, seller_id) DO NOTHING;

-- +goose StatementBegin
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM products p WHERE NOT EXISTS (SELECT 1 FROM product_genres pg WHERE pg.product_id = p.id)) THEN
        RAISE EXCEPTION 'seed: every product needs at least one genre';
    END IF;
END
$$;
-- +goose StatementEnd

-- +goose Down
DELETE FROM products
WHERE slug <> ALL (ARRAY[
    'elden-ring', 'cyberpunk-2077', 'red-dead-redemption-2', 'the-witcher-3-wild-hunt', 'baldurs-gate-3',
    'hogwarts-legacy', 'grand-theft-auto-v', 'stardew-valley', 'hades', 'hades-ii', 'sekiro-shadows-die-twice',
    'monster-hunter-wilds', 'black-myth-wukong', 'helldivers-2', 'palworld', 'terraria', 'hollow-knight',
    'hollow-knight-silksong', 'forza-horizon-5', 'diablo-iv', 'god-of-war', 'resident-evil-4', 'it-takes-two',
    'split-fiction', 'kingdom-come-deliverance-ii', 'clair-obscur-expedition-33', 'doom-the-dark-ages',
    'civilization-vii', 'satisfactory', 'lies-of-p', 'street-fighter-6', 'silent-hill-2',
    'indiana-jones-and-the-great-circle', 'stalker-2-heart-of-chornobyl', 'valheim',
    'marvels-spider-man-remastered', 'sea-of-thieves', 'fallout-4', 'skyrim-special-edition', 'the-last-of-us-part-i'
]);
DELETE FROM product_genres;
DELETE FROM genres;
UPDATE products SET search_keywords = '';
