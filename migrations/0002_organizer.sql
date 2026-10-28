-- Organizer mode: tokens are derived from INVITE_SECRET, groups can be soft-deleted.
-- token_hash stays the SHA-256 of the current token, so the Bearer lookup is unchanged.
ALTER TABLE groups ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE groups ADD COLUMN deleted_at INTEGER;  -- set on delete; name_key and token_hash become 'deleted:<id>'
