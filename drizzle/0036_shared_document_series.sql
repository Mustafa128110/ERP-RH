-- Document numbers used to run per company: number_sequences held one
-- 'doc:<company_id>:<document_type_id>' counter each, so Royal Hardware and M52
-- both issued SI-0001. The counter is now keyed by series ('doc:SI') and shared
-- by every company, so each series is one continuous run
-- (lib/db/sequences.ts documentScope).
--
-- This seeds each shared counter above the highest number already issued for its
-- series in ANY company, so the continuous run resumes instead of colliding with
-- history. Both the ledger and documents are scanned: purchases accept a manual
-- number, and a hand-typed one has to be counted too.
--
-- Numbers already issued are deliberately NOT renumbered — SI-0001 exists once
-- per company today and stays that way. Only numbers issued from here on are
-- continuous. The old per-company counter rows are left in place; nothing reads
-- them after this.
INSERT INTO number_sequences (scope, next_value)
SELECT 'doc:' || series, MAX(seq) + 1
FROM (
    SELECT dt.series AS series, SPLIT_PART(l.number, '-', 2)::int AS seq
    FROM document_number_ledger l
    JOIN document_types dt ON dt.id = l.document_type_id
    WHERE l.number ~ '^[A-Z]+-[0-9]+$'
    UNION ALL
    SELECT dt.series AS series, SPLIT_PART(d.number, '-', 2)::int AS seq
    FROM documents d
    JOIN document_types dt ON dt.id = d.document_type_id
    WHERE d.number ~ '^[A-Z]+-[0-9]+$'
) issued
GROUP BY series
ON CONFLICT (scope) DO UPDATE SET next_value = GREATEST(number_sequences.next_value, excluded.next_value);
