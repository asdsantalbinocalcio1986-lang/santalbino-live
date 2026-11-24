# SANTALive — decision register

This register contains decisions already established for the post-match workstream. Do not reopen them as unresolved questions unless new repository evidence shows a direct conflict. Any proposed change must identify the evidence and ask the project owner.

| ID | Decision | Status |
|---|---|---|
| D-001 | Existing FULL TIME automation remains unchanged. | FIXED |
| D-002 | New post-match summary is separate from FULL TIME auto-publication. | FIXED |
| D-003 | Human approval is mandatory before external publication of the new summary. | FIXED |
| D-004 | Initial internal notifications are for administrators/operators only, not supporters. | FIXED |
| D-005 | Standard summary excludes the complete formation. | FIXED |
| D-006 | Summary includes at least result, teams, scorers and essential information; dismissals if present; bookings/details optional. | FIXED |
| D-007 | Manual alternative must remain available for every automation. | FIXED |
| D-008 | Reuse the existing social publisher; do not create a second Facebook publisher. | FIXED |
| D-009 | Corrections after publication are never sent automatically; create a new revision requiring human approval. | FIXED |
| D-010 | Web Push is out of the first release. | FIXED |
| D-011 | Scheduling is deferred until backend scheduler reliability is verified. | FIXED |
| D-012 | MVP voting features/data are completely outside this workstream. | FIXED |
| D-013 | No real social publication or supporter notifications during tests. | FIXED |
| D-014 | No implementation or database changes before read-only audit and explicit approval of the resulting specification. | FIXED |

## Current technical questions (not decisions)

- Actual schema, constraints, indexes and RLS for publication and related tables.
- Actual persistence/synchronization model for match events and `S.events`.
- Actual user roles and authorization paths for draft, approve, publish and manual-result recording.
- Whether publisher calls can be protected from bypass without changing existing FULL TIME behavior.
- Atomic reservation, concurrent calls, timeout/uncertain outcomes, and immutable attempt history.
- How test mode is enforced server-side and how real Meta accounts are excluded.
- Whether scheduler is installed, active and correctly configured in the production Supabase project.
- How a corrected score/event affects a draft, approved revision, or already published message.

## Change control

A fixed decision can change only through a proposal containing:
1. decision ID;
2. new evidence or requirement;
3. impact on code, data, security and existing behavior;
4. migration/rollback implications, if any;
5. explicit project-owner approval.
