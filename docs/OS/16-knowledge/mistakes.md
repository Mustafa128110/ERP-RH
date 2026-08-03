# Mistakes — The Honest File

Consumers: bug-hunter (drafts entries) · SOP/doc patch decisions ·
the monthly roll-up · new-staff onboarding (reading this file IS
onboarding — it's every lesson pre-paid).
Culture line, stated once: the SOP gets patched, not the person
blamed. A mistake captured honestly is an asset; a mistake hidden
repeats at full price.

## Entry format
### [YYYY-MM-DD] · [one-line title] · Severity: [sales-blocking /
cost / near-miss]
**What happened:** (plain narrative, 2–4 sentences)
**Root cause:** (the real one — keep asking why until it stops
being a person and becomes a process)
**Which layer should have caught it:** (CI? checklist? SOP step?
QC sample? — name it)
**What changed so it can't recur:** (the patch, with the PR/doc
link — an entry without this line is unfinished)
**Cost:** (honest estimate: money, hours, trust)

## The recurrence law
The same root cause twice = a process failure, escalated: the
governing SOP/checklist/standard is rewritten, not re-explained.
Track recurrences in the monthly roll-up.

## Monthly roll-up (owner, with lessons.md)
Patterns across entries → this month's doc patches · recurrence
check · the one systemic fix worth an hour.