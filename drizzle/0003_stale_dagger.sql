CREATE TABLE `course_ratings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`course_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`rating_units` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "course_ratings_rating_units_check" CHECK(typeof("course_ratings"."rating_units") = 'integer' and "course_ratings"."rating_units" between 2 and 10)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `course_ratings_course_user_unique` ON `course_ratings` (`course_id`,`user_id`);
