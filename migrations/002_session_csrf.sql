ALTER TABLE sessions ADD COLUMN csrf_token TEXT;
UPDATE sessions SET csrf_token = lower(hex(randomblob(24))) WHERE csrf_token IS NULL;
