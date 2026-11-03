import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Brand } from "@/components/brand";
import { SignOut } from "@/components/sign-out";
import { OnlineFrameEditor } from "@/components/online-frame-editor";
import { requireAdministrator } from "@/lib/session";
import { isAdminLoginDisabled } from "@smartframe/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Personalizar porta-retratos" };

export default async function LayoutsPage() {
  await requireAdministrator("/layouts");
  return (
    <div className="editor-page">
      <header className="editor-header">
        <Link href="/" aria-label="Início SmartFrame">
          <Brand />
        </Link>
        <Link href="/" className="editor-back">
          <ArrowLeft size={16} /> Visão geral
        </Link>
        {!isAdminLoginDisabled() && <SignOut />}
      </header>
      <OnlineFrameEditor />
    </div>
  );
}
