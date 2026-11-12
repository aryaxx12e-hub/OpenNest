OpenNest Roadmap 🪺

This document outlines the planned development direction of OpenNest.

Project status: Pre-development
Current milestone: Foundation
Last updated: November 2026

Phase 0 foundation is complete except for the storage interfaces, which are
deferred to Stage B where they can be designed against real usage rather than in
advance. The interface shell, design tokens, localization, and quality gates are
in place.

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
- [ ] Define storage interfaces.
- [x] Configure testing infrastructure.
- [x] Document development workflow.

Completion criteria: The application starts successfully, its foundation is documented, and basic checks pass.

Phase 1: Personal Digital Library

Goal: Deliver the first genuinely useful OpenNest experience.

- [ ] Dashboard and navigation.
- [ ] File upload.
- [ ] File listing and metadata.
- [ ] Folder management.
- [ ] Tag management.
- [ ] Supported document previews.
- [ ] Local search.
- [ ] File deletion and organization.
- [ ] Import and export.
- [ ] Empty, loading, and error states.

Completion criteria: Users can manage their personal digital library reliably.

Phase 2: Notes and Knowledge

Goal: Expand OpenNest into a personal knowledge workspace.

- [ ] Markdown editor.
- [ ] Autosave.
- [ ] Note organization.
- [ ] Tags and folders for notes.
- [ ] Search across notes.
- [ ] Connections between notes and files.
- [ ] Knowledge Hub foundation.

Phase 3: Offline and PWA

Goal: Make OpenNest dependable without a permanent internet connection.

- [ ] PWA manifest.
- [ ] Installable application.
- [ ] Offline application shell.
- [ ] Offline access to locally stored content.
- [ ] Storage status information.
- [ ] Backup reminders.
- [ ] Recovery and import workflows.

Phase 4: Privacy and Extensibility

Goal: Strengthen user control and prepare for future integrations.

- [ ] Privacy Center.
- [ ] Data management controls.
- [ ] Storage diagnostics.
- [ ] Optional storage adapters.
- [ ] Self-hosting architecture evaluation.
- [ ] Security review.
- [ ] Extension architecture research.

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