CREATE TABLE "ad_campaign" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"advertiser" text NOT NULL,
	"objective" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"start_at" timestamp with time zone DEFAULT now() NOT NULL,
	"end_at" timestamp with time zone,
	"daily_budget_sgd" real NOT NULL,
	"bid_model" text NOT NULL,
	"bid_amount_sgd" real NOT NULL,
	"targeting" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ad_campaign_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "ad_creative" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" integer NOT NULL,
	"ref" text,
	"format" text NOT NULL,
	"headline" text NOT NULL,
	"primary_text" text,
	"description" text,
	"image_url" text,
	"image_data" text,
	"cta_label" text DEFAULT 'Learn more' NOT NULL,
	"destination_url" text NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ad_creative_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
CREATE TABLE "ad_event" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"type" text NOT NULL,
	"creative_id" integer NOT NULL,
	"campaign_id" integer NOT NULL,
	"format" text NOT NULL,
	"placement" text NOT NULL,
	"device_id" text,
	"session_id" text,
	"internal" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ad_creative" ADD CONSTRAINT "ad_creative_campaign_id_ad_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."ad_campaign"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_event" ADD CONSTRAINT "ad_event_creative_id_ad_creative_id_fk" FOREIGN KEY ("creative_id") REFERENCES "public"."ad_creative"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ad_campaign_status_idx" ON "ad_campaign" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ad_creative_campaign_idx" ON "ad_creative" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "ad_event_ts_idx" ON "ad_event" USING btree ("ts");--> statement-breakpoint
CREATE INDEX "ad_event_campaign_ts_idx" ON "ad_event" USING btree ("campaign_id","ts");--> statement-breakpoint
CREATE INDEX "ad_event_session_idx" ON "ad_event" USING btree ("session_id","ts");