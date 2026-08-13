import { getAppVersion } from "@/lib/app-version";
import { AppShell } from "@/components/app-shell";

/**
 * Everything except /login renders inside the shell. The version is resolved
 * server-side (git); the protection chip stays where it always was — in the
 * dashboard header, driven by the runtime API — so nothing auth-shaped gets
 * baked in at build time here.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell version={getAppVersion()}>{children}</AppShell>;
}
