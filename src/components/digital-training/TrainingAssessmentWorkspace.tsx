import React, { useEffect, useState } from "react";
import { ArrowLeft, FileCheck2, GraduationCap, Link2, Loader2 } from "lucide-react";

import AccountMenu from "../AccountMenu";
import ModuleShellHeader from "../layout/ModuleShellHeader";
import { filterModuleNav, TRAINING_ASSESSMENT_NAV } from "../../config/workspaceNavigation";
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
    <div className="ft-module-shell flex min-h-screen flex-col bg-slate-50 font-sans">
      <ModuleShellHeader
        eyebrow="Liên kết dữ liệu với Đào tạo số"
        title="Bài kiểm tra cuối khóa tập huấn"
        items={filterModuleNav(TRAINING_ASSESSMENT_NAV, { questionBank: canManageQuestionBank })}
        activeId={activeTab}
        onSelect={(id) => {
          if (id === "digital-training") onOpenDigitalTraining();
          else setActiveTab(id as "assessments" | "bank-settings");
        }}
        ariaLabel="Điều hướng Bài kiểm tra cuối khóa"
        account={(
          <AccountMenu
            userName={userName}
            userRole={userRole}
            photoURL={photoURL}
            isGuest={false}
            onAccountClick={onAccountClick}
            onLogout={onLogout}
            variant="avatar"
          />
        )}
      />
      <main className="min-w-0 flex-1">
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
