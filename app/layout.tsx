import type { Metadata } from "next";
import { OptionalClerkProvider } from "@/lib/clerk";
import { ConvexClientProvider } from "@/components/convex-client-provider";
import { Playfair_Display, Work_Sans } from "next/font/google";
import "./globals.css";

const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const workSans = Work_Sans({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Cornerstone Proposal Generator",
  description: "Generate Cornerstone New Construction Proposals from Excel.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${playfair.variable} ${workSans.variable}`}>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <OptionalClerkProvider>
          <ConvexClientProvider>{children}</ConvexClientProvider>
        </OptionalClerkProvider>
      </body>
    </html>
  );
}
