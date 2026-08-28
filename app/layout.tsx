import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL || "http://localhost:3000"),
  title: "Radiance AI Reception",
  description: "Intelligent patient reception, CRM and appointment operations for Radiance Clinics, Bhubaneswar.",
  manifest: "/site.webmanifest",
  icons: {
    icon: "/radiance-logo-mark.png",
    shortcut: "/radiance-logo-mark.png",
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    title: "Radiance AI Reception",
    description: "Intelligent patient care, always on — for Radiance Clinics, Bhubaneswar.",
    images: [{ url: "/og.png", width: 1792, height: 909, alt: "Radiance AI Reception" }],
  },
  twitter: { card: "summary_large_image", title: "Radiance AI Reception", description: "Intelligent patient care, always on.", images: ["/og.png"] },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
