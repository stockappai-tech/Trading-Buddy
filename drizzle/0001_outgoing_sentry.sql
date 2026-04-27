CREATE TABLE `alerts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`symbol` varchar(20) NOT NULL,
	`targetPrice` decimal(15,4) NOT NULL,
	`alertType` enum('above','below','stop_loss','take_profit') NOT NULL,
	`triggered` boolean DEFAULT false,
	`message` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`triggeredAt` timestamp,
	CONSTRAINT `alerts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `coachMessages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`sessionId` int,
	`role` enum('user','assistant') NOT NULL,
	`content` text NOT NULL,
	`coachMode` enum('sergeant','friend','expert') DEFAULT 'friend',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `coachMessages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `positions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`symbol` varchar(20) NOT NULL,
	`quantity` decimal(15,4) NOT NULL,
	`avgPrice` decimal(15,4) NOT NULL,
	`currentPrice` decimal(15,4),
	`unrealizedPnl` decimal(15,4),
	`openDate` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `positions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`title` varchar(255),
	`transcript` text,
	`audioUrl` text,
	`emotionalNote` text,
	`summary` text,
	`coachFeedback` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `trades` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`sessionId` int,
	`symbol` varchar(20) NOT NULL,
	`side` enum('buy','sell','short','cover') NOT NULL,
	`quantity` decimal(15,4) NOT NULL,
	`entryPrice` decimal(15,4) NOT NULL,
	`exitPrice` decimal(15,4),
	`pnl` decimal(15,4),
	`status` enum('open','closed') NOT NULL DEFAULT 'open',
	`notes` text,
	`tradeDate` timestamp NOT NULL DEFAULT (now()),
	`closedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `trades_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `userPreferences` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`coachMode` enum('sergeant','friend','expert') NOT NULL DEFAULT 'friend',
	`accountSize` decimal(15,2) DEFAULT '10000',
	`riskPerTrade` decimal(5,2) DEFAULT '1.00',
	`tradierToken` text,
	`tradierAccountId` varchar(64),
	`notificationsEnabled` boolean DEFAULT true,
	`isPremium` boolean DEFAULT false,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `userPreferences_id` PRIMARY KEY(`id`),
	CONSTRAINT `userPreferences_userId_unique` UNIQUE(`userId`)
);
