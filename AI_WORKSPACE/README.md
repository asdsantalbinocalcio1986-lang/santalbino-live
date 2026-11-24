# SANTALive — AI collaboration workspace

This folder is the single source of truth for AI-assisted work on SANTALive.

## Roles

- **ChatGPT — coordinator / integrator:** defines tasks, checks repository facts, reconciles reviews, decides acceptance, and controls any GitHub changes.
- **Claude — primary analyst / implementer:** performs the assigned analysis or prepares the implementation on the specified branch. It must not merge or deploy.
- **Gemini — independent reviewer:** reviews the exact task input, specification, diff, and test evidence. It must not silently rewrite the implementation or change the repository.
- **Human project owner — final authority:** approves scope changes, production-data changes, database migrations, merges, deploys, and real communications.

The three assistants do not have a shared live conversation. The coordinator transfers one canonical task packet and collects each result. Never assume another assistant can see a chat, file, branch, or attachment unless access is explicitly confirmed.

## Operating loop

1. ChatGPT writes one task in `CURRENT_TASK.md` (or issues a self-contained task packet in chat).
2. Claude confirms the exact task ID, source version/commit, and files received before working.
3. Claude returns findings or a unified diff/patch, tests performed, and unresolved questions. No vague “done” claims.
4. Gemini receives the same task packet plus Claude's exact output/diff and reviews it independently. Gemini first confirms the exact inputs received.
5. ChatGPT compares the review with repository evidence, classifies each finding, and issues a decision: accept, revise, reject, or investigate.
6. Only the accepted change is applied to a non-production branch and opened as a PR.
7. ChatGPT checks the diff, validation and regression evidence. The project owner explicitly authorizes merge/deploy where required.

## Mandatory input-receipt check

Before analysis, each assistant must state:
- task ID;
- exact document/specification version or commit SHA;
- files/sections actually received;
- anything missing or truncated.

If the required input is missing, stop and request only that missing input. Do not produce a generic review and do not claim to have reviewed unseen material.

## Task boundaries

Every task must state:
- objective and expected deliverable;
- exact source of truth (branch/commit/files);
- allowed and forbidden actions;
- acceptance criteria;
- test evidence required;
- decisions that must not be reopened.

If a task fails twice for the same transfer/input reason, stop that route and change the transfer method. Do not repeat the same failed handoff.

## GitHub rules

- Work on a dedicated feature branch; never work directly on `main`.
- Claude and Gemini do not merge PRs or deploy.
- A PR is a proposal, not approval.
- No production database writes, migrations, live match data changes, real social posts, notifications, or changes to historical votes/results without explicit authorization.
- Do not put secrets, tokens, service-role keys, private VAPID keys, or credentials in prompts, issues, commits, or files.
- Prefer small, reviewable PRs. Documentation-only setup must not change application runtime.

## Status vocabulary

Use only:
- `NOT STARTED`
- `IN PROGRESS`
- `BLOCKED`
- `IN REVIEW`
- `ACCEPTED`
- `REJECTED`

A task is not accepted merely because an assistant says it is complete. Acceptance requires evidence against the stated criteria.

## Free-tier/mobile constraint

The workflow must work by copying a compact task packet between the free mobile apps. Repository access by Claude/Gemini is optional, never assumed. If an app cannot read the canonical branch/PR, paste the relevant file or diff directly and include its commit/PR reference.
