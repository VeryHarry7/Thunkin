CREATE TABLE "job_events" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"source" text NOT NULL,
	"data" jsonb
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"kind" text NOT NULL,
	"look_id" text NOT NULL,
	"model_id" text NOT NULL,
	"params" jsonb NOT NULL,
	"status" text NOT NULL,
	"fal_request_id" text,
	"queue_position" integer,
	"error_code" text,
	"error_message" text,
	"attempt" integer DEFAULT 0 NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"next_poll_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"session_id" text NOT NULL,
	"kind" text NOT NULL,
	"storage_key" text NOT NULL,
	"blur_placeholder" text,
	"mime" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"duration_ms" integer,
	"bytes" integer NOT NULL,
	"checksum" text,
	"source_url" text,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job_events" ADD CONSTRAINT "job_events_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_events_job_at_idx" ON "job_events" USING btree ("job_id","at");--> statement-breakpoint
CREATE INDEX "jobs_session_created_idx" ON "jobs" USING btree ("session_id","created_at" DESC);--> statement-breakpoint
CREATE INDEX "jobs_status_next_poll_idx" ON "jobs" USING btree ("status","next_poll_at");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_session_idempotency_idx" ON "jobs" USING btree ("session_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "assets_job_idx" ON "assets" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "assets_session_ingested_idx" ON "assets" USING btree ("session_id","ingested_at");