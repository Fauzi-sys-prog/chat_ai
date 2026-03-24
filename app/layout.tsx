import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BW Water Knowledge Assistant",
  description: "Asisten knowledge internal untuk dokumen, SOP, dan percakapan tim PT BW Water.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
