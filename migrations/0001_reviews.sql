-- No personal name, email, school ID or plaintext IP is required.
CREATE TABLE IF NOT EXISTS ratings (
  occurrence TEXT NOT NULL,
  dish_id TEXT NOT NULL,
  visitor TEXT NOT NULL,
  stars INTEGER NOT NULL CHECK(stars BETWEEN 1 AND 5),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (occurrence, visitor)
);
CREATE INDEX IF NOT EXISTS ratings_dish ON ratings(dish_id);
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  occurrence TEXT NOT NULL,
  dish_id TEXT NOT NULL,
  dish_name TEXT NOT NULL,
  visitor TEXT NOT NULL,
  nickname TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS comments_occurrence ON comments(occurrence, status, created_at);
CREATE INDEX IF NOT EXISTS comments_moderation ON comments(status, created_at);
CREATE TABLE IF NOT EXISTS request_limits (
  bucket TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(bucket, window_start)
);
CREATE INDEX IF NOT EXISTS request_limits_expiry ON request_limits(window_start);
