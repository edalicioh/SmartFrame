import type { Metadata } from "next";
import { HistoryGuard } from "@/components/online-editor/history-guard";
import "./globals.css";
import "./editor.css";

export const metadata: Metadata = {
  title: { default: "SmartFrame — suas memórias, sempre por perto", template: "%s · SmartFrame" },
  description: "Transforme seu tablet em um porta-retratos inteligente. Suas fotos, do seu jeito.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>
        <HistoryGuard />
        {children}
      </body>
    </html>
  );
}
