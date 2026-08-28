CREATE TABLE IF NOT EXISTS patients (
  id VARCHAR(64) PRIMARY KEY, name VARCHAR(160) NOT NULL, name_source VARCHAR(40) NOT NULL DEFAULT 'whatsapp_profile', name_verified BOOLEAN NOT NULL DEFAULT FALSE,
  phone VARCHAR(32) NOT NULL UNIQUE, email VARCHAR(255), age INT, gender VARCHAR(40), primary_concern TEXT, concern_duration VARCHAR(120), treatment_category VARCHAR(80), treatment_slug VARCHAR(100),
  lead_score INT NOT NULL DEFAULT 10, lead_temperature VARCHAR(16) NOT NULL DEFAULT 'COLD', lead_stage VARCHAR(40) NOT NULL DEFAULT 'new', source VARCHAR(80) NOT NULL DEFAULT 'whatsapp', campaign VARCHAR(160),
  ai_summary TEXT, assigned_to VARCHAR(100) DEFAULT 'AI Reception', ai_enabled BOOLEAN NOT NULL DEFAULT TRUE, whatsapp_id VARCHAR(40), whatsapp_opt_in_status VARCHAR(24) NOT NULL DEFAULT 'UNKNOWN',
  whatsapp_opt_in_date VARCHAR(40), whatsapp_opt_in_source VARCHAR(80), do_not_contact BOOLEAN NOT NULL DEFAULT FALSE, invalid_phone BOOLEAN NOT NULL DEFAULT FALSE,
  last_inbound_at VARCHAR(40), last_outbound_at VARCHAR(40), service_window_expires_at VARCHAR(40), created_at VARCHAR(40) NOT NULL, updated_at VARCHAR(40), last_contact_at VARCHAR(40), next_followup_at VARCHAR(40),
  INDEX idx_patients_score (lead_score DESC), INDEX idx_patients_whatsapp (whatsapp_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS conversations (
  id VARCHAR(64) PRIMARY KEY, patient_id VARCHAR(64) NOT NULL, channel VARCHAR(32) NOT NULL DEFAULT 'whatsapp', status VARCHAR(32) NOT NULL DEFAULT 'open', unread_count INT NOT NULL DEFAULT 0,
  ai_enabled BOOLEAN NOT NULL DEFAULT TRUE, last_message_at VARCHAR(40) NOT NULL, created_at VARCHAR(40) NOT NULL,
  CONSTRAINT fk_conversations_patient FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
  INDEX idx_conversations_last_message (last_message_at DESC), INDEX idx_conversations_patient (patient_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS conversation_state (
  conversation_id VARCHAR(64) PRIMARY KEY, preferred_language VARCHAR(16) NOT NULL DEFAULT 'AUTO', active_flow VARCHAR(80), pending_question TEXT, pending_action VARCHAR(120), last_assistant_question TEXT,
  requested_date VARCHAR(20), requested_time VARCHAR(20), requested_day_part VARCHAR(20), offered_slots_json LONGTEXT NOT NULL, selected_slot VARCHAR(20), appointment_id VARCHAR(64),
  current_concern TEXT, current_treatment VARCHAR(100), previous_treatment BOOLEAN NOT NULL DEFAULT FALSE, rolling_summary TEXT, sent_content_ids_json LONGTEXT NOT NULL,
  last_content_sent_at VARCHAR(40), ai_mode VARCHAR(24) NOT NULL DEFAULT 'AI', human_lock_until VARCHAR(40), created_at VARCHAR(40) NOT NULL, updated_at VARCHAR(40) NOT NULL,
  CONSTRAINT fk_conversation_state_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS treatments (
  id VARCHAR(64) PRIMARY KEY, name VARCHAR(160) NOT NULL, slug VARCHAR(100) NOT NULL UNIQUE, category VARCHAR(80) NOT NULL, description TEXT NOT NULL,
  approved_response_guidance TEXT NOT NULL, booking_enabled BOOLEAN NOT NULL DEFAULT TRUE, created_at VARCHAR(40) NOT NULL, updated_at VARCHAR(40)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS content_items (
  id VARCHAR(64) PRIMARY KEY, type VARCHAR(32) NOT NULL, title VARCHAR(255) NOT NULL, description TEXT NOT NULL, url TEXT NOT NULL, thumbnail_url TEXT, treatment_slug VARCHAR(100),
  tags_json LONGTEXT NOT NULL, when_to_send TEXT NOT NULL, priority INT NOT NULL DEFAULT 1, active BOOLEAN NOT NULL DEFAULT TRUE, approved_for_ai BOOLEAN NOT NULL DEFAULT TRUE,
  approved_for_production BOOLEAN NOT NULL DEFAULT FALSE, created_at VARCHAR(40) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS messages (
  id VARCHAR(64) PRIMARY KEY, conversation_id VARCHAR(64) NOT NULL, patient_id VARCHAR(64) NOT NULL, direction VARCHAR(16) NOT NULL, sender_type VARCHAR(32) NOT NULL,
  message_type VARCHAR(32) NOT NULL DEFAULT 'text', content TEXT NOT NULL, media_url TEXT, content_item_id VARCHAR(64), delivery_status VARCHAR(32) NOT NULL DEFAULT 'delivered',
  metadata_json LONGTEXT, external_message_id VARCHAR(255), created_at VARCHAR(40) NOT NULL,
  CONSTRAINT fk_messages_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  CONSTRAINT fk_messages_patient FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
  UNIQUE KEY idx_messages_external_id (external_message_id), INDEX idx_messages_conversation_created (conversation_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS appointments (
  id VARCHAR(64) PRIMARY KEY, patient_id VARCHAR(64) NOT NULL, conversation_id VARCHAR(64) NOT NULL, treatment_slug VARCHAR(100), date_time VARCHAR(40) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'confirmed', confirmed_slot VARCHAR(40) GENERATED ALWAYS AS (CASE WHEN status='confirmed' THEN date_time ELSE NULL END) STORED,
  notes TEXT, created_at VARCHAR(40) NOT NULL, updated_at VARCHAR(40),
  CONSTRAINT fk_appointments_patient FOREIGN KEY (patient_id) REFERENCES patients(id), CONSTRAINT fk_appointments_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id),
  UNIQUE KEY idx_appointments_confirmed_slot (confirmed_slot)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS scheduled_jobs (
  id VARCHAR(64) PRIMARY KEY, patient_id VARCHAR(64) NOT NULL, conversation_id VARCHAR(64) NOT NULL, appointment_id VARCHAR(64), job_type VARCHAR(80) NOT NULL,
  scheduled_for VARCHAR(40) NOT NULL, status VARCHAR(32) NOT NULL DEFAULT 'pending', payload_json LONGTEXT NOT NULL, created_at VARCHAR(40) NOT NULL, executed_at VARCHAR(40), error TEXT,
  CONSTRAINT fk_jobs_patient FOREIGN KEY (patient_id) REFERENCES patients(id), CONSTRAINT fk_jobs_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id),
  CONSTRAINT fk_jobs_appointment FOREIGN KEY (appointment_id) REFERENCES appointments(id), INDEX idx_jobs_due (status, scheduled_for)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_events (
  id VARCHAR(64) PRIMARY KEY, patient_id VARCHAR(64) NOT NULL, conversation_id VARCHAR(64), event_type VARCHAR(80) NOT NULL, title VARCHAR(255) NOT NULL,
  details TEXT, metadata_json LONGTEXT NOT NULL, created_at VARCHAR(40) NOT NULL,
  CONSTRAINT fk_events_patient FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
  CONSTRAINT fk_events_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE, INDEX idx_events_conversation_created (conversation_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS settings (`key` VARCHAR(160) PRIMARY KEY, value LONGTEXT NOT NULL, updated_at VARCHAR(40) NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS available_slots (id VARCHAR(80) PRIMARY KEY, `date` VARCHAR(20) NOT NULL, `time` VARCHAR(20) NOT NULL, active BOOLEAN NOT NULL DEFAULT TRUE, UNIQUE KEY idx_slot (`date`, `time`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS human_tasks (
  id VARCHAR(64) PRIMARY KEY, patient_id VARCHAR(64) NOT NULL, conversation_id VARCHAR(64), type VARCHAR(32) NOT NULL, priority VARCHAR(16) NOT NULL DEFAULT 'NORMAL', status VARCHAR(24) NOT NULL DEFAULT 'OPEN',
  title VARCHAR(255) NOT NULL, reason TEXT, suggested_reply TEXT, assigned_to VARCHAR(100), due_at VARCHAR(40), resolved_at VARCHAR(40), resolved_by VARCHAR(100), resolution TEXT, created_at VARCHAR(40) NOT NULL, updated_at VARCHAR(40) NOT NULL,
  CONSTRAINT fk_tasks_patient FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE, CONSTRAINT fk_tasks_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  INDEX idx_human_tasks_status_priority (status, priority, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS lead_score_events (
  id VARCHAR(64) PRIMARY KEY, patient_id VARCHAR(64) NOT NULL, conversation_id VARCHAR(64), previous_score INT NOT NULL, new_score INT NOT NULL, reason_codes_json LONGTEXT NOT NULL, created_at VARCHAR(40) NOT NULL,
  CONSTRAINT fk_score_patient FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE, CONSTRAINT fk_score_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  INDEX idx_score_events_patient_created (patient_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_logs (id VARCHAR(64) PRIMARY KEY, actor VARCHAR(32) NOT NULL, action VARCHAR(100) NOT NULL, entity_type VARCHAR(100) NOT NULL, entity_id VARCHAR(100), summary TEXT NOT NULL, metadata_json LONGTEXT NOT NULL, created_at VARCHAR(40) NOT NULL, INDEX idx_audit_entity_created (entity_type, entity_id, created_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS provider_usage (id VARCHAR(64) PRIMARY KEY, patient_id VARCHAR(64), conversation_id VARCHAR(64), provider VARCHAR(40) NOT NULL, model VARCHAR(100) NOT NULL, operation VARCHAR(80) NOT NULL, status VARCHAR(32) NOT NULL, latency_ms INT NOT NULL DEFAULT 0, input_tokens INT, output_tokens INT, estimated_cost_usd VARCHAR(40), error_code VARCHAR(100), created_at VARCHAR(40) NOT NULL, INDEX idx_provider_usage_created (created_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS lead_imports (id VARCHAR(64) PRIMARY KEY, file_name VARCHAR(255) NOT NULL, status VARCHAR(32) NOT NULL, total_rows INT NOT NULL DEFAULT 0, imported_rows INT NOT NULL DEFAULT 0, skipped_rows INT NOT NULL DEFAULT 0, error_rows INT NOT NULL DEFAULT 0, errors_json LONGTEXT NOT NULL, created_at VARCHAR(40) NOT NULL, completed_at VARCHAR(40)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS message_templates (
  id VARCHAR(64) PRIMARY KEY, name VARCHAR(160) NOT NULL UNIQUE, display_name VARCHAR(200), category VARCHAR(40) NOT NULL DEFAULT 'MARKETING', language VARCHAR(20) NOT NULL DEFAULT 'en', body TEXT NOT NULL,
  meta_template_name VARCHAR(160), status VARCHAR(32) NOT NULL DEFAULT 'DRAFT', variables_json LONGTEXT NOT NULL, purpose TEXT, treatment_slug VARCHAR(100), active BOOLEAN NOT NULL DEFAULT TRUE,
  last_synced_at VARCHAR(40), created_at VARCHAR(40) NOT NULL, updated_at VARCHAR(40) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS campaigns (
  id VARCHAR(64) PRIMARY KEY, name VARCHAR(200) NOT NULL, template_id VARCHAR(64) NOT NULL, status VARCHAR(32) NOT NULL DEFAULT 'DRAFT', audience_json LONGTEXT NOT NULL,
  segment VARCHAR(80) NOT NULL DEFAULT 'eligible_all', scheduled_for VARCHAR(40), rate_per_minute INT NOT NULL DEFAULT 10, created_by VARCHAR(100) NOT NULL DEFAULT 'Front Desk',
  created_at VARCHAR(40) NOT NULL, updated_at VARCHAR(40) NOT NULL, started_at VARCHAR(40), completed_at VARCHAR(40),
  CONSTRAINT fk_campaign_template FOREIGN KEY (template_id) REFERENCES message_templates(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS outbound_messages (
  id VARCHAR(64) PRIMARY KEY, campaign_id VARCHAR(64), patient_id VARCHAR(64) NOT NULL, conversation_id VARCHAR(64), template_id VARCHAR(64), channel VARCHAR(32) NOT NULL DEFAULT 'whatsapp',
  rendered_body TEXT NOT NULL, payload_json LONGTEXT NOT NULL, status VARCHAR(32) NOT NULL DEFAULT 'QUEUED', external_message_id VARCHAR(255), meta_message_id VARCHAR(255), scheduled_for VARCHAR(40) NOT NULL,
  sent_at VARCHAR(40), delivered_at VARCHAR(40), read_at VARCHAR(40), replied_at VARCHAR(40), failed_at VARCHAR(40), failure_code VARCHAR(80), failure_message TEXT, error TEXT, created_at VARCHAR(40) NOT NULL,
  CONSTRAINT fk_outbound_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE SET NULL, CONSTRAINT fk_outbound_patient FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
  CONSTRAINT fk_outbound_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL, CONSTRAINT fk_outbound_template FOREIGN KEY (template_id) REFERENCES message_templates(id) ON DELETE SET NULL,
  UNIQUE KEY idx_outbound_campaign_patient (campaign_id, patient_id), INDEX idx_outbound_due (status, scheduled_for), INDEX idx_outbound_external (external_message_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS webhook_events (
  id VARCHAR(64) PRIMARY KEY, external_id VARCHAR(255) NOT NULL UNIQUE, event_type VARCHAR(80) NOT NULL, payload_hash CHAR(64) NOT NULL, status VARCHAR(32) NOT NULL,
  attempt_count INT NOT NULL DEFAULT 1, error TEXT, created_at VARCHAR(40) NOT NULL, processed_at VARCHAR(40)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
