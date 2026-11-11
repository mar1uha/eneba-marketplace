-- +goose Up
-- Demo catalog. Images are hotlinked from Steam's public CDN; they belong to their publishers.
INSERT INTO sellers (name, rating, review_count) VALUES
    ('NovaKeys', 99.5, 64002),
    ('PixelVault', 99.2, 48210),
    ('KeyForge', 98.7, 31544),
    ('GameHaven', 97.9, 12873),
    ('LootLane', 96.4, 8650),
    ('QuestMart', 95.8, 4321);

INSERT INTO products (slug, title, description, cover_url, banner_url, platform, region, msrp_cents, release_date, sold_count)
SELECT v.slug, v.title, v.description,
       'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/' || v.app_id || '/library_600x900.jpg',
       'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/' || v.app_id || '/library_hero.jpg',
       v.platform, v.region, v.msrp_cents, v.release_date::date, v.sold_count
FROM (VALUES
    (1245620, 'elden-ring', 'ELDEN RING', 'Open-world action RPG across the Lands Between from FromSoftware.', 'steam', 'global', 5999, '2022-02-25', 9120),
    (1091500, 'cyberpunk-2077', 'Cyberpunk 2077', 'Story-driven open-world RPG set in the megalopolis of Night City.', 'steam', 'global', 5999, '2020-12-10', 8340),
    (1174180, 'red-dead-redemption-2', 'Red Dead Redemption 2', 'Outlaw epic about Arthur Morgan and the Van der Linde gang.', 'steam', 'global', 5999, '2019-12-05', 7710),
    (292030, 'the-witcher-3-wild-hunt', 'The Witcher 3: Wild Hunt', 'Monster hunter Geralt searches a war-torn world for his adopted daughter.', 'steam', 'global', 2999, '2015-05-18', 6650),
    (1086940, 'baldurs-gate-3', 'Baldur''s Gate 3', 'Party-based RPG set in the Dungeons & Dragons Forgotten Realms.', 'steam', 'global', 5999, '2023-08-03', 8990),
    (990080, 'hogwarts-legacy', 'Hogwarts Legacy', 'Open-world action RPG set in the 1800s wizarding world.', 'steam', 'europe', 5999, '2023-02-10', 7020),
    (271590, 'grand-theft-auto-v', 'Grand Theft Auto V', 'Three criminals pull off heists across Los Santos and Blaine County.', 'steam', 'global', 2999, '2015-04-14', 9800),
    (413150, 'stardew-valley', 'Stardew Valley', 'Farming life sim: restore your grandfather''s old farm.', 'steam', 'global', 1399, '2016-02-26', 6120),
    (1145360, 'hades', 'Hades', 'Rogue-like dungeon crawler: battle out of the Underworld.', 'steam', 'global', 2450, '2020-09-17', 4410),
    (1145350, 'hades-ii', 'Hades II', 'Sequel rogue-like: the Princess of the Underworld takes on the Titan of Time.', 'steam', 'global', 2950, '2025-09-25', 5230),
    (814380, 'sekiro-shadows-die-twice', 'Sekiro: Shadows Die Twice', 'Precision sword combat in a reimagined late-1500s Sengoku Japan.', 'steam', 'global', 5999, '2019-03-22', 3870),
    (2246340, 'monster-hunter-wilds', 'Monster Hunter Wilds', 'Hunt colossal monsters across living, shifting ecosystems.', 'steam', 'global', 6999, '2025-02-28', 6480),
    (2358720, 'black-myth-wukong', 'Black Myth: Wukong', 'Action RPG rooted in the Chinese classic Journey to the West.', 'steam', 'global', 5999, '2024-08-20', 7390),
    (553850, 'helldivers-2', 'HELLDIVERS 2', 'Co-op shooter: spread managed democracy across the galaxy.', 'steam', 'global', 3999, '2024-02-08', 6010),
    (1623730, 'palworld', 'Palworld', 'Multiplayer survival crafting with collectible creatures called Pals.', 'steam', 'global', 2899, '2024-01-19', 5560),
    (105600, 'terraria', 'Terraria', 'Dig, fight, explore, and build in a 2D sandbox world.', 'steam', 'global', 999, '2011-05-16', 4980),
    (367520, 'hollow-knight', 'Hollow Knight', 'Hand-drawn action adventure through a vast ruined insect kingdom.', 'steam', 'global', 1499, '2017-02-24', 4630),
    (1030300, 'hollow-knight-silksong', 'Hollow Knight: Silksong', 'Play as Hornet and climb a haunted kingdom of silk and song.', 'steam', 'global', 1950, '2025-09-04', 6870),
    (1551360, 'forza-horizon-5', 'Forza Horizon 5', 'Open-world racing across the landscapes of Mexico.', 'xbox', 'global', 5999, '2021-11-09', 4120),
    (2344520, 'diablo-iv', 'Diablo IV', 'Action RPG: fight the forces of Hell across Sanctuary.', 'steam', 'europe', 6999, '2023-10-17', 3550),
    (1593500, 'god-of-war', 'God of War', 'Kratos and his son Atreus journey through Norse realms.', 'steam', 'global', 4999, '2022-01-14', 4790),
    (2050650, 'resident-evil-4', 'Resident Evil 4', 'Remake of the survival horror classic: rescue the president''s daughter.', 'steam', 'global', 3999, '2023-03-24', 4350),
    (1426210, 'it-takes-two', 'It Takes Two', 'Genre-bending co-op adventure built for two players.', 'ea_app', 'global', 3999, '2021-03-26', 3980),
    (2001120, 'split-fiction', 'Split Fiction', 'Co-op adventure that jumps between sci-fi and fantasy worlds.', 'ea_app', 'global', 4999, '2025-03-06', 4560),
    (1771300, 'kingdom-come-deliverance-ii', 'Kingdom Come: Deliverance II', 'Realistic medieval RPG set in 15th-century Bohemia.', 'steam', 'europe', 5999, '2025-02-04', 5120),
    (1903340, 'clair-obscur-expedition-33', 'Clair Obscur: Expedition 33', 'Turn-based RPG with real-time reactions in a Belle Epoque-inspired world.', 'steam', 'global', 4999, '2025-04-24', 7860),
    (3017860, 'doom-the-dark-ages', 'DOOM: The Dark Ages', 'Medieval prequel: the Slayer wields a shield saw against Hell''s armies.', 'steam', 'global', 7999, '2025-05-15', 3210),
    (1295660, 'civilization-vii', 'Sid Meier''s Civilization VII', 'Turn-based strategy: build an empire to stand the test of time.', 'steam', 'north_america', 6999, '2025-02-11', 2890),
    (526870, 'satisfactory', 'Satisfactory', 'First-person open-world factory building and exploration.', 'steam', 'global', 3899, '2024-09-10', 3340),
    (1627720, 'lies-of-p', 'Lies of P', 'Soulslike action inspired by the story of Pinocchio.', 'steam', 'global', 5999, '2023-09-19', 2740),
    (1364780, 'street-fighter-6', 'Street Fighter 6', 'The fighting game series returns with World Tour and Battle Hub modes.', 'steam', 'global', 5999, '2023-06-02', 2210),
    (2124490, 'silent-hill-2', 'SILENT HILL 2', 'Remake of the psychological horror classic in a fog-bound town.', 'steam', 'global', 6999, '2024-10-08', 3060),
    (2677660, 'indiana-jones-and-the-great-circle', 'Indiana Jones and the Great Circle', 'First-person adventure racing to uncover an ancient global mystery.', 'steam', 'global', 6999, '2024-12-09', 2980),
    (1643320, 'stalker-2-heart-of-chornobyl', 'S.T.A.L.K.E.R. 2: Heart of Chornobyl', 'Open-world survival shooter in the Chornobyl Exclusion Zone.', 'steam', 'europe', 5999, '2024-11-20', 3410),
    (892970, 'valheim', 'Valheim', 'Viking survival and exploration for 1 to 10 players.', 'steam', 'global', 1999, '2021-02-02', 3720),
    (1817070, 'marvels-spider-man-remastered', 'Marvel''s Spider-Man Remastered', 'Swing through Marvel''s New York as an experienced Peter Parker.', 'steam', 'global', 5999, '2022-08-12', 3190),
    (1172620, 'sea-of-thieves', 'Sea of Thieves', 'Shared-world pirate adventure with your crew.', 'xbox', 'global', 3999, '2020-06-03', 2650),
    (377160, 'fallout-4', 'Fallout 4', 'Post-nuclear open-world RPG set in the Commonwealth of Boston.', 'steam', 'global', 1999, '2015-11-10', 3880),
    (489830, 'skyrim-special-edition', 'The Elder Scrolls V: Skyrim Special Edition', 'Open-world fantasy epic: the Dragonborn rises.', 'steam', 'united_kingdom', 3999, '2016-10-28', 4240),
    (1888930, 'the-last-of-us-part-i', 'The Last of Us Part I', 'Joel and Ellie cross a post-pandemic United States.', 'steam', 'north_america', 5999, '2023-03-28', 2570)
) AS v (app_id, slug, title, description, platform, region, msrp_cents, release_date, sold_count);

-- Deterministic pseudo-random offers: each seller lists roughly 2/3 of products at 30-85% of MSRP.
-- The second SELECT guarantees every product has at least one offer.
INSERT INTO offers (product_id, seller_id, price_cents)
SELECT p.id, s.id, greatest(99, (round(p.msrp_cents * (0.30 + (abs(hashtext(p.slug || ':' || s.name)) % 56) / 100.0) / 10) * 10)::int - 1)
FROM products p CROSS JOIN sellers s
WHERE abs(hashtext(s.name || '/' || p.slug)) % 3 <> 0
UNION
SELECT p.id, s.id, greatest(99, (round(p.msrp_cents * 0.80 / 10) * 10)::int - 1)
FROM products p JOIN sellers s ON s.id = (p.id % 6) + 1
ON CONFLICT (product_id, seller_id) DO NOTHING;

-- +goose Down
DELETE FROM offers;
DELETE FROM products;
DELETE FROM sellers;
