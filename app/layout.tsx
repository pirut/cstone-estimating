import type { Metadata } from "next";
import { OptionalClerkProvider } from "@/lib/clerk";
import { ConvexClientProvider } from "@/components/convex-client-provider";
import { ThemeProvider } from "@/components/theme-provider";
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

const DEFAULT_APP_URL = "https://estimating.jrbussard.com";

function resolveMetadataBase() {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    DEFAULT_APP_URL;
  const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(normalized);
  } catch {
    return new URL(DEFAULT_APP_URL);
  }
}

export const metadata: Metadata = {
  metadataBase: resolveMetadataBase(),
  title: "Cornerstone Proposal Generator",
  description: "Generate Cornerstone New Construction Proposals from Excel.",
  openGraph: {
    title: "Cornerstone Proposal Generator",
    description: "Generate Cornerstone New Construction Proposals from Excel.",
    type: "website",
    siteName: "Cornerstone Proposal Generator",
    images: [
      {
        url: "/brand/cornerstone-logo.png",
        alt: "Cornerstone Proposal Generator",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Cornerstone Proposal Generator",
    description: "Generate Cornerstone New Construction Proposals from Excel.",
    images: ["/brand/cornerstone-logo.png"],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${playfair.variable} ${workSans.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <OptionalClerkProvider>
            <ConvexClientProvider>{children}</ConvexClientProvider>
          </OptionalClerkProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
