import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Brand } from "@/components/brand";
import { SignOut } from "@/components/sign-out";
import { UnsavedDraftProvider } from "@/components/online-editor/unsaved-draft-context";
import { OnlineFrameEditor } from "@/components/online-frame-editor";
import { buildEditorShortcutHref, normalizeEditorSearchParam } from "@/lib/online-editor/overview";
import { requireAdministrator } from "@/lib/session";
import { isAdminLoginDisabled } from "@smartframe/auth";
import { existsSync } from "node:fs";

export const dynamic = "force-dynamic";
export const metadata = { title: "Personalizar porta-retratos" };

export default async function LayoutsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = await searchParams;
  const initialPanelId = normalizeEditorSearchParam(resolvedSearchParams.panelId);
  const initialDeviceId = normalizeEditorSearchParam(resolvedSearchParams.deviceId);
  await requireAdministrator(
    buildEditorShortcutHref({ panelId: initialPanelId, deviceId: initialDeviceId }),
  );
  const hasAndroidApk =
    !!process.env.SMARTFRAME_ANDROID_APK && existsSync(process.env.SMARTFRAME_ANDROID_APK);
  return (
    <UnsavedDraftProvider>
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
        {hasAndroidApk && (
          <div className="android-download">
            <a href="/downloads/smartframe.apk" download>
              Baixar aplicativo Android
            </a>
            <span>APK de debug para instalar ou atualizar no tablet.</span>
          </div>
        )}
        <OnlineFrameEditor
          initialPanelId={initialPanelId}
          initialDeviceId={initialDeviceId}
        />
      </div>
    </UnsavedDraftProvider>
  );
}
