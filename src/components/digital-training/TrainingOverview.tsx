import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Calendar,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Clock,
  Layers,
  Package,
  PackageCheck,
  Sparkles,
  UsersRound,
} from "lucide-react";

type OverviewSession = {
  id: number;
  title: string;
  date: string | null;
  start_time?: string | null;
  end_time?: string | null;
  partner?: string;
  partner_name?: string;
  staff_name?: string;
  status: "unscheduled" | "planned" | "completed" | "cancelled";
};

type OverviewMeeting = {
  id: number;
  title: string;
  date: string;
  start_time?: string | null;
  end_time?: string | null;
  representative?: string;
  staff_name?: string;
  status: "unscheduled" | "planned" | "completed" | "cancelled";
};

type OverviewPartner = { id: number; name: string };

type Product = { id: number; name: string; active: boolean };
type Subscription = {
  id: number;
  partner: number;
  partner_name: string;
  product_name: string;
  quantity: number;
  effective_status: "active" | "expiring" | "expired" | "paused" | "cancelled";
  days_remaining?: number | null;
};

type AlertRow = {
  key: string;
  level: "danger" | "warning" | "info";
  title: string;
  detail: string;
};

const dateLabel = (value?: string | null) =>
  value ? new Date(`${value}T00:00:00`).toLocaleDateString("vi-VN") : "Chưa xếp ngày";
const timeLabel = (start?: string | null, end?: string | null) =>
  [start?.slice(0, 5), end?.slice(0, 5)].filter(Boolean).join(" – ") || "Chưa xếp giờ";
const localDateKey = (value: Date) =>
  `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;

export default function TrainingOverview({
  sessions,
  meetings,
  partners,
  idToken,
  onOpenCalendar,
  onOpenPartners,
  onOpenProducts,
}: {
  sessions: OverviewSession[];
  meetings: OverviewMeeting[];
  partners: OverviewPartner[];
  idToken: string;
  onOpenCalendar: () => void;
  onOpenPartners: () => void;
  onOpenProducts: () => void;
}) {
  const [products, setProducts] = useState<Product[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const headers = idToken ? { Authorization: `Bearer ${idToken}` } : undefined;
    setLoading(true);
    Promise.all([
      fetch("/api/digital-training/products", { headers }),
      fetch("/api/digital-training/product-subscriptions", { headers }),
    ])
      .then(async ([productResponse, subscriptionResponse]) => {
        if (!productResponse.ok || !subscriptionResponse.ok)
          throw new Error("Không thể tải tình trạng sản phẩm.");
        const [productRows, subscriptionRows] = await Promise.all([
          productResponse.json(),
          subscriptionResponse.json(),
        ]);
        if (!active) return;
        setProducts(productRows);
        setSubscriptions(subscriptionRows);
        setError("");
      })
      .catch((reason) => {
        if (active) setError(String(reason?.message || reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [idToken]);

  const today = localDateKey(new Date());
  const upcoming = useMemo(
    () =>
      [
        ...sessions.map((item) => ({
          ...item,
          key: `training-${item.id}`,
          kind: "Tập huấn",
          customer: item.partner_name || item.partner || "Chưa gắn khách hàng",
        })),
        ...meetings.map((item) => ({
          ...item,
          key: `meeting-${item.id}`,
          kind: "Lịch công tác",
          customer: item.representative || "Chưa cập nhật đầu mối",
        })),
      ]
        .filter((item) => item.date && item.date >= today && item.status === "planned")
        .sort(
          (a, b) =>
            String(a.date).localeCompare(String(b.date)) ||
            String(a.start_time || "").localeCompare(String(b.start_time || "")),
        ),
    [sessions, meetings, today],
  );

  const statusCounts = useMemo(
    () =>
      subscriptions.reduce<Record<string, number>>((result, item) => {
        result[item.effective_status] = (result[item.effective_status] || 0) + 1;
        return result;
      }, {}),
    [subscriptions],
  );
  const activeQuantity = subscriptions
    .filter((item) => ["active", "expiring"].includes(item.effective_status))
    .reduce((sum, item) => sum + Number(item.quantity || 0), 0);

  const alerts = useMemo(() => {
    const rows: AlertRow[] = [];
    subscriptions.forEach((item) => {
      if (item.effective_status === "expired")
        rows.push({
          key: `expired-${item.id}`,
          level: "danger",
          title: `${item.product_name} đã hết hạn`,
          detail: `${item.partner_name}${item.days_remaining != null ? ` · Quá hạn ${Math.abs(item.days_remaining)} ngày` : ""}`,
        });
      else if (item.effective_status === "expiring")
        rows.push({
          key: `expiring-${item.id}`,
          level: "warning",
          title: `${item.product_name} sắp hết hạn`,
          detail: `${item.partner_name}${item.days_remaining != null ? ` · Còn ${item.days_remaining} ngày` : ""}`,
        });
    });
    sessions
      .filter((item) => item.status === "unscheduled" || (!item.date && item.status !== "cancelled" && item.status !== "completed"))
      .forEach((item) =>
        rows.push({
          key: `unscheduled-${item.id}`,
          level: "warning",
          title: "Buổi tập huấn chưa xếp lịch",
          detail: `${item.title} · ${item.partner_name || item.partner || "Chưa gắn khách hàng"}`,
        }),
      );
    upcoming
      .filter((item) => !item.staff_name)
      .forEach((item) =>
        rows.push({
          key: `staff-${item.key}`,
          level: "info",
          title: "Lịch sắp tới chưa phân công nhân sự",
          detail: `${item.title} · ${dateLabel(item.date)}`,
        }),
      );
    const allocatedPartners = new Set(
      subscriptions.filter((item) => item.effective_status !== "cancelled").map((item) => item.partner),
    );
    partners
      .filter((item) => !allocatedPartners.has(item.id))
      .forEach((item) =>
        rows.push({
          key: `no-product-${item.id}`,
          level: "info",
          title: "Khách hàng chưa được phân bổ sản phẩm",
          detail: item.name,
        }),
      );
    return rows;
  }, [subscriptions, sessions, upcoming, partners]);

  return (
    <section className="space-y-6">
      {/* 1. Module Header */}
      <header className="rounded-2xl border border-slate-200/80 bg-white p-5 sm:p-6 shadow-2xs">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700 ring-1 ring-blue-600/20 mb-2">
              <CalendarClock className="h-3.5 w-3.5" />
              <span>ĐIỀU HÀNH ĐÀO TẠO SỐ</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              Tổng quan Phân hệ
            </h1>
            <p className="mt-1 text-xs text-slate-500 sm:text-sm">
              Theo dõi lịch công tác sắp tới, cơ sở đối tác, hiện trạng license sản phẩm và danh sách cảnh báo cần ưu tiên xử lý.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onOpenCalendar}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200/90 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 transition-colors cursor-pointer"
            >
              <Calendar className="h-3.5 w-3.5 text-blue-600" />
              <span>Xem lịch công tác</span>
            </button>
            <button
              type="button"
              onClick={onOpenProducts}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white shadow-2xs hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <PackageCheck className="h-3.5 w-3.5" />
              <span>Quản lý sản phẩm</span>
            </button>
          </div>
        </div>
      </header>

      {/* 2. 4 Bento KPI Metric Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Card 1: Upcoming Sessions */}
        <button
          type="button"
          onClick={onOpenCalendar}
          className="group rounded-xl border border-slate-200/90 bg-white p-5 shadow-2xs flex flex-col justify-between text-left hover:-translate-y-0.5 hover:shadow-md transition-all cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Lịch sắp tới</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600 group-hover:bg-blue-100 transition-colors">
              <CalendarClock className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-4">
            <div className="text-3xl font-bold tracking-tight text-slate-900">{upcoming.length}</div>
            <div className="mt-1.5 flex items-center gap-1 text-xs font-semibold text-blue-600">
              <span>Xem lịch kế hoạch</span>
              <ChevronRight className="h-3 w-3" />
            </div>
          </div>
        </button>

        {/* Card 2: Total Partners */}
        <button
          type="button"
          onClick={onOpenPartners}
          className="group rounded-xl border border-slate-200/90 bg-white p-5 shadow-2xs flex flex-col justify-between text-left hover:-translate-y-0.5 hover:shadow-md transition-all cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Tổng khách hàng</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-50 text-violet-600 group-hover:bg-violet-100 transition-colors">
              <UsersRound className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-4">
            <div className="text-3xl font-bold tracking-tight text-slate-900">{partners.length}</div>
            <div className="mt-1.5 flex items-center gap-1 text-xs font-semibold text-violet-600">
              <span>Cơ sở đối tác</span>
              <ChevronRight className="h-3 w-3" />
            </div>
          </div>
        </button>

        {/* Card 3: Active Subscriptions */}
        <button
          type="button"
          onClick={onOpenProducts}
          className="group rounded-xl border border-slate-200/90 bg-white p-5 shadow-2xs flex flex-col justify-between text-left hover:-translate-y-0.5 hover:shadow-md transition-all cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">License đang hoạt động</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 group-hover:bg-emerald-100 transition-colors">
              <PackageCheck className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-4">
            <div className="text-3xl font-bold tracking-tight text-slate-900">{activeQuantity}</div>
            <div className="mt-1.5 flex items-center gap-1 text-xs font-semibold text-emerald-600">
              <span>Phân bổ ổn định</span>
              <ChevronRight className="h-3 w-3" />
            </div>
          </div>
        </button>

        {/* Card 4: Action Required */}
        <div
          className={`rounded-xl border p-5 shadow-2xs flex flex-col justify-between ${
            alerts.length > 0 ? "border-amber-200 bg-amber-50/40" : "border-slate-200/90 bg-white"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className={`text-xs font-medium ${alerts.length > 0 ? "text-amber-800" : "text-slate-500"}`}>
              Cảnh báo cần xử lý
            </span>
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                alerts.length > 0 ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"
              }`}
            >
              <AlertTriangle className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-4">
            <div className={`text-3xl font-bold tracking-tight ${alerts.length > 0 ? "text-amber-900" : "text-slate-900"}`}>
              {alerts.length}
            </div>
            <div className={`mt-1.5 text-xs font-semibold ${alerts.length > 0 ? "text-amber-700" : "text-slate-500"}`}>
              {alerts.length > 0 ? "Việc cần ưu tiên thực hiện" : "Hệ thống an toàn"}
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-medium text-rose-700">
          {error}
        </div>
      )}

      {/* 3. Middle 2-Column Bento Grid */}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(22rem,1fr)]">
        {/* Left: Lịch sắp tới */}
        <article className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-2xs">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 p-5">
            <div>
              <h2 className="text-base font-bold text-slate-900">Lịch công tác sắp tới</h2>
              <p className="mt-0.5 text-xs text-slate-500">Các phiên làm việc, khảo sát và tập huấn theo tiến độ.</p>
            </div>
            <button
              onClick={onOpenCalendar}
              className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:text-blue-800 cursor-pointer"
            >
              <span>Xem tất cả</span>
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="divide-y divide-slate-100">
            {upcoming.slice(0, 7).map((item) => (
              <button
                key={item.key}
                onClick={onOpenCalendar}
                className="group flex w-full items-center gap-4 p-4 text-left hover:bg-slate-50/70 transition-colors cursor-pointer"
              >
                {/* Date avatar badge */}
                <div className="flex h-12 w-14 shrink-0 flex-col items-center justify-center rounded-xl border border-blue-200/60 bg-blue-50/60 text-blue-700">
                  <span className="text-[10px] font-bold uppercase tracking-wider">{dateLabel(item.date).split("/")[0] ? `NGÀY ${dateLabel(item.date).split("/")[0]}` : "LỊCH"}</span>
                  <span className="text-xs font-bold">{dateLabel(item.date)}</span>
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-xs text-slate-900 group-hover:text-blue-600 transition-colors truncate">
                      {item.title}
                    </span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.2 text-[10px] font-semibold text-slate-600 shrink-0">
                      {item.kind}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-500">
                    <span className="inline-flex items-center gap-1 font-medium text-blue-600">
                      <Clock className="h-3 w-3" />
                      {timeLabel(item.start_time, item.end_time)}
                    </span>
                    <span>·</span>
                    <span className="truncate">{item.customer}</span>
                  </div>
                </div>

                <div className="shrink-0 text-right">
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      item.staff_name
                        ? "bg-slate-100 text-slate-700"
                        : "bg-amber-50 text-amber-700 ring-1 ring-amber-600/20"
                    }`}
                  >
                    {item.staff_name || "Chưa phân công"}
                  </span>
                </div>
              </button>
            ))}
            {!upcoming.length && (
              <div className="p-12 text-center text-xs text-slate-400">
                <Calendar className="h-8 w-8 text-slate-300 mx-auto mb-2 opacity-80" />
                Chưa có lịch sắp tới nào được lên kế hoạch.
              </div>
            )}
          </div>
        </article>

        {/* Right: Tình trạng sản phẩm */}
        <article className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-slate-900">Hiện trạng License & Gói</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  {products.filter((item) => item.active).length} sản phẩm, dịch vụ đang kinh doanh.
                </p>
              </div>
              <button
                onClick={onOpenProducts}
                className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:text-blue-800 cursor-pointer"
              >
                <span>Chi tiết</span>
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3">
              {[
                { label: "Đang sử dụng", value: statusCounts.active || 0, tone: "bg-emerald-50 text-emerald-700 border-emerald-200/60", dot: "bg-emerald-500" },
                { label: "Sắp hết hạn", value: statusCounts.expiring || 0, tone: "bg-amber-50 text-amber-700 border-amber-200/60", dot: "bg-amber-500" },
                { label: "Đã quá hạn", value: statusCounts.expired || 0, tone: "bg-rose-50 text-rose-700 border-rose-200/60", dot: "bg-rose-500" },
                { label: "Tạm dừng / Hủy", value: (statusCounts.paused || 0) + (statusCounts.cancelled || 0), tone: "bg-slate-50 text-slate-700 border-slate-200/60", dot: "bg-slate-400" },
              ].map(({ label, value, tone, dot }) => (
                <div key={label} className={`rounded-xl border p-3.5 ${tone} shadow-2xs`}>
                  <div className="flex items-center gap-1.5 text-xs font-semibold">
                    <span className={`h-2 w-2 rounded-full ${dot}`} />
                    <span>{label}</span>
                  </div>
                  <b className="mt-2 block text-2xl font-bold tracking-tight">{value}</b>
                </div>
              ))}
            </div>
          </div>

          {loading ? (
            <p className="mt-4 text-xs text-slate-400">Đang cập nhật dữ liệu sản phẩm...</p>
          ) : (
            <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
              <span className="inline-flex items-center gap-1 text-emerald-600 font-medium">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Dữ liệu thời gian thực
              </span>
              <span>Tổng: {subscriptions.length} gói</span>
            </div>
          )}
        </article>
      </div>

      {/* 4. Cảnh báo cần xử lý */}
      <article className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-2xs">
        <div className="border-b border-slate-100 p-5">
          <h2 className="text-base font-bold text-slate-900">Cảnh báo & Việc ưu tiên xử lý</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Tập hợp các trường hợp license hết hạn, lịch công tác chưa xếp giờ hoặc chưa có nhân sự phụ trách.
          </p>
        </div>
        <div className="grid gap-px bg-slate-100 sm:grid-cols-2">
          {alerts.slice(0, 10).map((item) => (
            <div key={item.key} className="bg-white p-4 hover:bg-slate-50/70 transition-colors">
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                  item.level === "danger"
                    ? "bg-rose-50 text-rose-700 ring-1 ring-rose-600/20"
                    : item.level === "warning"
                    ? "bg-amber-50 text-amber-700 ring-1 ring-amber-600/20"
                    : "bg-blue-50 text-blue-700 ring-1 ring-blue-600/20"
                }`}
              >
                <AlertTriangle className="h-3 w-3" />
                <span>{item.level === "danger" ? "Khẩn cấp" : item.level === "warning" ? "Cần xử lý" : "Lưu ý"}</span>
              </span>
              <b className="mt-2 block text-xs font-semibold text-slate-900">{item.title}</b>
              <span className="mt-0.5 block text-[11px] text-slate-500">{item.detail}</span>
            </div>
          ))}
          {!alerts.length && (
            <div className="bg-white p-12 text-center text-xs text-slate-500 sm:col-span-2">
              <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto mb-2 opacity-80" />
              Không có cảnh báo nào cần xử lý. Mọi hoạt động diễn ra theo đúng kế hoạch!
            </div>
          )}
        </div>
      </article>
    </section>
  );
}