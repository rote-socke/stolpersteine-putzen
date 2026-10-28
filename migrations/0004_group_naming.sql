-- A group may name itself once. 1 = still carries a placeholder name ("Gruppe N") the group may replace.
-- Existing groups keep their names.
ALTER TABLE groups ADD COLUMN name_pending INTEGER NOT NULL DEFAULT 0;
