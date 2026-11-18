OpenNest Roadmap 🪺

This document outlines the planned development direction of OpenNest.

Project status: MVP in progress; Stage D in progress
Current milestone: Stage D. D2 local-only sync model, D3 encryption, D4A extension sandbox, and D4B AI provider are complete. Stage D security review, external cryptographic review, and the E2EE claim gate remain open.
Last updated: November 2026

Stage A foundation and Stage B core architecture are complete. Stage C core is
delivered; the Knowledge Hub and recovery follow-ups remain open. Stage D is in
progress. Stage E is not started.

OpenNest has five stages. Stage E is the final stage. There is no Stage F and no
Phase 6. This restructure does not mark any work item complete.

Roadmap items represent development goals, not guaranteed release dates.

Development Principles

OpenNest development follows these principles:

- Privacy-first and local-first architecture.
- Functional features over decorative interfaces.
- Accessibility from the beginning.
- Indonesian and English localization.
- Incremental development with tested milestones.
- Community-driven development.

Stage A: Foundation

Status: complete.

Goal: Establish a maintainable project foundation.

- [x] Initialize Git repository.
- [x] Initialize Next.js with TypeScript.
- [x] Configure Tailwind CSS.
- [x] Establish application directory structure.
- [x] Configure ESLint and formatting.
- [x] Establish design tokens and UI foundations.
- [x] Implement Indonesian and English localization.
- [x] Define storage boundary and package scaffold.
- [x] Configure testing infrastructure.
- [x] Document development workflow.

Completion criteria: The application starts successfully, its foundation is documented, and basic checks pass.

Stage B: Core Architecture

Status: complete.

Goal: Build the storage and domain layer every feature depends on.

The Stage B design and existing gate results record the domain model, storage
interfaces, IndexedDB and SQLite adapters, repository layer, validation, error
handling, and persistence tests as delivered.

Completion criteria: Both storage adapters pass the same conformance scenarios, and the Stage A gates still pass.

Stage C: MVP Features

Status: core delivered; follow-ups open.

Goal: Deliver the personal digital library, notes, search, and offline experience.

Library and notes core:

- [x] Dashboard and navigation.
- [x] File upload.
- [x] File listing and metadata.
- [x] Folder management.
- [x] Tag management.
- [x] Supported document previews.
- [x] Local search.
- [x] File deletion and organization.
- [x] Local backup export, import, validation, and restore.
- [x] Empty, loading, and error states.
- [x] Markdown editor.
- [x] Autosave.
- [x] Note organization.
- [x] Tags and folders for notes.
- [x] Search across notes.

Knowledge Hub follow-ups:

- [ ] Connections between notes and files.
- [ ] Knowledge Hub foundation.

Offline and recovery follow-ups:

- [x] PWA manifest.
- [x] Installable application.
- [x] Offline application shell.
- [x] Offline access to locally stored content.
- [ ] Storage status information.
- [ ] Backup reminders.
- [ ] Guided recovery workflows.

Completion criteria: The MVP core is accepted, and the Knowledge Hub and recovery follow-ups are either delivered or explicitly deferred.

Stage D: Privacy, Security, and Extensibility

Status: in progress.

Goal: Strengthen user control, security, and integration boundaries.

- [x] Privacy Center.
- [x] Data management controls.
- [ ] Storage diagnostics.
- [ ] Optional storage adapters.
- [ ] Self-hosting architecture evaluation.
- [ ] Security review.
- [x] D4A extension architecture and sandbox: Tier 1 local sideload, manifest
  integrity, opaque-origin iframe and blob worker, capability consent, read-only
  host API, isolated storage, safe mode, audit, PWA, and browser E2E. No registry,
  signature, network grant, or workspace write access. Independent security
  review pending.
- [x] D4B AI provider and credential architecture accepted under ADR 0011.
- [x] D4B AI provider implementation: off-by-default providers, session-only and
  vault BYOK credentials, one-time payload-bound consent, and local and remote
  OpenAI-compatible adapters (implementation complete; independent review
  pending).
- [x] Sync-compatible data model (local-only); ADR 0012 audit remediation complete.
- [x] D2 transaction and migration remediation: per-workspace revisions, nested rollback, atomic SQLite migrations, and restore guard before blob writes.
- [ ] SQLite interrupted-restore orphan blob and stale `.tmp` cleanup.
- [x] Optional workspace content encryption for note bodies and file bytes (D3 implementation complete; external review pending).
- [x] Encrypted drafts and encrypted backup v2 (D3 implementation complete; external review pending).
- [x] Plaintext-to-encrypted migration, recovery, and key rotation (D3 implementation complete; external review pending).
- [ ] External cryptographic review and E2EE claim gate (D3 implementation complete; independent review not started, so no E2EE claim).

Completion criteria: All Stage D items are delivered or explicitly deferred by a recorded decision. The Stage D security and cryptography gates pass, and the selected extension, AI, storage, and self-hosting boundaries are documented and verified.

Stage E: AI, Sync, and Collaboration

Status: not started.

Goal: Deliver the final capability set identified for OpenNest.

Stage E is the final stage. It covers the post-MVP final scope previously listed
under Future Possibilities and Post-MVP. AI and Sync build on the Stage D
provider and sync-compatible foundations. Collaboration requires a separate
architecture and security approval before implementation. No item in this stage
is complete.

AI:

- [ ] AI-powered extensions after D4B.
- [ ] Optional local AI.
- [ ] Document Q&A with citation-based responses.
- [ ] MCP integration, gated by a separate security and consent design.

Sync:

- [ ] Optional cloud synchronization.
- [ ] Multi-device workflows.
- [ ] Self-hosted server, if the Stage D self-hosting evaluation approves it.

Collaboration:

- [ ] Collaboration, gated by a separate multi-user architecture and security review.

Completion criteria: The AI, Sync, and Collaboration designs are approved, their security gates pass, and the implemented behavior matches the approved scope. Stage E does not close while the Stage D security review, external cryptographic review, or E2EE claim gate is open.

Cross-Stage Quality Gates

Quality is not a separate stage. The quality work previously deferred to a
separate final stage applies to every stage accepted after this restructure.
Stage A and Stage B closed under their historical gates and are not reopened.
These gates are mandatory before a later stage is accepted:

- Accessibility and responsive behavior.
- Performance review for user-facing changes.
- Unit tests, integration tests, and E2E coverage for critical journeys.
- Documentation updates for architecture, behavior, and limitations.
- CI workflow covering the repository quality gates. CI is not yet implemented;
  it remains an open gap and blocks later stage acceptance.
- Security review sign-off for security-sensitive changes. The Stage D security
  review remains the canonical review, and no Stage E release may close while it,
  the external cryptographic review, or the E2EE claim gate is open.

Release-Support Backlog

This backlog is cross-stage. It is not a stage and does not replace Stage E. It
contains the former Phase 5 work and must be completed before public release.
Existing files such as `CONTRIBUTING.md` and `docs/extensions.md` are partial
evidence, not completion evidence, so every item stays unchecked.

- [ ] Community documentation.
- [ ] Contribution guidelines.
- [ ] Localization contributions.
- [ ] Extension guidelines.
- [ ] Community feedback channels.
- [ ] Public release preparation.

Stage Naming History

Dated specs, plans, and ADRs retain their historical labels. This table maps them
to the current roadmap.

| Historical label | Current location |
| --- | --- |
| `AGENTS.md` Stage A, B, C | Stage A, B, C |
| `AGENTS.md` Stage D Data Ownership | Retired as a stage; export/import/backup/restore and storage status are in Stage C, data controls are in Stage D |
| `AGENTS.md` Stage E PWA | Stage C |
| `AGENTS.md` Stage F Quality | Cross-Stage Quality Gates |
| `ROADMAP.md` Phase 0 | Stage A |
| `ROADMAP.md` Phase 1-3 | Stage C |
| `ROADMAP.md` Phase 4 | Stage D |
| `ROADMAP.md` Phase 5 | Release-Support Backlog |
| `PRD.md` Phase 0 | Stage A; CI workflow is in Cross-Stage Quality Gates |
| `PRD.md` Phase 1-3 | Stage C |
| `PRD.md` Phase 4 Public Beta | Release-Support Backlog; security review is in Stage D, and tests and documentation are in Cross-Stage Quality Gates |
| `PRD.md` Post-MVP AI, Sync, Collaboration | Stage E |
| `PRD.md` Post-MVP Backup automation | Unscheduled Future Possibilities |
| Future Possibilities AI, Sync, Collaboration | Stage E |
| "Phase 6" | No Phase 6 is defined; the label has no assigned scope |

`AGENTS.md` Stage F Quality is a historical quality label. It is not the final
capability scope. The final capability scope, AI, Sync, and Collaboration, is
Stage E.

The `D0` to `D5` columns in ADR 0008 and `docs/privacy-center.md` are data
classifications, not roadmap stages. Stage D0, D1, D2, D3, D4A, and D4B are
separate roadmap labels. Do not rename either set as part of roadmap work.

Unscheduled Future Possibilities

These ideas are not scheduled as part of Stage E:

- Community extensions.
- Additional storage providers beyond the Stage D adapters.
- Advanced document workflows.
- Backup automation.

Community Space product features such as public templates, shared collections,
and a plugin catalog remain post-MVP. They are not part of Stage E or the
Release-Support Backlog.

Each feature must be evaluated against privacy, usability, maintainability, and resource requirements.

Milestone Policy

A stage is complete only when:

1. Its functionality is implemented.
2. Relevant tests pass.
3. Accessibility and error states are considered.
4. Documentation is updated.
5. No known critical regression remains.

OpenNest — Your data. Your space. Your control.
