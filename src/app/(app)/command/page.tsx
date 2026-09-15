import type { Metadata } from "next";
import { CommandCenter } from "@/components/command-center";

export const metadata: Metadata = {
  title: "Command Center"
};

/**
 * The second dashboard, alongside the original at `/`.
 *
 * Both stay reachable on purpose: the classic screen is where the manual daily
 * state lives, and this one is the derived read of the ledgers. Neither writes
 * to the other's data.
 */
export default function CommandCenterPage() {
  return <CommandCenter />;
}
