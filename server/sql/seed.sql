-- Demo data for the stock & quotation portal.
-- Passwords are bcrypt hashes of "demo1234" (cost 10).
-- Regenerate with: node -e "import('bcryptjs').then(b=>console.log(b.default.hashSync('demo1234',10)))"

INSERT INTO users (email, password_hash, role) VALUES
  ('admin@portal.local', '$2a$10$gyE3qNl/Wd1wEZOVfJt9zO8tEcIIJDHWmM.Bmz6rqowaHkUq.OvQa', 'admin'),
  ('sales@portal.local', '$2a$10$gyE3qNl/Wd1wEZOVfJt9zO8tEcIIJDHWmM.Bmz6rqowaHkUq.OvQa', 'sales');

INSERT INTO categories (name) VALUES
  ('Hand Tools'),
  ('Power Tools'),
  ('Safety Equipment'),
  ('Fasteners');

INSERT INTO products (sku, name, category_id, unit_price, stock_qty, reorder_level) VALUES
  ('HT-0001', 'Claw Hammer 16oz',            1,  18.90, 120, 20),
  ('HT-0002', 'Screwdriver Set 12pcs',       1,  32.50,  64, 15),
  ('HT-0003', 'Adjustable Wrench 10in',      1,  27.00,   8, 15),
  ('HT-0004', 'Tape Measure 5m',             1,  12.40, 210, 30),
  ('PT-0101', 'Cordless Drill 18V',          2, 289.00,  35, 10),
  ('PT-0102', 'Angle Grinder 4in',           2, 159.00,  12, 10),
  ('PT-0103', 'Impact Driver Kit',           2, 349.00,   5, 10),
  ('PT-0104', 'Circular Saw 1400W',          2, 429.00,  18,  8),
  ('SF-0201', 'Safety Helmet Yellow',        3,  22.00, 200, 40),
  ('SF-0202', 'Safety Goggles Clear',        3,   9.80, 150, 40),
  ('SF-0203', 'Cut-Resistant Gloves L',      3,  14.20,   3, 25),
  ('FS-0301', 'Hex Bolt M8 x 60mm (100pcs)', 4,  38.00, 300, 50),
  ('FS-0302', 'Wood Screw 4x40mm (500pcs)',  4,  45.50,  90, 50);
