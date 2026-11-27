import type { Metadata } from "next";
import AlertsView from "./AlertsView";

export const metadata: Metadata = { title: "Alerts, Deal search" };

export default function AlertsPage() {
  return <AlertsView />;
}
