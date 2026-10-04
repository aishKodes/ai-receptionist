"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  Bot,
  CalendarCheck2,
  Check,
  PhoneCall,
  Plus,
  Save,
  Search,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell, PageLoader } from "@/components/app-shell";
import { StatusBadge, titleCase } from "@/components/shared";
import { useRadianceState } from "@/components/use-radiance-state";

async function requestJson(url: string, body: Record<string, unknown>) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Action failed");
  return result;
}

function ProductMetric({
  label,
  value,
  icon,
}: {
  label: string;
  value: number | string;
  icon: React.ReactNode;
}) {
  return (
    <div className="metric-card">
      <div className="metric-icon">{icon}</div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

export function TodayPage() {
  const { data } = useRadianceState();
  if (!data)
    return (
      <AppShell title="Today">
        <PageLoader />
      </AppShell>
    );
  const remaining = Math.max(
    0,
    Number(data.settings.autoMarketingDailyLimit || 10) -
      Number(data.analytics.marketingUsed || 0),
  );
  const newToday = data.patients.filter(
    (patient) =>
      patient.createdAt.slice(0, 10) === data.serverTime.slice(0, 10),
  ).length;
  return (
    <AppShell
      eyebrow="Radiance operating system"
      title="Today"
      action={
        <Link className="primary-button" href="/leads/new">
          <Plus size={16} />
          New lead
        </Link>
      }
    >
      <div className="page-content">
        <div className="metric-row">
          <ProductMetric
            label="New enquiries"
            value={newToday}
            icon={<Users />}
          />
          <ProductMetric
            label="Hot leads"
            value={data.analytics.hot}
            icon={<Sparkles />}
          />
          <ProductMetric
            label="Consultations booked"
            value={data.analytics.booked}
            icon={<CalendarCheck2 />}
          />
          <ProductMetric
            label="Calls due"
            value={
              data.humanTasks.filter(
                (task) => task.status === "OPEN" && task.type === "CALL",
              ).length
            }
            icon={<PhoneCall />}
          />
          <ProductMetric
            label="Callbacks due"
            value={data.analytics.callbacksDue}
            icon={<PhoneCall />}
          />
          <ProductMetric
            label="Doctor reviews"
            value={data.analytics.doctorReviewsOpen}
            icon={<ShieldCheck />}
          />
        </div>
        <div className="today-grid">
          <section className="surface ops-hero">
            <span className="eyebrow">CONVERSION PRIORITY</span>
            <h2>One clear action for every active lead</h2>
            <p>
              Lead score measures commercial quality. Readiness controls when
              Ananya should offer a consultation. Human calls remain a
              first-class action for valuable stalled enquiries.
            </p>
            <div className="ops-actions">
              <Link className="primary-button" href="/attention">
                Open attention queue <ArrowRight size={15} />
              </Link>
              <Link className="secondary-button" href="/ask-radiance">
                Ask Radiance
              </Link>
            </div>
          </section>
          <section className="surface today-list">
            <div className="section-head">
              <div>
                <h2>Capacity</h2>
                <p>Current operational limits and queues.</p>
              </div>
            </div>
            <div className="state-row">
              <span>Automated outreach remaining</span>
              <strong>
                {remaining} /{" "}
                {Number(data.settings.autoMarketingDailyLimit || 10)}
              </strong>
            </div>
            <div className="state-row">
              <span>Manual opportunities</span>
              <strong>{data.analytics.manualOpportunities}</strong>
            </div>
            <div className="state-row">
              <span>Callbacks due</span>
              <strong>{data.analytics.callbacksDue}</strong>
            </div>
            <div className="state-row">
              <span>Doctor review</span>
              <strong>{data.analytics.doctorReviewsOpen}</strong>
            </div>
          </section>
        </div>
        <section className="surface table-surface">
          <div className="section-head padded">
            <div>
              <h2>Highest-value open leads</h2>
              <p>Database-ranked; no model-generated statistics.</p>
            </div>
          </div>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Lead</th>
                  <th>Treatment</th>
                  <th>Lead score</th>
                  <th>Readiness</th>
                  <th>Reactivation</th>
                  <th>Next action</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {[...data.patients]
                  .filter(
                    (p) =>
                      !["booked", "lost", "not_interested"].includes(
                        p.leadStage,
                      ),
                  )
                  .sort((a, b) => b.leadScore - a.leadScore)
                  .slice(0, 8)
                  .map((patient) => (
                    <tr key={patient.id}>
                      <td>
                        <strong>{patient.name}</strong>
                      </td>
                      <td>{titleCase(patient.treatmentSlug)}</td>
                      <td>{patient.leadScore}</td>
                      <td>{patient.readinessScore || 0}</td>
                      <td>{patient.reactivationScore || 0}</td>
                      <td>
                        <StatusBadge
                          value={patient.nextBestAction || "ANSWER"}
                        />
                      </td>
                      <td>
                        <Link
                          className="row-action"
                          href={`/leads/${patient.id}`}
                        >
                          <ArrowRight size={15} />
                        </Link>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </AppShell>
  );
}

const emptyLead = {
  name: "",
  phone: "",
  email: "",
  source: "MANUAL",
  primaryConcern: "",
  treatmentCategory: "Hair",
  treatmentSlug: "",
  context: "",
  previousInteraction: "",
  leadStatus: "new",
  leadPriority: "NORMAL",
  preferredLanguage: "AUTO",
  followupAt: "",
  callbackAt: "",
  assignedTo: "AI Reception",
  whatsappConsent: "UNKNOWN",
  doNotContact: false,
  internalNotes: "",
  nextAction: "ANSWER",
};
export function NewLeadPage() {
  const [form, setForm] = useState({ ...emptyLead });
  const [busy, setBusy] = useState(false);
  const set = (key: string, value: string | boolean) =>
    setForm((current) => ({ ...current, [key]: value }));
  async function save() {
    setBusy(true);
    try {
      const result = await requestJson("/api/leads", {
        ...form,
        email: form.email || null,
        followupAt: form.followupAt
          ? new Date(form.followupAt).toISOString()
          : null,
        callbackAt: form.callbackAt
          ? new Date(form.callbackAt).toISOString()
          : null,
      });
      toast.success("Lead created — no message was sent");
      window.location.href = `/leads/${result.patientId}`;
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Lead creation failed",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <AppShell
      eyebrow="Manual intake"
      title="New lead"
      action={
        <Link className="secondary-button" href="/leads">
          Back to leads
        </Link>
      }
    >
      <div className="page-content">
        <section className="surface product-form">
          <div className="content-notice">
            <ShieldCheck />
            <div>
              <strong>Creation does not contact the lead</strong>
              <span>
                Context is stored for Ananya to use naturally if the person
                messages later.
              </span>
            </div>
          </div>
          <div className="form-grid">
            <label>
              Name
              <input
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                required
              />
            </label>
            <label>
              Phone
              <input
                value={form.phone}
                onChange={(e) => set("phone", e.target.value)}
                placeholder="10-digit Indian mobile"
                required
              />
            </label>
            <label>
              Email optional
              <input
                type="email"
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
              />
            </label>
            <label>
              Lead source
              <select
                value={form.source}
                onChange={(e) => set("source", e.target.value)}
              >
                {[
                  "GOOGLE_ORGANIC",
                  "GOOGLE_ADS",
                  "META_ADS",
                  "INSTAGRAM",
                  "WEBSITE",
                  "GBP",
                  "WHATSAPP",
                  "PHONE",
                  "REFERRAL",
                  "MANUAL",
                  "CSV",
                  "OTHER",
                ].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label>
              Primary concern
              <input
                value={form.primaryConcern}
                onChange={(e) => set("primaryConcern", e.target.value)}
              />
            </label>
            <label>
              Category
              <select
                value={form.treatmentCategory}
                onChange={(e) => set("treatmentCategory", e.target.value)}
              >
                <option>Hair</option>
                <option>Skin</option>
                <option>Aesthetics</option>
              </select>
            </label>
            <label>
              Treatment slug
              <input
                value={form.treatmentSlug}
                onChange={(e) => set("treatmentSlug", e.target.value)}
                placeholder="hair_transplant"
              />
            </label>
            <label>
              Lead status
              <input
                value={form.leadStatus}
                onChange={(e) => set("leadStatus", e.target.value)}
              />
            </label>
            <label>
              Priority
              <select
                value={form.leadPriority}
                onChange={(e) => set("leadPriority", e.target.value)}
              >
                <option>LOW</option>
                <option>NORMAL</option>
                <option>HIGH</option>
                <option>URGENT</option>
              </select>
            </label>
            <label>
              Language
              <select
                value={form.preferredLanguage}
                onChange={(e) => set("preferredLanguage", e.target.value)}
              >
                <option>AUTO</option>
                <option>ENGLISH</option>
                <option>HINDI</option>
                <option>HINGLISH</option>
                <option>ODIA</option>
              </select>
            </label>
            <label>
              Follow-up
              <input
                type="datetime-local"
                value={form.followupAt}
                onChange={(e) => set("followupAt", e.target.value)}
              />
            </label>
            <label>
              Callback
              <input
                type="datetime-local"
                value={form.callbackAt}
                onChange={(e) => set("callbackAt", e.target.value)}
              />
            </label>
            <label>
              Assigned person
              <input
                value={form.assignedTo}
                onChange={(e) => set("assignedTo", e.target.value)}
              />
            </label>
            <label>
              WhatsApp consent
              <select
                value={form.whatsappConsent}
                onChange={(e) => set("whatsappConsent", e.target.value)}
              >
                <option>UNKNOWN</option>
                <option>CONFIRMED</option>
                <option>REVOKED</option>
              </select>
            </label>
            <label>
              Next action
              <select
                value={form.nextAction}
                onChange={(e) => set("nextAction", e.target.value)}
              >
                {[
                  "ANSWER",
                  "ASK_ONE_QUESTION",
                  "SHOW_OPTIONS",
                  "SHARE_CONTENT",
                  "HANDLE_OBJECTION",
                  "OFFER_BOOKING",
                  "CHECK_SLOTS",
                  "BOOK",
                  "CALL",
                  "MANUAL_FOLLOWUP",
                  "WAIT",
                  "DOCTOR_REVIEW",
                  "CLOSE_NOT_INTERESTED",
                ].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={form.doNotContact}
                onChange={(e) => set("doNotContact", e.target.checked)}
              />
              Do not contact
            </label>
            <label className="span-2">
              Free-text context
              <textarea
                value={form.context}
                onChange={(e) => set("context", e.target.value)}
                placeholder="Interested in hair transplant. Asked price previously. Comparing clinics…"
              />
            </label>
            <label className="span-2">
              Previous interaction
              <textarea
                value={form.previousInteraction}
                onChange={(e) => set("previousInteraction", e.target.value)}
              />
            </label>
            <label className="span-2">
              Internal notes
              <textarea
                value={form.internalNotes}
                onChange={(e) => set("internalNotes", e.target.value)}
              />
            </label>
          </div>
          <footer className="form-footer">
            <Link className="secondary-button" href="/leads">
              Cancel
            </Link>
            <button
              className="primary-button"
              disabled={busy || !form.name || !form.phone}
              onClick={save}
            >
              <Save size={16} />
              {busy ? "Saving…" : "Create lead"}
            </button>
          </footer>
        </section>
      </div>
    </AppShell>
  );
}

type Catalog = {
  categories: Array<Record<string, unknown>>;
  concerns: Array<Record<string, unknown>>;
  treatments: Array<Record<string, unknown>>;
  prices: Array<Record<string, unknown>>;
  knowledge: Array<Record<string, unknown>>;
};
export function TreatmentsPage() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [newTreatment, setNewTreatment] = useState({
    name: "",
    slug: "",
    category: "Hair",
    description: "",
  });
  const [newConcern, setNewConcern] = useState({
    name: "",
    slug: "",
    categoryId: "cat_hair",
  });
  const load = () =>
    fetch("/api/treatments", { cache: "no-store" })
      .then((r) => r.json())
      .then(setCatalog);
  useEffect(() => {
    void load();
  }, []);
  async function createCategory() {
    try {
      await requestJson("/api/treatments", {
        kind: "category",
        name,
        slug,
        description: "",
        status: "DRAFT",
        active: true,
      });
      setName("");
      setSlug("");
      await load();
      toast.success("Category draft created");
    } catch (error) {
      toast.error(String(error));
    }
  }
  async function editCategory(item: Record<string, unknown>) {
    const description = window.prompt(
      "Category description",
      String(item.description || ""),
    );
    if (description === null) return;
    try {
      await requestJson("/api/treatments", {
        kind: "category",
        ...item,
        description,
      });
      await load();
      toast.success("Category updated");
    } catch (error) {
      toast.error(String(error));
    }
  }
  async function setCategoryState(
    item: Record<string, unknown>,
    status: "DRAFT" | "NEEDS_REVIEW" | "APPROVED" | "ARCHIVED",
    active = status !== "ARCHIVED",
  ) {
    try {
      await requestJson("/api/treatments", {
        kind: "category",
        ...item,
        status,
        active,
      });
      await load();
    } catch (error) {
      toast.error(String(error));
    }
  }
  async function createTreatment() {
    try {
      await requestJson("/api/treatments", {
        kind: "treatment",
        ...newTreatment,
        approvalStatus: "DRAFT",
        active: true,
        bookingEnabled: true,
      });
      setNewTreatment({
        name: "",
        slug: "",
        category: "Hair",
        description: "",
      });
      await load();
      toast.success("Treatment draft created");
    } catch (error) {
      toast.error(String(error));
    }
  }
  async function createConcern() {
    try {
      await requestJson("/api/treatments", {
        kind: "concern",
        ...newConcern,
        description: "",
        treatmentSlugs: [],
        benefits: [],
        conversationOptions: [
          "Estimated cost",
          "How it works",
          "Book consultation",
        ],
        status: "DRAFT",
        active: true,
      });
      setNewConcern({ name: "", slug: "", categoryId: "cat_hair" });
      await load();
      toast.success("Concern draft created");
    } catch (error) {
      toast.error(String(error));
    }
  }
  async function editConcern(item: Record<string, unknown>) {
    const explanation = window.prompt(
      "Doctor-approved patient explanation",
      String(item.approvedExplanation || ""),
    );
    if (explanation === null) return;
    try {
      await requestJson("/api/treatments", {
        kind: "concern",
        ...item,
        approvedExplanation: explanation,
        treatmentSlugs: JSON.parse(String(item.treatmentSlugsJson || "[]")),
        benefits: JSON.parse(String(item.benefitsJson || "[]")),
        conversationOptions: JSON.parse(
          String(item.conversationOptionsJson || "[]"),
        ),
      });
      await load();
      toast.success("Concern updated");
    } catch (error) {
      toast.error(String(error));
    }
  }
  async function setConcernState(
    item: Record<string, unknown>,
    status: "DRAFT" | "NEEDS_REVIEW" | "APPROVED" | "ARCHIVED",
    active = status !== "ARCHIVED",
  ) {
    try {
      await requestJson("/api/treatments", {
        kind: "concern",
        ...item,
        treatmentSlugs: JSON.parse(String(item.treatmentSlugsJson || "[]")),
        benefits: JSON.parse(String(item.benefitsJson || "[]")),
        conversationOptions: JSON.parse(
          String(item.conversationOptionsJson || "[]"),
        ),
        status,
        active,
      });
      await load();
    } catch (error) {
      toast.error(String(error));
    }
  }
  async function updateTreatment(
    item: Record<string, unknown>,
    approvalStatus: "DRAFT" | "NEEDS_REVIEW" | "APPROVED" | "ARCHIVED",
    active = approvalStatus !== "ARCHIVED",
  ) {
    try {
      await requestJson("/api/treatments", {
        kind: "treatment",
        ...item,
        benefits: JSON.parse(String(item.benefitsJson || "[]")),
        conversationOptions: JSON.parse(
          String(item.conversationOptionsJson || "[]"),
        ),
        approvalStatus,
        active,
      });
      await load();
      toast.success(`Treatment ${approvalStatus.toLowerCase()}`);
    } catch (error) {
      toast.error(String(error));
    }
  }
  async function editTreatment(item: Record<string, unknown>) {
    const description = window.prompt(
      "Patient-safe treatment description",
      String(item.description || ""),
    );
    if (description === null) return;
    await updateTreatment(
      { ...item, description },
      String(item.approvalStatus || "DRAFT") as
        "DRAFT" | "NEEDS_REVIEW" | "APPROVED" | "ARCHIVED",
      Boolean(item.active),
    );
  }
  async function updatePrice(
    item: Record<string, unknown>,
    approvalStatus: "APPROVED" | "ARCHIVED",
  ) {
    try {
      await requestJson("/api/treatments", {
        kind: "price",
        ...item,
        approvalStatus,
        approvedForPatientDisplay: approvalStatus === "APPROVED",
        active: approvalStatus !== "ARCHIVED",
      });
      await load();
      toast.success(`Price ${approvalStatus.toLowerCase()}`);
    } catch (error) {
      toast.error(String(error));
    }
  }
  async function updateGuidance(
    item: Record<string, unknown>,
    approvalStatus: "APPROVED" | "ARCHIVED",
  ) {
    try {
      await requestJson("/api/treatments", {
        kind: "knowledge",
        ...item,
        approvalStatus,
        active: approvalStatus !== "ARCHIVED",
      });
      await load();
      toast.success(`Guidance ${approvalStatus.toLowerCase()}`);
    } catch (error) {
      toast.error(String(error));
    }
  }
  return (
    <AppShell
      eyebrow="Doctor-approved knowledge"
      title="Treatment management"
      action={
        <Link className="secondary-button" href="/settings">
          Settings
        </Link>
      }
    >
      {!catalog ? (
        <PageLoader />
      ) : (
        <div className="page-content">
          <div className="catalog-grid">
            <section className="surface catalog-panel">
              <div className="section-head">
                <div>
                  <h2>Categories</h2>
                  <p>Editable without code changes.</p>
                </div>
              </div>
              {catalog.categories.map((item) => (
                <div className="catalog-row" key={String(item.id)}>
                  <div>
                    <strong>{String(item.name)}</strong>
                    <span>{String(item.slug)}</span>
                  </div>
                  <div className="row-buttons">
                    <StatusBadge value={String(item.status)} />
                    <button onClick={() => editCategory(item)}>Edit</button>
                    <button onClick={() => setCategoryState(item, "APPROVED")}>
                      Approve
                    </button>
                    <button
                      onClick={() =>
                        setCategoryState(
                          item,
                          String(item.status) === "ARCHIVED"
                            ? "APPROVED"
                            : (String(item.status) as
                                "DRAFT" | "NEEDS_REVIEW" | "APPROVED"),
                          !Boolean(item.active),
                        )
                      }
                    >
                      {Boolean(item.active) ? "Disable" : "Enable"}
                    </button>
                    <button onClick={() => setCategoryState(item, "ARCHIVED")}>
                      Archive
                    </button>
                  </div>
                </div>
              ))}
              <div className="inline-create">
                <input
                  placeholder="Category name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                <input
                  placeholder="slug"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                />
                <button
                  className="primary-button"
                  onClick={createCategory}
                  disabled={!name || !slug}
                >
                  <Plus size={14} />
                  Add draft
                </button>
              </div>
            </section>
            <section className="surface catalog-panel">
              <div className="section-head">
                <div>
                  <h2>Concerns</h2>
                  <p>Category → concern → treatments → approved explanation.</p>
                </div>
              </div>
              <div className="catalog-scroll">
                {catalog.concerns.map((item) => (
                  <div className="catalog-row" key={String(item.id)}>
                    <div>
                      <strong>{String(item.name)}</strong>
                      <span>
                        {JSON.parse(
                          String(item.treatmentSlugsJson || "[]"),
                        ).join(" · ")}
                      </span>
                    </div>
                    <div className="row-buttons">
                      <StatusBadge value={String(item.status)} />
                      <button onClick={() => editConcern(item)}>Edit</button>
                      <button onClick={() => setConcernState(item, "APPROVED")}>
                        Approve
                      </button>
                      <button
                        onClick={() =>
                          setConcernState(
                            item,
                            String(item.status) === "ARCHIVED"
                              ? "APPROVED"
                              : (String(item.status) as
                                  "DRAFT" | "NEEDS_REVIEW" | "APPROVED"),
                            !Boolean(item.active),
                          )
                        }
                      >
                        {Boolean(item.active) ? "Disable" : "Enable"}
                      </button>
                      <button onClick={() => setConcernState(item, "ARCHIVED")}>
                        Archive
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="inline-create">
                <input
                  placeholder="Concern name"
                  value={newConcern.name}
                  onChange={(e) =>
                    setNewConcern({ ...newConcern, name: e.target.value })
                  }
                />
                <input
                  placeholder="slug"
                  value={newConcern.slug}
                  onChange={(e) =>
                    setNewConcern({ ...newConcern, slug: e.target.value })
                  }
                />
                <select
                  value={newConcern.categoryId}
                  onChange={(e) =>
                    setNewConcern({
                      ...newConcern,
                      categoryId: e.target.value,
                    })
                  }
                >
                  {catalog.categories.map((item) => (
                    <option key={String(item.id)} value={String(item.id)}>
                      {String(item.name)}
                    </option>
                  ))}
                </select>
                <button
                  className="primary-button"
                  onClick={createConcern}
                  disabled={!newConcern.name || !newConcern.slug}
                >
                  <Plus size={14} />
                  Add draft
                </button>
              </div>
            </section>
          </div>
          <section className="surface table-surface">
            <div className="section-head padded">
              <div>
                <h2>Treatments</h2>
                <p>
                  Create, approve, disable or archive without a code change.
                  Only approved active entries reach Ananya.
                </p>
              </div>
            </div>
            <div className="inline-create padded">
              <input
                placeholder="Treatment name"
                value={newTreatment.name}
                onChange={(e) =>
                  setNewTreatment({ ...newTreatment, name: e.target.value })
                }
              />
              <input
                placeholder="slug"
                value={newTreatment.slug}
                onChange={(e) =>
                  setNewTreatment({ ...newTreatment, slug: e.target.value })
                }
              />
              <select
                value={newTreatment.category}
                onChange={(e) =>
                  setNewTreatment({ ...newTreatment, category: e.target.value })
                }
              >
                <option>Hair</option>
                <option>Skin</option>
                <option>Aesthetics</option>
              </select>
              <input
                placeholder="Patient-safe description"
                value={newTreatment.description}
                onChange={(e) =>
                  setNewTreatment({
                    ...newTreatment,
                    description: e.target.value,
                  })
                }
              />
              <button
                className="primary-button"
                onClick={createTreatment}
                disabled={!newTreatment.name || !newTreatment.slug}
              >
                <Plus size={14} />
                Add draft
              </button>
            </div>
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Category</th>
                    <th>Status</th>
                    <th>Booking</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {catalog.treatments.map((item) => (
                    <tr key={String(item.id)}>
                      <td>
                        <strong>{String(item.name)}</strong>
                        <span className="table-subtitle">
                          {String(item.slug)}
                        </span>
                      </td>
                      <td>{String(item.category)}</td>
                      <td>
                        <StatusBadge value={String(item.approvalStatus)} />
                      </td>
                      <td>
                        {Boolean(item.bookingEnabled) ? "ENABLED" : "DISABLED"}
                      </td>
                      <td>
                        <div className="row-buttons">
                          <button
                            onClick={() => updateTreatment(item, "APPROVED")}
                          >
                            <Check size={13} />
                            Approve
                          </button>
                          <button onClick={() => editTreatment(item)}>
                            Edit
                          </button>
                          <button
                            onClick={() =>
                              updateTreatment(
                                item,
                                String(item.approvalStatus || "DRAFT") as
                                  | "DRAFT"
                                  | "NEEDS_REVIEW"
                                  | "APPROVED"
                                  | "ARCHIVED",
                                !Boolean(item.active),
                              )
                            }
                          >
                            {Boolean(item.active) ? "Disable" : "Enable"}
                          </button>
                          <button
                            onClick={() => updateTreatment(item, "ARCHIVED")}
                          >
                            Archive
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="surface table-surface">
            <div className="section-head padded">
              <div>
                <h2>Structured pricing</h2>
                <p>
                  Only APPROVED + patient-display rows can be used by Ananya.
                  Ambiguous mole, wart and facial-volume rows remain blocked.
                </p>
              </div>
            </div>
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Treatment</th>
                    <th>Price</th>
                    <th>Type</th>
                    <th>Source</th>
                    <th>Approval</th>
                    <th>Patient display</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {catalog.prices.map((item) => (
                    <tr key={String(item.id)}>
                      <td>
                        <strong>{titleCase(String(item.treatmentId))}</strong>
                      </td>
                      <td>{String(item.displayText)}</td>
                      <td>{String(item.pricingType)}</td>
                      <td>{String(item.source)}</td>
                      <td>
                        <StatusBadge value={String(item.approvalStatus)} />
                      </td>
                      <td>
                        {Boolean(item.approvedForPatientDisplay) ? "YES" : "NO"}
                      </td>
                      <td>
                        <div className="row-buttons">
                          <button
                            onClick={() => updatePrice(item, "APPROVED")}
                            disabled={
                              String(item.id).includes("ambiguous") ||
                              String(item.id).includes("facial_volume")
                            }
                          >
                            <Check size={13} />
                            Approve
                          </button>
                          <button onClick={() => updatePrice(item, "ARCHIVED")}>
                            Archive
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="surface table-surface">
            <div className="section-head padded">
              <div>
                <h2>Clinic guidance approval</h2>
                <p>
                  Doctor-review answers remain patient-specific unless saved
                  here as a draft and explicitly approved.
                </p>
              </div>
            </div>
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Source</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {catalog.knowledge.map((item) => (
                    <tr key={String(item.id)}>
                      <td>
                        <strong>{String(item.title)}</strong>
                        <span className="table-subtitle">
                          {String(item.content).slice(0, 140)}
                        </span>
                      </td>
                      <td>{String(item.source)}</td>
                      <td>
                        <StatusBadge value={String(item.approvalStatus)} />
                      </td>
                      <td>
                        <div className="row-buttons">
                          <button
                            onClick={() => updateGuidance(item, "APPROVED")}
                          >
                            <Check size={13} />
                            Approve
                          </button>
                          <button
                            onClick={() => updateGuidance(item, "ARCHIVED")}
                          >
                            Archive
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!catalog.knowledge.length && (
                    <tr>
                      <td colSpan={4}>No clinic-guidance drafts.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </AppShell>
  );
}

export function AskRadiancePage() {
  const [question, setQuestion] = useState(
    "What are the main objections this month?",
  );
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  async function ask() {
    setBusy(true);
    try {
      const result = await requestJson("/api/ask-radiance", { question });
      setAnswer(result.answer);
    } catch (error) {
      toast.error(String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <AppShell eyebrow="Deterministic CRM intelligence" title="Ask Radiance">
      <div className="page-content ask-radiance-layout">
        <section className="surface ask-radiance-card">
          <div className="ai-orb">
            <Sparkles />
          </div>
          <h2>Ask a clinic operations question</h2>
          <p>
            Natural language is mapped to a safe database query. The database
            calculates; the response formatter explains. No invented statistics.
          </p>
          <div className="ask-large">
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && ask()}
            />
            <button className="primary-button" onClick={ask} disabled={busy}>
              <Search size={16} />
              {busy ? "Checking…" : "Ask"}
            </button>
          </div>
          <div className="prompt-chips">
            {[
              "Which source produces the most bookings?",
              "Which treatments generated most enquiries?",
              "How many callbacks are pending?",
              "Which leads are currently most valuable?",
            ].map((item) => (
              <button key={item} onClick={() => setQuestion(item)}>
                {item}
              </button>
            ))}
          </div>
          {answer && (
            <div className="answer-panel">
              <Bot />
              <pre>{answer}</pre>
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}

export function StaffSettingsPage() {
  const [staff, setStaff] = useState<Array<Record<string, unknown>>>([]);
  const [form, setForm] = useState({
    name: "",
    phone: "",
    role: "DOCTOR",
    active: true,
    canViewSummaries: true,
    canViewAppointments: true,
    canReceiveDoctorReview: true,
    canApproveKnowledge: true,
    canReceiveAlerts: false,
  });
  const load = () =>
    fetch("/api/staff", { cache: "no-store" })
      .then((r) => r.json())
      .then((v) => setStaff(v.staff || []));
  useEffect(() => {
    void load();
  }, []);
  async function save() {
    try {
      await requestJson("/api/staff", form);
      toast.success("Authorized staff contact saved");
      setForm({ ...form, name: "", phone: "" });
      await load();
    } catch (error) {
      toast.error(String(error));
    }
  }
  return (
    <AppShell
      eyebrow="Server-enforced access"
      title="Authorized staff contacts"
      action={
        <Link className="secondary-button" href="/settings">
          Settings
        </Link>
      }
    >
      <div className="page-content settings-layout">
        <section className="surface catalog-panel">
          <div className="section-head">
            <div>
              <h2>Authorized numbers</h2>
              <p>
                Incoming numbers are normalized and checked before patient flow.
              </p>
            </div>
          </div>
          {staff.map((item) => (
            <div className="catalog-row" key={String(item.id)}>
              <div>
                <strong>{String(item.name)}</strong>
                <span>
                  {String(item.phone)} · {String(item.role)}
                </span>
              </div>
              <StatusBadge
                value={Boolean(item.active) ? "ACTIVE" : "DISABLED"}
              />
            </div>
          ))}
        </section>
        <aside className="surface product-form compact-form">
          <h2>Add or update contact</h2>
          <label>
            Name
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label>
            Phone
            <input
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </label>
          <label>
            Role
            <select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
            >
              <option>DOCTOR</option>
              <option>ADMIN</option>
              <option>RECEPTION</option>
              <option>MANAGER</option>
            </select>
          </label>
          {[
            ["canViewSummaries", "View summaries"],
            ["canViewAppointments", "View appointments"],
            ["canReceiveDoctorReview", "Receive doctor reviews"],
            ["canApproveKnowledge", "Approve knowledge"],
            ["canReceiveAlerts", "Receive urgent alerts"],
          ].map(([key, label]) => (
            <label className="checkbox-label" key={key}>
              <input
                type="checkbox"
                checked={Boolean(form[key as keyof typeof form])}
                onChange={(e) => setForm({ ...form, [key]: e.target.checked })}
              />
              {label}
            </label>
          ))}
          <button
            className="primary-button full"
            onClick={save}
            disabled={!form.name || !form.phone}
          >
            <Save size={15} />
            Save contact
          </button>
        </aside>
      </div>
    </AppShell>
  );
}
