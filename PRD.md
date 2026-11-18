OpenNest

Product Requirements Document & Technical Blueprint

Tagline: Your digital life. Your rules.
Product type: Open-source personal digital workspace
Version: 1.0
Status: Product definition / Pre-development
Platforms: Web + Progressive Web App (PWA)
Languages: English and Bahasa Indonesia
License proposal: GNU AGPL-3.0

---

1. Executive Summary

OpenNest is an open-source, privacy-first personal digital workspace designed to help people organize, preserve, search, and understand their digital information.

It combines personal document management, knowledge organization, searchable archives, and optional AI assistance into one cohesive application.

The product prioritizes:

1. Accessibility for everyday users.
2. Local-first data ownership.
3. Simple and intuitive user experience.
4. Offline availability.
5. Open-source development.
6. Community participation.
7. Modular extensibility.

OpenNest must not require users to subscribe to a cloud service or purchase AI credits to access its core functionality.

Product vision

Make personal digital information accessible, organized, portable, and controlled by its owner.

Product mission

Build an approachable digital workspace that gives everyone the ability to manage their own information without unnecessary technical complexity or vendor lock-in.

Core promise

- Your files belong to you.
- Your notes belong to you.
- Your data can leave the application at any time.
- Core functionality works offline.
- AI is optional.
- The source code is publicly available.

---

2. Problem Statement

People increasingly store important information across disconnected platforms.

Common problems include:

- Documents scattered across devices and applications.
- Notes separated from their associated documents.
- Difficulty locating previously saved information.
- Poor organization of personal digital archives.
- Dependence on proprietary cloud services.
- Privacy concerns surrounding AI-powered applications.
- Limited access to simple, affordable document-management software.

OpenNest addresses these problems by providing a unified personal workspace.

Product differentiation

OpenNest is not intended to replace every existing application.

Its differentiation comes from combining:

- Local-first storage.
- Document organization.
- Personal knowledge management.
- Full-text search.
- Offline-first functionality.
- Optional AI integration.
- Portable data formats.
- Community-driven development.

The application should feel approachable to non-technical users while remaining extensible for advanced users.

---

3. Target Audience

Primary users

A. Everyday users

Need a simple way to organize personal documents, notes, and information.

B. Students

Need to organize learning materials, references, PDFs, and notes.

C. Professionals

Need to maintain personal archives and work-related information.

D. Content creators

Need to manage research, references, creative ideas, and assets.

E. Privacy-conscious users

Prefer local storage and minimal external dependencies.

Secondary users

- Developers.
- Researchers.
- Open-source enthusiasts.
- Families managing shared archives.
- Community organizations.

Accessibility requirements

OpenNest must support:

- Keyboard navigation.
- Screen-reader-friendly semantic HTML.
- Visible focus indicators.
- Adjustable text sizing.
- Sufficient color contrast.
- Reduced-motion preferences.
- Responsive layouts.
- Clear error messages.

Target WCAG 2.2 AA compliance progressively, with accessibility testing included in development.

---

4. Product Scope

OpenNest consists of six functional modules.

Module 01: My Library

Central document and file management.

Features:

- Upload documents and images.
- Organize files into folders.
- Apply multiple tags.
- Preview supported file types.
- Display metadata.
- Rename and delete files.
- Sort and filter collections.
- Search by filename.
- Download individual files.
- Export collections.

Supported initial formats:

- PDF
- TXT
- MD
- PNG
- JPG/JPEG
- WEBP
- DOCX (basic metadata and preview support can follow)

Do not promise complete rendering support for every format in the MVP.

Module 02: Knowledge Hub

Personal knowledge management.

Features:

- Markdown editor.
- Create and edit notes.
- Tags and folders.
- Link notes together.
- Search notes.
- Pin important notes.
- Autosave.
- Basic revision history.

Notes must remain accessible as portable Markdown files.

Module 03: Smart Documents

Document understanding and processing.

Features:

- PDF text extraction.
- OCR for scanned documents.
- Text indexing.
- Automatic metadata extraction.
- Document categorization suggestions.
- Search inside document contents.

OCR and processing must run locally where feasible.

Heavy processing must not block the main UI thread.

Module 04: Ask OpenNest

Optional personal knowledge assistant.

Features:

- Ask questions about selected documents.
- Retrieve relevant document passages.
- Display citations and source references.
- Support configurable AI providers.
- Support local model integrations.
- Allow AI functionality to be completely disabled.

Important rules:

- Never fabricate document citations.
- Never upload private documents without explicit permission.
- Never require an AI provider to use OpenNest.
- Never send document contents to a provider by default.

This module is outside the MVP.

Module 05: Privacy Center

Data ownership and privacy management.

Features:

- Local data overview.
- Export all user data.
- Backup and restore.
- Storage usage information.
- Clear application data.
- Optional encryption integrations.
- Privacy settings.
- Permission management.

Browser storage must not be falsely described as encrypted. Local-first does not automatically mean encrypted.

Module 06: Community Space

Community-powered ecosystem.

Features:

- Public templates.
- Shared knowledge collections.
- Community contributions.
- Public plugin catalog.

Community sharing must be explicitly initiated by the user.

Private libraries must never become publicly accessible through accidental sharing.

Localization contributions and contribution guidelines are support work tracked in
the Release-Support Backlog, not Community Space product features.

This module is post-MVP.

---

5. MVP Definition

MVP 0.1: Personal Digital Library

The first public release focuses on one problem:

Helping people save, organize, and retrieve their personal digital information.

Required functionality

1. Responsive dashboard.
2. File upload.
3. File listing.
4. Folder management.
5. Tag management.
6. Markdown notes.
7. Search filenames and notes.
8. Local persistence.
9. Import/export.
10. Offline application shell.
11. Indonesian and English interface.
12. Accessible navigation.

Explicitly excluded

- AI chat.
- Cloud synchronization.
- Multi-user collaboration.
- Public sharing.
- Marketplace.
- Subscription system.
- Complex automation.
- Real-time collaboration.

These exclusions protect the MVP from unnecessary complexity.

MVP acceptance criteria

The MVP is considered ready when:

- Users can create and organize folders.
- Users can upload and retrieve files.
- Users can create and edit notes.
- Notes and files survive application restarts.
- Search returns relevant local results.
- Users can export their information.
- Users can restore an exported backup.
- Core functionality works offline after initial installation.
- Interface works on Android and desktop browsers.
- No mandatory API key or registration is required.
- Critical workflows pass automated tests.

---

6. User Stories

Epic A: Onboarding

US-001: As a new user, I want to open OpenNest without creating an account so that I can start immediately.

US-002: As a user, I want to select my preferred language.

US-003: As a user, I want a short onboarding explanation of how local storage works.

US-004: As a user, I want to understand how to export and back up my data.

Acceptance:

- No mandatory registration.
- Language selection is available.
- Onboarding can be skipped.
- Privacy information is clearly explained.

Epic B: Library

US-005: As a user, I want to upload a document.

US-006: As a user, I want to create folders.

US-007: As a user, I want to assign tags to files.

US-008: As a user, I want to rename and delete files.

US-009: As a user, I want to preview supported files.

US-010: As a user, I want to filter and sort my library.

Acceptance:

- File metadata is preserved.
- File contents remain accessible after reload.
- Unsupported file formats receive clear feedback.

Epic C: Knowledge Hub

US-011: As a user, I want to create Markdown notes.

US-012: As a user, I want to edit existing notes.

US-013: As a user, I want notes to autosave.

US-014: As a user, I want to connect related notes.

US-015: As a user, I want to search notes.

Acceptance:

- Autosave status is visible.
- Editing does not silently discard content.
- Notes can be exported as Markdown.

Epic D: Search

US-016: As a user, I want to search by filename.

US-017: As a user, I want to search note content.

US-018: As a user, I want to filter search results by folder and tags.

Acceptance:

- Search is responsive for the intended MVP dataset.
- Empty and unsuccessful searches have useful messages.
- Search results link to their original items.

Epic E: Data Ownership

US-019: As a user, I want to export all my data.

US-020: As a user, I want to restore my data from a backup.

US-021: As a user, I want to know how much storage my library uses.

US-022: As a user, I want to delete my local data.

Acceptance:

- Export includes files, notes, metadata, and relationships.
- Import validates the archive before applying changes.
- Failed imports do not partially overwrite existing data.
- Destructive actions require confirmation.

Epic F: Accessibility and Localization

US-023: As a user, I want to use OpenNest with a keyboard.

US-024: As a user, I want to change between Indonesian and English.

US-025: As a user, I want interface text to remain readable on mobile devices.

Acceptance:

- No essential action requires a mouse.
- Translation strings are not hardcoded inside components.
- Layout adapts to narrow screens.

---

7. Information Architecture

Primary navigation:

- Home
- My Library
- Knowledge Hub
- Search
- Settings

Secondary navigation:

- Privacy Center
- Storage
- Backup & Restore
- Language
- About OpenNest

Suggested dashboard sections:

1. Welcome header.
2. Quick actions.
3. Recently opened items.
4. Recent notes.
5. Storage overview.
6. Getting started guidance.

The interface should prioritize content over decorative analytics.

Avoid excessive cards, gradients, charts, and unnecessary dashboard widgets.

---

8. Final Technical Architecture

Architectural principles

1. Modular monolith for the initial application.
2. Local-first storage.
3. Offline-first core functionality.
4. Clear separation of UI and business logic.
5. Storage abstraction.
6. Portable data formats.
7. Optional integrations.
8. Minimal external dependencies.

Do not start with microservices.

Technology stack

Layer| Technology
Framework| Next.js
UI| React
Language| TypeScript
Styling| Tailwind CSS
Components| shadcn/ui
Icons| Lucide
Client storage| IndexedDB
IndexedDB wrapper| Dexie
Server database| SQLite
Server ORM| Drizzle ORM
Search| SQLite FTS5 / local search adapter
Markdown| remark / unified
Validation| Zod
Testing| Vitest
E2E| Playwright
PWA| Web App Manifest + Service Worker
Documentation| VitePress

Use stable, mutually compatible package versions at project initialization. Do not blindly install every package marked "latest".

Architecture overview

                    OPENNEST
                       |
              Next.js Web Application
                       |
                Presentation Layer
                       |
                Application Core
                       |
        +--------------+--------------+
        |              |              |
     Library         Notes          Search
        |              |              |
        +--------------+--------------+
                       |
                 Storage Adapter
                       |
             +---------+---------+
             |                   |
          IndexedDB           SQLite
          (Browser)       (Optional Server)
             |                   |
          Local Data         Self-hosted Data

The application core must not depend directly on IndexedDB or SQLite.

Define repository interfaces and implement separate adapters.

Storage architecture

Browser mode:

- IndexedDB for metadata.
- IndexedDB Blob storage for file contents.
- Local preferences.
- Optional browser filesystem integrations only with explicit permission.

Self-hosted mode:

- SQLite for metadata.
- Filesystem/object storage for binary documents.
- API for remote access.
- Authentication and authorization before multi-user exposure.

Important: browser storage can be evicted by browsers or lost when site data is cleared. OpenNest must explain this and encourage regular exports.

API design

Reserve a versioned API namespace:

/api/v1/health

/api/v1/files
/api/v1/files/:id

/api/v1/folders
/api/v1/folders/:id

/api/v1/tags
/api/v1/tags/:id

/api/v1/notes
/api/v1/notes/:id

/api/v1/search

/api/v1/backup/export
/api/v1/backup/import

MVP browser-local operations should use the storage adapter directly. Do not build a network API merely to make a local operation look sophisticated.

---

9. Initial Database Schema

The following schema is the initial logical data model. Browser storage and SQLite adapters must implement equivalent behavior.

Entity relationships

Workspace
  |
  +-- Folders
  |     |
  |     +-- Files
  |     +-- Notes
  |
  +-- Files
  |     |
  |     +-- FileTags
  |
  +-- Notes
  |     |
  |     +-- NoteTags
  |     +-- NoteLinks
  |
  +-- Tags

SQLite schema

PRAGMA foreign_keys = ON;

CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE folders (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  parent_id TEXT,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  FOREIGN KEY (workspace_id)
    REFERENCES workspaces(id) ON DELETE CASCADE,

  FOREIGN KEY (parent_id)
    REFERENCES folders(id) ON DELETE SET NULL
);

CREATE TABLE files (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  folder_id TEXT,
  name TEXT NOT NULL,
  mime_type TEXT,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  blob_key TEXT NOT NULL,
  checksum TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  FOREIGN KEY (workspace_id)
    REFERENCES workspaces(id) ON DELETE CASCADE,

  FOREIGN KEY (folder_id)
    REFERENCES folders(id) ON DELETE SET NULL
);

CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  folder_id TEXT,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  FOREIGN KEY (workspace_id)
    REFERENCES workspaces(id) ON DELETE CASCADE,

  FOREIGN KEY (folder_id)
    REFERENCES folders(id) ON DELETE SET NULL
);

CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT,
  created_at TEXT NOT NULL,

  FOREIGN KEY (workspace_id)
    REFERENCES workspaces(id) ON DELETE CASCADE,

  UNIQUE(workspace_id, name)
);

CREATE TABLE file_tags (
  file_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,

  PRIMARY KEY (file_id, tag_id),

  FOREIGN KEY (file_id)
    REFERENCES files(id) ON DELETE CASCADE,

  FOREIGN KEY (tag_id)
    REFERENCES tags(id) ON DELETE CASCADE
);

CREATE TABLE note_tags (
  note_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,

  PRIMARY KEY (note_id, tag_id),

  FOREIGN KEY (note_id)
    REFERENCES notes(id) ON DELETE CASCADE,

  FOREIGN KEY (tag_id)
    REFERENCES tags(id) ON DELETE CASCADE
);

CREATE TABLE note_links (
  source_note_id TEXT NOT NULL,
  target_note_id TEXT NOT NULL,

  PRIMARY KEY (source_note_id, target_note_id),

  FOREIGN KEY (source_note_id)
    REFERENCES notes(id) ON DELETE CASCADE,

  FOREIGN KEY (target_note_id)
    REFERENCES notes(id) ON DELETE CASCADE
);

CREATE INDEX idx_files_workspace
ON files(workspace_id);

CREATE INDEX idx_files_folder
ON files(folder_id);

CREATE INDEX idx_notes_workspace
ON notes(workspace_id);

CREATE INDEX idx_notes_folder
ON notes(folder_id);

CREATE INDEX idx_folders_parent
ON folders(parent_id);

Additional database requirements:

- Use UUIDs or another collision-resistant ID format.
- Store timestamps consistently in UTC.
- Validate folder ownership before moving items.
- Prevent circular folder relationships.
- Validate file sizes and MIME types.
- Use transactions for multi-record imports.
- Add FTS5 indexing when the SQLite adapter is implemented.
- Store binary files separately from relational metadata in server mode.

The browser adapter must define equivalent stores and indexes in Dexie.

---

10. File and Project Structure

Recommended monorepo:

opennest/
│
├── apps/
│   ├── web/
│   └── docs/
│
├── packages/
│   ├── core/
│   ├── database/
│   ├── storage/
│   ├── search/
│   ├── validation/
│   ├── ui/
│   ├── localization/
│   └── shared/
│
├── services/
│   ├── api/
│   └── workers/
│
├── public/
│   ├── icons/
│   └── locales/
│
├── tests/
│   ├── unit/
│   └── e2e/
│
├── .github/
│   ├── workflows/
│   ├── ISSUE_TEMPLATE/
│   └── FUNDING.yml
│
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
├── SECURITY.md
├── ROADMAP.md
├── README.md
├── LICENSE
├── AGENTS.md
└── package.json

Keep packages small and independently testable.

Do not create empty abstractions just to fill the directory tree. Add modules when there is a real consumer.

---

11. UI/UX Design System

Visual direction

OpenNest should feel calm, trustworthy, modern, and approachable.

Avoid:

- Excessive gradients.
- Excessive glassmorphism.
- Decorative animations.
- Crowded dashboards.
- Tiny typography.
- Unnecessary complexity.

Suggested palette

Light mode:

- Background: warm off-white.
- Surface: white.
- Primary: deep forest green.
- Text: charcoal.
- Secondary text: muted gray.
- Borders: soft neutral.

Dark mode:

- Background: deep charcoal.
- Surface: slightly lighter charcoal.
- Primary: accessible green.
- Text: warm white.
- Borders: subtle neutral.

Use design tokens rather than hardcoded colors.

Typography

- Primary: Inter or an equivalent readable sans-serif.
- Consistent heading hierarchy.
- Comfortable line height.
- Readable text sizes on mobile.

Layout

Desktop:

- Collapsible sidebar.
- Main content area.
- Optional contextual panel.

Mobile:

- Compact navigation.
- Touch-friendly controls.
- Responsive file previews.
- No horizontal overflow.

Design rule

Every screen must have one clear primary action.

---

12. Internationalization

Supported locales:

en
id

Requirements:

- Translation files separated from components.
- No hardcoded user-facing strings.
- Date and number formatting based on locale.
- User-selectable language.
- English as default fallback.
- Missing translation detection in CI.

Example:

packages/localization/
├── en/
│   └── common.json
└── id/
    └── common.json

Translations should communicate naturally rather than mechanically translating each word.

---

13. Privacy and Security Requirements

Privacy is a core product requirement, not a marketing slogan.

Requirements:

1. No mandatory account.
2. No external AI requests by default.
3. No document uploads to third parties without explicit consent.
4. No unnecessary tracking.
5. Strict content security policy.
6. Safe file handling.
7. Input validation.
8. Protection against XSS.
9. Safe Markdown rendering.
10. Backup integrity validation.
11. Dependency vulnerability checks.
12. Clear data deletion controls.

Never execute uploaded files.

Never render untrusted HTML directly.

Never assume a file is safe based solely on its extension.

Never store secrets in frontend source code.

If cloud synchronization is introduced, add authentication, authorization, transport security, conflict handling, and a documented threat model before public deployment.

---

14. Testing Strategy

Unit tests

Test:

- Folder operations.
- File metadata.
- Note creation.
- Note editing.
- Tag relationships.
- Search.
- Export/import.
- Storage adapters.

Integration tests

Test:

- Database operations.
- File persistence.
- Backup restoration.
- Storage adapter compatibility.
- Transaction rollback.

E2E tests

Critical user journeys:

1. First launch.
2. Create folder.
3. Upload file.
4. Create note.
5. Search for note.
6. Reload application.
7. Confirm persistence.
8. Export backup.
9. Restore backup.
10. Change interface language.

Quality gates

Before merging:

- TypeScript checks pass.
- ESLint passes.
- Unit tests pass.
- Relevant integration tests pass.
- Production build succeeds.
- No known critical security vulnerability.
- No broken translation keys.

---

15. Development Roadmap

The development roadmap has five stages. Stage E is the final stage. There is no
Stage F and no Phase 6. Live status is maintained in `ROADMAP.md`; this section
records the product-level stage definitions. Dated specs, plans, and ADRs may
retain historical stage labels.

Stage A: Foundation

Deliverables:

- Repository.
- License.
- Documentation.
- Next.js application.
- Design system.
- Localization.
- Storage boundary and package scaffold.

Exit criteria: clean application builds and tests pass.

Stage B: Core Architecture

Deliverables:

- Domain model and storage interfaces.
- IndexedDB and SQLite adapters.
- Repository layer.
- Validation and error handling.
- Persistence and conformance tests.

Exit criteria: both storage adapters pass the same conformance scenarios.

Stage C: MVP Features

Deliverables:

- Dashboard.
- Local database integration.
- Folder management.
- File upload.
- File listing.
- File preview for supported formats.
- Markdown notes.
- Autosave.
- Search.
- Tag management.
- Filters.
- Export.
- Import.
- Backup validation.
- Restore.
- Offline shell.
- Service worker.
- Installation support.
- Mobile optimization.
- Keyboard navigation.
- Screen reader improvements.
- Accessibility tests.
- Connections between notes and files.
- Knowledge Hub foundation.
- Storage status.
- Backup reminders.
- Guided recovery workflows.

Exit criteria: users can create, store, edit, retrieve, export, and restore
information, and essential features work offline.

Stage D: Privacy, Security, and Extensibility

Deliverables:

- Privacy Center and data management controls.
- Storage diagnostics and optional storage adapters.
- Self-hosting architecture evaluation.
- Security review.
- Extension sandbox and local sideload.
- AI provider and credential architecture.
- Sync-compatible data model.
- Optional workspace encryption, encrypted drafts, and encrypted backup v2.
- External cryptographic review and E2EE claim gate.
- SQLite interrupted-restore cleanup.

Exit criteria: all Stage D items are delivered or explicitly deferred, and the
Stage D security and cryptography gates pass.

Stage E: AI, Sync, and Collaboration

Stage E is the final stage and covers the post-MVP final scope:

AI:

- AI-powered extensions after D4B.
- Optional local AI.
- Document Q&A with citation-based responses.
- MCP integration, gated by a separate security and consent design.

Sync:

- Optional cloud synchronization.
- Multi-device workflows.
- Self-hosted server, if the Stage D self-hosting evaluation approves it.

Collaboration:

- Multi-user collaboration.

AI and Sync build on the Stage D foundations. Collaboration requires a separate
architecture and security approval before implementation. Stage E does not close
while the Stage D security review, external cryptographic review, or E2EE claim
gate is open.

Exit criteria: the designs are approved, the security gates pass, and the
implemented behavior matches the approved scope.

Cross-Stage Quality Gates

Quality is not a separate stage. Accessibility, responsive behavior, performance,
unit, integration, and E2E tests, documentation, CI, and security review sign-off
apply to every stage accepted after this restructure. Stage A and Stage B closed
under their historical gates and are not reopened. CI is not yet implemented; it
remains an open gap.

Release-Support Backlog

The former community ecosystem work is a cross-stage backlog, not a stage. These
items are support artifacts, not Community Space product features. The backlog
must be completed before public release:

- Community documentation.
- Contribution guidelines.
- Localization contributions.
- Extension guidelines.
- Community feedback channels.
- Public release preparation.

Unscheduled Future Possibilities

These are not scheduled as part of Stage E:

- OCR.
- PDF extraction.
- Advanced search.
- Metadata extraction.
- Community templates.
- Plugin ecosystem.
- Localization expansion.
- Community governance.
- Backup automation.

Community Space product features such as public templates, shared collections,
and a plugin catalog remain post-MVP. They are not part of Stage E or the
Release-Support Backlog.

These are planning directions, not fixed release guarantees.

---

16. Community and Funding Strategy

Open-source governance

Initial governance:

- Maintainer-led.
- Public discussions.
- Transparent issue tracking.
- Pull request reviews.
- Published release notes.
- Documented security reporting.

As the community grows, introduce additional maintainers and a documented decision-making process.

Contribution channels

- GitHub Issues.
- GitHub Discussions.
- Pull Requests.
- Translation contributions.
- Documentation contributions.
- Design contributions.

Funding channels

Initial:

- GitHub Sponsors.
- Buy Me a Coffee, subject to account eligibility.
- Open Collective when financial transparency needs increase.

Funding principles

- Core functionality remains free.
- No paywall for user data export.
- No paywall for privacy controls.
- No paywall for basic document organization.
- Donations never influence feature access.
- Financial reports are published transparently.

Potential future revenue

Optional services:

- Managed hosting.
- Hosted synchronization.
- Organization deployment support.
- Professional setup assistance.
- Enterprise support.

These must not compromise the free core product.

---

17. Success Metrics

Do not measure success exclusively through GitHub stars.

Track:

Metric| Purpose
Weekly active users| Actual usage
Successful file uploads| Library adoption
Notes created| Knowledge Hub adoption
Search usage| Information retrieval value
Backup completion| Data portability
Returning users| Product usefulness
Contributors| Community health
Issues resolved| Maintenance quality
Documentation engagement| Discoverability

Avoid collecting personally identifiable usage data unnecessarily.

Prefer privacy-preserving and optional analytics.

Initial community target:

- 20 genuine beta users.
- 5 external contributors.
- 10 documented user feedback reports.
- No unresolved critical security issues.

These are initial goals, not claims of existing adoption.

---

18. Risks and Mitigation

Risk| Mitigation
Scope creep| Strict MVP boundaries
Browser storage eviction| Backup reminders and exports
Data corruption| Integrity checks and transactions
Low adoption| User interviews and usability testing
Maintenance overload| Modular architecture
Security problems| Threat modeling and audits
Translation inconsistencies| Centralized localization
Feature duplication| Competitive research
Funding uncertainty| Sustainable, transparent operations

---

19. Definition of Done

A feature is not complete merely because it renders.

Every feature must include:

- Working implementation.
- Input validation.
- Error handling.
- Loading and empty states.
- Responsive behavior.
- Accessibility considerations.
- Unit tests where applicable.
- Documentation.
- Localization.
- Data persistence verification.

For destructive operations, require confirmation and provide understandable consequences.

---

20. Final Product Principles

Every development decision must respect these principles:

1. User ownership

Users own their data and can export it.

2. Simplicity

A normal person should understand the interface without reading a technical manual.

3. Privacy

Private information remains private by default.

4. Independence

The core product must not depend on a commercial AI provider.

5. Accessibility

The product should work for people with different abilities and devices.

6. Openness

The community can inspect, modify, and contribute to the software.

7. Sustainability

The project should be maintainable by a community, not permanently dependent on one person.

---

21. Initial Product Statement

OpenNest is an open-source personal digital workspace that helps everyone organize, preserve, and retrieve their digital information.

Built with privacy, accessibility, and data ownership at its core, OpenNest gives users a simple place for their documents, notes, and knowledge.

No mandatory subscription. No mandatory AI. No vendor lock-in.

Your digital life. Your rules.

---

22. First Release Checklist

- [ ] Create GitHub repository.
- [ ] Confirm project name and repository availability.
- [ ] Add AGPL-3.0 license.
- [ ] Initialize Next.js + TypeScript.
- [ ] Configure Tailwind CSS.
- [ ] Configure shadcn/ui.
- [ ] Establish design tokens.
- [ ] Implement English and Indonesian localization.
- [ ] Define storage interfaces.
- [ ] Implement IndexedDB adapter.
- [ ] Implement workspace and folder models.
- [ ] Implement file management.
- [ ] Implement Markdown notes.
- [ ] Implement local search.
- [ ] Implement backup and restore.
- [ ] Implement PWA functionality.
- [ ] Add automated tests.
- [ ] Publish documentation.
- [ ] Release OpenNest 0.1.0 Beta.

Document status: Approved product direction, pending implementation and technical validation.