CREATE TABLE `dpr_snapshots` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`siteId` bigint unsigned NOT NULL,
	`day` varchar(10) NOT NULL,
	`crop` varchar(64) NOT NULL,
	`program` varchar(32) NOT NULL DEFAULT 'conventional',
	`openingLbs` int NOT NULL DEFAULT 0,
	`receivedLbs` int NOT NULL DEFAULT 0,
	`receivedBu` double NOT NULL DEFAULT 0,
	`shippedLbs` int NOT NULL DEFAULT 0,
	`shippedBu` double NOT NULL DEFAULT 0,
	`transfersInLbs` int NOT NULL DEFAULT 0,
	`transfersOutLbs` int NOT NULL DEFAULT 0,
	`shrinkMoistureLbs` int NOT NULL DEFAULT 0,
	`shrinkHandlingLbs` int NOT NULL DEFAULT 0,
	`shrinkAerationLbs` int NOT NULL DEFAULT 0,
	`shrinkErrorCorrectionLbs` int NOT NULL DEFAULT 0,
	`adjustmentsLbs` int NOT NULL DEFAULT 0,
	`endingLbs` int NOT NULL DEFAULT 0,
	`endingBu` double NOT NULL DEFAULT 0,
	`frozen` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `dpr_snapshots_id` PRIMARY KEY(`id`),
	CONSTRAINT `dpr_site_day_crop_program_unique` UNIQUE(`siteId`,`day`,`crop`,`program`)
);
--> statement-breakpoint
CREATE TABLE `physical_counts` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`siteId` bigint unsigned NOT NULL,
	`binId` bigint unsigned NOT NULL,
	`countedLbs` int NOT NULL,
	`countedAt` timestamp NOT NULL,
	`note` text,
	`operator` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `physical_counts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `loads` ADD `shrinkLbs` double;--> statement-breakpoint
ALTER TABLE `loads` ADD `dockLbs` double;--> statement-breakpoint
ALTER TABLE `dpr_snapshots` ADD CONSTRAINT `dpr_snapshots_siteId_sites_id_fk` FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `physical_counts` ADD CONSTRAINT `physical_counts_siteId_sites_id_fk` FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `physical_counts` ADD CONSTRAINT `physical_counts_binId_bins_id_fk` FOREIGN KEY (`binId`) REFERENCES `bins`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `dpr_site_day_idx` ON `dpr_snapshots` (`siteId`,`day`);--> statement-breakpoint
CREATE INDEX `physical_counts_site_idx` ON `physical_counts` (`siteId`);--> statement-breakpoint
CREATE INDEX `physical_counts_bin_idx` ON `physical_counts` (`binId`);