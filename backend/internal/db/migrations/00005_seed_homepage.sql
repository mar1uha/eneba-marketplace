-- +goose Up
INSERT INTO homepage_blocks (block_type, position, title, config) VALUES
('hero_carousel', 10, 'Featured', '{
    "interval_ms": 6000,
    "slides": [
        {"product_slug": "clair-obscur-expedition-33", "title": "Clair Obscur: Expedition 33", "subtitle": "Turn-based combat, real-time reactions. One of the year''s best RPGs.", "cta_label": "Shop now"},
        {"product_slug": "hollow-knight-silksong", "title": "Hollow Knight: Silksong", "subtitle": "Hornet''s journey is finally here. Climb to the citadel.", "cta_label": "Shop now"},
        {"product_slug": "elden-ring", "title": "ELDEN RING", "subtitle": "Rise, Tarnished. The award-winning open-world epic.", "cta_label": "Shop now"},
        {"product_slug": "black-myth-wukong", "title": "Black Myth: Wukong", "subtitle": "Become the Destined One in a myth-soaked action RPG.", "cta_label": "Shop now"},
        {"product_slug": "baldurs-gate-3", "title": "Baldur''s Gate 3", "subtitle": "Gather your party. Every choice matters.", "cta_label": "Shop now"}
    ]
}'),
('deal', 20, 'Deal of the day', '{
    "rotation": "daily",
    "product_slugs": ["red-dead-redemption-2", "hogwarts-legacy", "sekiro-shadows-die-twice", "the-witcher-3-wild-hunt", "resident-evil-4", "god-of-war", "it-takes-two"]
}'),
('product_carousel', 30, 'Best sellers', '{"source": "best_selling", "limit": 12}'),
('product_carousel', 40, 'New releases', '{"source": "newest", "limit": 12}'),
('product_carousel', 50, 'Biggest discounts', '{"source": "discount", "limit": 12}'),
('product_carousel', 60, 'Soulslike essentials', '{
    "source": "manual",
    "product_slugs": ["elden-ring", "sekiro-shadows-die-twice", "lies-of-p", "hollow-knight", "hollow-knight-silksong", "black-myth-wukong"]
}');

-- +goose Down
DELETE FROM homepage_blocks;
