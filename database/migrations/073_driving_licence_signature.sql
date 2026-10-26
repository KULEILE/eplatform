-- Batch 27 — Driving Licence: display the actual card, with the citizen's signature on it.
--
-- "i said the system must generate the card like this one and then display it like id display
-- when citizen is entered on that license department and also the citizen still needs to sign
-- when they collect it and that signature putted on the license"
--
-- signature_reference: the citizen's signature captured on a pad at the moment the physical
-- licence is collected — the exact same column name and capture-at-collection convention
-- migration 035 already established for National ID, birth certificate, passport, and police
-- clearance certificate (see that migration's header comment). Driving Licence was the one
-- physical-collection document in the system that didn't yet have this.
ALTER TABLE traffic_records
    ADD COLUMN IF NOT EXISTS signature_reference VARCHAR(255);
