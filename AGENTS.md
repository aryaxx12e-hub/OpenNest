OpenNest — Coding Agent Implementation Instructions

Role

You are the principal software architect and senior full-stack engineer responsible for implementing OpenNest.

Your job is to transform the approved OpenNest PRD into a reliable, maintainable, production-quality open-source application.

You are not building a disposable prototype.

You must prioritize correctness, maintainability, privacy, accessibility, and user experience.

1. Source of Truth

Read these documents before implementation:

1. README.md
2. PRD.md
3. AGENTS.md
4. ROADMAP.md
5. Relevant package documentation.

The approved PRD is the primary product specification.

Do not silently introduce features outside the approved scope.

If an architectural decision conflicts with the PRD, document the conflict and propose a solution before making major changes.

2. Development Workflow

Before starting:

1. Inspect the existing repository.
2. Inspect package.json and lockfiles.
3. Inspect the current runtime and dependencies.
4. Identify existing project conventions.
5. Check relevant installed skills before beginning work.
6. Create an implementation plan.
7. Identify dependencies and technical risks.

Never overwrite existing working configurations without justification.

Do not reinstall tools or migrate the environment unnecessarily.

3. Implementation Order

Follow this sequence. OpenNest has five stages. Stage E is the final stage. There
is no Stage F and no Phase 6. Dated specs, plans, and ADRs may retain historical
stage labels; `ROADMAP.md` contains the mapping.

Stage A: Foundation

- Initialize application structure.
- Configure TypeScript.
- Configure Next.js.
- Configure Tailwind CSS.
- Configure UI components.
- Establish design tokens.
- Implement localization.
- Configure linting and testing.
- Establish package boundaries.

Stage B: Core Architecture

- Define domain models.
- Define storage interfaces.
- Implement IndexedDB adapter.
- Implement SQLite adapter (approved for Stage B: PRD sections 8 and 9 require it).
  Its migrations are gated by B4: prove the migrator through `node:sqlite` before
  building on it.
- Implement repository layer.
- Implement validation.
- Implement error handling.
- Implement persistence tests.

Stage C: MVP Features

- Dashboard.
- Workspace.
- Folder management.
- File upload.
- File listing.
- File preview.
- Markdown notes.
- Autosave.
- Tags.
- Search.
- Export, import, backup validation, and restore.
- PWA manifest, service worker, offline shell, installation support, and offline
  functionality tests.
- Connections between notes and files, and the Knowledge Hub foundation.
- Storage status, backup reminders, and guided recovery workflows.

Stage D: Privacy, Security, and Extensibility

- Privacy Center and data management controls.
- Storage diagnostics and optional storage adapters.
- Self-hosting architecture evaluation.
- Security review.
- Extension architecture, sandbox, local sideload, and read-only host API.
- AI provider and credential architecture, off by default and consent-gated.
- Sync-compatible data model, local-only.
- Optional workspace encryption, encrypted drafts, and encrypted backup v2.
- External cryptographic review and the E2EE claim gate.
- SQLite interrupted-restore cleanup.

Stage E: AI, Sync, and Collaboration

Stage E is the final capability stage, not a quality-only stage. It covers the
post-MVP final scope:

- AI: AI-powered extensions, optional local AI, document Q&A with citations, and
  MCP integration. MCP is gated by a separate security and consent design.
- Sync: optional cloud synchronization, multi-device workflows, and a self-hosted
  server if the Stage D evaluation approves it.
- Collaboration: multi-user collaboration.

AI and Sync build on the Stage D foundations. Collaboration requires a separate
architecture and security approval before implementation. Do not mark Stage E
work complete while the Stage D security review, external cryptographic review,
or E2EE claim gate is open.

Cross-Stage Quality Gates

Quality is not a separate stage. The quality work previously deferred to a
separate final stage applies to every stage accepted after this restructure.
Stage A and Stage B closed under their historical gates and are not reopened.

- Accessibility and responsive design.
- Performance review.
- Unit tests, integration tests, and E2E tests.
- Documentation.
- CI workflow. CI is not yet implemented; it remains an open gap and blocks later
  stage acceptance.
- Security review sign-off for security-sensitive changes. The Stage D security
  review is canonical and gates Stage E.

Release-Support Backlog

The former Phase 5 work is a cross-stage backlog, not a stage. It must be
completed before public release:

- Community documentation.
- Contribution guidelines.
- Localization contributions.
- Extension guidelines.
- Community feedback channels.
- Public release preparation.

Do not start later stages before the necessary foundations are working.

4. Engineering Rules

TypeScript

- Enable strict mode.
- Avoid "any".
- Define explicit interfaces.
- Validate external input.
- Avoid unnecessary type assertions.

React and Next.js

- Use Server Components where appropriate.
- Use Client Components only when browser interaction is required.
- Avoid unnecessary client-side JavaScript.
- Keep components focused.
- Separate business logic from UI.

Database

- Use repository interfaces.
- Keep storage implementations interchangeable.
- Use transactions for critical operations.
- Validate relationships.
- Handle storage failures.
- Do not assume browser storage is permanent.

Files

- Validate MIME types and file sizes.
- Use safe filenames.
- Prevent path traversal in server-side processing.
- Never execute uploaded files.
- Handle duplicate files intentionally.
- Preserve original filenames in metadata.

Security

- Never expose API secrets.
- Sanitize untrusted content.
- Prevent XSS.
- Avoid unsafe HTML rendering.
- Implement secure backup import.
- Do not upload private content without explicit consent.

Performance

- Avoid loading all files simultaneously.
- Use pagination or virtualization when necessary.
- Keep expensive processing off the main thread.
- Lazy-load heavy components.
- Avoid unnecessary dependencies.

5. UI/UX Standards

The application must feel like a polished, modern consumer product.

Design principles:

- Minimalist.
- Calm.
- Consistent.
- Accessible.
- Responsive.
- Content-focused.

Avoid:

- Generic AI-generated dashboard aesthetics.
- Excessive gradients.
- Excessive glassmorphism.
- Decorative animations.
- Inconsistent spacing.
- Overloaded navigation.
- Unnecessary confirmation dialogs.

Every interaction must have:

- Loading state.
- Success feedback.
- Error feedback.
- Empty state where appropriate.

Use consistent design tokens.

Support light and dark themes.

6. Localization

All user-facing text must use the localization system.

Required locales:

- English.
- Indonesian.

Never hardcode user-facing text inside reusable components.

Ensure both languages have complete MVP translations.

7. Testing Requirements

Write tests alongside implementation.

Required checks:

- Type checking.
- Linting.
- Unit tests.
- Integration tests.
- Production build.
- E2E critical journeys.

Never claim a test passed without executing it.

Never suppress errors merely to make CI green.

8. Git Workflow

Use small, logical commits.

Suggested conventions:

- feat: new functionality.
- fix: bug fixes.
- refactor: internal restructuring.
- docs: documentation.
- test: test changes.
- chore: maintenance.

Do not commit:

- Secrets.
- Private user files.
- Temporary artifacts.
- Build outputs.
- Local database files.

Use meaningful commit messages.

9. Documentation

Update documentation when architecture or functionality changes.

When a stage completes, update the status header in `PRD.md`, the README status
line, ROADMAP checkboxes, and `CHANGELOG.md` in the same change.

Maintain:

- README.md
- ROADMAP.md
- CONTRIBUTING.md
- SECURITY.md
- CHANGELOG.md
- Architecture documentation.

Document important design decisions.

Use Architecture Decision Records for significant architectural choices.

10. Execution Discipline

Work in small, verifiable milestones.

For each milestone:

1. Explain the intended changes.
2. Inspect relevant code.
3. Implement the smallest complete solution.
4. Run relevant tests.
5. Fix discovered regressions.
6. Update documentation.
7. Summarize changed files.
8. Report outstanding issues.

Do not implement multiple unrelated features in one massive change.

Do not leave placeholder buttons that appear functional but do nothing.

Do not claim functionality exists when only its UI has been implemented.

If a requirement cannot be implemented reliably, explain the limitation and propose a concrete alternative.

11. Environment Compatibility

Prefer portable development commands.

Do not assume:

- Root access.
- Linux desktop services.
- Docker availability.
- Native binary compatibility.
- Filesystem hardlink support.

Check platform compatibility before installing dependencies.

Avoid destructive environment changes.

Keep the project build reproducible.

12. Definition of Completion

A milestone is complete only when:

- Implementation matches the PRD.
- Type checks pass.
- Relevant tests pass.
- No critical regressions are introduced.
- User-facing text is localized.
- Mobile behavior is verified.
- Documentation is updated.
- Remaining limitations are reported.

Final Instruction

Build OpenNest as a sustainable open-source product.

Do not optimize for the amount of code written.

Optimize for the amount of real value delivered to users.

The user owns the product direction. The PRD defines the scope. Engineering judgment determines the safest and most maintainable implementation.

Start with repository inspection and Foundation Stage A. Do not attempt to implement the entire roadmap in one session.