CREATE VIRTUAL TABLE `files_fts` USING fts5(
	`name`,
	content='files',
	content_rowid='rowid',
	tokenize='unicode61 remove_diacritics 2'
);
--> statement-breakpoint
CREATE VIRTUAL TABLE `notes_fts` USING fts5(
	`title`,
	`content`,
	content='notes',
	content_rowid='rowid',
	tokenize='unicode61 remove_diacritics 2'
);
--> statement-breakpoint
CREATE TRIGGER `files_fts_ai` AFTER INSERT ON `files` BEGIN
	INSERT INTO `files_fts`(`rowid`, `name`) VALUES (new.`rowid`, new.`name`);
END;
--> statement-breakpoint
CREATE TRIGGER `files_fts_ad` AFTER DELETE ON `files` BEGIN
	INSERT INTO `files_fts`(`files_fts`, `rowid`, `name`) VALUES ('delete', old.`rowid`, old.`name`);
END;
--> statement-breakpoint
CREATE TRIGGER `files_fts_au` AFTER UPDATE ON `files` BEGIN
	INSERT INTO `files_fts`(`files_fts`, `rowid`, `name`) VALUES ('delete', old.`rowid`, old.`name`);
	INSERT INTO `files_fts`(`rowid`, `name`) VALUES (new.`rowid`, new.`name`);
END;
--> statement-breakpoint
CREATE TRIGGER `notes_fts_ai` AFTER INSERT ON `notes` BEGIN
	INSERT INTO `notes_fts`(`rowid`, `title`, `content`) VALUES (new.`rowid`, new.`title`, new.`content`);
END;
--> statement-breakpoint
CREATE TRIGGER `notes_fts_ad` AFTER DELETE ON `notes` BEGIN
	INSERT INTO `notes_fts`(`notes_fts`, `rowid`, `title`, `content`) VALUES ('delete', old.`rowid`, old.`title`, old.`content`);
END;
--> statement-breakpoint
CREATE TRIGGER `notes_fts_au` AFTER UPDATE ON `notes` BEGIN
	INSERT INTO `notes_fts`(`notes_fts`, `rowid`, `title`, `content`) VALUES ('delete', old.`rowid`, old.`title`, old.`content`);
	INSERT INTO `notes_fts`(`rowid`, `title`, `content`) VALUES (new.`rowid`, new.`title`, new.`content`);
END;
