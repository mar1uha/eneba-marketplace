-- +goose Up
UPDATE products v SET edition_of = m.id
FROM (VALUES
    ('cyberpunk-2077-gog', 'cyberpunk-2077'),
    ('the-witcher-3-wild-hunt-gog', 'the-witcher-3-wild-hunt'),
    ('baldurs-gate-3-gog', 'baldurs-gate-3'),
    ('satisfactory-epic', 'satisfactory'),
    ('hades-nintendo', 'hades'),
    ('stardew-valley-nintendo', 'stardew-valley'),
    ('hollow-knight-nintendo', 'hollow-knight'),
    ('celeste-nintendo', 'celeste'),
    ('balatro-nintendo', 'balatro'),
    ('monster-hunter-rise-nintendo', 'monster-hunter-rise'),
    ('god-of-war-ragnarok-playstation', 'god-of-war-ragnarok'),
    ('final-fantasy-vii-rebirth-playstation', 'final-fantasy-vii-rebirth'),
    ('ghost-of-tsushima-playstation', 'ghost-of-tsushima-directors-cut'),
    ('the-last-of-us-part-i-playstation', 'the-last-of-us-part-i'),
    ('horizon-forbidden-west-playstation', 'horizon-forbidden-west-complete-edition')
) AS e (variant, main)
JOIN products m ON m.slug = e.main
WHERE v.slug = e.variant;

-- Fake keys in the 5-5-5 format most stores use, derived deterministically from the offer and key number.
-- Stock per offer: about 1 in 8 offers is sold out and about 1 in 8 has only 1-3 keys left; the rest have
-- 4-25. Each product's guaranteed offer from 00004/00008 (seller (product id % 6) + 1) always has stock,
-- so every product stays purchasable.
INSERT INTO digital_keys (offer_id, code)
SELECT o.id,
       upper(substr(md5(o.id || ':' || g.n), 1, 5) || '-' || substr(md5(o.id || ':' || g.n), 6, 5) || '-' || substr(md5(o.id || ':' || g.n), 11, 5))
FROM offers o
JOIN products p ON p.id = o.product_id
CROSS JOIN LATERAL (SELECT abs(hashtext('stock:' || p.slug || ':' || o.seller_id)) AS h) x
CROSS JOIN LATERAL generate_series(1,
    CASE
        WHEN o.seller_id = (p.id % 6) + 1 THEN 4 + x.h % 22
        WHEN x.h % 8 = 0 THEN 0
        WHEN x.h % 8 = 1 THEN 1 + x.h % 3
        ELSE 4 + x.h % 22
    END) AS g (n);

-- +goose StatementBegin
DO $$
BEGIN
    IF (SELECT count(*) FROM products WHERE edition_of IS NOT NULL) <> 15 THEN
        RAISE EXCEPTION 'seed: expected 15 linked editions';
    END IF;
    IF EXISTS (
        SELECT 1 FROM products p
        WHERE NOT EXISTS (
            SELECT 1 FROM offers o JOIN digital_keys k ON k.offer_id = o.id
            WHERE o.product_id = p.id AND o.is_active
        )
    ) THEN
        RAISE EXCEPTION 'seed: every product needs an offer with stock';
    END IF;
END
$$;
-- +goose StatementEnd

-- +goose Down
DELETE FROM digital_keys;
UPDATE products SET edition_of = NULL;
