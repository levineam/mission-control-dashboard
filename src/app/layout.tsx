import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { AgentationOverlay } from "@/components/agentation-overlay";
import { AppShell } from "@/components/app-shell";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Mission Control",
  description: "Andrew's project management dashboard - Portfolio, Program, Project, Task hierarchy",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Mission Control",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#1a1a2e",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const enableAgentation =
    process.env.NODE_ENV === "development" ||
    process.env.AGENTATION_ENABLED === "true";
  const agentationEndpoint = process.env.AGENTATION_ENDPOINT;

  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <AppShell>
            {children}
          </AppShell>
          <AgentationOverlay
            enabled={enableAgentation}
            endpoint={agentationEndpoint}
          />
        </ThemeProvider>
      </body>
    </html>
  );
}
