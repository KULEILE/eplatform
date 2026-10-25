-- 065_passport_pages_full_proof.sql
--
-- Migration 064 let a citizen renew a not-yet-expired passport by simply declaring
-- renewalReason = 'Pages Full', with nothing backing that claim up. The client asked for proof:
-- the citizen must say how many pages their passport has, and upload a photo of the last page
-- showing it's actually full. Mirrors how every other "prove it" moment in this system already
-- works (a supporting document for National ID/passport replacement, a proof image for a birth
-- certificate reissue) — a declared reason alone was never enough anywhere else either.

ALTER TABLE passport_records
    ADD COLUMN IF NOT EXISTS pages_full_page_count INTEGER
        CHECK (pages_full_page_count IS NULL OR pages_full_page_count > 0),
    ADD COLUMN IF NOT EXISTS pages_full_proof_reference VARCHAR(255);
