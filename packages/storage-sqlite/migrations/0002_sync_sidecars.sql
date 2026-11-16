CREATE TABLE `sync_conflict` (
	`conflict_id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`field_path` text NOT NULL,
	`local_field_revision` integer NOT NULL,
	`remote_field_revision` integer NOT NULL,
	`local_op_id` text NOT NULL,
	`remote_op_id` text NOT NULL,
	`local_value` text NOT NULL,
	`remote_value` text NOT NULL,
	`local_device_id` text NOT NULL,
	`remote_device_id` text NOT NULL,
	`created_at` text NOT NULL,
	`state` text NOT NULL,
	`resolution` text,
	`resolved_at` text,
	`resolved_by_device_id` text
);
--> statement-breakpoint
CREATE INDEX `sync_conflict_workspace_entity_state_idx` ON `sync_conflict` (`workspace_id`,`entity_id`,`state`);--> statement-breakpoint
CREATE TABLE `sync_devices` (
	`workspace_id` text NOT NULL,
	`device_id` text NOT NULL,
	`registered_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`last_acked_tombstone_workspace_revision` integer NOT NULL,
	`state` text NOT NULL,
	`public_key` text,
	PRIMARY KEY(`workspace_id`, `device_id`)
);
--> statement-breakpoint
CREATE INDEX `sync_devices_workspace_state_idx` ON `sync_devices` (`workspace_id`,`state`);--> statement-breakpoint
CREATE TABLE `sync_field_meta` (
	`workspace_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`field_path` text NOT NULL,
	`field_revision` integer NOT NULL,
	`workspace_revision` integer NOT NULL,
	`origin_device_id` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	PRIMARY KEY(`workspace_id`, `entity_type`, `entity_id`, `field_path`)
);
--> statement-breakpoint
CREATE INDEX `sync_field_meta_entity_idx` ON `sync_field_meta` (`workspace_id`,`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `sync_meta` (
	`workspace_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`entity_revision` integer NOT NULL,
	`workspace_revision` integer NOT NULL,
	`origin_device_id` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`content_hash` text,
	PRIMARY KEY(`workspace_id`, `entity_type`, `entity_id`)
);
--> statement-breakpoint
CREATE INDEX `sync_meta_workspace_revision_idx` ON `sync_meta` (`workspace_id`,`workspace_revision`);--> statement-breakpoint
CREATE TABLE `sync_outbox` (
	`op_id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`operation` text NOT NULL,
	`base_entity_revision` integer NOT NULL,
	`base_workspace_revision` integer NOT NULL,
	`field_patches` text NOT NULL,
	`payload_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`device_id` text NOT NULL,
	`local_sequence` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`state` text NOT NULL,
	`acked_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sync_outbox_workspace_device_sequence_uq` ON `sync_outbox` (`workspace_id`,`device_id`,`local_sequence`);--> statement-breakpoint
CREATE INDEX `sync_outbox_workspace_device_state_sequence_idx` ON `sync_outbox` (`workspace_id`,`device_id`,`state`,`local_sequence`);--> statement-breakpoint
CREATE TABLE `sync_tombstone` (
	`tombstone_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`deleted_at` text NOT NULL,
	`deleted_by_device_id` text NOT NULL,
	`tombstone_workspace_revision` integer NOT NULL,
	`state` text NOT NULL,
	`compacted_at` text,
	PRIMARY KEY(`workspace_id`, `entity_type`, `entity_id`)
);
--> statement-breakpoint
CREATE INDEX `sync_tombstone_workspace_revision_idx` ON `sync_tombstone` (`workspace_id`,`tombstone_workspace_revision`);--> statement-breakpoint
CREATE TABLE `workspace_sync_state` (
	`workspace_id` text NOT NULL,
	`device_id` text NOT NULL,
	`remote_workspace_id` text,
	`last_server_cursor` text,
	`last_local_workspace_revision` integer NOT NULL,
	`tombstone_floor` integer NOT NULL,
	`last_full_resync_at` text,
	PRIMARY KEY(`workspace_id`, `device_id`)
);
--> statement-breakpoint
INSERT INTO sync_meta (workspace_id, entity_type, entity_id, entity_revision, workspace_revision, origin_device_id, updated_at, deleted_at, content_hash)
SELECT id, 'workspace', id, 1, 0, 'legacy', updated_at, NULL, NULL FROM workspaces;--> statement-breakpoint
INSERT INTO sync_meta (workspace_id, entity_type, entity_id, entity_revision, workspace_revision, origin_device_id, updated_at, deleted_at, content_hash)
SELECT workspace_id, 'folder', id, 1, 0, 'legacy', updated_at, NULL, NULL FROM folders;--> statement-breakpoint
INSERT INTO sync_meta (workspace_id, entity_type, entity_id, entity_revision, workspace_revision, origin_device_id, updated_at, deleted_at, content_hash)
SELECT workspace_id, 'file', id, 1, 0, 'legacy', updated_at, NULL, checksum FROM files;--> statement-breakpoint
INSERT INTO sync_meta (workspace_id, entity_type, entity_id, entity_revision, workspace_revision, origin_device_id, updated_at, deleted_at, content_hash)
SELECT workspace_id, 'note', id, 1, 0, 'legacy', updated_at, NULL, NULL FROM notes;--> statement-breakpoint
INSERT INTO sync_meta (workspace_id, entity_type, entity_id, entity_revision, workspace_revision, origin_device_id, updated_at, deleted_at, content_hash)
SELECT workspace_id, 'tag', id, 1, 0, 'legacy', created_at, NULL, NULL FROM tags;--> statement-breakpoint
INSERT INTO workspace_sync_state (workspace_id, device_id, remote_workspace_id, last_server_cursor, last_local_workspace_revision, tombstone_floor, last_full_resync_at)
SELECT id, 'legacy', NULL, NULL, 0, 0, NULL FROM workspaces;
