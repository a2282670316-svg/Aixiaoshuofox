CREATE TABLE `background_responses` (
	`id` text PRIMARY KEY NOT NULL,
	`response_id` text NOT NULL,
	`run_id` text NOT NULL,
	`project_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`step_key` text NOT NULL,
	`kind` text NOT NULL,
	`chapter_number` integer,
	`segment_number` integer,
	`status` text DEFAULT 'queued' NOT NULL,
	`attempts` integer DEFAULT 1 NOT NULL,
	`last_error` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `automation_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `background_responses_response_id_uidx` ON `background_responses` (`response_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `background_responses_run_step_key_uidx` ON `background_responses` (`run_id`,`step_key`);--> statement-breakpoint
CREATE INDEX `background_responses_project_status_idx` ON `background_responses` (`project_id`,`status`);--> statement-breakpoint
CREATE TABLE `webhook_events` (
	`id` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`response_id` text,
	`received_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
