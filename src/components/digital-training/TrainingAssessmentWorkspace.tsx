import React, { useEffect, useState } from "react";
import { ArrowLeft, FileCheck2, GraduationCap, Link2, Loader2 } from "lucide-react";

import AccountMenu from "../AccountMenu";
import ModuleMobileNav from "../ModuleMobileNav";
import TrainingAssessmentsAdmin from "./TrainingAssessmentsAdmin";
import QuestionBankSettings from "./QuestionBankSettings";

export default function TrainingAssessmentWorkspace({
  onBackToWorkspace,
  onOpenDigitalTraining,
  onAccountClick,
  onLogout,
  userName,
  userRole,
  photoURL,
  idToken,
}: {
  onBackToWorkspace: () => void;
  onOpenDigitalTraining: () => void;
  onAccountClick: () => void;
  onLogout: () => void;
  userName?: string | null;
  userRole?: string | null;
  photoURL?: string | null;
  idToken: string;
}) {
  const [sessions, setSessions] = useState<any[]>([]);
  const [classes, setClasses] = useState<any[]>([]);
  const [partners, setPartners] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [activeTab, setActiveTab] = useState<"assessments" | "bank-settings">("assessments");
  const canManageQuestionBank = userRole === "ADMIN" || userRole === "MANAGER";

  useEffect(() => {
    let active = true;
    const headers = { Authorization: `Bearer ${idToken}` };
    Promise.all([
      fetch("/api/digital-training/sessions", { headers }),
      fetch("/api/digital-training/classes", { headers }),
      fetch("/api/digital-training/partners", { headers }),
    ])
      .then(async ([sessionResponse, classResponse, partnerResponse]) => {
        if (!sessionResponse.ok || !classResponse.ok || !partnerResponse.ok) {
          throw new Error("Không thể tải dữ liệu liên kết từ Đào tạo số.");
        }
        const [sessionData, classData, partnerData] = await Promise.all([
          sessionResponse.json(),
          classResponse.json(),
          partnerResponse.json(),
        ]);
        if (active) {
          setSessions(sessionData);
          setClasses(classData);
          setPartners(partnerData);
        }
      })
      .catch((error) => active && setNotice(String(error?.message || error)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [idToken]);

  return (
    <div className="ft-module-shell min-h-screen bg-slate-50 font-sans">
      <aside className="dt-sidebar ft-module-sidebar fixed inset-y-0 left-0 hidden w-64 flex-col md:flex">
        {/* Brand */}
        <div className="ft-sidebar-brand flex items-center gap-3">
          <img src="/logo.png" alt="FermatTech" className="h-9 w-auto object-contain" />
          <div className="min-w-0 border-l border-sky-100 pl-3">
            <b className="block text-xl font-extrabold leading-none">Fermat</b>
            <p className="mt-1 text-[10px] font-extrabold uppercase tracking-[0.12em] text-blue-200">
              Bài kiểm tra cuối khóa tập huấn
            </p>
          </div>
        </div>
        {/* Nav */}
        <nav className="flex-1 space-y-1 overflow-y-auto p-4">
          <button onClick={() => setActiveTab("assessments")} className={`ft-nav-item flex w-full items-center gap-3 rounded-xl border-l-4 px-4 py-3 text-left text-sm font-bold ${activeTab === "assessments" ? "ft-nav-item-active" : ""}`}>
            <FileCheck2 className="h-5 w-5 shrink-0" />
            Bài kiểm tra cuối khóa tập huấn
          </button>
          {canManageQuestionBank && <button onClick={() => setActiveTab("bank-settings")} className={`ft-nav-item flex w-full items-center gap-3 rounded-xl border-l-4 px-4 py-3 text-left text-sm font-bold ${activeTab === "bank-settings" ? "ft-nav-item-active" : ""}`}>
            <Link2 className="h-5 w-5 shrink-0" />
            Set up ngân hàng đề thi
          </button>}
          <button onClick={onOpenDigitalTraining} className="ft-nav-item flex w-full items-center gap-3 rounded-xl border-l-4 px-4 py-3 text-left text-sm font-bold">
            <GraduationCap className="h-5 w-5 shrink-0" />
            Mở Đào tạo số
          </button>
        </nav>        {/* Footer */}
        <div className="ft-sidebar-footer border-t p-4">
          <button
            onClick={onBackToWorkspace}
            className="ft-sidebar-back mb-3 flex w-full items-center gap-3 rounded-xl border p-3 text-left text-sm font-bold"
          >
            <ArrowLeft className="h-5 w-5" />
            Quay lại Workspace
          </button>
          <AccountMenu
            userName={userName}
            userRole={userRole}
            photoURL={photoURL}
            isGuest={false}
            onAccountClick={onAccountClick}
            onLogout={onLogout}
            variant="sidebar"
          />
        </div>
      </aside>

      <ModuleMobileNav
        className="lg:hidden dt-mobile-nav"
        onBack={onBackToWorkspace}
        activeId={activeTab}
        onSelect={(nextTab) => {
          if (nextTab === "digital-training") onOpenDigitalTraining();
          else setActiveTab(nextTab as "assessments" | "bank-settings");
        }}
        items={[
          { id: "assessments", label: "Bài kiểm tra", icon: FileCheck2 },
          ...(canManageQuestionBank ? [{ id: "bank-settings", label: "Ngân hàng đề", icon: Link2 }] : []),
          { id: "digital-training", label: "Đào tạo số", icon: GraduationCap },
        ]}
        ariaLabel="Điều hướng Bài kiểm tra cuối khóa"
      />

      <main className="md:ml-64">
        <header className="ft-module-header border-b px-5 py-4 md:px-8">
          <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-blue-600">
                Liên kết dữ liệu với Đào tạo số
              </p>
              <h1 className="mt-1 text-2xl font-extrabold text-[#001e40]">
                {activeTab === "bank-settings" ? "Set up ngân hàng đề thi" : "Bài kiểm tra cuối khóa tập huấn"}
              </h1>
            </div>
            <button onClick={onBackToWorkspace} className="ft-btn ft-btn-secondary md:hidden">
              <ArrowLeft className="h-4 w-4" />
              Workspace
            </button>
          </div>
        </header>
        <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8">
          {notice && (
            <p className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
              {notice}
            </p>
          )}
          {loading ? (
            <div className="grid min-h-[50vh] place-items-center text-slate-500">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
          ) : activeTab === "bank-settings" ? (
            <QuestionBankSettings idToken={idToken} />
          ) : (
            <TrainingAssessmentsAdmin
              idToken={idToken}
              userRole={userRole || "EMPLOYEE"}
              sessions={sessions}
              classes={classes}
              partners={partners}
              isGuest={false}
            />
          )}
        </div>
      </main>
    </div>
  );
}
