OpenNest Roadmap 🪺

This document outlines the planned development direction of OpenNest.

Project status: MVP in progress
Current milestone: Stage C features, local data portability, and the PWA offline shell implemented
Last updated: November 2026

Phase 0 foundation and Stage B core architecture are complete. Stage C now
implements the local browser experience: dashboard, library, file previews,
folders, tags, Markdown notes with autosave, search, local backup export and
restore, and an installable offline shell. Stage C implementation is complete;
the next gate is acceptance review.

Roadmap items represent development goals, not guaranteed release dates.

Development Principles

OpenNest development follows these principles:

- Privacy-first and local-first architecture.
- Functional features over decorative interfaces.
- Accessibility from the beginning.
- Indonesian and English localization.
- Incremental development with tested milestones.
- Community-driven development.

Phase 0: Foundation

Goal: Establish a maintainable project foundation.

- [x] Initialize Git repository.
- [x] Initialize Next.js with TypeScript.
- [x] Configure Tailwind CSS.
- [x] Establish application directory structure.
- [x] Configure ESLint and formatting.
- [x] Establish design tokens and UI foundations.
- [x] Implement Indonesian and English localization.
- [x] Define storage interfaces.
- [x] Configure testing infrastructure.
- [x] Document development workflow.

Completion criteria: The application starts successfully, its foundation is documented, and basic checks pass.

Phase 1: Personal Digital Library

Goal: Deliver the first genuinely useful OpenNest experience.

- [x] Dashboard and navigation.
- [x] File upload.
- [x] File listing and metadata.
- [x] Folder management.
- [x] Tag management.
- [x] Supported document previews.
- [x] Local search.
- [x] File deletion and organization.
- [x] Local backup export and restore.
- [x] Empty, loading, and error states.

Completion criteria: Users can manage their personal digital library reliably.

Phase 2: Notes and Knowledge

Goal: Expand OpenNest into a personal knowledge workspace.

- [x] Markdown editor.
- [x] Autosave.
- [x] Note organization.
- [x] Tags and folders for notes.
- [x] Search across notes.
- [ ] Connections between notes and files.
- [ ] Knowledge Hub foundation.

Phase 3: Offline and PWA

Goal: Make OpenNest dependable without a permanent internet connection.

- [x] PWA manifest.
- [x] Installable application.
- [x] Offline application shell.
- [x] Offline access to locally stored content.
- [ ] Storage status information.
- [ ] Backup reminders.
- [ ] Guided recovery workflows.

Phase 4: Privacy and Extensibility

Goal: Strengthen user control and prepare for future integrations.

- [x] Privacy Center.
- [x] Data management controls.
- [ ] Storage diagnostics.
- [ ] Optional storage adapters.
- [ ] Self-hosting architecture evaluation.
- [ ] Security review.
- [ ] Extension architecture research.
- [x] Sync-compatible data model (local-only); ADR 0012 audit remediation complete.
- [x] D2 transaction and migration remediation: per-workspace revisions, nested rollback, atomic SQLite migrations, and restore guard before blob writes.
- [ ] SQLite interrupted-restore orphan blob and stale `.tmp` cleanup.

Phase 5: Community Ecosystem

Goal: Enable community participation and shared development.

- [ ] Community documentation.
- [ ] Contribution guidelines.
- [ ] Localization contributions.
- [ ] Extension guidelines.
- [ ] Community feedback channels.
- [ ] Public release preparation.

Future Possibilities

These ideas are not part of the initial MVP:

- Optional AI assistance.
- Optional cloud synchronization.
- Multi-device workflows.
- Collaboration.
- Community extensions.
- Additional storage providers.
- Advanced document workflows.

Each feature must be evaluated against privacy, usability, maintainability, and resource requirements.

Milestone Policy

A milestone is complete only when:

1. Its functionality is implemented.
2. Relevant tests pass.
3. Accessibility and error states are considered.
4. Documentation is updated.
5. No known critical regression remains.

OpenNest — Your data. Your space. Your control.