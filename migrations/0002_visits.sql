-- Anonymous daily page-view counts. No IP address is stored: visitor is an
-- HMAC of the address and user agent with SESSION_SECRET, rotating every day.
CREATE TABLE IF NOT EXISTS visits (
  day TEXT NOT NULL,
  visitor TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 1,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  PRIMARY KEY (day, visitor)
);
CREATE INDEX IF NOT EXISTS visits_day ON visits(day);
