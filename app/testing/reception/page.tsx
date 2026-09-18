import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { ReceptionTestPanel } from "@/components/testing/reception-test-panel";
import { localReceptionTestEnabled } from "@/lib/testing/local-reception";

export const dynamic = "force-dynamic";

export default async function ReceptionTestingPage() {
  const host = (await headers()).get("host") || "";
  if (!localReceptionTestEnabled(host)) notFound();
  return <ReceptionTestPanel/>;
}
