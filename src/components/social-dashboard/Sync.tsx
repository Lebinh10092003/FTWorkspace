import { useState, useEffect } from 'react';
import {
  RefreshCw, Play, CheckCircle2, XCircle, AlertCircle, ShieldAlert, History
} from 'lucide-react';
import { Channel, ApiLog, UserRole } from '../../types';
import ConfirmModal from '../ConfirmModal';
import { pastDateVN } from '../../lib/vnDate';

interface SyncProps {
  idToken: string;
  googleAccessToken: string | null;
  channels: Channel[];
  userRole: UserRole;
  onRefreshChannels: () => Promise<void>;
  onConnectGoogle?: () => Promise<boolean>;
}

interface FacebookApiUsage {
  maxUsage: number;
  processCalls: number;
  lastResponseAt?: string;
  cooldownUntil?: string;
  cooldownActive: boolean;
  reason?: string;
}

const getDefaultSinceDate = (): string => pastDateVN(1);

function readableSyncMessage(log: ApiLog): string {
  const message = String(log.errorMessage || '');
  const facebookUnauthorized = log.platform === 'facebook'
    && (/\b401\b/i.test(message) || /unauthorized/i.test(message) || /oauth/i.test(message));
  if (facebookUnauthorized) {
    return 'Facebook từ chối quyền truy cập. Token của Trang đã hết hạn hoặc không còn quyền; vào Cấu hình hệ thống để quét lại các trang được cấp quyền. Nếu vẫn lỗi, nạp User Access Token mới. Dữ liệu cũ vẫn được giữ.';
  }
  return message || 'Chưa có thông điệp chi tiết.';
}

export default function Sync({ idToken, googleAccessToken, channels, userRole, onRefreshChannels, onConnectGoogle }: SyncProps) {
  const [since, setSince] = useState(getDefaultSinceDate);
  const [until, setUntil] = useState('');
  const [syncHistory, setSyncHistory] = useState<ApiLog[]>([]);
  const [facebookUsage, setFacebookUsage] = useState<FacebookApiUsage | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [channelSyncStates, setChannelSyncStates] = useState<Record<string, ApiLog['status']>>({});
  const [selectedChannelIds, setSelectedChannelIds] = useState<Set<string>>(() => new Set());
  const [cancellingChannelId, setCancellingChannelId] = useState<string | null>(null);

  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [syncResult, setSyncResult] = useState<{ status: 'success' | 'failed'; message: string } | null>(null);

  // Custom confirmation modal state to bypass iframe window.confirm limits
  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmText?: string;
    type?: 'danger' | 'warning' | 'info';
    onConfirm: () => void | Promise<void>;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  const canManage = userRole === 'ADMIN' || userRole === 'MANAGER';
  const activeChannels = channels.filter(channel => channel.status === 'active');
  const activeChannelIds = new Set(activeChannels.map(channel => channel.id));
  const selectedChannels = activeChannels.filter(channel => selectedChannelIds.has(channel.id));
  const toggleChannelSelection = (channelId: string) => setSelectedChannelIds(current => { const next = new Set(current); if (next.has(channelId)) next.delete(channelId); else next.add(channelId); return next; });
  const hasActiveChannelSync = Object.entries(channelSyncStates).some(
    ([channelId, status]) => activeChannelIds.has(channelId) && (status === 'queued' || status === 'running'),
  );

  const applySyncStatesFromHistory = (logs: ApiLog[]) => {
    const cutoff = Date.now() - 6 * 60 * 60 * 1000;
    const latestByChannel: Record<string, ApiLog['status']> = {};

    for (const log of logs) {
      if (!log.channelId || latestByChannel[log.channelId]) continue;
      if (new Date(log.startedAt).getTime() < cutoff) continue;
      latestByChannel[log.channelId] = log.status;
    }

    setChannelSyncStates(latestByChannel);
  };

  const fetchSyncHistory = async (silent = false) => {
    if (!silent) setLoadingHistory(true);
    try {
      const headers = { 'Authorization': 'Bearer ' + idToken };
      const [res, usageRes] = await Promise.all([
        fetch('/api/sync/history', { headers }),
        fetch('/api/sync/facebook-usage', { headers }),
      ]);
      if (res.ok) {
        const data: ApiLog[] = await res.json();
        setSyncHistory(data || []);
        applySyncStatesFromHistory(data || []);
      }
      if (usageRes.ok) {
        setFacebookUsage(await usageRes.json());
      }
    } catch (error) {
      console.error('Không thể tải lịch sử đồng bộ:', error);
    } finally {
      if (!silent) setLoadingHistory(false);
    }
  };

  useEffect(() => {
    void fetchSyncHistory();
  }, [idToken]);

  useEffect(() => {
    if (!hasActiveChannelSync && syncingId === null) return;
    const intervalId = window.setInterval(() => {
      void fetchSyncHistory(true);
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [hasActiveChannelSync, syncingId, idToken]);

  const handleSyncAll = () => {
    if (!canManage) return;
    const targets = selectedChannels.length ? selectedChannels : activeChannels;
    const isSelectedSync = selectedChannels.length > 0;
    setConfirmState({
      isOpen: true,
      title: isSelectedSync ? `Đồng bộ ${targets.length} trang đã chọn` : 'Đồng bộ toàn bộ các kênh',
      message: isSelectedSync ? `Bạn có muốn đồng bộ dữ liệu cho ${targets.length} trang đã chọn?` : 'Bạn có muốn kích hoạt đồng bộ dữ liệu cho TOÀN BỘ các kênh đang hoạt động?',
      confirmText: isSelectedSync ? 'Đồng bộ đã chọn' : 'Đồng bộ tất cả',
      type: 'info',
      onConfirm: async () => {
        setConfirmState(current => ({ ...current, isOpen: false }));
        setSyncingId('all');
        setSyncResult(null);
        setChannelSyncStates(current => ({ ...current, ...Object.fromEntries(targets.map(channel => [channel.id, 'queued' as const])) }));
        try {
          const res = await fetch('/api/sync/all', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + idToken, 'X-Google-OAuth-Token': googleAccessToken || '' },
            body: JSON.stringify({ background: true, recentDays: 1, channelIds: targets.map(channel => channel.id) }),
          });
          const data = await res.json();
          if (data.success) {
            await onRefreshChannels();
            setSyncResult({ status: 'success', message: data.message || 'Đã xếp hàng đồng bộ nền.' });
          } else setSyncResult({ status: 'failed', message: data.error || data.message || 'Lỗi xảy ra trong quá trình đồng bộ.' });
        } catch (error: any) {
          setSyncResult({ status: 'failed', message: error.message || 'Lỗi đồng bộ.' });
        } finally {
          await fetchSyncHistory(true);
          setSyncingId(null);
        }
      },
    });
  };
  const handleCancelAll = () => {
    if (!canManage || !hasActiveChannelSync) return;
    setConfirmState({
      isOpen: true,
      title: 'Hủy đồng bộ dữ liệu',
      message: 'Bạn có muốn dừng lượt đồng bộ đang chạy? Kênh đang gọi API sẽ dừng sau tác vụ hiện tại, các kênh chờ sẽ không tiếp tục.',
      confirmText: 'Hủy đồng bộ',
      type: 'danger',
      onConfirm: async () => {
        setConfirmState(current => ({ ...current, isOpen: false }));
        setCancelling(true);
        try {
          const response = await fetch('/api/sync/cancel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken },
            body: JSON.stringify({}),
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(data.error || 'Không thể hủy đồng bộ.');
          setSyncResult({ status: 'success', message: data.message || 'Đã gửi yêu cầu hủy đồng bộ.' });
          await fetchSyncHistory(true);
        } catch (error: any) {
          setSyncResult({ status: 'failed', message: error.message || 'Không thể hủy đồng bộ.' });
        } finally {
          setCancelling(false);
        }
      },
    });
  };
  const handleSyncChannel = async (channelId: string) => {
    if (!canManage) return;
    setSyncingId(channelId);
    setSyncResult(null);
    setChannelSyncStates(current => ({ ...current, [channelId]: 'queued' }));
    try {
      const res = await fetch('/api/channels/' + channelId + '/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + idToken, 'X-Google-OAuth-Token': googleAccessToken || '' },
        body: JSON.stringify({ since: since || undefined, until: until || undefined }),
      });
      const data = await res.json();
      if (data.success) setSyncResult({ status: 'success', message: data.message || 'Đã xếp hàng đồng bộ nền cho kênh.' });
      else { setChannelSyncStates(current => ({ ...current, [channelId]: 'failed' })); setSyncResult({ status: 'failed', message: data.error || 'Đồng bộ thất bại.' }); }
    } catch (error: any) {
      setChannelSyncStates(current => ({ ...current, [channelId]: 'failed' }));
      setSyncResult({ status: 'failed', message: error.message || 'Lỗi đồng bộ.' });
    } finally { await fetchSyncHistory(true); setSyncingId(null); }
  };

  const handleCancelChannel = async (channelId: string) => {
    if (!canManage) return;
    setCancellingChannelId(channelId);
    try {
      const response = await fetch('/api/sync/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken }, body: JSON.stringify({ channelId }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Không thể hủy đồng bộ kênh.');
      setSyncResult({ status: 'success', message: data.message || 'Đã gửi yêu cầu hủy đồng bộ kênh.' });
      await fetchSyncHistory(true);
    } catch (error: any) { setSyncResult({ status: 'failed', message: error.message || 'Không thể hủy đồng bộ kênh.' }); }
    finally { setCancellingChannelId(null); }
  };
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-150 pb-5">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Đồng Bộ Dữ Liệu</h2>
          <p className="text-sm text-slate-500">Yêu cầu kéo dữ liệu tức thời từ API Facebook/Zalo để đồng bộ và lưu trữ vào cơ sở dữ liệu hệ thống.</p>
        </div>

        {canManage ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {hasActiveChannelSync && (
              <button
                onClick={handleCancelAll}
                disabled={cancelling}
                className="flex items-center gap-2 border border-rose-200 bg-white text-rose-700 hover:bg-rose-50 font-semibold text-xs px-4 py-2.5 rounded-xl disabled:opacity-50 transition-colors"
              >
                <XCircle className={'w-4 h-4 ' + (cancelling ? 'animate-spin' : '')} />
                {cancelling ? 'Đang hủy...' : 'Hủy đồng bộ'}
              </button>
            )}
            <button
              onClick={handleSyncAll}
              disabled={syncingId !== null || hasActiveChannelSync || activeChannels.length === 0}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs px-4 py-2.5 rounded-xl disabled:opacity-50 transition-colors shadow-sm cursor-pointer"
            >
              <RefreshCw className={'w-4 h-4 ' + (syncingId === 'all' || hasActiveChannelSync ? 'animate-spin' : '')} />
              {syncingId === 'all' || hasActiveChannelSync ? 'Đang đồng bộ...' : selectedChannels.length > 0 ? ('Đồng bộ ' + selectedChannels.length + ' trang đã chọn') : 'Đồng bộ toàn bộ các kênh'}
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 border border-slate-200 text-slate-500 rounded-lg text-xs font-semibold">
            <ShieldAlert className="w-4 h-4 text-slate-400" />
            Viewer Mode - Không thể đồng bộ
          </div>
        )}
      </div>

      {facebookUsage && (
        <div className={'rounded-2xl border p-4 text-xs ' + (
          facebookUsage.cooldownActive
            ? 'border-amber-300 bg-amber-50 text-amber-900'
            : facebookUsage.maxUsage >= 70
              ? 'border-amber-200 bg-amber-50/70 text-amber-900'
              : 'border-emerald-200 bg-emerald-50/70 text-emerald-900'
        )}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2 font-extrabold">
              <ShieldAlert className="h-4 w-4" />
              Bảo vệ hạn mức Facebook API
            </span>
            <span className="font-bold">
              Mức sử dụng cao nhất: {facebookUsage.maxUsage || 0}% · {facebookUsage.processCalls || 0} call trong tiến trình gần nhất
            </span>
          </div>
          <p className="mt-2 leading-relaxed">
            {facebookUsage.cooldownActive
              ? 'Hệ thống đang tạm hoãn call để tránh Meta giới hạn hoặc thu hồi quyền. Dữ liệu đã lưu không bị xóa và con trỏ đồng bộ chưa dịch chuyển.'
              : 'Hệ thống tự giảm tốc từ 70%, tạm dừng từ 85% và chia lịch sử thành nhiều đợt an toàn.'}
          </p>
          {facebookUsage.cooldownActive && facebookUsage.cooldownUntil && (
            <p className="mt-1 font-semibold">
              Dự kiến thử lại sau: {new Date(facebookUsage.cooldownUntil).toLocaleString('vi-VN')}
              {facebookUsage.reason ? ' · ' + facebookUsage.reason : ''}
            </p>
          )}
        </div>
      )}

      {/* Google Sheets warning removed, as database sync does not require Google login */}

      {/* Date filters and controls for manual syncing */}
      {canManage && (
        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-4">
          <h3 className="text-sm font-bold text-slate-800">Cấu hình tham số đồng bộ thủ công</h3>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">Đồng bộ riêng lẻ từ ngày (mặc định ngày mới nhất)</label>
              <input 
                type="date"
                value={since}
                onChange={(e) => setSince(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 text-xs rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">Đến ngày (Tùy chọn)</label>
              <input 
                type="date"
                value={until}
                onChange={(e) => setUntil(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 text-xs rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="border-t border-slate-50 pt-4 space-y-2">
            <h4 className="text-xs font-bold text-slate-500 mb-1">Đồng bộ riêng lẻ từng kênh hoạt động</h4>
            
            {activeChannels.length === 0 ? (
              <p className="text-xs text-amber-600 italic">Không có kênh nào đang ở trạng thái hoạt động để đồng bộ.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {activeChannels.map(chan => {
                  const syncState = channelSyncStates[chan.id];
                  const isQueued = syncState === 'queued';
                  const isRunning = syncState === 'running' || syncingId === chan.id;
                  const isThisSyncing = isQueued || isRunning;
                  return (
                    <div key={chan.id} className={'flex items-center justify-between p-3 rounded-xl border transition-colors ' + (isRunning ? 'border-blue-200 bg-blue-50/60' : isQueued ? 'border-amber-200 bg-amber-50/60' : 'border-slate-100 bg-slate-50/50')}>
                      <label className="flex min-w-0 flex-1 items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={selectedChannelIds.has(chan.id)} onChange={() => toggleChannelSelection(chan.id)} disabled={isThisSyncing} aria-label={`Chọn ${chan.name}`} className="h-4 w-4 shrink-0 rounded border-slate-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50" />
                        <span className="min-w-0"><span className="text-xs font-bold text-slate-800 block truncate max-w-[150px]">{chan.name}</span><span className="text-[10px] text-slate-400 uppercase font-semibold">{chan.platform}</span></span>
                      </label>
                      <button
                        onClick={() => isThisSyncing ? handleCancelChannel(chan.id) : handleSyncChannel(chan.id)}
                        disabled={isThisSyncing ? cancellingChannelId === chan.id : syncingId !== null || hasActiveChannelSync}
                        title={isThisSyncing ? 'Hủy đồng bộ kênh này' : 'Đồng bộ kênh này'}
                        className={'flex items-center gap-1.5 bg-white border font-semibold text-[10px] px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-80 ' + (isThisSyncing ? 'border-rose-200 text-rose-700' : 'border-slate-200 text-slate-600 hover:text-blue-600 hover:border-blue-100')}
                      >
                        {isThisSyncing ? <XCircle className={'w-3.5 h-3.5 ' + (cancellingChannelId === chan.id ? 'animate-spin' : '')} /> : <Play className="w-3 h-3" />}
                        {isThisSyncing ? 'Hủy' : 'Sync'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Sync feedback result */}
      {syncResult && (
        <div className={`p-4 rounded-xl border flex items-start gap-3 text-xs ${
          syncResult.status === 'success' 
            ? 'bg-emerald-50 border-emerald-200 text-emerald-800' 
            : 'bg-red-50 border-red-200 text-red-800'
        }`}>
          {syncResult.status === 'success' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 mt-0.5" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0 text-red-600 mt-0.5" />
          )}
          <div>
            <strong className="font-semibold block">
              {syncResult.status === 'success' ? 'Đồng bộ hoàn tất' : 'Lỗi đồng bộ hóa'}
            </strong>
            <p className="mt-0.5">{syncResult.message}</p>
          </div>
          <button onClick={() => setSyncResult(null)} className="ml-auto font-bold text-slate-400 hover:text-slate-600">×</button>
        </div>
      )}

      {/* Sync History Logs */}
      <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-slate-50 pb-3">
          <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
            <History className="w-4 h-4 text-slate-500" />
            Nhật ký cuộc gọi API & Lịch sử đồng bộ hệ thống
          </h3>
          <button 
            onClick={() => fetchSyncHistory()}
            className="text-xs font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1.5"
          >
            <RefreshCw className="w-3 h-3" />
            Tải lại
          </button>
        </div>

        {loadingHistory ? (
          <div className="py-12 text-center text-slate-400 text-xs">Đang tải lịch sử...</div>
        ) : syncHistory.length === 0 ? (
          <div className="py-12 text-center text-slate-400 text-xs italic">Chưa ghi nhận nhật ký đồng bộ nào.</div>
        ) : (
          <div className="overflow-x-auto border border-slate-100 rounded-xl">
            <table className="w-full text-left border-collapse table-fixed">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  <th className="p-4 w-36">Thời điểm khởi động</th>
                  <th className="p-4 w-28">Nền tảng</th>
                  <th className="p-4 w-24">Trạng thái</th>
                  <th className="p-4 w-20 text-center">Nhận</th>
                  <th className="p-4 w-20 text-center">Ghi mới</th>
                  <th className="p-4 w-20 text-center">Cập nhật</th>
                  <th className="p-4 w-52">Nội dung lỗi / Thông điệp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs font-mono">
                {syncHistory.map((log) => {
                  const chan = channels.find(c => c.id === log.channelId);
                  const readableMessage = readableSyncMessage(log);
                  return (
                    <tr key={log.logId} className="hover:bg-slate-50/50">
                      <td className="p-4 text-slate-500 font-sans whitespace-nowrap">
                        {new Date(log.startedAt).toLocaleString('vi-VN')}
                      </td>
                      <td className="p-4 font-sans text-slate-800 font-medium">
                        {chan?.name || log.platform.toUpperCase()}
                      </td>
                      <td className="p-4">
                        <span className={'inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-sans font-semibold text-[10px] ' + (
                          log.status === 'success'
                            ? 'bg-emerald-50 text-emerald-700'
                            : log.status === 'running'
                              ? 'bg-blue-50 text-blue-700'
                              : log.status === 'queued'
                                ? 'bg-amber-50 text-amber-700'
                                : log.status === 'cancelled'
                                  ? 'bg-slate-100 text-slate-600'
                                  : log.status === 'deferred'
                                    ? 'bg-amber-100 text-amber-800'
                                  : 'bg-red-50 text-red-700'
                        )}>
                          {(log.status === 'queued' || log.status === 'running') && <RefreshCw className="w-3 h-3 animate-spin" />}
                          {log.status === 'success' ? 'Thành công' : log.status === 'running' ? 'Đang chạy' : log.status === 'queued' ? 'Đang chờ' : log.status === 'cancelled' ? 'Đã hủy' : log.status === 'deferred' ? 'Tạm hoãn an toàn' : 'Thất bại'}
                        </span>
                      </td>
                      <td className="p-4 text-center text-slate-600 font-medium">{log.recordsReceived}</td>
                      <td className="p-4 text-center text-slate-600 font-medium">{log.recordsInserted}</td>
                      <td className="p-4 text-center text-slate-600 font-medium">{log.recordsUpdated}</td>
                      <td className="p-4 font-sans text-slate-500 truncate" title={readableMessage}>
                        {log.status === 'success' ? (
                          <span className="text-slate-400 italic">Đồng bộ hoàn hảo</span>
                        ) : log.status === 'running' ? (
                          <span className="text-blue-600 font-medium">Đang lấy dữ liệu...</span>
                        ) : log.status === 'queued' ? (
                          <span className="text-amber-600 font-medium">Đang chờ đến lượt...</span>
                        ) : log.status === 'cancelled' ? (
                          <span className="text-slate-500 font-medium">Đã hủy theo yêu cầu quản trị.</span>
                        ) : log.status === 'deferred' ? (
                          <span className="text-amber-700 font-medium">{readableMessage}</span>
                        ) : (
                          <span className="text-red-500 font-medium">{readableMessage}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmModal
        isOpen={confirmState.isOpen}
        onClose={() => setConfirmState(prev => ({ ...prev, isOpen: false }))}
        onConfirm={confirmState.onConfirm}
        title={confirmState.title}
        message={confirmState.message}
        confirmText={confirmState.confirmText}
        type={confirmState.type}
      />
    </div>
  );
}
