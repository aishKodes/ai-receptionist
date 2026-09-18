import dotenv from "dotenv";
import mysql from "mysql2/promise";

dotenv.config({ path: ".env.local", override: false, quiet: true });
dotenv.config({ path: ".env", override: false, quiet: true });

const fail = (message: string): never => { throw new Error(`[PRODUCTION DB CHECK] ${message}`); };
if (process.env.DATABASE_PROVIDER !== "mysql") fail("DATABASE_PROVIDER=mysql is required.");
if (!process.env.DATABASE_URL) fail("DATABASE_URL is required.");

const connection = await mysql.createConnection({
  uri: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "false" ? undefined : { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false" },
});

const requiredTables = ["patients", "conversations", "conversation_state", "messages", "appointments", "available_slots", "scheduled_jobs", "settings", "message_templates", "outbound_messages", "webhook_events", "marketing_daily_quota", "marketing_patient_cooldown"];
const requiredColumns: Record<string, string[]> = {
  patients: ["id", "phone", "whatsapp_id", "do_not_contact", "service_window_expires_at"],
  conversation_state: ["conversation_id", "booking_declined_for_now", "conversation_phase", "readiness_score", "conversion_memory_json"],
  messages: ["external_message_id", "delivery_status"],
  appointments: ["date_time", "status", "confirmed_slot"],
  available_slots: ["date", "time", "active"],
  provider_usage: ["fallback_reason"],
};
const requiredIndexes: Record<string, string[]> = {
  patients: ["idx_patients_score", "idx_patients_whatsapp"],
  messages: ["idx_messages_external_id", "idx_messages_conversation_created"],
  appointments: ["idx_appointments_confirmed_slot"],
  scheduled_jobs: ["idx_jobs_due"],
  outbound_messages: ["idx_outbound_due", "idx_outbound_campaign_patient"],
};

try {
  const [databaseRows] = await connection.query("SELECT DATABASE() AS name, @@session.time_zone AS sessionTimezone, @@global.time_zone AS globalTimezone");
  const database = String((databaseRows as Array<{ name?: string }>)[0]?.name || "");
  if (!database) fail("Connected without selecting a MySQL database.");

  const [tables] = await connection.query("SELECT TABLE_NAME AS name, ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()");
  const tableMap = new Map((tables as Array<{ name: string; engine: string }>).map((row) => [row.name, row.engine]));
  for (const table of requiredTables) {
    if (!tableMap.has(table)) fail(`Missing table: ${table}. Run npm run db:mysql:migrate against this new CRM database.`);
    if (String(tableMap.get(table)).toUpperCase() !== "INNODB") fail(`Table ${table} must use InnoDB.`);
  }

  for (const [table, columns] of Object.entries(requiredColumns)) {
    const [rows] = await connection.execute("SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?", [table]);
    const present = new Set((rows as Array<{ name: string }>).map((row) => row.name));
    for (const column of columns) if (!present.has(column)) fail(`Missing column: ${table}.${column}. Run npm run db:mysql:migrate.`);
  }
  for (const [table, indexes] of Object.entries(requiredIndexes)) {
    const [rows] = await connection.execute("SELECT DISTINCT INDEX_NAME AS name FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?", [table]);
    const present = new Set((rows as Array<{ name: string }>).map((row) => row.name));
    for (const index of indexes) if (!present.has(index)) fail(`Missing index: ${table}.${index}.`);
  }

  await connection.beginTransaction();
  try {
    await connection.query("CREATE TEMPORARY TABLE radiance_write_check (value_id INT PRIMARY KEY)");
    await connection.query("INSERT INTO radiance_write_check (value_id) VALUES (1)");
    await connection.query("SELECT value_id FROM radiance_write_check");
    await connection.rollback();
  } catch (error) { await connection.rollback(); throw error; }

  const [fixtureRows] = await connection.query(`SELECT
    (SELECT COUNT(*) FROM patients WHERE source IN ('demo','local_demo','mock_meta','test','test_fixture') OR name LIKE '%Demo%' OR name='Radiance Live Test') AS patients,
    (SELECT COUNT(*) FROM campaigns WHERE name LIKE '%simulation%' OR name LIKE '%demo%') AS campaigns,
    (SELECT COUNT(*) FROM appointments WHERE notes LIKE '%fixture%' OR notes LIKE '%test%') AS appointments`);
  const fixtures = (fixtureRows as Array<{ patients: number; campaigns: number; appointments: number }>)[0];
  if (Number(fixtures.patients) || Number(fixtures.campaigns) || Number(fixtures.appointments)) fail("Test or demo records were found. Production must use a new, clean CRM database.");

  const timezones = (databaseRows as Array<{ sessionTimezone?: string; globalTimezone?: string }>)[0];
  console.log(`[PRODUCTION DB CHECK] OK database=${database} session_timezone=${timezones.sessionTimezone || "unknown"} global_timezone=${timezones.globalTimezone || "unknown"} writable=yes fixtures=none`);
} finally {
  await connection.end();
}
