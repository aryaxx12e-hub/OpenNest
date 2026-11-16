ALTER TABLE `workspace_sync_state` ADD `last_local_sequence` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `workspace_sync_state`
SET `last_local_sequence` = COALESCE((
  SELECT MAX(`sync_outbox`.`local_sequence`)
  FROM `sync_outbox`
  WHERE `sync_outbox`.`workspace_id` = `workspace_sync_state`.`workspace_id`
    AND `sync_outbox`.`device_id` = `workspace_sync_state`.`device_id`
), 0);
