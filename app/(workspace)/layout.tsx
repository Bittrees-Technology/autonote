import {SharedRoles} from '../components/shared-roles';
import "../globals.css";
import Script from "next/script";
export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {children}
      <SharedRoles/>
      <Script
        src="https://insights.bittrees.org/consent.js"
        data-insights-site="autonote"
        strategy="afterInteractive"
      />
    </>
  );
}
