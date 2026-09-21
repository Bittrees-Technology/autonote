import Script from "next/script";
export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {children}
      <Script
        src="https://insights.bittrees.org/consent.js"
        data-insights-site="autonote"
        strategy="afterInteractive"
      />
    </>
  );
}
