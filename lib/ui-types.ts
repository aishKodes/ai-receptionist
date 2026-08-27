export type Patient = {
  id: string; name: string; phone: string; email?: string | null; age?: number | null; gender?: string | null;
  primaryConcern?: string | null; concernDuration?: string | null; treatmentCategory?: string | null; treatmentSlug?: string | null;
  leadScore: number; leadTemperature: "HOT" | "WARM" | "COLD"; leadStage: string; source: string; campaign?: string | null; aiSummary?: string | null;
  assignedTo?: string | null; aiEnabled: number | boolean; createdAt: string; lastContactAt?: string | null; nextFollowupAt?: string | null;
  whatsappOptInStatus?: string; doNotContact?: number | boolean; invalidPhone?: number | boolean; serviceWindowExpiresAt?: string | null;
  conversationId: string; unreadCount: number; lastMessageAt: string; lastMessage?: string | null; lastSender?: string | null;
};

export type Message = { id: string; conversationId: string; patientId: string; direction: string; senderType: string; messageType: string; content: string; mediaUrl?: string | null; contentItemId?: string | null; deliveryStatus: string; metadataJson?: string; createdAt: string };
export type AIEvent = { id: string; patientId: string; conversationId?: string; eventType: string; title: string; details?: string; metadataJson?: string; createdAt: string; patientName?: string };
export type Appointment = { id: string; patientId: string; conversationId: string; treatmentSlug?: string | null; dateTime: string; status: string; notes?: string; name?: string; phone?: string };
export type ContentItem = { id: string; type: "youtube" | "website" | "before_after" | "faq" | "instruction"; title: string; description: string; url: string; thumbnailUrl?: string | null; treatmentSlug?: string | null; tagsJson?: string; tags?: string[]; whenToSend: string; priority: number; active: number | boolean; approvedForAi?: number | boolean; createdAt: string };
export type Job = { id: string; patientId: string; conversationId: string; appointmentId?: string | null; jobType: string; scheduledFor: string; status: string; createdAt: string; executedAt?: string | null; error?: string | null };

export type DashboardState = {
  patients: Patient[];
  selected: null | { patient: Patient; conversation: Record<string, unknown>; messages: Message[]; appointment: Appointment | null; events: AIEvent[]; sentContent: ContentItem[]; scoreEvents: Array<{ id: string; previousScore: number; newScore: number; reasonCodesJson: string; createdAt: string }>; audit: Array<Record<string, unknown>>; outreachHistory: Array<Record<string, unknown>> };
  appointments: Appointment[]; contents: ContentItem[]; jobs: Job[]; settings: Record<string, string>;
  humanTasks: Array<{ id: string; patientId: string; conversationId?: string; type: string; priority: string; status: string; title: string; reason?: string; suggestedReply?: string; patientName: string; createdAt: string }>;
  campaigns: Array<Record<string, unknown>>; providerMetrics: Array<{ provider: string; requests: number; avgLatency: number; errors: number; fallbacks: number; estimatedCost: number }>;
  analytics: { total: number; hot: number; booked: number; human: number; sentFollowups: number; sourceCounts: Array<{ source: string; count: number }>; stageCounts: Array<{ stage: string; count: number }> };
  provider: string; serverTime: string;
};
