CREATE TYPE "public"."accrual_mode" AS ENUM('annual', 'monthly');--> statement-breakpoint
CREATE TYPE "public"."day_count_mode" AS ENUM('working', 'calendar');--> statement-breakpoint
CREATE TYPE "public"."employee_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."entry_type" AS ENUM('opening', 'accrual', 'leave', 'adjustment', 'carryover', 'expiry', 'reversal');--> statement-breakpoint
CREATE TYPE "public"."half_day" AS ENUM('full', 'am', 'pm');--> statement-breakpoint
CREATE TYPE "public"."holiday_source" AS ENUM('preset', 'custom', 'closure');--> statement-breakpoint
CREATE TYPE "public"."leave_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('in_app', 'email');--> statement-breakpoint
CREATE TYPE "public"."notification_kind" AS ENUM('submitted', 'approved', 'rejected', 'withdrawn', 'changed');--> statement-breakpoint
CREATE TYPE "public"."notification_recipient" AS ENUM('operator', 'employee');--> statement-breakpoint
CREATE TYPE "public"."palette_color" AS ENUM('blue', 'rose', 'slate', 'violet', 'teal', 'orange', 'lime', 'pink');--> statement-breakpoint
CREATE TYPE "public"."request_source" AS ENUM('operator', 'portal');--> statement-breakpoint
CREATE TYPE "public"."save_status" AS ENUM('pending', 'approved');--> statement-breakpoint
CREATE TYPE "public"."team_visibility" AS ENUM('department', 'company', 'off');--> statement-breakpoint
CREATE TABLE "attachment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"leave_request_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_key" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "attachment_size_limit" CHECK ("attachment"."size_bytes" > 0 and "attachment"."size_bytes" <= 10485760)
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"action" text NOT NULL,
	"actor" text,
	"before_json" jsonb,
	"after_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"logo_storage_key" text,
	"country_code" text DEFAULT 'XX' NOT NULL,
	"work_days" smallint DEFAULT 31 NOT NULL,
	"leave_year_start_month" smallint DEFAULT 1 NOT NULL,
	"allow_negative" boolean DEFAULT false NOT NULL,
	"negative_limit_days" numeric(6, 1) DEFAULT '0' NOT NULL,
	"default_save_status" "save_status" DEFAULT 'approved' NOT NULL,
	"locale" text DEFAULT 'fr-FR' NOT NULL,
	"team_visibility" "team_visibility" DEFAULT 'department' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_settings_singleton" CHECK ("company_settings"."id" = 1),
	CONSTRAINT "company_settings_work_days_range" CHECK ("company_settings"."work_days" between 1 and 127),
	CONSTRAINT "company_settings_year_start_month" CHECK ("company_settings"."leave_year_start_month" between 1 and 12),
	CONSTRAINT "company_settings_negative_limit" CHECK ("company_settings"."negative_limit_days" >= 0)
);
--> statement-breakpoint
CREATE TABLE "department" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"min_staffing" smallint,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" text NOT NULL,
	"employee_code" text,
	"department_id" uuid NOT NULL,
	"job_title" text,
	"email" text,
	"portal_access" boolean DEFAULT false NOT NULL,
	"hire_date" date NOT NULL,
	"end_date" date,
	"work_days_override" smallint,
	"annual_allowance_override" numeric(6, 1),
	"status" "employee_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_end_after_hire" CHECK ("employee"."end_date" is null or "employee"."end_date" >= "employee"."hire_date"),
	CONSTRAINT "employee_work_days_override_range" CHECK ("employee"."work_days_override" is null or "employee"."work_days_override" between 1 and 127)
);
--> statement-breakpoint
CREATE TABLE "holiday" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"name" text NOT NULL,
	"is_half_day" boolean DEFAULT false NOT NULL,
	"is_confirmed" boolean DEFAULT true NOT NULL,
	"source" "holiday_source" DEFAULT 'preset' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_policy" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"accrual_mode" "accrual_mode" NOT NULL,
	"rate_days" numeric(6, 1) NOT NULL,
	"prorate_hire_month" boolean DEFAULT true NOT NULL,
	"carryover_cap_days" numeric(6, 1),
	"carryover_expiry_month_day" text,
	"effective_from" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_policy_expiry_format" CHECK ("leave_policy"."carryover_expiry_month_day" is null or "leave_policy"."carryover_expiry_month_day" ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$')
);
--> statement-breakpoint
CREATE TABLE "leave_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"start_half" "half_day" DEFAULT 'full' NOT NULL,
	"end_half" "half_day" DEFAULT 'full' NOT NULL,
	"working_days" numeric(6, 1) NOT NULL,
	"status" "leave_status" NOT NULL,
	"note" text,
	"reject_reason" text,
	"has_warning" boolean DEFAULT false NOT NULL,
	"conflict_result" jsonb,
	"source" "request_source" NOT NULL,
	"hr_changed_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "leave_request_end_after_start" CHECK ("leave_request"."end_date" >= "leave_request"."start_date"),
	CONSTRAINT "leave_request_working_days_step" CHECK (mod("leave_request"."working_days" * 10, 5) = 0 and "leave_request"."working_days" > 0)
);
--> statement-breakpoint
CREATE TABLE "leave_type" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"color" "palette_color" NOT NULL,
	"is_paid" boolean DEFAULT true NOT NULL,
	"deducts_balance" boolean DEFAULT true NOT NULL,
	"day_count_mode" "day_count_mode" DEFAULT 'working' NOT NULL,
	"requires_attachment" boolean DEFAULT false NOT NULL,
	"annual_cap_days" numeric(6, 1),
	"default_save_status" "save_status",
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"entry_type" "entry_type" NOT NULL,
	"days" numeric(6, 1) NOT NULL,
	"effective_date" date NOT NULL,
	"leave_request_id" uuid,
	"period_key" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entry_days_step" CHECK (mod("ledger_entry"."days" * 10, 5) = 0)
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient" "notification_recipient" NOT NULL,
	"recipient_employee_id" uuid,
	"leave_request_id" uuid,
	"kind" "notification_kind" NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"sent_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_recipient_consistency" CHECK (("notification"."recipient" = 'employee') = ("notification"."recipient_employee_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_leave_request_id_leave_request_id_fk" FOREIGN KEY ("leave_request_id") REFERENCES "public"."leave_request"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee" ADD CONSTRAINT "employee_department_id_department_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."department"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_policy" ADD CONSTRAINT "leave_policy_leave_type_id_leave_type_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_type"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_leave_type_id_leave_type_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_type"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_leave_type_id_leave_type_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_type"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_leave_request_id_leave_request_id_fk" FOREIGN KEY ("leave_request_id") REFERENCES "public"."leave_request"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_recipient_employee_id_employee_id_fk" FOREIGN KEY ("recipient_employee_id") REFERENCES "public"."employee"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_leave_request_id_leave_request_id_fk" FOREIGN KEY ("leave_request_id") REFERENCES "public"."leave_request"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attachment_storage_key_unique" ON "attachment" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "attachment_request_idx" ON "attachment" USING btree ("leave_request_id");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "department_name_unique" ON "department" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "employee_code_unique" ON "employee" USING btree ("employee_code");--> statement-breakpoint
CREATE UNIQUE INDEX "employee_email_unique" ON "employee" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "employee_department_idx" ON "employee" USING btree ("department_id");--> statement-breakpoint
CREATE UNIQUE INDEX "holiday_date_unique" ON "holiday" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX "leave_policy_type_effective_unique" ON "leave_policy" USING btree ("leave_type_id","effective_from");--> statement-breakpoint
CREATE INDEX "leave_request_employee_dates_idx" ON "leave_request" USING btree ("employee_id","start_date","end_date") WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "leave_request_status_idx" ON "leave_request" USING btree ("status") WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "leave_request_dates_idx" ON "leave_request" USING btree ("start_date","end_date") WHERE deleted_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "leave_type_code_unique" ON "leave_type" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_entry_idempotency_unique" ON "ledger_entry" USING btree ("employee_id","leave_type_id","entry_type","period_key");--> statement-breakpoint
CREATE INDEX "ledger_entry_balance_idx" ON "ledger_entry" USING btree ("employee_id","leave_type_id","effective_date");--> statement-breakpoint
CREATE INDEX "ledger_entry_request_idx" ON "ledger_entry" USING btree ("leave_request_id");--> statement-breakpoint
CREATE INDEX "notification_unread_idx" ON "notification" USING btree ("recipient","recipient_employee_id") WHERE read_at is null;