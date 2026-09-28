import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Authorize a connection",
  robots: { index: false, follow: false },
};
import Consent from "./consent";
import "./consent.css";
export const dynamic = "force-dynamic";
export default function Page() {
  return <Consent />;
}
