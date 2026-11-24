# Current task — SANTALive post-match read-only audit

- **Task ID:** SANTALIVE-AUDIT-001
- **Status:** IN PROGRESS
- **Owner/coordinator:** ChatGPT
- **Primary analyst:** Claude
- **Independent reviewer:** Gemini
- **Scope:** read-only audit only
- **Baseline:** repository `main`; record the exact commit SHA used before inspecting files
- **Specification baseline:** `SANTALive – Specifica Tecnica Post-Partita v3.1` supplied in the current project conversation. If the full text is not available to the assistant, stop and request the exact missing document; do not substitute the older `SANTALive_Analisi_PostPartita.md`.

## Objective

Verify whether the v3.1 post-match design is compatible with the actual repository and effective Supabase configuration, without changing code, schema, data, deployment or social channels.

## Required audit areas

1. Publication schema, indexes, constraints, RLS and related persistence needed for match/revision identity.
2. Event persistence and synchronization; how `S.events`, FULL TIME, result, scorers and dismissals are produced and updated.
3. Existing summary and graphic generation; whether text and graphic can be tied to the same immutable revision/content fingerprint.
4. Existing publisher contract, authorization, channel behavior, concurrency/idempotency, timeout and uncertain outcomes.
5. Protection against bypassing the approval flow while preserving existing FULL TIME auto-publication unchanged.
6. Actual roles/permissions for draft, approve, publish, manual publication recording and uncertain-outcome resolution.
7. Test isolation and server-side fail-closed behavior; `?test=1` alone is insufficient.
8. Internal notification mechanisms and access controls, if any.
9. Scheduler installation/configuration only as a deferred capability check; it is not a prerequisite for the first release.
10. Regression and perimeter check: no MVP candidates/votes/tallies/history; no real posts or supporter notifications.

## Required output

For each finding provide:
- ID;
- classification: VERIFIED / NOT FOUND / UNKNOWN / RISK;
- exact file path and line/function/schema reference, or exact database object;
- evidence (short excerpt or query result);
- impact on v3.1;
- recommended action;
- whether it blocks phase 1 or a later phase.

Clearly distinguish repository evidence from live Supabase evidence. If live database access is unavailable, mark it UNKNOWN; do not infer deployment state from migration files.

## Forbidden actions

- No code edits, commits, PR implementation, migrations, SQL writes, data updates or deletes.
- No production social posts, test posts to real accounts, notifications, or changes to match/voting records.
- No merge or deployment.
- No secrets or credentials in output.
- Do not design new tables before auditing existing schema and constraints.

## Acceptance criteria

The audit is complete only when:
- all ten areas are addressed;
- every material claim has a repository or database evidence reference;
- unknowns are explicitly listed with the exact access/evidence needed;
- conflicts with v3.1 are mapped to its sections;
- the output ends with blockers for phase 1, blockers for later phases, and a go/no-go recommendation.

## Handoff protocol

1. Claude first confirms task ID, baseline commit, and which sources it can actually access. It returns an evidence-based audit, not a proposed implementation.
2. Gemini receives this exact task plus Claude's complete audit and independently checks coverage, unsupported claims, missed risks and false positives. Gemini must state exactly what it received.
3. ChatGPT reconciles both outputs against repository/database evidence and updates the audit/decision record.
4. No implementation begins until the project owner explicitly approves the resulting specification and phase.
