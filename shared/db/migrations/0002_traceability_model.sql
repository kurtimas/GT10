CREATE TABLE `audit_log` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`actor` varchar(255) NOT NULL DEFAULT 'system',
	`action` varchar(32) NOT NULL,
	`entityType` varchar(64) NOT NULL,
	`entityId` bigint unsigned NOT NULL,
	`beforeJson` text,
	`afterJson` text,
	`note` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `bin_movements` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`siteId` bigint unsigned NOT NULL,
	`lotId` bigint unsigned,
	`fromBinId` bigint unsigned,
	`toBinId` bigint unsigned,
	`quantityLbs` int NOT NULL,
	`loadId` bigint unsigned,
	`shipmentId` bigint unsigned,
	`operator` varchar(255),
	`note` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `bin_movements_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `shipments` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`siteId` bigint unsigned NOT NULL,
	`customerName` varchar(255) NOT NULL,
	`destination` varchar(255),
	`lotId` bigint unsigned,
	`binId` bigint unsigned,
	`quantityLbs` int NOT NULL,
	`quantityBu` double,
	`truckId` varchar(64),
	`binMovementId` bigint unsigned,
	`note` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `shipments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `loads` ADD `damagePct` double;--> statement-breakpoint
ALTER TABLE `loads` ADD `grade` varchar(32);--> statement-breakpoint
ALTER TABLE `loads` ADD `farmOrigin` varchar(255);--> statement-breakpoint
ALTER TABLE `loads` ADD `shipmentId` bigint unsigned;--> statement-breakpoint
ALTER TABLE `loads` ADD `voidedAt` timestamp;--> statement-breakpoint
ALTER TABLE `loads` ADD `voidReason` text;--> statement-breakpoint
ALTER TABLE `weight_sheets` ADD `voidedAt` timestamp;--> statement-breakpoint
ALTER TABLE `weight_sheets` ADD `voidReason` text;--> statement-breakpoint
ALTER TABLE `eod_reports` ADD CONSTRAINT `eod_site_day_unique` UNIQUE(`siteId`,`day`);--> statement-breakpoint
ALTER TABLE `bin_movements` ADD CONSTRAINT `bin_movements_siteId_sites_id_fk` FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bin_movements` ADD CONSTRAINT `bin_movements_lotId_lots_id_fk` FOREIGN KEY (`lotId`) REFERENCES `lots`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bin_movements` ADD CONSTRAINT `bin_movements_fromBinId_bins_id_fk` FOREIGN KEY (`fromBinId`) REFERENCES `bins`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bin_movements` ADD CONSTRAINT `bin_movements_toBinId_bins_id_fk` FOREIGN KEY (`toBinId`) REFERENCES `bins`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shipments` ADD CONSTRAINT `shipments_siteId_sites_id_fk` FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shipments` ADD CONSTRAINT `shipments_lotId_lots_id_fk` FOREIGN KEY (`lotId`) REFERENCES `lots`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shipments` ADD CONSTRAINT `shipments_binId_bins_id_fk` FOREIGN KEY (`binId`) REFERENCES `bins`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shipments` ADD CONSTRAINT `shipments_binMovementId_bin_movements_id_fk` FOREIGN KEY (`binMovementId`) REFERENCES `bin_movements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `audit_entity_idx` ON `audit_log` (`entityType`,`entityId`);--> statement-breakpoint
CREATE INDEX `audit_created_idx` ON `audit_log` (`createdAt`);--> statement-breakpoint
CREATE INDEX `binmov_site_idx` ON `bin_movements` (`siteId`);--> statement-breakpoint
CREATE INDEX `binmov_lot_idx` ON `bin_movements` (`lotId`);--> statement-breakpoint
CREATE INDEX `binmov_from_bin_idx` ON `bin_movements` (`fromBinId`);--> statement-breakpoint
CREATE INDEX `binmov_to_bin_idx` ON `bin_movements` (`toBinId`);--> statement-breakpoint
CREATE INDEX `binmov_load_idx` ON `bin_movements` (`loadId`);--> statement-breakpoint
CREATE INDEX `binmov_created_idx` ON `bin_movements` (`createdAt`);--> statement-breakpoint
CREATE INDEX `shipments_site_idx` ON `shipments` (`siteId`);--> statement-breakpoint
CREATE INDEX `shipments_lot_idx` ON `shipments` (`lotId`);--> statement-breakpoint
CREATE INDEX `shipments_bin_idx` ON `shipments` (`binId`);--> statement-breakpoint
CREATE INDEX `shipments_created_idx` ON `shipments` (`createdAt`);--> statement-breakpoint
ALTER TABLE `bins` ADD CONSTRAINT `bins_siteId_sites_id_fk` FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `eod_reports` ADD CONSTRAINT `eod_reports_siteId_sites_id_fk` FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loads` ADD CONSTRAINT `loads_sheetId_weight_sheets_id_fk` FOREIGN KEY (`sheetId`) REFERENCES `weight_sheets`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loads` ADD CONSTRAINT `loads_binId_bins_id_fk` FOREIGN KEY (`binId`) REFERENCES `bins`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loads` ADD CONSTRAINT `loads_shipmentId_shipments_id_fk` FOREIGN KEY (`shipmentId`) REFERENCES `shipments`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `lots` ADD CONSTRAINT `lots_farmerId_farmers_id_fk` FOREIGN KEY (`farmerId`) REFERENCES `farmers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `lots` ADD CONSTRAINT `lots_landlordId_landlords_id_fk` FOREIGN KEY (`landlordId`) REFERENCES `landlords`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `weight_sheets` ADD CONSTRAINT `weight_sheets_siteId_sites_id_fk` FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `weight_sheets` ADD CONSTRAINT `weight_sheets_farmerId_farmers_id_fk` FOREIGN KEY (`farmerId`) REFERENCES `farmers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `weight_sheets` ADD CONSTRAINT `weight_sheets_lotId_lots_id_fk` FOREIGN KEY (`lotId`) REFERENCES `lots`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `weight_sheets` ADD CONSTRAINT `weight_sheets_landlordId_landlords_id_fk` FOREIGN KEY (`landlordId`) REFERENCES `landlords`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `loads_shipment_idx` ON `loads` (`shipmentId`);