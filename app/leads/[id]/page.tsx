import { LeadDetailPage } from "@/components/pages/admin-pages";
export default async function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <LeadDetailPage patientId={id}/>; }
