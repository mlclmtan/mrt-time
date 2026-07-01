-- Board observations extracted from timed platform photos.
CREATE TABLE IF NOT EXISTS observations (
  id            BIGSERIAL PRIMARY KEY,
  line          TEXT        NOT NULL,
  station_code  TEXT        NOT NULL,
  captured_at   TIMESTAMPTZ NOT NULL,
  direction     TEXT        NOT NULL,
  dest_code     TEXT,
  dest_name     TEXT,
  next_min      INTEGER     NOT NULL,
  next_next_min INTEGER,
  source        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_obs_line_station ON observations (line, station_code, captured_at);

-- Prevent exact duplicate rows if the same photo is loaded twice.
CREATE UNIQUE INDEX IF NOT EXISTS uq_obs_dedupe
  ON observations (line, station_code, captured_at, direction, dest_code);
