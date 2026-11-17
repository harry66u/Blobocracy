-- Blobocracy schema (spec §9). Applied on sim boot; every statement is idempotent.

CREATE TABLE IF NOT EXISTS levels (
  id              integer PRIMARY KEY,
  name            text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  unlocked_at     timestamptz,
  beaten_at       timestamptz,
  current_version integer NOT NULL
);

-- Every version a level has been played on; its geometry stays in the code so old replays draw.
CREATE TABLE IF NOT EXISTS level_versions (
  level_id      integer NOT NULL REFERENCES levels(id),
  version       integer NOT NULL,
  geometry_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  notes         text NOT NULL DEFAULT '',
  PRIMARY KEY (level_id, version)
);

-- One row per level: the death count and the record (the sim's copy in memory is authoritative).
CREATE TABLE IF NOT EXISTS world (
  level_id        integer PRIMARY KEY REFERENCES levels(id),
  deaths          bigint NOT NULL DEFAULT 0,
  record_progress double precision,
  record_run      integer,
  record_version  integer,
  peak_players    integer NOT NULL DEFAULT 0,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Nickname-ready: sessions are anonymous today; a nickname can attach later without touching other tables.
CREATE TABLE IF NOT EXISTS players (
  session_id text PRIMARY KEY,
  nickname   text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS clips (
  id            text PRIMARY KEY,
  level_id      integer NOT NULL,
  level_version integer NOT NULL,
  run_number    integer NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('record', 'near_miss', 'win')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  progress      double precision NOT NULL,
  cause         text NOT NULL DEFAULT '',
  deaths        bigint NOT NULL DEFAULT 0,
  replay        bytea NOT NULL,
  og_image      bytea,
  session_id    text
);
CREATE INDEX IF NOT EXISTS clips_run ON clips (level_id, run_number);

CREATE TABLE IF NOT EXISTS runs (
  level_id      integer NOT NULL,
  level_version integer NOT NULL,
  run_number    integer NOT NULL,
  started_at    timestamptz NOT NULL,
  ended_at      timestamptz NOT NULL,
  duration_ms   integer NOT NULL,
  max_progress  double precision NOT NULL,
  max_x         double precision NOT NULL,
  zone_reached  smallint NOT NULL,
  cause         text NOT NULL,
  peak_players  integer NOT NULL DEFAULT 0,
  clip_id       text,
  session_id    text,
  PRIMARY KEY (level_id, run_number)
);
CREATE INDEX IF NOT EXISTS runs_best ON runs (level_id, max_progress DESC, run_number DESC);

CREATE TABLE IF NOT EXISTS hall_of_fame (
  level_id     integer PRIMARY KEY,
  beaten_at    timestamptz NOT NULL,
  death_count  bigint NOT NULL,
  peak_players integer NOT NULL,
  run_number   integer NOT NULL,
  clip_id      text
);
