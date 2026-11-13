import type { Metadata } from "next";
import "./globals.css";
import "./auth-enhancements.css";
import "./ui-enhancements.css";
import ToastHost from "@/components/ToastHost";

export const metadata: Metadata = {
  title: "Interview Studio",
  description: "A calmer space to practise for your next interview.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">{children}<ToastHost /></body>
    </html>
  );
}
