import "./globals.css";
import type { Metadata } from "next";
import { Libre_Baskerville, Source_Sans_3 } from "next/font/google";

const titleFont = Libre_Baskerville({ subsets: ["latin"], weight: ["700"] });
const bodyFont = Source_Sans_3({ subsets: ["latin"], weight: ["400", "600"] });

export const metadata: Metadata = {
  title: "HA Agent Capstone",
  description: "Chat-first Home Assistant room planner",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${titleFont.className} ${bodyFont.className}`}>{children}</body>
    </html>
  );
}
