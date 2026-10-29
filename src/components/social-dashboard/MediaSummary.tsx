import { useEffect, useMemo, useState } from 'react';
import { appDialog } from '../AppDialog';
import { AlertCircle, BarChart3, Download, FileSpreadsheet, RefreshCw, TrendingDown, TrendingUp } from 'lucide-react';
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Channel, Platform } from '../../types';
import SearchableSelect from '../SearchableSelect';
import { pastDateVN, todayVN } from '../../lib/vnDate';

interface MediaSummaryRow { id: string; platform: Platform; name: string; externalId: string; lastSyncAt: string | null; lastSyncStatus: 'success' | 'failed' | null; followersCount: number; postsCount: number; views: number; totalEngagement: number; }
interface TrendPoint { period: string; label: string; views: number; engagement: number; postsCount: number; followers: number; metricSource?: 'daily_insights' | 'unavailable'; startValues?: Record<string, number>; endValues?: Record<string, number>; }
interface MediaSummaryProps { idToken: string; channels: Channel[]; }
type PeriodGroup = 'month' | 'quarter' | 'year';
const getPastDateStr = pastDateVN;
const getTodayStr = todayVN;
const percentChange = (current: number, previous?: number) => previous === undefined || previous === 0 ? null : ((current - previous) / previous) * 100;
const metricRows = [{ key: 'views', label: 'Lượt xem', color: '#0891b2' }, { key: 'engagement', label: 'Lượt tương tác', color: '#2563eb' }, { key: 'postsCount', label: 'Số bài đăng', color: '#10b981' }, { key: 'followers', label: 'Lượt follow', color: '#7c3aed' }] as const;

export default function MediaSummary({ idToken, channels }: MediaSummaryProps) {
  const [rows, setRows] = useState<MediaSummaryRow[]>([]);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const startDate = getPastDateStr(365);
  const endDate = getTodayStr();
  const [exporting, setExporting] = useState(false);
  const [periodGroup, setPeriodGroup] = useState<PeriodGroup>('month');
  const [platformFilter, setPlatformFilter] = useState('all');
  const [channelFilter, setChannelFilter] = useState('all');
  const [activeMetric, setActiveMetric] = useState<(typeof metricRows)[number]['key']>('views');
  const filteredChannels = useMemo(() => channels.filter(channel => channel.status === 'active' && (platformFilter === 'all' || channel.platform === platformFilter)), [channels, platformFilter]);
  const activeMetricConfig = metricRows.find(metric => metric.key === activeMetric)!;
  const chartData = useMemo(() => trend.map((point, index) => {
    const needsDailyInsights = activeMetric === 'views' || activeMetric === 'engagement';
    const value = needsDailyInsights && point.metricSource !== 'daily_insights' ? null : point[activeMetric];
    const previous = trend[index - 1];
    const previousValue = !previous || (needsDailyInsights && previous.metricSource !== 'daily_insights') ? undefined : previous[activeMetric];
    const change = value === null ? null : percentChange(value, previousValue);
    return {
      ...point,
      value,
      growth: change ?? 0,
      growthMissing: change === null,
    };
  }), [trend, activeMetric]);
  const deltaRows = useMemo(() => chartData.map((point, index) => ({ point, index })).reverse(), [chartData]);

  const params = () => { const search = new URLSearchParams({ startDate, endDate, groupBy: periodGroup }); if (platformFilter !== 'all') search.set('platform', platformFilter); if (channelFilter !== 'all') search.set('channelId', channelFilter); return search; };
  const loadSummary = async () => {
    setLoading(true); setError(null);
    try {
      const search = params();
      const headers = { Authorization: `Bearer ${idToken}` };
      const [summaryResponse, trendResponse] = await Promise.all([fetch(`/api/media-summary?${search.toString()}`, { headers, cache: 'no-store' }), fetch(`/api/media-summary/trend?${search.toString()}`, { headers, cache: 'no-store' })]);
      const [summaryBody, trendBody] = await Promise.all([summaryResponse.json(), trendResponse.json()]);
      if (!summaryResponse.ok) throw new Error(summaryBody.error || 'Không thể tải báo cáo tổng hợp.');
      if (!trendResponse.ok) throw new Error(trendBody.error || 'Không thể tải xu hướng báo cáo.');
      setRows(summaryBody); setTrend(trendBody.trend || []);
    } catch (loadError: any) { setError(loadError.message || 'Không thể kết nối tới hệ thống.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { loadSummary(); }, [idToken, startDate, endDate, periodGroup, platformFilter, channelFilter]);
  const downloadXlsx = async () => {
    setExporting(true);
    try {
      const response = await fetch('/api/reports/media-summary.xlsx?' + params().toString(), {
        headers: { Authorization: 'Bearer ' + idToken },
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || 'Không thể tạo file Excel.');
      }
      const blob = await response.blob();
      if (blob.size === 0) throw new Error('File Excel trống.');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'bao_cao_tong_hop_' + getTodayStr() + '.xlsx';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (downloadError: any) {
      void appDialog.alert(downloadError.message || 'Không thể tải file Excel.', { title: 'Tải file thất bại', tone: 'danger' });
    } finally {
      setExporting(false);
    }
  };

  return <div className="space-y-7 pb-10">
    <div className="border-b border-slate-200/70 pb-5">
      <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight">Báo cáo tổng hợp</h2>
      <p className="text-sm text-slate-500 mt-1">Theo dõi diễn biến hiệu quả đa kênh và so sánh biến động theo từng kỳ.</p>
    </div>
    <section className="flex flex-wrap items-center gap-3 bg-slate-50 border border-slate-200/70 p-3 rounded-xl">
      <span className="text-sm font-bold text-slate-600">Lọc báo cáo:</span>
      <SearchableSelect
        value={platformFilter}
        onChange={value => { setPlatformFilter(value); setChannelFilter('all'); }}
        options={[{ value: 'all', label: 'Tất cả nền tảng' }, { value: 'facebook', label: 'Facebook Pages' }, { value: 'zalo', label: 'Zalo OA' }]}
        className="min-w-[190px]"
      />
      <SearchableSelect
        value={channelFilter}
        onChange={setChannelFilter}
        options={[{ value: 'all', label: 'Tất cả các trang' }, ...filteredChannels.map(channel => ({ value: channel.id, label: channel.name }))]}
        className="min-w-[230px]"
      />
      <div className="ml-1 flex rounded-lg border border-slate-200 bg-white p-1">
        {([{ value: 'month', label: 'Theo tháng' }, { value: 'quarter', label: 'Theo quý' }, { value: 'year', label: 'Theo năm' }] as const).map(item => (
          <button key={item.value} onClick={() => setPeriodGroup(item.value)} className={'rounded-md px-3 py-1.5 text-xs font-bold ' + (periodGroup === item.value ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50')}>
            {item.label}
          </button>
        ))}
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <button onClick={loadSummary} disabled={loading} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 bg-white text-sm font-extrabold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
          <RefreshCw className={'w-4 h-4 ' + (loading ? 'animate-spin' : '')} />
          Làm mới
        </button>
        <button onClick={downloadXlsx} disabled={exporting || loading} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-extrabold hover:bg-emerald-700 shadow-sm disabled:opacity-60">
          <Download className="w-4 h-4" />
          {exporting ? 'Đang tạo file...' : 'Xuất Excel'}
        </button>
      </div>
    </section>
    {loading ? <div className="py-24 text-center bg-white border border-slate-200 rounded-3xl"><RefreshCw className="w-9 h-9 text-blue-500 animate-spin mx-auto"/><p className="text-sm text-slate-500 mt-3">Đang tải dữ liệu báo cáo...</p></div> : error ? <div className="p-6 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 flex items-center gap-3"><AlertCircle className="w-6 h-6"/>{error}</div> : <>
      <section className="bg-white p-5 rounded-3xl border border-slate-200/70 shadow-sm"><div className="flex flex-col gap-4 border-b border-slate-100 pb-4"><div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3"><div><h3 className="text-lg font-extrabold text-slate-800">Biểu đồ báo cáo tổng hợp</h3><p className="text-sm text-slate-500 mt-1">Cột và điểm đường cùng biểu diễn giá trị đã ghi nhận; kỳ không có dữ liệu nằm đúng ở mốc 0.</p></div><BarChart3 className="w-6 h-6 text-blue-600"/></div><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{metricRows.map(metric=><button key={metric.key} onClick={()=>setActiveMetric(metric.key)} className={`rounded-xl border px-4 py-3 text-left text-sm font-extrabold transition ${activeMetric===metric.key?'border-blue-500 bg-blue-50 text-blue-700 shadow-sm':'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}><span className="inline-block h-2.5 w-2.5 rounded-full mr-2" style={{backgroundColor:metric.color}}/>{metric.label}</button>)}</div></div><div className="h-[380px] mt-5"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={chartData} margin={{top:12,right:24,left:0,bottom:8}}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0"/><XAxis dataKey="label" tick={{fontSize:12,fill:'#64748b'}} tickLine={false} axisLine={false}/><YAxis yAxisId="value" domain={[0, 'auto']} allowDataOverflow={false} tick={{fontSize:12,fill:'#64748b'}} tickLine={false} axisLine={false}/><Tooltip formatter={(value:number)=>[Number(value).toLocaleString('vi-VN'), activeMetricConfig.label]} contentStyle={{borderRadius:12,fontSize:12}}/><Bar yAxisId="value" dataKey="value" name={`${activeMetricConfig.label} trong kỳ`} fill={activeMetricConfig.color} fillOpacity={0.72} radius={[5,5,0,0]}/><Line yAxisId="value" type="monotone" dataKey="value" name={activeMetricConfig.label} stroke="#ea580c" strokeWidth={2.5} dot={{r:4,fill:'#fff',stroke:'#ea580c',strokeWidth:2}}/></ComposedChart></ResponsiveContainer></div></section>
      <section className="bg-white rounded-3xl border border-slate-200/70 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-100"><h3 className="text-lg font-extrabold text-slate-800">Giá trị và biến động theo kỳ</h3><p className="text-sm text-slate-500 mt-1">{activeMetric === 'followers' ? 'Lượt follow: mốc cuối kỳ trừ mốc đầu kỳ.' : activeMetric === 'postsCount' ? 'Số bài đăng được đếm theo ngày xuất bản trong kỳ.' : `${activeMetricConfig.label}: tổng chỉ số theo ngày đã lưu trong kỳ.`}</p></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left"><thead><tr className="bg-slate-50 text-xs font-bold uppercase tracking-wide text-slate-500"><th className="px-5 py-4">Kỳ báo cáo</th><th className="px-5 py-4 text-right">Giá trị trong kỳ</th><th className="px-5 py-4">Cách tính</th><th className="px-5 py-4 text-right">So kỳ trước</th></tr></thead><tbody className="divide-y divide-slate-100 text-sm">{deltaRows.map(({point,index}) => { const change = percentChange(point.value, chartData[index - 1]?.value); const formula = activeMetric === 'followers' ? 'Cuối kỳ − đầu kỳ' : activeMetric === 'postsCount' ? 'Bài xuất bản trong kỳ' : 'Tổng snapshot ngày'; return <tr key={point.period} className="hover:bg-slate-50/70"><td className="px-5 py-4 font-bold text-slate-800">{point.label}</td><td className="px-5 py-4 text-right font-extrabold text-slate-800">{point.value === null ? <span className="font-medium text-slate-400">Chưa có dữ liệu</span> : Number(point.value).toLocaleString('vi-VN')}</td><td className="px-5 py-4 text-slate-600">{formula}</td><td className="px-5 py-4 text-right"><span className={`inline-flex items-center gap-1 font-bold ${change === null ? 'text-slate-400' : change >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{change === null ? '—' : <>{change >= 0 ? <TrendingUp className="w-3.5 h-3.5"/> : <TrendingDown className="w-3.5 h-3.5"/>}{Math.abs(change).toFixed(1)}%</>}</span></td></tr>})}</tbody></table></div>
      </section>      <section className="bg-white border border-slate-200/70 rounded-3xl shadow-sm overflow-hidden"><div className="p-6 border-b border-slate-100 flex items-start gap-3"><div className="p-3 rounded-xl bg-blue-50 text-blue-700"><FileSpreadsheet className="w-6 h-6"/></div><div><h3 className="text-lg font-extrabold text-slate-800">Hiệu quả hoạt động theo kênh</h3><p className="text-sm text-slate-500 mt-1">Giữ nguyên bảng kênh và tự hiển thị các kênh mới sau khi đồng bộ.</p></div></div>{rows.length === 0 ? <div className="py-20 text-center text-slate-500">Chưa có kênh phù hợp với bộ lọc.</div> : <div className="overflow-x-auto"><table className="w-full min-w-[1160px] text-left border-collapse"><thead><tr className="bg-slate-50 border-b border-slate-200 text-xs font-extrabold uppercase tracking-wide text-slate-500"><th className="px-6 py-4 text-center">STT</th><th className="px-6 py-4">Nền tảng</th><th className="px-6 py-4">Tên trang</th><th className="px-6 py-4 font-mono">ID</th><th className="px-6 py-4">Đồng bộ lần cuối</th><th className="px-6 py-4 text-right">Người theo dõi</th><th className="px-6 py-4 text-center">Số bài đăng</th><th className="px-6 py-4 text-right">Lượt xem</th><th className="px-6 py-4 text-right">Tổng tương tác</th></tr></thead><tbody className="divide-y divide-slate-100 text-sm">{rows.map((row, index) => <tr key={row.id} className="hover:bg-slate-50/70"><td className="px-6 py-5 text-center font-semibold text-slate-500">{index + 1}</td><td className="px-6 py-5"><span className={`inline-flex px-3 py-1 rounded-full border text-xs font-extrabold ${row.platform === 'facebook' ? 'bg-blue-50 text-blue-700 border-blue-100' : 'bg-teal-50 text-teal-700 border-teal-100'}`}>{row.platform === 'facebook' ? 'Facebook' : 'Zalo OA'}</span></td><td className="px-6 py-5 font-bold text-slate-800">{row.name}</td><td className="px-6 py-5 font-mono text-slate-500">{row.externalId}</td><td className="px-6 py-5">{row.lastSyncAt ? <div><p className="font-semibold text-slate-700">{new Date(row.lastSyncAt).toLocaleString('vi-VN')}</p><p className={`text-xs font-bold mt-1 ${row.lastSyncStatus === 'success' ? 'text-emerald-600' : 'text-rose-600'}`}>{row.lastSyncStatus === 'success' ? 'Thành công' : 'Thất bại'}</p></div> : <span className="text-slate-400">Chưa đồng bộ</span>}</td><td className="px-6 py-5 text-right font-extrabold text-slate-700">{row.followersCount.toLocaleString('vi-VN')}</td><td className="px-6 py-5 text-center font-extrabold text-slate-700">{row.postsCount.toLocaleString('vi-VN')}</td><td className="px-6 py-5 text-right font-extrabold text-slate-700">{row.views.toLocaleString('vi-VN')}</td><td className="px-6 py-5 text-right font-extrabold text-slate-900">{row.totalEngagement.toLocaleString('vi-VN')}</td></tr>)}</tbody></table></div>}</section>
    </>}
  </div>;
}
