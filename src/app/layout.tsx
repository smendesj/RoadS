import type { Metadata } from "next";
import { Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import { ThemeProvider } from "@/lib/theme-provider";
import "./globals.css";

const plusJakarta = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "RoadS",
  description:
    "Dashboard e roadmap colaborativo da Essencis Labs — substitui o SCRUM síncrono por um board em tempo real e priorização assíncrona.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className={`${plusJakarta.variable} ${jetbrainsMono.variable}`} suppressHydrationWarning>
      <body className="font-sans min-h-screen bg-rs-bg text-rs-text antialiased">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
