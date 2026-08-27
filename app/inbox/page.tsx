import { InboxView } from "@/components/inbox/inbox-view";
export default async function InboxPage({ searchParams }: { searchParams: Promise<{ patientId?: string }> }) { const { patientId } = await searchParams; return <InboxView initialPatientId={patientId}/>; }
