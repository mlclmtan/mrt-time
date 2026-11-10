CREATE TABLE "train_sighting" (
	"id" serial PRIMARY KEY NOT NULL,
	"station" text NOT NULL,
	"line" text NOT NULL,
	"direction" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"source" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"destination" text,
	"trip_event_id" integer,
	"user_id" text,
	"device_id" text,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "train_sighting" ADD CONSTRAINT "train_sighting_trip_event_id_trip_event_id_fk" FOREIGN KEY ("trip_event_id") REFERENCES "public"."trip_event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "train_sighting" ADD CONSTRAINT "train_sighting_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "train_sighting_line_idx" ON "train_sighting" USING btree ("line","direction","at");--> statement-breakpoint
CREATE INDEX "train_sighting_platform_idx" ON "train_sighting" USING btree ("station","line","direction","at");--> statement-breakpoint
CREATE INDEX "train_sighting_status_idx" ON "train_sighting" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "train_sighting_trip_event_idx" ON "train_sighting" USING btree ("trip_event_id");