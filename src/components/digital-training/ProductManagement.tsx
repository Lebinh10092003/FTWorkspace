import { useEffect, useMemo, useState } from "react";
import { appDialog } from "../AppDialog";
import { matchesSearch } from "../../lib/searchText";
import {
  AlertTriangle,
  BarChart3,
  Boxes,
  CheckCircle2,
  Clock3,
  Layers,
  Mail,
  Package,
  PackagePlus,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Tag,
  Trash2,
  Users,
  X,
} from "lucide-react";

export type ProductView = "catalog" | "allocation" | "statistics";

export type ProductPartner = {
  id: number;
  name: string;
  contact_person?: string;
  contact_position?: string;
  phone?: string;
  email?: string;
  planned_sessions?: number;
  partner_type?: string;
  partner_subtype?: string;
  province?: string;
  ward?: string;
  notes?: string;
  ai_account_count?: number;
};

type Product = {
  id: number;
  name: string;
  code: string;
  description: string;
  product_type: "product" | "service";
  active: boolean;
  display_order: number;
  customer_count: number;
  active_customer_count: number;
  expired_customer_count: number;
  total_quantity: number;
};

export type ProductSubscription = {
  id: number;
  partner: number;
  partner_name: string;
  partner_group: string;
  partner_subtype: string;
  partner_province: string;
  partner_ward: string;
  product: number;
  product_name: string;
  product_code: string;
  quantity: number;
  starts_at?: string | null;
  expires_at?: string | null;
  /** Thời gian theo hợp đồng; starts_at/expires_at là thời gian thực tế. */
  contract_starts_at?: string | null;
  contract_expires_at?: string | null;
  /** Hạn dùng để tính còn lại: thực tế, thiếu thì theo hợp đồng. */
  effective_expires_at?: string | null;
  status: "active" | "paused" | "cancelled";
  effective_status: "active" | "expiring" | "expired" | "paused" | "cancelled";
  days_remaining?: number | null;
  notes: string;
};

const statusNames: Record<string, string> = {
  active: "Đang sử dụng",
  expiring: "Sắp hết hạn",
  expired: "Đã hết hạn",
  paused: "Tạm dừng",
  cancelled: "Đã hủy",
  registered: "Có đăng ký",
  unregistered: "Chưa đăng ký",
};

const statusClass: Record<string, string> = {
  active: "bg-blue-50 text-blue-700",
  expiring: "bg-amber-50 text-amber-700",
  expired: "bg-rose-50 text-rose-700",
  paused: "bg-slate-100 text-slate-700",
  cancelled: "bg-slate-100 text-slate-500",
};

const showDate = (value?: string | null) =>
  value ? new Date(value + "T00:00:00").toLocaleDateString("vi-VN") : "Không giới hạn";

const apiError = async (response: Response) => {
  const body = await response.json().catch(() => ({}));
  if (body.error) return body.error;
  return Object.entries(body)
    .flatMap(([field, value]) => Array.isArray(value) ? value.map((item) => `${field}: ${item}`) : [`${field}: ${value}`])
    .join(" · ") || "Không thể xử lý yêu cầu.";
};

const preferenceIdentity = (token: string) => {
  if (!token) return "anonymous";
  try {
    const encoded = token.split(".")[1]?.replace(/-/g, "+").replace(/_/g, "/") || "";
    const padded = encoded + "=".repeat((4 - encoded.length % 4) % 4);
    const payload = JSON.parse(decodeURIComponent(atob(padded).split("").map((char) => `%${`00${char.charCodeAt(0).toString(16)}`.slice(-2)}`).join("")));
    return String(payload.sub || payload.email || payload.preferred_username || "anonymous");
  } catch { return "anonymous"; }
};

const emptySubscription = () => ({
  id: 0,
  partner: "",
  product: "",
  quantity: "1",
  starts_at: "",
  expires_at: "",
  status: "active",
  add_meeting: false,
  notes: "",
});

export default function ProductManagement({
  partners,
  idToken,
  isGuest,
  view,
  onOpenPartnerDetail,
  onScheduleNegotiation,
  onCreatePartner,
}: {
  partners: ProductPartner[];
  idToken: string;
  isGuest: boolean;
  view: ProductView;
  onOpenPartnerDetail?: (partnerId: number) => void;
  onScheduleNegotiation?: (partnerId: number, productId: number) => void;
  onCreatePartner?: () => void;
}) {
  const [products, setProducts] = useState<Product[]>([]);
  const [subscriptions, setSubscriptions] = useState<ProductSubscription[]>([]);
  const [busy, setBusy] = useState(false);
  const setNotice = (msg: string) => {
    if (msg) void appDialog.alert(msg, { title: "Thông báo", tone: "danger" });
  };
  const [filters, setFilters] = useState({
    query: "",
    product: "",
    group: "",
    subtype: "",
    province: "",
    ward: "",
    usage: "",
  });
  const [subscriptionDraft, setSubscriptionDraft] = useState(emptySubscription);
  const [subscriptionOpen, setSubscriptionOpen] = useState(false);
  const [productOpen, setProductOpen] = useState(false);
  const [columnPickerOpen, setColumnPickerOpen] = useState(false);
  const [savedColumnIds, setSavedColumnIds] = useState<number[] | null>(null);
  const [otherProductsPartnerId, setOtherProductsPartnerId] = useState<number | null>(null);
  const [statusDrilldown, setStatusDrilldown] = useState<"active" | "expiring" | "expired" | null>(null);
  const [productDraft, setProductDraft] = useState({ id: 0, name: "", product_type: "product", description: "", active: true });
  const auth = idToken ? { Authorization: `Bearer ${idToken}` } : {};
  const columnPreferenceKey = useMemo(() => `digital-training.product-columns.${encodeURIComponent(preferenceIdentity(idToken))}`, [idToken]);

  const load = async () => {
    setBusy(true);
    setNotice("");
    try {
      const [productResponse, subscriptionResponse] = await Promise.all([
        fetch("/api/digital-training/products", { headers: auth }),
        fetch("/api/digital-training/product-subscriptions", { headers: auth }),
      ]);
      if (!productResponse.ok) throw new Error(await apiError(productResponse));
      if (!subscriptionResponse.ok) throw new Error(await apiError(subscriptionResponse));
      setProducts(await productResponse.json());
      setSubscriptions(await subscriptionResponse.json());
    } catch (error: any) {
      setNotice(String(error?.message || error));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { void load(); }, [idToken]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(columnPreferenceKey);
      const parsed = stored ? JSON.parse(stored) : null;
      setSavedColumnIds(Array.isArray(parsed) ? parsed.map(Number).filter(Number.isFinite) : null);
    } catch { setSavedColumnIds(null); }
  }, [columnPreferenceKey]);

  const productList = [...products].sort((a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name, "vi"));
  const selectedSubscriptionProduct = productList.find((item) => String(item.id) === subscriptionDraft.product);
  const subscriptionsByCell = useMemo(
    () => new Map(subscriptions.map((item) => [`${item.partner}:${item.product}`, item])),
    [subscriptions],
  );
  const optionValues = (field: keyof ProductPartner) => Array.from(new Set(partners.map((item) => String(item[field] || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, "vi"));

  const filteredPartners = useMemo(() => partners.filter((partner) => {
    const partnerSubscriptions = subscriptions.filter((item) => item.partner === partner.id);
    const selectedSubscription = filters.product
      ? partnerSubscriptions.find((item) => String(item.product) === filters.product)
      : undefined;
    const searchable = [partner.name, partner.partner_type, partner.partner_subtype, partner.province, partner.ward, partner.notes]
      .join(" ").toLocaleLowerCase("vi-VN");
    const statusCandidates = filters.product ? (selectedSubscription ? [selectedSubscription] : []) : partnerSubscriptions;
    const usageMatches = !filters.usage
      || (filters.usage === "registered" && statusCandidates.length > 0)
      || (filters.usage === "unregistered" && statusCandidates.length === 0)
      || statusCandidates.some((item) => item.effective_status === filters.usage);
    return matchesSearch(searchable, filters.query)
      && (!filters.group || partner.partner_type === filters.group)
      && (!filters.subtype || partner.partner_subtype === filters.subtype)
      && (!filters.province || partner.province === filters.province)
      && (!filters.ward || partner.ward === filters.ward)
      && (!filters.product || filters.usage === "unregistered" || !!selectedSubscription)
      && usageMatches;
  }), [partners, subscriptions, filters]);

  const candidateProducts = useMemo(
    () => productList.filter((product) => product.active || subscriptions.some((item) => item.product === product.id)),
    [productList, subscriptions],
  );
  const recommendedProductIds = useMemo(() => {
    const partnerIds = new Set(filteredPartners.map((partner) => partner.id));
    const scoreByProduct = new Map<number, number>();
    subscriptions.forEach((item) => {
      if (!partnerIds.has(item.partner) || !["active", "expiring"].includes(item.effective_status)) return;
      scoreByProduct.set(item.product, (scoreByProduct.get(item.product) || 0) + 1);
    });
    const trainingProduct = productList.find((product) => product.code === "tap-huan");
    const trainingCount = filteredPartners.filter((partner) => Number(partner.planned_sessions || 0) > 0).length;
    if (trainingProduct && trainingCount) scoreByProduct.set(trainingProduct.id, trainingCount);
    return productList.filter((product) => scoreByProduct.has(product.id)).sort((left, right) => (scoreByProduct.get(right.id) || 0) - (scoreByProduct.get(left.id) || 0) || left.display_order - right.display_order).map((product) => product.id);
  }, [filteredPartners, productList, subscriptions]);
  const productColumns = useMemo(() => {
    const ids = savedColumnIds === null ? recommendedProductIds.slice(0, 6) : savedColumnIds;
    const selected = new Set(ids);
    return candidateProducts.filter((product) => selected.has(product.id));
  }, [candidateProducts, recommendedProductIds, savedColumnIds]);
  const selectedProductIds = useMemo(() => new Set(productColumns.map((product) => product.id)), [productColumns]);
  const otherProductsByPartner = useMemo(() => new Map(filteredPartners.map((partner) => {
    const items = productList.flatMap((product) => {
      if (selectedProductIds.has(product.id)) return [];
      const subscription = subscriptionsByCell.get(String(partner.id) + ":" + String(product.id));
      const trainingSessions = product.code === "tap-huan" ? Number(partner.planned_sessions || 0) : 0;
      return subscription || trainingSessions > 0 ? [{ product, subscription, trainingSessions }] : [];
    });
    return [partner.id, items];
  })), [filteredPartners, productList, selectedProductIds, subscriptionsByCell]);
  const otherProductsPartner = otherProductsPartnerId == null ? undefined : filteredPartners.find((partner) => partner.id === otherProductsPartnerId);
  const persistColumnIds = (ids: number[]) => {
    const unique = Array.from(new Set(ids)).filter((id) => candidateProducts.some((product) => product.id === id));
    setSavedColumnIds(unique);
    window.localStorage.setItem(columnPreferenceKey, JSON.stringify(unique));
  };
  const resetRecommendedColumns = () => {
    setSavedColumnIds(null);
    window.localStorage.removeItem(columnPreferenceKey);
  };

  const visiblePartnerIds = new Set(filteredPartners.map((item) => item.id));
  const visibleSubscriptions = subscriptions.filter((item) =>
    visiblePartnerIds.has(item.partner)
    && (!filters.product || String(item.product) === filters.product)
    && (!filters.usage || ["registered", "unregistered"].includes(filters.usage) || item.effective_status === filters.usage),
  );
  const activeSubscriptions = visibleSubscriptions.filter((item) => ["active", "expiring"].includes(item.effective_status));
  const totalQuantity = activeSubscriptions.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const statusSubscriptions = statusDrilldown
    ? visibleSubscriptions.filter((item) => item.effective_status === statusDrilldown)
    : [];

  const openSubscription = (partnerId: number, productId: number, item?: ProductSubscription) => {
    setSubscriptionDraft(item ? {
      id: item.id,
      partner: String(item.partner),
      product: String(item.product),
      quantity: String(item.quantity),
      starts_at: item.starts_at || "",
      expires_at: item.expires_at || "",
      status: item.status,
      add_meeting: false,
      notes: item.notes || "",
    } : { ...emptySubscription(), partner: String(partnerId), product: String(productId) });
    setSubscriptionOpen(true);
    setNotice("");
  };

  const saveSubscription = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    const isNegotiation = subscriptionDraft.status === "negotiating";
    try {
      const response = await fetch(
        isNegotiation ? "/api/digital-training/product-opportunities" : `/api/digital-training/product-subscriptions${subscriptionDraft.id ? `/${subscriptionDraft.id}` : ""}`,
        {
          method: isNegotiation ? "POST" : subscriptionDraft.id ? "PATCH" : "POST",
          headers: { ...auth, "Content-Type": "application/json" },
          body: JSON.stringify(isNegotiation ? {
            partner: Number(subscriptionDraft.partner), product: Number(subscriptionDraft.product), status: "negotiating", notes: subscriptionDraft.notes,
          } : {
            partner: Number(subscriptionDraft.partner), product: Number(subscriptionDraft.product), quantity: Number(subscriptionDraft.quantity), starts_at: subscriptionDraft.starts_at || null, expires_at: subscriptionDraft.expires_at || null, status: subscriptionDraft.status, notes: subscriptionDraft.notes,
          }),
        },
      );
      if (!response.ok) throw new Error(await apiError(response));
      const shouldSchedule = isNegotiation && subscriptionDraft.add_meeting;
      const partnerId = Number(subscriptionDraft.partner), productId = Number(subscriptionDraft.product);
      setSubscriptionOpen(false);
      await load();
      if (shouldSchedule) onScheduleNegotiation?.(partnerId, productId);
    } catch (error: any) {
      setNotice(String(error?.message || error));
    } finally {
      setBusy(false);
    }
  };
  const deleteSubscription = async () => {
    if (!subscriptionDraft.id) return;
    const confirmed = await appDialog.confirm("Xóa đăng ký sản phẩm này?", {
      title: "Xóa đăng ký sản phẩm",
      confirmText: "Xóa đăng ký",
      tone: "danger",
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/digital-training/product-subscriptions/${subscriptionDraft.id}`, { method: "DELETE", headers: auth });
      if (!response.ok) throw new Error(await apiError(response));
      setSubscriptionOpen(false);
      await load();
    } catch (error: any) {
      setNotice(String(error?.message || error));
    } finally {
      setBusy(false);
    }
  };

  const openProduct = (item?: Product) => {
    setProductDraft(item ? {
      id: item.id,
      name: item.name,
      product_type: item.product_type,
      description: item.description || "",
      active: item.active,
    } : { id: 0, name: "", product_type: "product", description: "", active: true });
    setNotice("");
    setProductOpen(true);
  };

  const saveProduct = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(`/api/digital-training/products${productDraft.id ? `/${productDraft.id}` : ""}`, {
        method: productDraft.id ? "PATCH" : "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: productDraft.name,
          product_type: productDraft.product_type,
          description: productDraft.description,
          active: productDraft.active,
        }),
      });
      if (!response.ok) throw new Error(await apiError(response));
      setProductOpen(false);
      await load();
    } catch (error: any) {
      setNotice(String(error?.message || error));
    } finally {
      setBusy(false);
    }
  };

  const productStatistics = productList.map((product) => {
    const rows = visibleSubscriptions.filter((item) => item.product === product.id);
    return {
      product,
      customers: new Set(rows.map((item) => item.partner)).size,
      active: rows.filter((item) => ["active", "expiring"].includes(item.effective_status)).length,
      expiring: rows.filter((item) => item.effective_status === "expiring").length,
      expired: rows.filter((item) => item.effective_status === "expired").length,
      quantity: rows.filter((item) => ["active", "expiring"].includes(item.effective_status)).reduce((sum, item) => sum + item.quantity, 0),
    };
  });
  const groupStatistics = Array.from(new Map(filteredPartners.map((partner) => {
    const key = [partner.partner_type || "Chưa phân nhóm", partner.partner_subtype || "Chưa phân loại"].join(" · ");
    return [key, key];
  })).values()).map((name) => {
    const ids = new Set(filteredPartners.filter((partner) => [partner.partner_type || "Chưa phân nhóm", partner.partner_subtype || "Chưa phân loại"].join(" · ") === name).map((partner) => partner.id));
    const rows = visibleSubscriptions.filter((item) => ids.has(item.partner));
    return { name, customers: ids.size, registered: new Set(rows.map((item) => item.partner)).size, quantity: rows.filter((item) => ["active", "expiring"].includes(item.effective_status)).reduce((sum, item) => sum + item.quantity, 0) };
  }).sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name, "vi"));

  return (
    <section className="space-y-6">
      {/* 1. Module Header */}
      <header className="rounded-2xl border border-slate-200/80 bg-white p-5 sm:p-6 shadow-2xs">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700 ring-1 ring-blue-600/20 mb-2">
              <Package className="h-3.5 w-3.5" />
              <span>{view === "allocation" ? "PHÂN BỔ SẢN PHẨM" : view === "catalog" ? "DANH MỤC SẢN PHẨM" : "THỐNG KÊ SỬ DỤNG"}</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              {view === "allocation" ? "Khách hàng & Sản phẩm đang dùng" : view === "catalog" ? "Danh mục Sản phẩm & Dịch vụ" : "Thống kê Khai thác Dịch vụ"}
            </h1>
            <p className="mt-1 text-xs text-slate-500 sm:text-sm">
              {view === "allocation"
                ? "Theo dõi đầu mối, số lượng license và hạn dùng từng dịch vụ theo từng cơ sở trường học/đối tác."
                : view === "catalog"
                ? "Quản lý danh mục sản phẩm, phần mềm, dịch vụ tập huấn và cấu hình kinh doanh."
                : "Báo cáo tổng hợp số lượng đăng ký, tỷ lệ hoạt động và cơ cấu khách hàng theo phân khúc."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void load()}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200/90 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-2xs hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 text-blue-600 ${busy ? "animate-spin" : ""}`} />
              <span>Làm mới</span>
            </button>
            {!isGuest && view === "catalog" && (
              <button
                type="button"
                onClick={() => openProduct()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white shadow-2xs hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Thêm sản phẩm</span>
              </button>
            )}
            {!isGuest && view === "allocation" && (
              <button
                type="button"
                onClick={() => onCreatePartner?.()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white shadow-2xs hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <Users className="h-3.5 w-3.5" />
                <span>Thêm khách hàng</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* 2. Filter Bar (for allocation and statistics views) */}
      {view !== "catalog" && (
        <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
            <div className="relative xl:col-span-2">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                value={filters.query}
                onChange={(event) => setFilters({ ...filters, query: event.target.value })}
                className="w-full rounded-lg border border-slate-200/90 bg-white py-2 pl-9 pr-8 text-xs font-medium text-slate-700 shadow-2xs placeholder:text-slate-400 hover:border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition-all"
                placeholder="Tìm trường, nhóm, địa bàn..."
              />
              {filters.query && (
                <button
                  type="button"
                  onClick={() => setFilters({ ...filters, query: "" })}
                  className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <select
              value={filters.product}
              onChange={(event) => setFilters({ ...filters, product: event.target.value })}
              className="rounded-lg border border-slate-200/90 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-2xs hover:border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition-all cursor-pointer"
            >
              <option value="">Tất cả sản phẩm</option>
              {productList.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <select
              value={filters.group}
              onChange={(event) => setFilters({ ...filters, group: event.target.value, subtype: "" })}
              className="rounded-lg border border-slate-200/90 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-2xs hover:border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition-all cursor-pointer"
            >
              <option value="">Tất cả nhóm</option>
              {optionValues("partner_type").map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
            <select
              value={filters.subtype}
              onChange={(event) => setFilters({ ...filters, subtype: event.target.value })}
              className="rounded-lg border border-slate-200/90 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-2xs hover:border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition-all cursor-pointer"
            >
              <option value="">Tất cả loại hình</option>
              {optionValues("partner_subtype").map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
            <select
              value={filters.province}
              onChange={(event) => setFilters({ ...filters, province: event.target.value, ward: "" })}
              className="rounded-lg border border-slate-200/90 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-2xs hover:border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition-all cursor-pointer"
            >
              <option value="">Tất cả tỉnh/thành</option>
              {optionValues("province").map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
            <select
              value={filters.usage}
              onChange={(event) => setFilters({ ...filters, usage: event.target.value })}
              className="rounded-lg border border-slate-200/90 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-2xs hover:border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition-all cursor-pointer"
            >
              <option value="">Tất cả trạng thái</option>
              {["registered", "unregistered", "active", "expiring", "expired", "paused", "cancelled"].map((item) => (
                <option key={item} value={item}>
                  {statusNames[item]}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}


      {/* 3. View Switcher */}
      {view === "catalog" ? (
        /* CATALOG VIEW */
        <article className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-2xs">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5">
            <div>
              <h2 className="text-base font-bold text-slate-900">Danh mục sản phẩm & dịch vụ</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Hiển thị {products.length} danh mục với tổng số lượng khách hàng và trạng thái kinh doanh.
              </p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse min-w-[900px]">
              <thead>
                <tr className="border-b border-slate-200/80 bg-slate-50/75 text-2xs font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap">
                  <th className="py-3 px-4 w-16 min-w-16 text-center">STT</th>
                  <th className="py-3 px-4">Tên sản phẩm / Dịch vụ</th>
                  <th className="py-3 px-4">Loại hình</th>
                  <th className="py-3 px-4">Mô tả</th>
                  <th className="py-3 px-4 text-center">Khách hàng</th>
                  <th className="py-3 px-4 text-center">Tổng SL</th>
                  <th className="py-3 px-4">Trạng thái</th>
                  <th className="py-3 px-4 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {[...products]
                  .sort((a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name, "vi"))
                  .map((item, index) => (
                    <tr key={item.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3.5 px-4 text-center text-xs font-medium text-slate-400">{index + 1}</td>
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-slate-900">{item.name}</div>
                        <span className="inline-block mt-0.5 rounded-sm bg-slate-100 px-1.5 py-0.2 font-mono text-[10px] text-slate-500">
                          {item.code}
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                            item.product_type === "service"
                              ? "bg-blue-50 text-blue-700 ring-1 ring-blue-600/20"
                              : "bg-purple-50 text-purple-700 ring-1 ring-purple-600/20"
                          }`}
                        >
                          <Tag className="h-3 w-3" />
                          <span>{item.product_type === "service" ? "Dịch vụ" : "Sản phẩm"}</span>
                        </span>
                      </td>
                      <td className="py-3.5 px-4 max-w-md whitespace-normal text-xs text-slate-600">
                        {item.description || "—"}
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <span className="inline-flex items-center justify-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
                          {item.customer_count}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <b className="text-slate-900">{item.total_quantity}</b>
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                            item.active
                              ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/20"
                              : "bg-slate-100 text-slate-600 ring-1 ring-slate-200"
                          }`}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full ${item.active ? "bg-emerald-600" : "bg-slate-400"}`} />
                          <span>{item.active ? "Đang kinh doanh" : "Ngừng kinh doanh"}</span>
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        {!isGuest && (
                          <button
                            type="button"
                            onClick={() => openProduct(item)}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-200/90 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 hover:text-blue-600 transition-colors cursor-pointer"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            <span>Sửa</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                {!products.length && (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-xs text-slate-500">
                      Chưa có sản phẩm hoặc dịch vụ nào trong danh mục.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </article>
      ) : view === "allocation" ? (
        /* ALLOCATION MATRIX VIEW */
        <article className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-2xs">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4 sm:p-5">
            <div>
              <h2 className="text-base font-bold text-slate-900">Sản phẩm đang sử dụng theo khách hàng</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                {filteredPartners.length} khách hàng · {activeSubscriptions.length} gói dịch vụ đang hoạt động · Tổng số lượng: {totalQuantity}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setColumnPickerOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200/90 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 transition-colors cursor-pointer"
            >
              <SlidersHorizontal className="h-3.5 w-3.5 text-slate-500" />
              <span>Chọn cột hiển thị ({productColumns.length})</span>
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse min-w-[1120px]">
              <thead>
                <tr className="border-b border-slate-200/80 bg-slate-50/80 text-2xs font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap">
                  <th className="sticky left-0 z-30 w-16 min-w-16 bg-slate-50/95 py-3 px-3 text-center border-r border-slate-200/60 whitespace-nowrap">STT</th>
                  <th className="sticky z-30 min-w-56 bg-slate-50/95 py-3 px-4 border-r border-slate-200/60" style={{ left: "3rem" }}>
                    Tên khách hàng
                  </th>
                  <th className="sticky z-30 min-w-52 bg-slate-50/95 py-3 px-4 border-r border-slate-200/60" style={{ left: "17rem" }}>
                    Đại diện & Liên hệ
                  </th>
                  {productColumns.map((product) => (
                    <th key={product.id} className="min-w-48 py-3 px-4 border-r border-slate-100">
                      <div className="font-bold text-slate-900">{product.name}</div>
                      <span className="block text-[10px] font-normal text-slate-400 truncate max-w-44">
                        {product.description || "Gói bản quyền"}
                      </span>
                    </th>
                  ))}
                  <th className="min-w-36 py-3 px-4">Dịch vụ khác</th>
                  <th className="min-w-40 py-3 px-4">Ghi chú</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredPartners.length ? (
                  filteredPartners.map((partner, index) => {
                    const otherItems = otherProductsByPartner.get(partner.id) || [];
                    const area = [partner.ward, partner.province].filter(Boolean).join(" - ");
                    const contact = [partner.contact_person, partner.contact_position].filter(Boolean).join(" - ");
                    return (
                      <tr
                        key={partner.id}
                        onClick={() => onOpenPartnerDetail?.(partner.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            onOpenPartnerDetail?.(partner.id);
                          }
                        }}
                        role="link"
                        tabIndex={0}
                        className="group cursor-pointer hover:bg-slate-50/70 transition-colors"
                      >
                        <td className="sticky left-0 z-10 bg-white group-hover:bg-slate-50/70 py-3 px-3 text-center text-xs font-medium text-slate-400 border-r border-slate-200/60">
                          {index + 1}
                        </td>
                        <td
                          className="sticky z-10 bg-white group-hover:bg-slate-50/70 py-3 px-4 border-r border-slate-200/60"
                          style={{ left: "3rem" }}
                        >
                          <div className="font-semibold text-slate-900 group-hover:text-blue-600 transition-colors">
                            {partner.name}
                          </div>
                          {area && <span className="block text-[11px] text-slate-500 mt-0.5">{area}</span>}
                        </td>
                        <td
                          className="sticky z-10 bg-white group-hover:bg-slate-50/70 py-3 px-4 border-r border-slate-200/60 text-xs"
                          style={{ left: "17rem" }}
                        >
                          {contact && <div className="font-medium text-slate-800">{contact}</div>}
                          {partner.phone && (
                            <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 mt-0.5">
                              <Phone className="h-3 w-3 text-slate-400" />
                              {partner.phone}
                            </span>
                          )}
                          {partner.email && (
                            <span className="block text-[11px] text-slate-400 truncate max-w-44">
                              {partner.email}
                            </span>
                          )}
                        </td>
                        {productColumns.map((product) => {
                          const item = subscriptionsByCell.get(String(partner.id) + ":" + String(product.id));
                          const trainingSessions = Number(partner.planned_sessions || 0);
                          const hasTrainingSessions = product.code === "tap-huan" && trainingSessions > 0;
                          return (
                            <td key={product.id} className="py-2.5 px-3 border-r border-slate-100">
                              {hasTrainingSessions ? (
                                <span className="block rounded-xl border border-cyan-200 bg-cyan-50/80 p-2.5 text-center text-xs font-bold text-cyan-800 shadow-2xs">
                                  {trainingSessions} buổi tập huấn
                                </span>
                              ) : item ? (
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    if (!isGuest) openSubscription(partner.id, product.id, item);
                                  }}
                                  className={`w-full rounded-xl border p-2.5 text-left transition-all shadow-2xs ${
                                    item.effective_status === "expired"
                                      ? "border-rose-300 bg-rose-50/80 text-rose-900 hover:bg-rose-100"
                                      : item.effective_status === "expiring"
                                      ? "border-amber-300 bg-amber-50/80 text-amber-900 hover:bg-amber-100"
                                      : "border-slate-200 bg-white hover:border-blue-400 hover:bg-blue-50/40"
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-1">
                                    <span className="text-xs font-bold">
                                      SL: {item.quantity} · {statusNames[item.effective_status]}
                                    </span>
                                    {!isGuest && <Pencil className="h-3 w-3 text-slate-400 hover:text-blue-600" />}
                                  </div>
                                  <div className="mt-1 text-[11px] text-slate-500 font-medium">
                                    Hạn: {showDate(item.expires_at)}
                                  </div>
                                </button>
                              ) : !product.active ? (
                                <span className="text-xs font-medium text-slate-400 italic">Ngừng kinh doanh</span>
                              ) : !isGuest ? (
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    openSubscription(partner.id, product.id);
                                  }}
                                  className="flex min-h-[4rem] w-full items-center justify-center rounded-xl border border-dashed border-slate-200 hover:border-blue-400 hover:bg-blue-50/30 text-xs font-medium text-slate-400 hover:text-blue-600 transition-all cursor-pointer"
                                >
                                  + Đăng ký
                                </button>
                              ) : (
                                <span className="flex min-h-[4rem] items-center justify-center text-xs font-medium text-slate-300">
                                  —
                                </span>
                              )}
                            </td>
                          );
                        })}
                        <td className="py-2.5 px-3">
                          {otherItems.length ? (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                setOtherProductsPartnerId(partner.id);
                              }}
                              className="w-full rounded-lg border border-dashed border-violet-300 bg-violet-50 px-2.5 py-2 text-xs font-bold text-violet-700 hover:bg-violet-100 transition-colors shadow-2xs"
                            >
                              + {otherItems.length} sản phẩm khác
                            </button>
                          ) : null}
                        </td>
                        <td className="py-2.5 px-3 min-w-40 text-xs text-slate-500">
                          {partner.notes || "—"}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={5 + productColumns.length} className="py-12 text-center text-xs text-slate-500">
                      Không có khách hàng phù hợp bộ lọc.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </article>
      ) : (
        /* STATISTICS VIEW */
        <div className="space-y-6">
          {/* 5 Bento Metric Cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <div className="rounded-xl border border-slate-200/90 bg-white p-5 shadow-2xs flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-500">Khách hàng phù hợp</span>
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                  <Users className="h-4 w-4" />
                </div>
              </div>
              <div className="mt-3">
                <div className="text-2xl font-bold tracking-tight text-slate-900">{filteredPartners.length}</div>
                <div className="mt-1 text-xs text-slate-500">Đối tác trong phân hệ</div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200/90 bg-white p-5 shadow-2xs flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-500">Sản phẩm & Dịch vụ</span>
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-50 text-purple-600">
                  <Boxes className="h-4 w-4" />
                </div>
              </div>
              <div className="mt-3">
                <div className="text-2xl font-bold tracking-tight text-slate-900">{productList.length}</div>
                <div className="mt-1 text-xs text-slate-500">Danh mục cung ứng</div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200/90 bg-white p-5 shadow-2xs flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-500">Tổng license đang dùng</span>
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                  <PackagePlus className="h-4 w-4" />
                </div>
              </div>
              <div className="mt-3">
                <div className="text-2xl font-bold tracking-tight text-slate-900">{totalQuantity}</div>
                <div className="mt-1 text-xs text-emerald-600 font-medium">Hoạt động ổn định</div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setStatusDrilldown("expiring")}
              className="rounded-xl border border-amber-200 bg-amber-50/40 p-5 shadow-2xs flex flex-col justify-between text-left hover:border-amber-400 hover:bg-amber-50 transition-all cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-amber-700">Sắp hết hạn (30 ngày)</span>
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
                  <Clock3 className="h-4 w-4" />
                </div>
              </div>
              <div className="mt-3">
                <div className="text-2xl font-bold tracking-tight text-amber-900">
                  {visibleSubscriptions.filter((item) => item.effective_status === "expiring").length}
                </div>
                <div className="mt-1 text-xs text-amber-700 font-medium">Bấm xem chi tiết →</div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setStatusDrilldown("expired")}
              className="rounded-xl border border-rose-200 bg-rose-50/40 p-5 shadow-2xs flex flex-col justify-between text-left hover:border-rose-400 hover:bg-rose-50 transition-all cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-rose-700">Đã quá hạn sử dụng</span>
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-100 text-rose-700">
                  <AlertTriangle className="h-4 w-4" />
                </div>
              </div>
              <div className="mt-3">
                <div className="text-2xl font-bold tracking-tight text-rose-900">
                  {visibleSubscriptions.filter((item) => item.effective_status === "expired").length}
                </div>
                <div className="mt-1 text-xs text-rose-700 font-medium">Cần liên hệ tái ký →</div>
              </div>
            </button>
          </div>

          {/* 2 Side-by-side Bento Tables */}
          <div className="grid gap-6 xl:grid-cols-2">
            <article className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-2xs">
              <div className="p-5 border-b border-slate-100">
                <h2 className="text-base font-bold text-slate-900">Thống kê theo sản phẩm</h2>
                <p className="mt-0.5 text-xs text-slate-500">Mức độ phân bổ và tình trạng license theo từng đầu sản phẩm.</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200/80 bg-slate-50/75 text-2xs font-semibold uppercase tracking-wider text-slate-500">
                      <th className="py-3 px-4">Sản phẩm</th>
                      <th className="py-3 px-3 text-center">Khách hàng</th>
                      <th className="py-3 px-3 text-center">Đang dùng</th>
                      <th className="py-3 px-3 text-center">Sắp hết</th>
                      <th className="py-3 px-3 text-center">Quá hạn</th>
                      <th className="py-3 px-4 text-center">Số lượng</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {productStatistics.map((item) => (
                      <tr key={item.product.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-3 px-4 font-semibold text-slate-900">{item.product.name}</td>
                        <td className="py-3 px-3 text-center text-slate-600">{item.customers}</td>
                        <td className="py-3 px-3 text-center font-bold text-emerald-600">{item.active}</td>
                        <td className="py-3 px-3 text-center font-bold text-amber-600">{item.expiring}</td>
                        <td className="py-3 px-3 text-center font-bold text-rose-600">{item.expired}</td>
                        <td className="py-3 px-4 text-center font-bold text-slate-900">{item.quantity}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>

            <article className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-2xs">
              <div className="p-5 border-b border-slate-100">
                <h2 className="text-base font-bold text-slate-900">Thống kê theo nhóm khách hàng</h2>
                <p className="mt-0.5 text-xs text-slate-500">Cơ cấu khách hàng và số lượng license đang khai thác.</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200/80 bg-slate-50/75 text-2xs font-semibold uppercase tracking-wider text-slate-500">
                      <th className="py-3 px-4">Nhóm / Loại hình</th>
                      <th className="py-3 px-4 text-center">Tổng khách hàng</th>
                      <th className="py-3 px-4 text-center">Đang dùng DV</th>
                      <th className="py-3 px-4 text-center">Số lượng license</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {groupStatistics.map((item) => (
                      <tr key={item.name} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-3 px-4 font-semibold text-slate-900">{item.name}</td>
                        <td className="py-3 px-4 text-center text-slate-600">{item.customers}</td>
                        <td className="py-3 px-4 text-center font-bold text-blue-600">{item.registered}</td>
                        <td className="py-3 px-4 text-center font-bold text-slate-900">{item.quantity}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          </div>
        </div>
      )}

      {/* 4. Modals and Dialogs */}
      {/* Drilldown Modal */}
      {statusDrilldown && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 backdrop-blur-xs p-4">
          <div className="max-h-[calc(100vh-2rem)] w-full max-w-4xl overflow-hidden rounded-2xl bg-white shadow-2xl border border-slate-200/90 flex flex-col">
            <div className={`flex items-start justify-between gap-3 border-b p-5 ${statusDrilldown === "expired" ? "bg-rose-50/70" : "bg-amber-50/70"}`}>
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  {statusDrilldown === "expired" ? "Sản phẩm đã quá hạn" : "Sản phẩm sắp hết hạn (trong 30 ngày)"}
                </h2>
                <p className="mt-0.5 text-xs text-slate-600">
                  Có {statusSubscriptions.length} gói dịch vụ cần theo dõi và hỗ trợ gia hạn.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setStatusDrilldown(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-white hover:text-slate-600 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="overflow-y-auto max-h-[60vh]">
              <table className="w-full text-left text-sm border-collapse">
                <thead>
                  <tr className="border-b border-slate-200/80 bg-slate-50/75 text-2xs font-semibold uppercase tracking-wider text-slate-500">
                    <th className="py-3 px-4">Khách hàng</th>
                    <th className="py-3 px-4">Sản phẩm</th>
                    <th className="py-3 px-4">Hạn sử dụng</th>
                    <th className="py-3 px-4">Thời gian còn lại</th>
                    <th className="py-3 px-4 text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {statusSubscriptions.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4 font-semibold text-slate-900">{item.partner_name}</td>
                      <td className="py-3 px-4 text-slate-700">{item.product_name}</td>
                      <td className={`py-3 px-4 font-bold ${item.effective_status === "expired" ? "text-rose-700" : "text-amber-700"}`}>
                        {showDate(item.expires_at)}
                      </td>
                      <td className="py-3 px-4 text-slate-600">
                        {item.days_remaining == null
                          ? "—"
                          : item.days_remaining < 0
                          ? `Quá hạn ${Math.abs(item.days_remaining)} ngày`
                          : `Còn ${item.days_remaining} ngày`}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setStatusDrilldown(null);
                              onOpenPartnerDetail?.(item.partner);
                            }}
                            className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            Hồ sơ
                          </button>
                          {!isGuest && (
                            <button
                              type="button"
                              onClick={() => {
                                setStatusDrilldown(null);
                                openSubscription(item.partner, item.product, item);
                              }}
                              className="rounded-md bg-blue-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                            >
                              Gia hạn
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!statusSubscriptions.length && (
                    <tr>
                      <td colSpan={5} className="py-10 text-center text-xs text-slate-500">
                        Không có gói đăng ký nào ở trạng thái này.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Column Picker Modal */}
      {columnPickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 backdrop-blur-xs p-4">
          <div className="max-h-[calc(100vh-2rem)] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl border border-slate-200/90">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Chọn cột sản phẩm hiển thị</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Tùy chỉnh các cột dịch vụ xuất hiện trên bảng ma trận. Cấu hình được ghi nhớ riêng cho tài khoản của bạn.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setColumnPickerOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => persistColumnIds(candidateProducts.map((product) => product.id))}
                className="rounded-lg border border-slate-200/90 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 cursor-pointer"
              >
                Hiện tất cả ({candidateProducts.length})
              </button>
              <button
                type="button"
                onClick={resetRecommendedColumns}
                className="rounded-lg border border-slate-200/90 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 cursor-pointer"
              >
                Khôi phục mặc định
              </button>
            </div>
            <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
              {candidateProducts.map((product) => {
                const checked = productColumns.some((item) => item.id === product.id);
                return (
                  <label
                    key={product.id}
                    className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors ${
                      checked ? "border-blue-300 bg-blue-50/40" : "border-slate-200 bg-white hover:border-slate-300"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        const base = savedColumnIds === null ? productColumns.map((item) => item.id) : savedColumnIds;
                        persistColumnIds(checked ? base.filter((id) => id !== product.id) : [...base, product.id]);
                      }}
                      className="h-4 w-4 rounded-sm border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <div className="min-w-0">
                      <b className="block text-xs text-slate-900 truncate">{product.name}</b>
                      <span className="text-[11px] text-slate-500 truncate block">{product.description || "Gói dịch vụ"}</span>
                    </div>
                  </label>
                );
              })}
              {!candidateProducts.length && (
                <p className="py-6 text-xs text-slate-500 col-span-2 text-center">Chưa có sản phẩm nào để chọn.</p>
              )}
            </div>
            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => setColumnPickerOpen(false)}
                className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white shadow-2xs hover:bg-slate-800 cursor-pointer"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Other Products Modal */}
      {otherProductsPartner && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 backdrop-blur-xs p-4">
          <div className="max-h-[calc(100vh-2rem)] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl border border-slate-200/90">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Sản phẩm & Dịch vụ khác</h2>
                <p className="mt-0.5 text-xs text-slate-500">{otherProductsPartner.name}</p>
              </div>
              <button
                type="button"
                onClick={() => setOtherProductsPartnerId(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-4 space-y-3">
              {(otherProductsByPartner.get(otherProductsPartner.id) || []).map(
                ({ product, subscription, trainingSessions }) => (
                  <div key={product.id} className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <b className="text-xs font-bold text-slate-900">{product.name}</b>
                        <p className="mt-0.5 text-[11px] text-slate-500">{product.description}</p>
                      </div>
                      {!isGuest && subscription && (
                        <button
                          type="button"
                          onClick={() => openSubscription(otherProductsPartner.id, product.id, subscription)}
                          className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          Sửa
                        </button>
                      )}
                    </div>
                    <p className="mt-2 text-xs font-semibold text-slate-800">
                      {trainingSessions > 0 ? `${trainingSessions} buổi` : `Số lượng: ${subscription?.quantity || 0}`}
                    </p>
                    {subscription && (
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        Trạng thái: {statusNames[subscription.effective_status]} · Hạn: {showDate(subscription.expires_at)}
                      </p>
                    )}
                  </div>
                ),
              )}
            </div>
            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => setOtherProductsPartnerId(null)}
                className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white shadow-2xs hover:bg-slate-800 cursor-pointer"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Subscription Edit / Create Modal */}
      {subscriptionOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 backdrop-blur-xs p-4">
          <form
            onSubmit={saveSubscription}
            className="max-h-[calc(100vh-2rem)] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl border border-slate-200/90"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  {subscriptionDraft.id ? "Cập nhật đăng ký dịch vụ" : "Đăng ký dịch vụ mới"}
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">Thiết lập số lượng license, thời hạn và trạng thái khai thác.</p>
              </div>
              <button
                type="button"
                onClick={() => setSubscriptionOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2 text-xs">
              <label>
                <span className="mb-1 block font-bold text-slate-700">Khách hàng *</span>
                <select
                  required
                  disabled={!!subscriptionDraft.id}
                  value={subscriptionDraft.partner}
                  onChange={(event) => setSubscriptionDraft({ ...subscriptionDraft, partner: event.target.value })}
                  className="w-full rounded-lg border border-slate-200/90 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-2xs disabled:bg-slate-100"
                >
                  <option value="">Chọn khách hàng</option>
                  {partners.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="mb-1 block font-bold text-slate-700">Sản phẩm *</span>
                <select
                  required
                  disabled={!!subscriptionDraft.id}
                  value={subscriptionDraft.product}
                  onChange={(event) => setSubscriptionDraft({ ...subscriptionDraft, product: event.target.value })}
                  className="w-full rounded-lg border border-slate-200/90 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-2xs disabled:bg-slate-100"
                >
                  <option value="">Chọn sản phẩm</option>
                  {productList.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="mb-1 block font-bold text-slate-700">Số lượng license *</span>
                <input
                  required
                  type="number"
                  min="1"
                  className="w-full rounded-lg border border-slate-200/90 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-2xs"
                  value={subscriptionDraft.quantity}
                  onChange={(event) => setSubscriptionDraft({ ...subscriptionDraft, quantity: event.target.value })}
                />
              </label>
              <label>
                <span className="mb-1 block font-bold text-slate-700">Trạng thái</span>
                <select
                  className="w-full rounded-lg border border-slate-200/90 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-2xs"
                  value={subscriptionDraft.status}
                  onChange={(event) => setSubscriptionDraft({ ...subscriptionDraft, status: event.target.value as any })}
                >
                  <option value="active">Đang sử dụng</option>
                  <option value="negotiating">Đang thương thảo</option>
                  <option value="paused">Tạm dừng</option>
                  <option value="cancelled">Đã hủy</option>
                </select>
              </label>
              {subscriptionDraft.status === "negotiating" && (
                <label className="sm:col-span-2 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-900">
                  <input
                    type="checkbox"
                    checked={subscriptionDraft.add_meeting}
                    onChange={(event) => setSubscriptionDraft({ ...subscriptionDraft, add_meeting: event.target.checked })}
                    className="h-4 w-4"
                  />
                  Thêm lịch hẹn sau khi lưu
                </label>
              )}
              <label>
                <span className="mb-1 block font-bold text-slate-700">Ngày bắt đầu</span>
                <input
                  type="date"
                  className="w-full rounded-lg border border-slate-200/90 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-2xs"
                  value={subscriptionDraft.starts_at}
                  onChange={(event) => setSubscriptionDraft({ ...subscriptionDraft, starts_at: event.target.value })}
                />
              </label>
              <label>
                <span className="mb-1 block font-bold text-slate-700">Hạn sử dụng</span>
                {selectedSubscriptionProduct?.code === "tap-huan" ? (
                  <div className="w-full rounded-lg border border-slate-200/90 bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-600">
                    Không giới hạn
                  </div>
                ) : (
                  <input
                    type="date"
                    className="w-full rounded-lg border border-slate-200/90 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-2xs"
                    value={subscriptionDraft.expires_at}
                    onChange={(event) => setSubscriptionDraft({ ...subscriptionDraft, expires_at: event.target.value })}
                  />
                )}
              </label>
              <label className="sm:col-span-2">
                <span className="mb-1 block font-bold text-slate-700">Ghi chú</span>
                <textarea
                  className="w-full rounded-lg border border-slate-200/90 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-2xs min-h-20"
                  value={subscriptionDraft.notes}
                  onChange={(event) => setSubscriptionDraft({ ...subscriptionDraft, notes: event.target.value })}
                />
              </label>
            </div>
            <div className="mt-6 flex items-center justify-between gap-3">
              {subscriptionDraft.id ? (
                <button
                  type="button"
                  onClick={() => void deleteSubscription()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 cursor-pointer"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Xóa đăng ký</span>
                </button>
              ) : (
                <div />
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setSubscriptionOpen(false)}
                  className="rounded-lg border border-slate-200/90 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  disabled={busy}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white shadow-2xs hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
                >
                  Lưu đăng ký
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* Product Edit / Create Modal */}
      {productOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 backdrop-blur-xs p-4">
          <form
            onSubmit={saveProduct}
            className="max-h-[calc(100vh-2rem)] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl border border-slate-200/90"
          >
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  {productDraft.id ? "Cập nhật sản phẩm / dịch vụ" : "Thêm sản phẩm hoặc dịch vụ"}
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">Thông tin danh mục được dùng chung cho phân bổ và báo cáo.</p>
              </div>
              <button
                type="button"
                onClick={() => setProductOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2 text-xs">
              <label className="sm:col-span-2">
                <span className="mb-1 block font-bold text-slate-700">Tên sản phẩm / dịch vụ *</span>
                <input
                  required
                  className="w-full rounded-lg border border-slate-200/90 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-2xs"
                  value={productDraft.name}
                  onChange={(event) => setProductDraft({ ...productDraft, name: event.target.value })}
                />
              </label>
              <label className="sm:col-span-2">
                <span className="mb-1 block font-bold text-slate-700">Loại hình *</span>
                <select
                  className="w-full rounded-lg border border-slate-200/90 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-2xs"
                  value={productDraft.product_type}
                  onChange={(event) => setProductDraft({ ...productDraft, product_type: event.target.value as any })}
                >
                  <option value="product">Sản phẩm / Phần mềm</option>
                  <option value="service">Dịch vụ / Đào tạo</option>
                </select>
              </label>
              <label className="sm:col-span-2">
                <span className="mb-1 block font-bold text-slate-700">Mô tả</span>
                <textarea
                  className="w-full rounded-lg border border-slate-200/90 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-2xs min-h-20"
                  value={productDraft.description}
                  onChange={(event) => setProductDraft({ ...productDraft, description: event.target.value })}
                />
              </label>
              <label className="sm:col-span-2 flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <input
                  type="checkbox"
                  checked={productDraft.active}
                  onChange={(event) => setProductDraft({ ...productDraft, active: event.target.checked })}
                  className="h-4 w-4 rounded-sm text-blue-600 focus:ring-blue-500"
                />
                <span className="text-xs font-semibold text-slate-800">
                  Đang kinh doanh và cho phép phân bổ license mới
                </span>
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setProductOpen(false)}
                className="rounded-lg border border-slate-200/90 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Hủy
              </button>
              <button
                disabled={busy}
                className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white shadow-2xs hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
              >
                {productDraft.id ? "Lưu thay đổi" : "Thêm mới"}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
