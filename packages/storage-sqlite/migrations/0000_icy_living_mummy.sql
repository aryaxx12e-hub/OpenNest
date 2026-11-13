CREATE TABLE `file_tags` (
	`file_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`file_id`, `tag_id`),
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `file_tags_tag_idx` ON `file_tags` (`tag_id`);--> statement-breakpoint
CREATE TABLE `files` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`folder_id` text,
	`name` text NOT NULL,
	`mime_type` text,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`blob_key` text NOT NULL,
	`checksum` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`folder_id`) REFERENCES `folders`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `files_workspace_idx` ON `files` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `files_workspace_folder_idx` ON `files` (`workspace_id`,`folder_id`);--> statement-breakpoint
CREATE INDEX `files_workspace_created_idx` ON `files` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `files_workspace_updated_idx` ON `files` (`workspace_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `folders` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `folders`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `folders_workspace_idx` ON `folders` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `folders_workspace_parent_idx` ON `folders` (`workspace_id`,`parent_id`);--> statement-breakpoint
CREATE INDEX `folders_workspace_created_idx` ON `folders` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `folders_workspace_updated_idx` ON `folders` (`workspace_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `note_links` (
	`source_note_id` text NOT NULL,
	`target_note_id` text NOT NULL,
	PRIMARY KEY(`source_note_id`, `target_note_id`),
	FOREIGN KEY (`source_note_id`) REFERENCES `notes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_note_id`) REFERENCES `notes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `note_links_target_idx` ON `note_links` (`target_note_id`);--> statement-breakpoint
CREATE TABLE `note_tags` (
	`note_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`note_id`, `tag_id`),
	FOREIGN KEY (`note_id`) REFERENCES `notes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `note_tags_tag_idx` ON `note_tags` (`tag_id`);--> statement-breakpoint
CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`folder_id` text,
	`title` text NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`folder_id`) REFERENCES `folders`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `notes_workspace_idx` ON `notes` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `notes_workspace_folder_idx` ON `notes` (`workspace_id`,`folder_id`);--> statement-breakpoint
CREATE INDEX `notes_workspace_created_idx` ON `notes` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `notes_workspace_updated_idx` ON `notes` (`workspace_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_workspace_name_uq` ON `tags` (`workspace_id`,`name`);--> statement-breakpoint
CREATE INDEX `tags_workspace_created_idx` ON `tags` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
