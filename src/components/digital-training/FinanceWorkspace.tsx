import { useEffect, useState } from "react";
import { ArrowLeft, BadgeDollarSign } from "lucide-react";

import AccountMenu from "../AccountMenu";
import ModuleMobileNav from "../ModuleMobileNav";
import FinanceReport, { type FinancePartner } from "./FinanceReport";

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

  return (
    <div className="ft-module-shell flex min-h-screen text-slate-800">
      <aside className="dt-sidebar ft-module-sidebar sticky top-0 flex h-screen w-64 shrink-0 flex-col border-r">
        <div className="ft-sidebar-brand flex items-center gap-3 border-b p-5">
          <img src="/logo.png" alt="FermatTech" className="h-8 object-contain" />
          <div className="border-l pl-3">
            <b>FermatTech</b>
            <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-cyan-600">Tài chính</p>
          </div>
        </div>
        <nav className="flex-1 px-4 pt-5">
          <div className="ft-nav-item ft-nav-item-active flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-left text-xs font-bold">
            <BadgeDollarSign className="h-4 w-4" />
            Báo cáo thu chi
          </div>
        </nav>
        <div className="ft-sidebar-footer border-t p-4">
          <button onClick={onBackToWorkspace} className="ft-sidebar-back mb-3 flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-bold">
            <ArrowLeft className="h-4 w-4" />
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
        activeId="finance"
        onSelect={() => undefined}
        items={[{ id: "finance", label: "Báo cáo thu chi", icon: BadgeDollarSign }]}
        ariaLabel="Điều hướng Tài chính"
      />
      <main className="min-w-0 flex-1">
        <div className="ft-module-content mx-auto p-5 md:p-7">
          {loading ? (
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
