# Royal Hardware ERP — UI Wireframes

**Phase:** 6 of 12
**Status:** Draft for approval
**Depends on:** [Phase 2 — FRS](phase-2-functional-requirements.md), [Phase 5 — Folder Structure](phase-5-folder-structure.md)

**Interactive wireframes:** https://claude.ai/code/artifact/dadf0a38-7e9e-46e1-bb80-b336b851cfed

These are low-fidelity layout sketches — box structure and interaction rules, not final visual design (that's a Phase 10 concern once shadcn/ui components are in place). Use the rail on the left of the artifact to switch between 10 screens; each screen has a "Key behavior" panel underneath tying it back to specific FR IDs from Phase 2.

## Screens Covered

| Screen | Module | Notable behavior shown |
|---|---|---|
| Login | Auth | No company/warehouse selection at login — resolved post-auth from access tables |
| Dashboard | Core | Admin vs. Salesman see different tile sets, not the same tiles with hidden numbers |
| Products — List | Inventory | Warehouse-relative Low/Out stock pill; blocked-delete affordance |
| Product — Detail | Inventory | Read-only per-warehouse Average Cost; unit-conversion chain as a flow chip, not a raw table |
| Stock Transfer | Inventory | Three-state stepper (Initiated → In Transit → Received) with a variance column |
| New Sale (POS) | Sales | Channel picker, inline low-stock warning, no cost/margin column for Salesman |
| Quotation → Invoice | Sales | Partial conversion via per-line qty + checkbox, plus a conversion history table |
| Customer Ledger | Sales | Per-company balance switch (Royal Hardware / M52) on the same customer |
| Reports | Reporting | Shared filter shape across all report types; cost-at-sale vs. live cost distinction |
| Settings & Roles | Admin | Permission matrix as the actual data model; Sales Channel → Company mapping table |

## Design Direction Confirmed at This Fidelity

- Table-dense, power-user layouts (TanStack Table–shaped) rather than card-heavy consumer UI — matches the "Stripe/Linear/Vercel/Notion" reference and "Large tables, power-user friendly" requirement.
- Status is always shown as a pill/chip (color + label), never color alone — relevant for accessibility and for the Urdu/English bilingual user base.
- Every screen's chrome (topbar with company/warehouse switcher + global search, left module nav) is identical — establishing the shell that Phase 10 will build once, not per-page.

## Deferred to Later Phases

- Actual color palette, type system, spacing scale, dark/light theme tokens → Phase 10 (Frontend Development), built on shadcn/ui primitives.
- Mobile/tablet breakpoint behavior (the constitution requires full responsiveness) → sketched at desktop fidelity here; responsive collapse of the sidebar/table patterns is a Phase 10 implementation detail once real components exist.
- Keyboard shortcut scheme (constitution requires "power-user" shortcuts) → to be defined alongside the shared `data-table` component in Phase 10.

---

**Next Step:** On approval, proceed to **Phase 7 — API Design**, defining the Server Actions/Route Handlers contracts (inputs, outputs, permission checks) that back every screen above.
