import { OwnerDashboard } from "@/components/owner-dashboard";
import { getAppVersion } from "@/lib/app-version";

export default function Home() {
  return <OwnerDashboard version={getAppVersion()} />;
}
