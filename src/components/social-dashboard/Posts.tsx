import React, { useState, useEffect } from 'react';
import { appDialog } from '../AppDialog';
import { 
  Search, Radio, Layers, ExternalLink, Download, ArrowUpDown, ChevronLeft, ChevronRight, AlertCircle, FileText, Calendar
} from 'lucide-react';
import { Channel, Post, Platform } from '../../types';
import SearchableSelect from '../SearchableSelect';

interface PostsProps {
  idToken: string;
  channels: Channel[];
}

type DatePreset = 'custom' | '7days' | '30days' | '3months' | '6months' | '1year';

function getPastDateStr(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function getTodayStr(): string {
  return new Date().toISOString().slice(0, 10);
}
export default function Posts({ idToken, channels }: PostsProps) {
  const [posts, setPosts] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters state
  const [search, setSearch] = useState('');
  const [platform, setPlatform] = useState<string>('all');
  const [channelId, setChannelId] = useState<string>('all');
  const [startDate, setStartDate] = useState(getPastDateStr(6));
  const [endDate, setEndDate] = useState(getTodayStr());
  const [datePreset, setDatePreset] = useState<DatePreset>('7days');
  const [page, setPage] = useState(1);
  const [limit] = useState(15);
  const [postType, setPostType] = useState<string>('all');

  const fetchPosts = async () => {
    setLoading(true);
    setError(null);
    try {
      let url = `/api/posts?page=${page}&limit=${limit}&startDate=${startDate}&endDate=${endDate}`;
      if (search) url += `&search=${encodeURIComponent(search)}`;
      if (platform !== 'all') url += `&platform=${platform}`;
      if (channelId !== 'all') url += `&channelId=${channelId}`;
      if (postType !== 'all') url += `&postType=${postType}`;

      const res = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${idToken}`,
        }
      });
      if (!res.ok) {
        throw new Error('Không thể tải danh sách bài đăng từ server.');
      }
      const data = await res.json();
      setPosts(data.posts || []);
      setTotal(data.total || 0);
    } catch (err: any) {
      setError(err.message || 'Lỗi mạng.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPosts();
  }, [idToken, platform, channelId, startDate, endDate, page, channels, postType]);

  // Handle manual trigger when pressing Enter or clicking Search button
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchPosts();
  };

  const handlePlatformChange = (p: string) => {
    setPlatform(p);
    setChannelId('all');
    setPage(1);
  };

  const updatePreset = (preset: DatePreset) => {
    setDatePreset(preset);
    if (preset === 'custom') return;
    const end = new Date();
    const start = new Date();
    if (preset === '7days') start.setDate(end.getDate() - 6);
    if (preset === '30days') start.setDate(end.getDate() - 29);
    if (preset === '3months') start.setMonth(end.getMonth() - 3);
    if (preset === '6months') start.setMonth(end.getMonth() - 6); if (preset === '1year') start.setFullYear(end.getFullYear() - 1);
    setStartDate(start.toISOString().slice(0, 10));
    setEndDate(end.toISOString().slice(0, 10));
    setPage(1);
  };
  const handleExportCSV = () => {
    let url = `/api/reports/export.csv?`;
    if (platform !== 'all') url += `platform=${platform}&`;
    if (channelId !== 'all') url += `channelId=${channelId}&`;
    url += `startDate=${startDate}&endDate=${endDate}`;

    // Direct download via browser trigger
    const link = document.createElement('a');
    link.href = url;
    // Embed the Auth Bearer token inside the url or since export.csv is authenticated, we can fetch it first!
    // Fetch export to get CSV blob
    fetch(url, {
      headers: { 'Authorization': `Bearer ${idToken}` }
    })
    .then(res => res.blob())
    .then(blob => {
      const downloadUrl = window.URL.createObjectURL(blob);
      link.href = downloadUrl;
      link.setAttribute('download', `bao_cao_ft_social_${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    })
    .catch(err => {
      void appDialog.alert('Không thể xuất báo cáo CSV: ' + err.message, { title: 'Xuất báo cáo thất bại', tone: 'danger' });
    });
  };

  const filteredChannels = platform === 'all' 
    ? channels.filter(c => c.status === 'active') 
    : channels.filter(c => c.platform === platform && c.status === 'active');

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-6">
      {/* Header and export button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-150 pb-5">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Danh Sách Bài Đăng</h2>
          <p className="text-sm text-slate-500">Thống kê tương tác chi tiết từng bài đăng từ Facebook và Zalo OA.</p>
        </div>

        <button
          onClick={handleExportCSV}
          disabled={posts.length === 0}
          className="flex items-center gap-2 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 font-semibold text-xs px-4 py-2.5 rounded-xl border border-slate-200 transition-colors shadow-sm"
        >
          <Download className="w-4 h-4" />
          Xuất dữ liệu CSV
        </button>
      </div>

      {/* Filter and search bar */}
      <form onSubmit={handleSearchSubmit} className="posts-filter flex flex-wrap items-end gap-3 bg-slate-50 p-4 rounded-xl border border-slate-100">
        <div className="min-w-0">
          <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">Nền tảng</label>
          <SearchableSelect value={platform} onChange={handlePlatformChange} options={[{ value: 'all', label: 'Tất cả nền tảng' }, { value: 'facebook', label: 'Facebook' }, { value: 'zalo', label: 'Zalo OA' }]} className="min-w-[170px]" />
        </div>

        <div className="min-w-0">
          <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">Trang</label>
          <SearchableSelect value={channelId} onChange={value => { setChannelId(value); setPage(1); }} options={[{ value: 'all', label: 'Tất cả trang' }, ...filteredChannels.map(chan => ({ value: chan.id, label: chan.name + ' (' + chan.platform.toUpperCase() + ')' }))]} className="min-w-[220px]" />
        </div>

        <div className="posts-date-field min-w-0">
          <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">Thời gian</label>
          <div className="posts-date-filter flex min-w-0 items-center gap-1 bg-white border border-slate-200 rounded-lg px-2 py-1.5">
            <Calendar className="w-3.5 h-3.5 text-slate-400" />
            <select value={datePreset} onChange={event => updatePreset(event.target.value as DatePreset)} className="text-xs font-medium text-slate-700 bg-transparent outline-none max-w-28">
              <option value="custom">Tùy chọn</option>
              <option value="7days">7 ngày qua</option>
              <option value="30days">1 tháng qua</option>
              <option value="3months">3 tháng qua</option>
              <option value="6months">6 tháng qua</option>
              <option value="1year">1 năm qua</option>
            </select>
            <input type="date" value={startDate} min={getPastDateStr(365)} max={endDate} onChange={event => { setStartDate(event.target.value); setDatePreset('custom'); setPage(1); }} className="w-28 text-[11px] text-slate-600 outline-none" />
            <span className="text-slate-400 text-[11px]">đến</span>
            <input type="date" value={endDate} min={startDate} max={getTodayStr()} onChange={event => { setEndDate(event.target.value); setDatePreset('custom'); setPage(1); }} className="w-28 text-[11px] text-slate-600 outline-none" />
          </div>
        </div>

        <div className="flex-1 min-w-[220px]">
          <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">Tìm kiếm bài đăng</label>
          <div className="relative">
            <input
              type="text"
              placeholder="Nhập nội dung bài đăng cần tìm..."
              value={search}
              onChange={event => setSearch(event.target.value)}
              className="w-full bg-white border border-slate-200 text-xs rounded-lg pl-9 pr-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          </div>
        </div>

        <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs px-4 py-2.5 rounded-lg shadow-sm transition-colors">
          Tìm kiếm
        </button>
      </form>

      {/* Category Tabs */}
      <div className="flex border-b border-slate-200 gap-1 overflow-x-auto pb-px">
        {[
          { key: 'all', label: 'Tất cả bài viết' },
          { key: 'photo', label: 'Ảnh / Album' },
          { key: 'video', label: 'Video / Reel' },
          { key: 'link', label: 'Liên kết' },
          { key: 'status', label: 'Văn bản' },
          { key: 'other', label: 'Khác' },
        ].map((tab) => {
          const isActive = postType === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => { setPostType(tab.key); setPage(1); }}
              className={`px-4 py-2.5 border-b-2 font-bold text-xs whitespace-nowrap transition-all cursor-pointer ${
                isActive 
                  ? 'border-blue-600 text-blue-650' 
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Main Table view */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 bg-white border border-slate-100 rounded-2xl shadow-sm space-y-3">
          <ChevronRight className="w-10 h-10 text-blue-500 animate-spin" />
          <p className="text-sm font-medium text-slate-500">Đang tải dữ liệu bài đăng...</p>
        </div>
      ) : error ? (
        <div className="p-8 bg-red-50 border border-red-200 rounded-2xl text-center space-y-3">
          <AlertCircle className="w-10 h-10 text-red-500 mx-auto" />
          <h3 className="text-base font-bold text-red-900">Không thể tải bài đăng</h3>
          <p className="text-xs text-red-600">{error}</p>
        </div>
      ) : posts.length === 0 ? (
        <div className="p-12 text-center bg-white border border-slate-150 rounded-2xl shadow-sm space-y-4">
          <FileText className="w-12 h-12 text-slate-300 mx-auto" />
          <div>
            <h3 className="text-base font-bold text-slate-800">Không tìm thấy bài viết nào</h3>
            <p className="text-xs text-slate-400 mt-1">Chưa có bài viết nào được đồng bộ hoặc kết quả tìm kiếm không phù hợp.</p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse table-fixed">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    <th className="px-2 py-3 w-[65px]">Nền tảng</th>
                    <th className="px-2 py-3 w-[110px]">Kênh</th>
                    <th className="px-2 py-3 w-[85px]">Ngày đăng</th>
                    <th className="px-2 py-3 w-auto">Nội dung tóm tắt</th>
                    <th className="px-2 py-3 w-[70px]">Phân loại</th>
                    <th className="px-2 py-3 w-[50px] text-center">Likes</th>
                    <th className="px-2 py-3 w-[55px] text-center">Comments</th>
                    <th className="px-2 py-3 w-[50px] text-center">Shares</th>
                    <th className="px-2 py-3 w-[50px] text-center">Views</th>
                    <th className="px-2 py-3 w-[50px] text-center">Reach</th>
                    <th className="px-2 py-3 w-[75px] text-center">Tương tác</th>
                    <th className="px-2 py-3 w-[45px] text-center">Xem</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-[11px]">
                  {posts.map((post) => {
                    const chan = channels.find(c => c.id === post.channelId);
                    return (
                      <tr key={post.postKey} className="hover:bg-slate-50/50">
                        <td className="px-2 py-3">
                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full font-semibold text-[9px] ${
                            post.platform === 'facebook' 
                              ? 'bg-blue-50 text-blue-700 border border-blue-100' 
                              : 'bg-teal-50 text-teal-700 border border-teal-100'
                          }`}>
                            {post.platform === 'facebook' ? 'FB' : 'Zalo'}
                          </span>
                        </td>
                        <td className="px-2 py-3 font-medium text-slate-800 truncate" title={chan?.name}>{chan?.name || 'Kênh ẩn'}</td>
                        <td className="px-2 py-3 text-slate-500 whitespace-nowrap">
                          {new Date(post.publishedAt).toLocaleDateString('vi-VN')}
                        </td>
                        <td className="px-2 py-3 text-slate-700 font-normal truncate" title={post.message}>
                          {post.message || <em className="text-slate-400">Không có văn bản</em>}
                        </td>
                        <td className="px-2 py-3 text-slate-500 capitalize">{post.postType}</td>
                        <td className="px-2 py-3 text-center font-mono text-slate-600 font-medium">{post.reactions.toLocaleString()}</td>
                        <td className="px-2 py-3 text-center font-mono text-slate-600 font-medium">{post.comments.toLocaleString()}</td>
                        <td className="px-2 py-3 text-center font-mono text-slate-600 font-medium">{post.shares.toLocaleString()}</td>
                        <td className="px-2 py-3 text-center font-mono text-slate-600 font-medium">{post.views.toLocaleString()}</td>
                        <td className="px-2 py-3 text-center font-mono text-slate-600 font-medium">{post.reach > 0 ? post.reach.toLocaleString() : '-'}</td>
                        <td className="px-2 py-3 text-center">
                          <span className="font-semibold text-blue-600 bg-blue-50 border border-blue-100 px-1.5 py-0.5 rounded font-mono">
                            {post.totalEngagement.toLocaleString()}
                          </span>
                        </td>
                        <td className="px-2 py-3 text-center">
                          <a
                            href={post.postUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex p-1 hover:bg-slate-100 text-blue-600 hover:text-blue-800 rounded transition-colors"
                          >
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between bg-white px-4 py-3 rounded-xl border border-slate-100 shadow-sm text-xs">
              <span className="text-slate-500">
                Hiển thị dòng <strong>{(page - 1) * limit + 1}</strong> đến{' '}
                <strong>{Math.min(page * limit, total)}</strong> trên tổng số{' '}
                <strong>{total}</strong> bài viết
              </span>

              <div className="inline-flex gap-2">
                <button
                  disabled={page === 1}
                  onClick={() => setPage(p => p - 1)}
                  className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <div className="inline-flex items-center gap-1 text-slate-700 font-semibold px-2">
                  Trang <span>{page}</span> / <span>{totalPages}</span>
                </div>
                <button
                  disabled={page === totalPages}
                  onClick={() => setPage(p => p + 1)}
                  className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
