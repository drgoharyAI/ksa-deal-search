import type { Metadata } from "next";
import HistoryView from "./HistoryView";

export const metadata: Metadata = { title: "History, Deal search" };

export default function HistoryPage() {
  return <HistoryView />;
}
