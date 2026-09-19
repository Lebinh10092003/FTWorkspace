import { useCallback, useEffect, useMemo, useState } from "react";

import AccountMenu from "../AccountMenu";
import ModuleShellHeader from "../layout/ModuleShellHeader";
import { FINANCE_NAV, withNavBadges } from "../../config/workspaceNavigation";
import ExaminationBillingReview from "../finance/ExaminationBillingReview";
import examinationBillingService, { type ExaminationBillingStats } from "../finance/examinationBillingService";
import FinanceReport, { type FinancePartner } from "./FinanceReport";

type FinanceTab = "report" | "examination-billing";

const financeRouteTab = (): FinanceTab =>
  window.location.pathname.replace(/^\/+|\/+$/g, "").split("/")[1] === "examination-billing"
    ? "examination-billing"
    : "report";

export default function FinanceWorkspace({
  onBackToWorkspace,
  onAccountClick,
  onLogout,
  userName,
  userRole,
  photoURL,
  idToken,
  canEdit,
}: {
  onBackToWorkspace: () => void;
  onAccountClick: () => void;
  onLogout: () => void;
  userName?: string | null;
  userRole?: string | null;
  photoURL?: string | null;
  idToken: string;
  canEdit: boolean;
}) {
  const [partners, setPartners] = useState<FinancePartner[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState<FinanceTab>(financeRouteTab);
  const [billingStats, setBillingStats] = useState<ExaminationBillingStats | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch("/api/digital-training/finance-partners", {
      headers: { Authorization: `Bearer ${idToken}` },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Không thể tải danh sách khách hàng.");
        return response.json();
      })
      .then((rows) => {
        if (active) setPartners(Array.isArray(rows) ? rows : []);
      })
      .catch((error) => {
        if (active) setNotice(String(error?.message || error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [idToken]);

  // The unread count is the accountant's notification that Khảo thí registered
  // new candidates, so it is fetched even while the report tab is open.
  useEffect(() => {
    let active = true;
    examinationBillingService
      .getStats({ idToken })
      .then((stats) => {
        if (active) setBillingStats(stats);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [idToken]);

  useEffect(() => {
    const syncFromLocation = () => setTab(financeRouteTab());
    window.addEventListener("popstate", syncFromLocation);
    return () => window.removeEventListener("popstate", syncFromLocation);
  }, []);

  const goTab = (next: FinanceTab) => {
    setTab(next);
    const path = next === "report" ? "/finance-report" : "/finance-report/examination-billing";
    if (window.location.pathname !== path) window.history.pushState(null, "", path);
  };

  const navItems = useMemo(
    () => withNavBadges(FINANCE_NAV, { "examination-billing": billingStats?.newCandidates || 0 }),
    [billingStats],
  );

  const handleBillingStats = useCallback((stats: ExaminationBillingStats) => setBillingStats(stats), []);

  return (
    <div className="ft-module-shell flex min-h-screen flex-col text-slate-800">
      <ModuleShellHeader
        eyebrow="FermatTech Workspace"
        title="Báo cáo thu chi"
        items={navItems}
        activeId={tab}
        onSelect={(id) => goTab(id as FinanceTab)}
        ariaLabel="Điều hướng Báo cáo thu chi"
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
        <div className="ft-module-content mx-auto p-5 md:p-7">
          {tab === "examination-billing" ? (
            <ExaminationBillingReview
              idToken={idToken}
              actorName={userName || "Kế toán"}
              canEdit={canEdit}
              onStatsChange={handleBillingStats}
            />
          ) : loading ? (
            <div className="py-20 text-center text-sm text-slate-500">Đang tải Báo cáo thu chi...</div>
          ) : notice ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm font-semibold text-rose-700">{notice}</div>
          ) : (
            <FinanceReport partners={partners} idToken={idToken} canEdit={canEdit} />
          )}
        </div>
      </main>
    </div>
  );
}
