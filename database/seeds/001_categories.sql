-- ============================================================================
-- database/seeds/001_categories.sql
-- Canonical category list. Idempotent: safe to run repeatedly.
-- ============================================================================

INSERT INTO categories (name, description) VALUES
  ('Electronics',        'Electronic devices and accessories other than phones and laptops'),
  ('Mobile Phone',       'Smartphones and mobile handsets'),
  ('Laptop & Tablet',    'Laptops, tablets and their chargers'),
  ('Bag & Backpack',     'Backpacks, handbags, laptop bags and luggage'),
  ('Wallet & Purse',     'Wallets, purses, card holders'),
  ('ID Card & Documents','Student IDs, library cards, passports and paperwork'),
  ('Keys',               'Key rings, room keys, car keys and fobs'),
  ('Clothing',           'Jackets, hoodies, scarves and other apparel'),
  ('Books & Stationery', 'Textbooks, notebooks, calculators and pens'),
  ('Jewellery',          'Rings, watches, bracelets and other accessories'),
  ('Sports Equipment',   'Bats, rackets, gym gear and sports bags'),
  ('Water Bottle',       'Reusable bottles, flasks and thermos'),
  ('Eyewear',            'Spectacles, sunglasses and cases'),
  ('Umbrella',           'Umbrellas of all sizes'),
  ('Other',              'Items that do not fit any other category')
ON CONFLICT (name) DO UPDATE
  SET description = EXCLUDED.description;
