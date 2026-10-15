-- Per-user rDash token cache. Acts as the source of truth for "what's the
-- current access/refresh token for this user", so concurrent refresh attempts
-- from different request handlers (and, in future, multiple pods) all converge
-- on the same token instead of racing rDash's single-use refresh-token
-- rotation and tripping "Refresh token replay detected. All tokens revoked."
--
-- Locked via pg_advisory_xact_lock(hashtext(user_id)) inside the refresh
-- helper — the lock + this row are how we serialize.
--
-- user_id is the decoded rDash integer-string (matches AuthPayload.userId).
CREATE TABLE IF NOT EXISTS pbe_user_sessions (
  user_id              TEXT PRIMARY KEY,
  access_token         TEXT NOT NULL,
  refresh_token        TEXT NOT NULL,
  expires_at           BIGINT NOT NULL,          -- unix seconds
  refresh_expires_at   BIGINT NOT NULL,          -- unix seconds
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- `prior_refresh_token` is the input refresh_token that was rotated to produce
-- the access_token in this row. The refresh helper uses it to detect when a
-- cached row is from a prior session (e.g. after the user re-handovers): if
-- cookie.refresh_token !== prior_refresh_token, this row's access_token is
-- stale and we must call rDash with the cookie's refresh_token instead.
ALTER TABLE pbe_user_sessions ADD COLUMN IF NOT EXISTS prior_refresh_token TEXT;

COMMENT ON TABLE pbe_user_sessions IS
  'rDash access/refresh token cache keyed by user_id. Authoritative for the CURRENT session only — `prior_refresh_token` ties the row to a specific cookie refresh_token. Rows from older sessions are ignored, not trusted.';
COMMENT ON COLUMN pbe_user_sessions.prior_refresh_token IS
  'The refresh_token that was the input to produce this access_token. Used to detect stale cache rows after re-handover.';
