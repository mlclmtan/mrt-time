CREATE TABLE "api_metric" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"route" text NOT NULL,
	"ms" real NOT NULL,
	"status" smallint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_setting" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"source" text NOT NULL,
	"medium" text NOT NULL,
	"campaign" text NOT NULL,
	"content" text,
	"term" text,
	"campaign_id" text,
	"landing_path" text DEFAULT '/' NOT NULL,
	"url" text NOT NULL,
	"kol_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device" (
	"id" text PRIMARY KEY NOT NULL,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"first_touch" jsonb,
	"last_touch" jsonb,
	"kol_handle" text,
	"referral_code" text,
	"installed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "event_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"event_id" text,
	"device_id" text,
	"session_id" text,
	"aggregate_only" boolean DEFAULT false NOT NULL,
	"origin" text DEFAULT 'client' NOT NULL,
	"user_type" text DEFAULT 'visitor' NOT NULL,
	"route" text,
	"referrer" text,
	"props" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"utm_content" text,
	"utm_term" text,
	"kol_handle" text,
	"viewport" text,
	"standalone" boolean,
	"language" text,
	"experiments" jsonb,
	"country" text,
	"region" text,
	"city" text,
	"browser" text,
	"os" text,
	"device_type" text
);
--> statement-breakpoint
CREATE TABLE "experiment" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"variants" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "experiment_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" serial PRIMARY KEY NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"device_id" text,
	"rating" smallint NOT NULL,
	"category" text NOT NULL,
	"text" text,
	"route" text,
	"language" text,
	"user_type" text DEFAULT 'visitor' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journey" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"from_place" text,
	"to_place" text,
	"legs" jsonb NOT NULL,
	"sheltered" boolean DEFAULT false NOT NULL,
	"sort" smallint DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kol" (
	"id" serial PRIMARY KEY NOT NULL,
	"handle" text NOT NULL,
	"display_name" text NOT NULL,
	"platform" text NOT NULL,
	"code" text NOT NULL,
	"landing_variant" text DEFAULT 'default' NOT NULL,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kol_handle_unique" UNIQUE("handle"),
	CONSTRAINT "kol_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "newsletter" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"consent_at" timestamp with time zone NOT NULL,
	"confirm_token" text,
	"confirmed_at" timestamp with time zone,
	"unsubscribed_at" timestamp with time zone,
	"language" text,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "newsletter_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "nps_response" (
	"id" serial PRIMARY KEY NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"device_id" text,
	"score" smallint NOT NULL,
	"comment" text
);
--> statement-breakpoint
CREATE TABLE "observation" (
	"id" serial PRIMARY KEY NOT NULL,
	"station" text NOT NULL,
	"line" text NOT NULL,
	"direction" text NOT NULL,
	"destination" text,
	"captured_at" timestamp with time zone NOT NULL,
	"minutes" integer[] NOT NULL,
	"source" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"origin" text,
	"user_id" text,
	"device_id" text,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "place" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"address" text,
	"lat" double precision,
	"lng" double precision,
	"station" text,
	"exit" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prediction_check" (
	"id" serial PRIMARY KEY NOT NULL,
	"trip_event_id" integer,
	"line" text NOT NULL,
	"station" text NOT NULL,
	"direction" text NOT NULL,
	"band" text NOT NULL,
	"boarded_at" timestamp with time zone NOT NULL,
	"predicted_at" timestamp with time zone,
	"kind" text NOT NULL,
	"basis" text NOT NULL,
	"confidence" text NOT NULL,
	"error_min" real,
	"hit" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscription" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscription_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE "rate_limit" (
	"bucket" text NOT NULL,
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limit_bucket_key_window_start_pk" PRIMARY KEY("bucket","key","window_start")
);
--> statement-breakpoint
CREATE TABLE "sandbox_run" (
	"id" serial PRIMARY KEY NOT NULL,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL,
	"mode" text NOT NULL,
	"day" text NOT NULL,
	"users" integer DEFAULT 0 NOT NULL,
	"events" integer DEFAULT 0 NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "trip_event" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"client_id" uuid NOT NULL,
	"journey_key" text,
	"trip_date" text,
	"kind" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"station" text,
	"line" text,
	"direction" text,
	"note" text,
	"source" text DEFAULT 'owner' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "passkey" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"public_key" text NOT NULL,
	"user_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"counter" integer NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean NOT NULL,
	"transports" text,
	"created_at" timestamp with time zone,
	"aaguid" text
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_kol_id_kol_id_fk" FOREIGN KEY ("kol_id") REFERENCES "public"."kol"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journey" ADD CONSTRAINT "journey_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation" ADD CONSTRAINT "observation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place" ADD CONSTRAINT "place_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prediction_check" ADD CONSTRAINT "prediction_check_trip_event_id_trip_event_id_fk" FOREIGN KEY ("trip_event_id") REFERENCES "public"."trip_event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscription" ADD CONSTRAINT "push_subscription_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_event" ADD CONSTRAINT "trip_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkey" ADD CONSTRAINT "passkey_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_metric_route_ts_idx" ON "api_metric" USING btree ("route","ts");--> statement-breakpoint
CREATE INDEX "event_log_ts_idx" ON "event_log" USING btree ("ts");--> statement-breakpoint
CREATE INDEX "event_log_name_ts_idx" ON "event_log" USING btree ("name","ts");--> statement-breakpoint
CREATE INDEX "event_log_device_ts_idx" ON "event_log" USING btree ("device_id","ts");--> statement-breakpoint
CREATE INDEX "event_log_campaign_idx" ON "event_log" USING btree ("utm_campaign","ts");--> statement-breakpoint
CREATE UNIQUE INDEX "journey_user_key_idx" ON "journey" USING btree ("user_id","key");--> statement-breakpoint
CREATE INDEX "observation_platform_idx" ON "observation" USING btree ("station","line","direction","captured_at");--> statement-breakpoint
CREATE INDEX "observation_line_idx" ON "observation" USING btree ("line","direction","captured_at");--> statement-breakpoint
CREATE INDEX "observation_status_idx" ON "observation" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "observation_dedupe_idx" ON "observation" USING btree ("station","line","direction","captured_at","source");--> statement-breakpoint
CREATE UNIQUE INDEX "place_user_key_idx" ON "place" USING btree ("user_id","key");--> statement-breakpoint
CREATE INDEX "prediction_check_line_idx" ON "prediction_check" USING btree ("line","station","boarded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_event_client_idx" ON "trip_event" USING btree ("user_id","client_id");--> statement-breakpoint
CREATE INDEX "trip_event_user_at_idx" ON "trip_event" USING btree ("user_id","at");--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "passkey_userId_idx" ON "passkey" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "passkey_credentialID_idx" ON "passkey" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");