CREATE TABLE IF NOT EXISTS treatment_categories (
  id VARCHAR(64) PRIMARY KEY, name VARCHAR(160) NOT NULL, slug VARCHAR(100) NOT NULL UNIQUE, description TEXT,
  status VARCHAR(24) NOT NULL DEFAULT 'APPROVED', active BOOLEAN NOT NULL DEFAULT TRUE, sort_order INT NOT NULL DEFAULT 0,
  created_at VARCHAR(40) NOT NULL, updated_at VARCHAR(40)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS concerns (
  id VARCHAR(64) PRIMARY KEY, category_id VARCHAR(64) NOT NULL, name VARCHAR(160) NOT NULL, slug VARCHAR(100) NOT NULL UNIQUE,
  description TEXT, treatment_slugs_json LONGTEXT NOT NULL, approved_explanation TEXT, benefits_json LONGTEXT NOT NULL,
  conversation_options_json LONGTEXT NOT NULL, status VARCHAR(24) NOT NULL DEFAULT 'NEEDS_REVIEW', active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT NOT NULL DEFAULT 0, created_at VARCHAR(40) NOT NULL, updated_at VARCHAR(40),
  CONSTRAINT fk_concerns_category FOREIGN KEY (category_id) REFERENCES treatment_categories(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS treatment_prices (
  id VARCHAR(64) PRIMARY KEY, treatment_id VARCHAR(100) NOT NULL, concern_id VARCHAR(64), pricing_type VARCHAR(32) NOT NULL,
  min_price INT, max_price INT, unit VARCHAR(40), currency VARCHAR(8) NOT NULL DEFAULT 'INR', display_text VARCHAR(255) NOT NULL,
  pricing_note TEXT, requires_assessment BOOLEAN NOT NULL DEFAULT TRUE, approved_for_patient_display BOOLEAN NOT NULL DEFAULT FALSE,
  source VARCHAR(100) NOT NULL, approval_status VARCHAR(24) NOT NULL DEFAULT 'NEEDS_REVIEW', active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at VARCHAR(40) NOT NULL, updated_at VARCHAR(40), INDEX idx_prices_treatment_status (treatment_id, approval_status, active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS knowledge_items (
  id VARCHAR(64) PRIMARY KEY, title VARCHAR(255) NOT NULL, item_type VARCHAR(40) NOT NULL, treatment_id VARCHAR(100), concern_id VARCHAR(64),
  content TEXT NOT NULL, source VARCHAR(100) NOT NULL, approval_status VARCHAR(24) NOT NULL DEFAULT 'DRAFT', approved_by VARCHAR(100),
  approved_at VARCHAR(40), active BOOLEAN NOT NULL DEFAULT TRUE, created_at VARCHAR(40) NOT NULL, updated_at VARCHAR(40)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS authorized_staff_contacts (
  id VARCHAR(64) PRIMARY KEY, name VARCHAR(160) NOT NULL, phone VARCHAR(32) NOT NULL UNIQUE, role VARCHAR(24) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE, can_view_summaries BOOLEAN NOT NULL DEFAULT FALSE, can_view_appointments BOOLEAN NOT NULL DEFAULT FALSE,
  can_receive_doctor_review BOOLEAN NOT NULL DEFAULT FALSE, can_approve_knowledge BOOLEAN NOT NULL DEFAULT FALSE,
  can_receive_alerts BOOLEAN NOT NULL DEFAULT FALSE, created_at VARCHAR(40) NOT NULL, updated_at VARCHAR(40),
  INDEX idx_staff_phone_active (phone, active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS doctor_reviews (
  id VARCHAR(64) PRIMARY KEY, patient_id VARCHAR(64) NOT NULL, conversation_id VARCHAR(64), question_summary TEXT NOT NULL,
  priority VARCHAR(16) NOT NULL DEFAULT 'NORMAL', status VARCHAR(24) NOT NULL DEFAULT 'OPEN', doctor_response TEXT, patient_reply TEXT,
  save_as_guidance BOOLEAN NOT NULL DEFAULT FALSE, resolved_at VARCHAR(40), created_at VARCHAR(40) NOT NULL, updated_at VARCHAR(40),
  CONSTRAINT fk_doctor_reviews_patient FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
  CONSTRAINT fk_doctor_reviews_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  INDEX idx_doctor_reviews_status (status, priority, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_feedback (
  id VARCHAR(64) PRIMARY KEY, message_id VARCHAR(64) NOT NULL, patient_id VARCHAR(64) NOT NULL, rating VARCHAR(16) NOT NULL,
  reason VARCHAR(40), notes TEXT, created_by VARCHAR(100) NOT NULL DEFAULT 'Front Desk', created_at VARCHAR(40) NOT NULL,
  CONSTRAINT fk_ai_feedback_message FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  CONSTRAINT fk_ai_feedback_patient FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
