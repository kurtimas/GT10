CREATE TABLE `attachments` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`siteId` bigint unsigned NOT NULL,
	`entityType` varchar(64) NOT NULL,
	`entityId` bigint unsigned NOT NULL,
	`filename` varchar(255) NOT NULL,
	`mime` varchar(128),
	`size` int,
	`storageRef` varchar(255) NOT NULL,
	`uploadedBy` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `attachments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `bin_cleanouts` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`siteId` bigint unsigned NOT NULL,
	`binId` bigint unsigned NOT NULL,
	`emptiedAt` timestamp NOT NULL,
	`cleanedAt` timestamp,
	`method` varchar(255),
	`note` text,
	`operator` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `bin_cleanouts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `bin_grade_overrides` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`siteId` bigint unsigned NOT NULL,
	`binId` bigint unsigned NOT NULL,
	`factor` varchar(32) NOT NULL,
	`value` double NOT NULL,
	`reason` text NOT NULL,
	`operator` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `bin_grade_overrides_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `certificates` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`siteId` bigint unsigned NOT NULL,
	`type` varchar(32) NOT NULL,
	`certNumber` varchar(128) NOT NULL,
	`issuedAt` timestamp NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'issued',
	`lotId` bigint unsigned,
	`shipmentId` bigint unsigned,
	`note` text,
	`fileRef` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `certificates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `fumigation_logs` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`siteId` bigint unsigned NOT NULL,
	`binId` bigint unsigned NOT NULL,
	`product` varchar(255) NOT NULL,
	`dosage` varchar(128),
	`appliedAt` timestamp NOT NULL,
	`exposureHours` double,
	`aerationClearedAt` timestamp,
	`applicator` varchar(255),
	`note` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `fumigation_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `grade_factors` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`siteId` bigint unsigned,
	`crop` varchar(64) NOT NULL,
	`gradeClass` varchar(32) NOT NULL,
	`factor` varchar(32) NOT NULL,
	`minValue` double,
	`maxValue` double,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `grade_factors_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `grading_schedules` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`siteId` bigint unsigned,
	`crop` varchar(64) NOT NULL,
	`moistureShrinkPerPoint` double NOT NULL,
	`baseMoisturePct` double NOT NULL,
	`handlingShrinkPct` double NOT NULL DEFAULT 0,
	`dockageRules` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `grading_schedules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `lab_results` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`siteId` bigint unsigned NOT NULL,
	`sampleDate` timestamp NOT NULL,
	`labName` varchar(255),
	`testType` varchar(32) NOT NULL,
	`result` varchar(255),
	`passFail` varchar(8),
	`lotId` bigint unsigned,
	`loadId` bigint unsigned,
	`binId` bigint unsigned,
	`note` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `lab_results_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `load_splits` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`loadId` bigint unsigned NOT NULL,
	`partyType` varchar(16) NOT NULL,
	`partyId` bigint unsigned NOT NULL,
	`splitPct` double NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `load_splits_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `shrink_entries` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`siteId` bigint unsigned NOT NULL,
	`binId` bigint unsigned NOT NULL,
	`kind` varchar(24) NOT NULL,
	`quantityLbs` int NOT NULL,
	`effectiveDate` timestamp NOT NULL,
	`note` text,
	`operator` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `shrink_entries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `bins` ADD `program` varchar(32) DEFAULT 'conventional' NOT NULL;--> statement-breakpoint
ALTER TABLE `loads` ADD `foreignMaterialPct` double;--> statement-breakpoint
ALTER TABLE `loads` ADD `sbPct` double;--> statement-breakpoint
ALTER TABLE `loads` ADD `program` varchar(32) DEFAULT 'conventional' NOT NULL;--> statement-breakpoint
ALTER TABLE `lots` ADD `program` varchar(32) DEFAULT 'conventional' NOT NULL;--> statement-breakpoint
ALTER TABLE `lots` ADD `practices` text;--> statement-breakpoint
ALTER TABLE `lots` ADD `carbonNotes` text;--> statement-breakpoint
ALTER TABLE `attachments` ADD CONSTRAINT `attachments_siteId_sites_id_fk` FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bin_cleanouts` ADD CONSTRAINT `bin_cleanouts_siteId_sites_id_fk` FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bin_cleanouts` ADD CONSTRAINT `bin_cleanouts_binId_bins_id_fk` FOREIGN KEY (`binId`) REFERENCES `bins`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bin_grade_overrides` ADD CONSTRAINT `bin_grade_overrides_siteId_sites_id_fk` FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bin_grade_overrides` ADD CONSTRAINT `bin_grade_overrides_binId_bins_id_fk` FOREIGN KEY (`binId`) REFERENCES `bins`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `certificates` ADD CONSTRAINT `certificates_siteId_sites_id_fk` FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `certificates` ADD CONSTRAINT `certificates_lotId_lots_id_fk` FOREIGN KEY (`lotId`) REFERENCES `lots`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `certificates` ADD CONSTRAINT `certificates_shipmentId_shipments_id_fk` FOREIGN KEY (`shipmentId`) REFERENCES `shipments`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `fumigation_logs` ADD CONSTRAINT `fumigation_logs_siteId_sites_id_fk` FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `fumigation_logs` ADD CONSTRAINT `fumigation_logs_binId_bins_id_fk` FOREIGN KEY (`binId`) REFERENCES `bins`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `grade_factors` ADD CONSTRAINT `grade_factors_siteId_sites_id_fk` FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `grading_schedules` ADD CONSTRAINT `grading_schedules_siteId_sites_id_fk` FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `lab_results` ADD CONSTRAINT `lab_results_siteId_sites_id_fk` FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `lab_results` ADD CONSTRAINT `lab_results_lotId_lots_id_fk` FOREIGN KEY (`lotId`) REFERENCES `lots`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `lab_results` ADD CONSTRAINT `lab_results_binId_bins_id_fk` FOREIGN KEY (`binId`) REFERENCES `bins`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `load_splits` ADD CONSTRAINT `load_splits_loadId_loads_id_fk` FOREIGN KEY (`loadId`) REFERENCES `loads`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shrink_entries` ADD CONSTRAINT `shrink_entries_siteId_sites_id_fk` FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shrink_entries` ADD CONSTRAINT `shrink_entries_binId_bins_id_fk` FOREIGN KEY (`binId`) REFERENCES `bins`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `attachments_site_idx` ON `attachments` (`siteId`);--> statement-breakpoint
CREATE INDEX `attachments_entity_idx` ON `attachments` (`entityType`,`entityId`);--> statement-breakpoint
CREATE INDEX `cleanouts_site_idx` ON `bin_cleanouts` (`siteId`);--> statement-breakpoint
CREATE INDEX `cleanouts_bin_idx` ON `bin_cleanouts` (`binId`);--> statement-breakpoint
CREATE INDEX `grade_overrides_site_idx` ON `bin_grade_overrides` (`siteId`);--> statement-breakpoint
CREATE INDEX `grade_overrides_bin_idx` ON `bin_grade_overrides` (`binId`);--> statement-breakpoint
CREATE INDEX `certificates_site_idx` ON `certificates` (`siteId`);--> statement-breakpoint
CREATE INDEX `certificates_lot_idx` ON `certificates` (`lotId`);--> statement-breakpoint
CREATE INDEX `certificates_shipment_idx` ON `certificates` (`shipmentId`);--> statement-breakpoint
CREATE INDEX `fumigation_site_idx` ON `fumigation_logs` (`siteId`);--> statement-breakpoint
CREATE INDEX `fumigation_bin_idx` ON `fumigation_logs` (`binId`);--> statement-breakpoint
CREATE INDEX `grade_factor_site_crop_idx` ON `grade_factors` (`siteId`,`crop`);--> statement-breakpoint
CREATE INDEX `grading_sched_site_crop_idx` ON `grading_schedules` (`siteId`,`crop`);--> statement-breakpoint
CREATE INDEX `lab_results_site_idx` ON `lab_results` (`siteId`);--> statement-breakpoint
CREATE INDEX `lab_results_lot_idx` ON `lab_results` (`lotId`);--> statement-breakpoint
CREATE INDEX `lab_results_bin_idx` ON `lab_results` (`binId`);--> statement-breakpoint
CREATE INDEX `lab_results_load_idx` ON `lab_results` (`loadId`);--> statement-breakpoint
CREATE INDEX `load_splits_load_idx` ON `load_splits` (`loadId`);--> statement-breakpoint
CREATE INDEX `shrink_entries_site_idx` ON `shrink_entries` (`siteId`);--> statement-breakpoint
CREATE INDEX `shrink_entries_bin_idx` ON `shrink_entries` (`binId`);