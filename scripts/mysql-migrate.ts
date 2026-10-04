import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import knowledge from "@/data/radiance-knowledge.json";
import {
  concernDefaults,
  treatmentCategoryDefaults,
  treatmentPriceDefaults,
} from "@/lib/product/defaults";

dotenv.config({ path: ".env.local", override: false, quiet: true });
dotenv.config({ path: ".env", override: false, quiet: true });

if (process.env.DATABASE_PROVIDER !== "mysql")
  throw new Error(
    "Set DATABASE_PROVIDER=mysql before running production migrations.",
  );
if (!process.env.DATABASE_URL)
  throw new Error("DATABASE_URL is required for MySQL migrations.");

const connection = await mysql.createConnection({
  uri: process.env.DATABASE_URL,
  multipleStatements: true,
  ssl:
    process.env.DATABASE_SSL === "false"
      ? undefined
      : {
          rejectUnauthorized:
            process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false",
        },
});
try {
  const migrationDirectory = path.join(process.cwd(), "migrations/mysql");
  for (const file of fs
    .readdirSync(migrationDirectory)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    await connection.query(
      fs.readFileSync(path.join(migrationDirectory, file), "utf8"),
    );
  }
  const additive: Array<[string, string, string]> = [
    ["treatments", "benefits_json", "LONGTEXT"],
    ["treatments", "conversation_options_json", "LONGTEXT"],
    [
      "treatments",
      "approval_status",
      "VARCHAR(24) NOT NULL DEFAULT 'APPROVED'",
    ],
    ["treatments", "active", "BOOLEAN NOT NULL DEFAULT TRUE"],
    [
      "content_items",
      "approval_status",
      "VARCHAR(24) NOT NULL DEFAULT 'NEEDS_REVIEW'",
    ],
    ["patients", "context_notes", "TEXT"],
    ["patients", "previous_interaction", "TEXT"],
    ["patients", "internal_notes", "TEXT"],
    ["patients", "lead_priority", "VARCHAR(16) NOT NULL DEFAULT 'NORMAL'"],
    ["patients", "preferred_language", "VARCHAR(16) NOT NULL DEFAULT 'AUTO'"],
    ["patients", "callback_at", "VARCHAR(40)"],
    ["patients", "contact_lifecycle", "VARCHAR(24) NOT NULL DEFAULT 'LEAD'"],
    ["patients", "lost_reason", "VARCHAR(40)"],
    ["patients", "reactivation_score", "INT NOT NULL DEFAULT 0"],
    ["patients", "reactivation_reasons_json", "LONGTEXT"],
    ["patients", "reactivation_action", "VARCHAR(24) NOT NULL DEFAULT 'WAIT'"],
    [
      "conversation_state",
      "conversation_phase",
      "VARCHAR(40) NOT NULL DEFAULT 'DISCOVERY'",
    ],
    ["conversation_state", "readiness_score", "INT NOT NULL DEFAULT 0"],
    ["conversation_state", "readiness_reason", "TEXT"],
    ["conversation_state", "primary_objection", "VARCHAR(40)"],
    [
      "conversation_state",
      "next_best_action",
      "VARCHAR(40) NOT NULL DEFAULT 'ANSWER'",
    ],
    ["conversation_state", "next_action_reason", "TEXT"],
    [
      "conversation_state",
      "booking_declined_for_now",
      "BOOLEAN NOT NULL DEFAULT FALSE",
    ],
    ["conversation_state", "conversion_memory_json", "LONGTEXT"],
    [
      "conversation_state",
      "interaction_type",
      "VARCHAR(24) NOT NULL DEFAULT 'NONE'",
    ],
    ["conversation_state", "interaction_options_json", "LONGTEXT"],
    ["conversation_state", "last_option_selected", "VARCHAR(160)"],
    ["provider_usage", "fallback_reason", "VARCHAR(120)"],
  ];
  for (const [table, column, definition] of additive) {
    const [rows] = await connection.execute(
      "SELECT COUNT(*) AS total FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?",
      [table, column],
    );
    if (Number((rows as Array<{ total: number }>)[0].total) === 0)
      await connection.query(
        `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`,
      );
  }
  await connection.query(
    "CREATE TABLE IF NOT EXISTS marketing_daily_quota (day VARCHAR(10) PRIMARY KEY, used INT NOT NULL DEFAULT 0) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
  );
  await connection.query(
    "CREATE TABLE IF NOT EXISTS marketing_patient_cooldown (patient_id VARCHAR(64) PRIMARY KEY, reserved_until VARCHAR(40) NOT NULL, CONSTRAINT fk_marketing_cooldown_patient FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
  );
  const now = new Date().toISOString();
  for (const item of treatmentCategoryDefaults) {
    await connection.execute(
      "INSERT INTO treatment_categories (id,name,slug,description,status,active,sort_order,created_at,updated_at) VALUES (?,?,?,?,\'APPROVED\',1,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name),description=VALUES(description),sort_order=VALUES(sort_order)",
      [
        item.id,
        item.name,
        item.slug,
        item.description,
        item.sortOrder,
        now,
        now,
      ],
    );
  }
  for (let index = 0; index < concernDefaults.length; index += 1) {
    const item = concernDefaults[index];
    await connection.execute(
      "INSERT INTO concerns (id,category_id,name,slug,description,treatment_slugs_json,approved_explanation,benefits_json,conversation_options_json,status,active,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,\'[]\',?,\'APPROVED\',1,?,?,?) ON DUPLICATE KEY UPDATE category_id=VALUES(category_id),name=VALUES(name),treatment_slugs_json=VALUES(treatment_slugs_json),conversation_options_json=VALUES(conversation_options_json)",
      [
        item[0],
        item[1],
        item[2],
        item[3],
        `${item[2]} enquiry`,
        JSON.stringify(item[4]),
        `Radiance can explain ${String(item[2]).toLowerCase()} generally; suitability requires doctor assessment.`,
        JSON.stringify(["Estimated cost", "How it works", "Book consultation"]),
        (index + 1) * 10,
        now,
        now,
      ],
    );
  }
  for (const item of treatmentPriceDefaults) {
    await connection.execute(
      "INSERT INTO treatment_prices (id,treatment_id,concern_id,pricing_type,min_price,max_price,unit,currency,display_text,pricing_note,requires_assessment,approved_for_patient_display,source,approval_status,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,\'INR\',?,?,?,?,\'CURRENT_DOCTOR_SUPPLIED\',?,1,?,?) ON DUPLICATE KEY UPDATE concern_id=VALUES(concern_id),pricing_type=VALUES(pricing_type),min_price=VALUES(min_price),max_price=VALUES(max_price),unit=VALUES(unit),display_text=VALUES(display_text),pricing_note=VALUES(pricing_note),requires_assessment=VALUES(requires_assessment),approved_for_patient_display=VALUES(approved_for_patient_display),approval_status=VALUES(approval_status),active=1",
      [
        item.id,
        item.treatmentId,
        item.concernId ?? null,
        item.pricingType,
        item.minPrice ?? null,
        item.maxPrice ?? null,
        item.unit ?? null,
        item.displayText,
        item.pricingNote ?? null,
        Number(item.requiresAssessment !== false),
        Number(Boolean(item.approved)),
        item.approvalStatus || "NEEDS_REVIEW",
        now,
        now,
      ],
    );
  }
  for (const item of knowledge.treatments) {
    await connection.execute(
      `INSERT INTO treatments (id,name,slug,category,description,approved_response_guidance,booking_enabled,created_at,updated_at)
      VALUES (?,?,?,?,?,?,1,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name),category=VALUES(category),description=VALUES(description),approved_response_guidance=VALUES(approved_response_guidance),updated_at=VALUES(updated_at)`,
      [
        `tr_${item.slug}`,
        item.name,
        item.slug,
        item.category,
        item.description,
        knowledge.clinic.safety,
        now,
        now,
      ],
    );
  }
  const settings: Record<string, string> = {
    clinicName: "Radiance Clinics",
    clinicLocation: "Bhubaneswar",
    timezone: "Asia/Kolkata",
    humanCallScoreThreshold: "85",
    humanLockMinutes: process.env.HUMAN_LOCK_MINUTES || "30",
    autoMarketingDailyLimit: process.env.AUTO_MARKETING_DAILY_LIMIT || "10",
    marketingOutreachCooldownDays:
      process.env.MARKETING_OUTREACH_COOLDOWN_DAYS || "7",
    appointmentConfirmation: "true",
    appointmentReminder1: "true",
    appointmentReminder2: "true",
    noShowRecovery: "true",
    dormantLeadFollowup: "true",
    appointmentScheduleJson: JSON.stringify({
      weekly: {
        sunday: [
          { start: "10:00", end: "13:30" },
          { start: "15:30", end: "19:30" },
        ],
        monday: [
          { start: "10:00", end: "13:30" },
          { start: "15:30", end: "19:30" },
        ],
        tuesday: [
          { start: "10:00", end: "13:30" },
          { start: "15:30", end: "19:30" },
        ],
        wednesday: [
          { start: "10:00", end: "13:30" },
          { start: "15:30", end: "19:30" },
        ],
        thursday: [
          { start: "10:00", end: "13:30" },
          { start: "15:30", end: "19:30" },
        ],
        friday: [
          { start: "10:00", end: "13:30" },
          { start: "15:30", end: "19:30" },
        ],
        saturday: [],
      },
      slotMinutes: 30,
      bookingLeadMinutes: 30,
      maxAdvanceDays: 30,
      closedDates: [],
      blockedSlots: [],
    }),
  };
  for (const [key, value] of Object.entries(settings)) {
    await connection.execute(
      "INSERT IGNORE INTO settings (`key`,value,updated_at) VALUES (?,?,?)",
      [key, value, now],
    );
  }
  const [futureSlotRows] = await connection.execute(
    "SELECT COUNT(*) AS total FROM available_slots WHERE `date`>=DATE_FORMAT(CONVERT_TZ(UTC_TIMESTAMP(),'+00:00','+05:30'),'%Y-%m-%d')",
  );
  if (
    Number((futureSlotRows as Array<{ total: number }>)[0]?.total || 0) === 0
  ) {
    const slotTimes = [
      "10:00",
      "10:30",
      "11:00",
      "11:30",
      "12:00",
      "12:30",
      "13:00",
      "15:30",
      "16:00",
      "16:30",
      "17:00",
      "17:30",
      "18:00",
      "18:30",
      "19:00",
    ];
    const istDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    for (let offset = 0; offset <= 30; offset += 1) {
      const date = istDate.format(new Date(Date.now() + offset * 86400000));
      if (new Date(`${date}T12:00:00+05:30`).getUTCDay() === 6) continue;
      for (const time of slotTimes) {
        await connection.execute(
          "INSERT IGNORE INTO available_slots (id,`date`,`time`,active) VALUES (?,?,?,1)",
          [`slot_${date}_${time.replace(":", "")}`, date, time],
        );
      }
    }
  }
  const content = [
    [
      "content_radiance_youtube_channel",
      "youtube",
      "Radiance Clinics YouTube channel",
      "Doctor-reviewed educational videos from Radiance Skin & Hair Clinics.",
      "https://www.youtube.com/@RadianceClinics",
      null,
      JSON.stringify(["radiance", "doctor reviewed", "education"]),
      "Only when a patient explicitly asks for clinic videos or educational resources",
      10,
    ],
    [
      "content_hair_transplant_guide",
      "youtube",
      "Hair transplant guide",
      "A doctor-reviewed guide to understanding hair-transplant consultation and treatment planning.",
      "https://youtu.be/8qYMw935MF8",
      "hair_transplant",
      JSON.stringify(["hair transplant", "guide", "consultation"]),
      "Only when a patient explicitly asks for a hair-transplant guide",
      20,
    ],
  ] as const;
  for (const item of content) {
    await connection.execute(
      `INSERT INTO content_items (id,type,title,description,url,treatment_slug,tags_json,when_to_send,priority,active,approved_for_ai,approved_for_production,approval_status,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,1,1,1,'APPROVED',?) ON DUPLICATE KEY UPDATE title=VALUES(title),description=VALUES(description),url=VALUES(url),treatment_slug=VALUES(treatment_slug),tags_json=VALUES(tags_json),when_to_send=VALUES(when_to_send),priority=VALUES(priority),active=1,approved_for_ai=1,approved_for_production=1,approval_status='APPROVED'`,
      [...item, now],
    );
  }
  console.log(
    `[MYSQL] Production schema and approved knowledge completed (${knowledge.treatments.length} treatments, ${content.length} approved content items, no appointment slots until the clinic schedule is configured).`,
  );
} finally {
  await connection.end();
}
