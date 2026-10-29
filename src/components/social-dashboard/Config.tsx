import React, { useState, useEffect } from 'react';
import { appDialog } from '../AppDialog';
import {
  Settings, FileSpreadsheet, Lock, Users, AlertCircle, CheckCircle2, Shield, Plus, Trash2, Eye, ShieldAlert, KeyRound, ExternalLink, Edit3, EyeOff, FileCode, HelpCircle, Search, Sparkles, RefreshCw
} from 'lucide-react';
import { UserProfile, UserRole } from '../../types';
import ConfirmModal from '../ConfirmModal';

export interface TokenRow {
  id: string;
  platform: 'facebook' | 'zalo' | 'mock';
  pageId: string;
  pageName: string;
  accessToken: string;
  issuedAt?: string;
  expiresAt?: string;
  sourceTokenId?: string;
}

interface FacebookScanToken {
  id: string;
  platform: 'facebook';
  label: string;
  accessToken: string;
  issuedAt?: string;
  expiresAt?: string;
  pageIds: string[];
  pageNames: string[];
  validationStatus?: 'unknown' | 'valid' | 'invalid' | 'error';
  lastValidatedAt?: string;
  lastValidationError?: string;
}

const FERMAT_PRESETS = [
  { pageId: '1133904153144780', pageName: 'Asia Young Scientist Badge Competition - AYSBC Việt Nam' },
  { pageId: '1118074088045944', pageName: 'IEO - Kỳ thi Olympic Quốc tế về Tiếng Anh' },
  { pageId: '1108690205657905', pageName: 'ISO - Kỳ thi Olympic Quốc tế về Khoa học' },
  { pageId: '1024612590731278', pageName: 'ICO - Kỳ thi Olympic Lập trình Quốc tế' },
  { pageId: '1023438644179980', pageName: 'International Artificial Intelligence Olympiad - IAIO Việt Nam' },
  { pageId: '1004405742767396', pageName: 'IMO - Kỳ thi Olympic Quốc tế về Toán học' },
  { pageId: '111290387234174', pageName: 'FermatTech' },
  { pageId: '1164029276789521', pageName: 'International Finance Knowledge Olympiad - IFKO Việt Nam' },
  { pageId: '1166180133241854', pageName: 'International Entrepreneurship & Innovation Olympiad - IEIO Việt Nam' }
];

type ConfigTab = 'manual' | 'fb_scan' | 'presets';

const configTabFromPath = (pathname: string): ConfigTab => {
  const segment = pathname.replace(/^\/+|\/+$/g, '').split('/')[2] || 'manual';
  if (segment === 'facebook-scan') return 'fb_scan';
  if (segment === 'token-presets') return 'presets';
  return 'manual';
};

const configPathFor = (tab: ConfigTab) => {
  if (tab === 'fb_scan') return '/social-dashboard/config/facebook-scan';
  if (tab === 'presets') return '/social-dashboard/config/token-presets';
  return '/social-dashboard/config';
};

interface ConfigProps {
  idToken: string;
  googleAccessToken: string | null;
  userRole: UserRole;
  onConnectGoogle?: () => Promise<boolean>;
  showUserManagement?: boolean;
  onChannelsChanged?: () => Promise<void>;
}

export default function Config({ idToken, googleAccessToken, userRole, onConnectGoogle, showUserManagement = false, onChannelsChanged }: ConfigProps) {
  const [spreadsheetId, setSpreadsheetId] = useState('');
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(true);
  const [googleServiceAccountJson, setGoogleServiceAccountJson] = useState('');
  const [initLoading, setInitLoading] = useState(false);
  const [initStatus, setInitStatus] = useState<{ status: 'success' | 'failed' | 'idle'; message: string }>({ status: 'idle', message: '' });

  // Token Table state
  const [tokensList, setTokensList] = useState<TokenRow[]>([]);
  const [facebookScanTokens, setFacebookScanTokens] = useState<FacebookScanToken[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [formPlatform, setFormPlatform] = useState<'facebook' | 'zalo' | 'mock'>('facebook');
  const [formPageId, setFormPageId] = useState('');
  const [formPageName, setFormPageName] = useState('');
  const [formAccessToken, setFormAccessToken] = useState('');
  const [editingTokenId, setEditingTokenId] = useState<string | null>(null);
  const [showAdvancedJson, setShowAdvancedJson] = useState(false);
  const [visibleTokens, setVisibleTokens] = useState<Record<string, boolean>>({});
  const [, setTokenClock] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setTokenClock(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  // Redesigned smart states for multi-token configuration
  const [activeTab, setActiveTab] = useState<ConfigTab>(() => configTabFromPath(window.location.pathname));
  const navigateConfigTab = (tab: ConfigTab) => {
    setActiveTab(tab);
    const path = configPathFor(tab);
    if (window.location.pathname !== path) window.history.pushState(null, '', path);
  };

  useEffect(() => {
    const onPopState = () => setActiveTab(configTabFromPath(window.location.pathname));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  const [fbUserToken, setFbUserToken] = useState('');
  const [scanningFb, setScanningFb] = useState(false);
  const [refreshingScanTokenId, setRefreshingScanTokenId] = useState<string | null>(null);
  const [scannedPages, setScannedPages] = useState<{ id: string; name: string; access_token: string; checked: boolean }[]>([]);
  const [scanError, setScanError] = useState('');

  const [presetToken, setPresetToken] = useState('');
  const [selectedPresets, setSelectedPresets] = useState<Record<string, boolean>>(
    FERMAT_PRESETS.reduce((acc, p) => ({ ...acc, [p.pageId]: true }), {})
  );

  // Secrets states
  const [metaPageTokensJson, setMetaPageTokensJson] = useState('');
  const [zaloOaTokensJson, setZaloOaTokensJson] = useState('');
  const [cronSecret, setCronSecret] = useState('');
  const [adminEmails, setAdminEmails] = useState('admin@ftsocial.com');
  const [secretsSaveLoading, setSecretsSaveLoading] = useState(false);
  const [secretsSaveStatus, setSecretsSaveStatus] = useState<{ status: 'success' | 'failed' | 'idle'; message: string }>({ status: 'idle', message: '' });

  // Users role management
  const [usersList, setUsersList] = useState<UserProfile[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('EMPLOYEE');
  const [userActionLoading, setUserActionLoading] = useState(false);

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

  const isAdmin = userRole === 'ADMIN';
  const tokenLifetime = (row: Omit<TokenRow, 'issuedAt' | 'expiresAt'>, previous?: TokenRow): TokenRow => {
    if (previous?.accessToken === row.accessToken && previous.issuedAt && previous.expiresAt) return { ...row, issuedAt: previous.issuedAt, expiresAt: previous.expiresAt };
    const issuedAt = new Date();
    return { ...row, issuedAt: issuedAt.toISOString(), expiresAt: new Date(issuedAt.getTime() + 60 * 86_400_000).toISOString() };
  };
  const scanTokenLifetime = (accessToken: string, pages: { id: string; name: string }[], previous?: FacebookScanToken): FacebookScanToken => {
    const issuedAt = previous?.accessToken === accessToken && previous.issuedAt && previous.expiresAt ? previous.issuedAt : new Date().toISOString();
    const expiresAt = previous?.accessToken === accessToken && previous.expiresAt ? previous.expiresAt : new Date(new Date(issuedAt).getTime() + 60 * 86_400_000).toISOString();
    const mergedPages = new Map<string, string>((previous?.pageIds || []).map((id, index) => [id, previous?.pageNames?.[index] || id]));
    pages.forEach(page => mergedPages.set(page.id, page.name));
    return { id: previous?.id || `facebook-scan-${Date.now()}-${Math.random().toString(16).slice(2)}`, platform: 'facebook', label: 'Token quét Facebook', accessToken, issuedAt, expiresAt, pageIds: [...mergedPages.keys()], pageNames: [...mergedPages.values()] };
  };
  const remainingDays = (expiresAt?: string) => expiresAt ? Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86_400_000)) : null;
  const tokenExpiryLabel = (expiresAt?: string) => {
    const days = remainingDays(expiresAt);
    if (days === null) return 'Chưa có hạn';
    if (days <= 0) return 'Đã hết hạn';
    return days === 1 ? 'Còn 1 ngày (sắp hết hạn)' : `Còn ${days} ngày`;
  };
  const tokenExpiryClass = (expiresAt?: string) => {
    const days = remainingDays(expiresAt);
    if (days !== null && days <= 1) return 'text-red-600';
    if (days !== null && days <= 5) return 'text-amber-600';
    return 'text-slate-600';
  };
  const scanTokenLabel = (token: FacebookScanToken) => (
    !token.label || token.label.includes('?') || token.label.toLowerCase().startsWith('token qu')
      ? (token.id === 'facebook-scan-current' ? 'Token quét Facebook (hiện tại)' : 'Token quét Facebook')
      : token.label
  );
  const scanTokenStatus = (token: FacebookScanToken) => {
    if (token.validationStatus === 'invalid') return {
      className: 'text-rose-700',
      text: 'Facebook đã từ chối token — cần nạp token mới',
    };
    if (token.validationStatus === 'error') return {
      className: 'text-amber-700',
      text: 'Chưa kiểm tra được token do lỗi kết nối',
    };
    if (token.validationStatus === 'valid') return {
      className: 'text-emerald-700',
      text: 'Đã xác minh với Facebook · mốc dự kiến ' + tokenExpiryLabel(token.expiresAt).toLowerCase(),
    };
    return {
      className: 'text-slate-600',
      text: 'Chưa xác minh với Facebook · mốc dự kiến ' + tokenExpiryLabel(token.expiresAt).toLowerCase(),
    };
  };

  const fetchUsers = async () => {
    setLoadingUsers(true);
    try {
      const res = await fetch('/api/admin/users', {
        headers: { 'Authorization': `Bearer ${idToken}` }
      });
      if (res.ok) {
        const list = await res.json();
        setUsersList(list);
      } else {
        console.warn('Lỗi lấy danh sách người dùng:', res.statusText);
      }
    } catch (e) {
      console.error('Không thể lấy danh sách người dùng:', e);
    } finally {
      setLoadingUsers(false);
    }
  };

  const fetchConfig = async () => {
    try {
      const res = await fetch('/api/admin/config', {
        headers: { 'Authorization': `Bearer ${idToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        setSpreadsheetId(data.spreadsheetId || '');
        setGoogleServiceAccountJson(data.googleServiceAccountJson || '');
        const metaJson = data.metaPageTokensJson || '';
        const zaloJson = data.zaloOaTokensJson || '';
        setMetaPageTokensJson(metaJson);
        setZaloOaTokensJson(zaloJson);
        setCronSecret(data.cronSecret || '');
        setAdminEmails(data.adminEmails || 'admin@ftsocial.com');
        setAutoSyncEnabled(data.autoSyncEnabled !== undefined ? data.autoSyncEnabled : true);

        // Load or bootstrap visual tokensList
        if (data.detailedTokensList && Array.isArray(data.detailedTokensList)) {
          setTokensList(data.detailedTokensList);
          setFacebookScanTokens(Array.isArray(data.facebookScanTokens) ? data.facebookScanTokens : []);
        } else {
          const bootstrapped: TokenRow[] = [];
          if (metaJson.trim()) {
            try {
              const parsed = JSON.parse(metaJson);
              Object.entries(parsed).forEach(([pid, tok]) => {
                bootstrapped.push({
                  id: `facebook-${pid}`,
                  platform: 'facebook',
                  pageId: pid,
                  pageName: `Trang Facebook (${pid})`,
                  accessToken: String(tok)
                });
              });
            } catch (e) {
              console.warn('Lỗi bootstrap Facebook tokens:', e);
            }
          }
          if (zaloJson.trim()) {
            try {
              const parsed = JSON.parse(zaloJson);
              Object.entries(parsed).forEach(([oaid, tok]) => {
                bootstrapped.push({
                  id: `zalo-${oaid}`,
                  platform: 'zalo',
                  pageId: oaid,
                  pageName: `Zalo OA (${oaid})`,
                  accessToken: String(tok)
                });
              });
            } catch (e) {
              console.warn('Lỗi bootstrap Zalo tokens:', e);
            }
          }
          setTokensList(bootstrapped);
          setFacebookScanTokens(Array.isArray(data.facebookScanTokens) ? data.facebookScanTokens : []);
        }
      }
    } catch (e) {
      console.error('Không thể lấy cấu hình hệ thống:', e);
    }
  };

  useEffect(() => {
    if (idToken) {
      fetchConfig();
      fetchUsers();
    }
  }, [idToken]);

  const handleSaveSecrets = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    
    setSecretsSaveLoading(true);
    setSecretsSaveStatus({ status: 'idle', message: '' });
    
    try {
      // Serialize current table back to JSON for system compatibility
      const metaObj: Record<string, string> = {};
      const zaloObj: Record<string, string> = {};

      tokensList.forEach((t) => {
        if (t.platform === 'facebook') {
          metaObj[t.pageId] = t.accessToken;
        } else if (t.platform === 'zalo') {
          zaloObj[t.pageId] = t.accessToken;
        }
      });

      const serializedMeta = JSON.stringify(metaObj, null, 2);
      const serializedZalo = JSON.stringify(zaloObj, null, 2);

      const res = await fetch('/api/admin/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({
          metaPageTokensJson: serializedMeta,
          zaloOaTokensJson: serializedZalo,
          detailedTokensList: tokensList,
          facebookScanTokens,
          cronSecret: cronSecret.trim(),
          adminEmails: adminEmails.trim(),
          autoSyncEnabled,
          googleServiceAccountJson
        })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Lỗi lưu cấu hình.');
      }

      const responseData = await res.json();
      const duplicateNotice = responseData.sharedTokenGroups?.length
        ? ` ${responseData.sharedTokenGroups.length} token đang dùng chung cho nhiều page và được theo dõi cùng hạn.`
        : '';
      setMetaPageTokensJson(serializedMeta);
      setZaloOaTokensJson(serializedZalo);
      setTokensList(responseData.detailedTokensList || tokensList);
      setFacebookScanTokens(responseData.facebookScanTokens || facebookScanTokens);
      await onChannelsChanged?.();
      setSecretsSaveStatus({ status: 'success', message: `Lưu bảng quản lý mã Tokens và cấu hình bảo mật thành công!${duplicateNotice}` });
    } catch (err: any) {
      setSecretsSaveStatus({ status: 'failed', message: err.message || 'Lỗi lưu cấu hình bảo mật.' });
    } finally {
      setSecretsSaveLoading(false);
    }
  };

  const autoSaveTokensList = async (newList: TokenRow[], nextScanTokens: FacebookScanToken[] = facebookScanTokens) => {
    if (!isAdmin) return;
    try {
      const metaObj: Record<string, string> = {};
      const zaloObj: Record<string, string> = {};

      newList.forEach((t) => {
        if (t.platform === 'facebook') {
          metaObj[t.pageId] = t.accessToken;
        } else if (t.platform === 'zalo') {
          zaloObj[t.pageId] = t.accessToken;
        }
      });

      const serializedMeta = JSON.stringify(metaObj, null, 2);
      const serializedZalo = JSON.stringify(zaloObj, null, 2);

      const res = await fetch('/api/admin/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({
          metaPageTokensJson: serializedMeta,
          zaloOaTokensJson: serializedZalo,
          detailedTokensList: newList,
          facebookScanTokens: nextScanTokens,
          cronSecret: cronSecret.trim(),
          adminEmails: adminEmails.trim(),
          autoSyncEnabled,
          googleServiceAccountJson
        })
      });

      if (res.ok) {
        const responseData = await res.json();
        setMetaPageTokensJson(serializedMeta);
        setZaloOaTokensJson(serializedZalo);
        setTokensList(responseData.detailedTokensList || newList);
        setFacebookScanTokens(responseData.facebookScanTokens || nextScanTokens);
        await onChannelsChanged?.();
        console.log('Đã tự động lưu cấu hình Tokens và đồng bộ hóa danh sách Kênh.');
      }
    } catch (e) {
      console.error('Lỗi tự động lưu cấu hình Tokens:', e);
    }
  };

  const handleAddOrUpdateToken = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formPageId.trim() || !formAccessToken.trim()) { void appDialog.alert('Vui lòng nhập đầy đủ ID Trang/OA và mã Access Token!', { title: 'Thiếu thông tin', tone: 'warning' }); return; }
    const cleanPageId = formPageId.trim();
    const cleanPageName = formPageName.trim() || `${formPlatform === 'facebook' ? 'Trang Facebook' : 'Zalo OA'} ${cleanPageId}`;
    const cleanAccessToken = formAccessToken.trim();
    const baseRow = { id: editingTokenId || `${formPlatform}-${cleanPageId}`, platform: formPlatform, pageId: cleanPageId, pageName: cleanPageName, accessToken: cleanAccessToken } as Omit<TokenRow, 'issuedAt' | 'expiresAt'>;
    let nextList: TokenRow[];
    if (editingTokenId) { nextList = tokensList.map(token => token.id === editingTokenId ? tokenLifetime(baseRow, token) : token); setEditingTokenId(null); }
    else { if (tokensList.some(token => token.id === baseRow.id)) { void appDialog.alert('Mã ID trang/OA này đã tồn tại trong bảng quản lý.', { title: 'ID đã tồn tại', tone: 'warning' }); return; } nextList = [...tokensList, tokenLifetime(baseRow)]; }
    setTokensList(nextList); setFormPageId(''); setFormPageName(''); setFormAccessToken(''); setShowAddForm(false); void autoSaveTokensList(nextList);
  };

  const handleFbScan = async () => {
    if (!fbUserToken.trim()) {
      void appDialog.alert('Vui lòng dán mã Facebook User Access Token!', { title: 'Thiếu Access Token', tone: 'warning' });
      return;
    }
    setScanningFb(true);
    setScanError('');
    setScannedPages([]);
    try {
      const res = await fetch(`https://graph.facebook.com/v18.0/me/accounts?access_token=${fbUserToken.trim()}&limit=100`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || 'Không thể lấy dữ liệu từ Facebook Graph API. Token có thể hết hạn hoặc sai quyền.');
      }
      if (data.data && Array.isArray(data.data)) {
        const pages = data.data.map((p: any) => ({
          id: String(p.id),
          name: String(p.name),
          access_token: String(p.access_token),
          checked: true
        }));
        setScannedPages(pages);
        if (pages.length === 0) {
          setScanError('Thành công nhưng không tìm thấy Trang nào được gán quyền cho token này.');
        }
      } else {
        throw new Error('Dữ liệu trả về từ Facebook không đúng cấu trúc.');
      }
    } catch (err: any) {
      console.error('Lỗi quét trang từ FB:', err);
      setScanError(err.message || 'Lỗi kết nối Facebook.');
    } finally {
      setScanningFb(false);
    }
  };

  const handleRefreshSavedScanToken = async (token: FacebookScanToken) => {
    if (refreshingScanTokenId) return;
    setRefreshingScanTokenId(token.id);
    try {
      const res = await fetch('/api/admin/config/facebook-scan-tokens/' + encodeURIComponent(token.id) + '/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + idToken
        }
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Không thể quét lại các Trang Facebook được cấp quyền.');
      }
      setTokensList(Array.isArray(data.detailedTokensList) ? data.detailedTokensList : tokensList);
      setFacebookScanTokens(Array.isArray(data.facebookScanTokens) ? data.facebookScanTokens : facebookScanTokens);
      if (typeof data.metaPageTokensJson === 'string') setMetaPageTokensJson(data.metaPageTokensJson);
      await onChannelsChanged?.();
      const addedText = data.addedPageCount > 0
        ? 'Đã phát hiện và thêm ' + data.addedPageCount + ' Trang mới.'
        : 'Không có Trang mới; token của các Trang hiện có đã được làm mới.';
      const syncText = data.alreadyRunning
        ? 'Đang có lượt đồng bộ khác; hệ thống không mở thêm tiến trình và sẽ nạp kênh mới ở lượt an toàn tiếp theo.'
        : 'Hệ thống đã xếp lịch đồng bộ dữ liệu.';
      void appDialog.alert(
        'Đã quét ' + (data.pageCount || 0) + ' Trang được cấp quyền. ' + addedText + ' ' + syncText,
        { title: 'Đã cập nhật quyền Facebook', tone: 'success' }
      );
    } catch (error) {
      void appDialog.alert(
        error instanceof Error ? error.message : 'Không thể quét lại các Trang Facebook được cấp quyền.',
        { title: 'Quét lại quyền thất bại', tone: 'danger' }
      );
    } finally {
      setRefreshingScanTokenId(null);
    }
  };

  const handleImportScannedPages = () => {
    const selected = scannedPages.filter(page => page.checked);
    if (selected.length === 0) { void appDialog.alert('Vui lòng chọn ít nhất một Trang để nhập!', { title: 'Chưa chọn trang', tone: 'warning' }); return; }
    const selectedPageIds = new Set(selected.map(page => page.id));
    const existingScanToken = facebookScanTokens.find(token => token.accessToken === fbUserToken.trim());
    // A replacement token for the same complete page group supersedes the old
    // scan token. Tokens serving other groups remain stored independently.
    const replacedScanToken = existingScanToken || facebookScanTokens.find(token =>
      token.pageIds.length > 0 && token.pageIds.every(pageId => selectedPageIds.has(pageId))
    );
    const nextScanToken = scanTokenLifetime(fbUserToken.trim(), selected, replacedScanToken);
    const nextList = [...tokensList];
    selected.forEach(page => {
      const id = `facebook-${page.id}`;
      const index = nextList.findIndex(token => token.id === id);
      const row = tokenLifetime({ id, platform: 'facebook', pageId: page.id, pageName: page.name, accessToken: page.access_token, sourceTokenId: nextScanToken.id }, index >= 0 ? nextList[index] : undefined);
      row.issuedAt = nextScanToken.issuedAt;
      row.expiresAt = nextScanToken.expiresAt;
      if (index >= 0) nextList[index] = row; else nextList.push(row);
    });
    const nextScanTokens = replacedScanToken ? facebookScanTokens.map(token => token.id === replacedScanToken.id ? nextScanToken : token) : [...facebookScanTokens, nextScanToken];
    setTokensList(nextList); setFacebookScanTokens(nextScanTokens); void autoSaveTokensList(nextList, nextScanTokens);
    void appDialog.alert(`Đã nạp thành công ${selected.length} trang Facebook vào bảng cấu hình!`, {
      title: 'Đã nạp trang Facebook',
      tone: 'success',
    });
    setShowAddForm(false); setFbUserToken(''); setScannedPages([]);
  };

  const handleImportPresets = () => {
    if (!presetToken.trim()) { void appDialog.alert('Vui lòng dán mã Access Token áp dụng cho các trang mẫu!', { title: 'Thiếu Access Token', tone: 'warning' }); return; }
    const selectedList = FERMAT_PRESETS.filter(page => selectedPresets[page.pageId]);
    if (selectedList.length === 0) { void appDialog.alert('Vui lòng tích chọn ít nhất một Trang mẫu để nhập!', { title: 'Chưa chọn trang mẫu', tone: 'warning' }); return; }
    const selectedPages = selectedList.map(page => ({ id: page.pageId, name: page.pageName }));
    const selectedIds = new Set(selectedList.map(page => page.pageId));
    const existingScanToken = facebookScanTokens.find(token => token.accessToken === presetToken.trim()) || facebookScanTokens.find(token => token.pageIds.some(id => selectedIds.has(id)));
    const nextScanToken = scanTokenLifetime(presetToken.trim(), selectedPages, existingScanToken);
    const nextList = [...tokensList];
    selectedList.forEach(page => {
      const id = `facebook-${page.pageId}`;
      const index = nextList.findIndex(token => token.id === id);
      const row = tokenLifetime({ id, platform: 'facebook', pageId: page.pageId, pageName: page.pageName, accessToken: presetToken.trim(), sourceTokenId: nextScanToken.id }, index >= 0 ? nextList[index] : undefined);
      row.issuedAt = nextScanToken.issuedAt;
      row.expiresAt = nextScanToken.expiresAt;
      if (index >= 0) nextList[index] = row; else nextList.push(row);
    });
    const nextScanTokens = existingScanToken ? facebookScanTokens.map(token => token.id === existingScanToken.id ? nextScanToken : token) : [...facebookScanTokens, nextScanToken];
    setTokensList(nextList); setFacebookScanTokens(nextScanTokens); void autoSaveTokensList(nextList, nextScanTokens);
    void appDialog.alert(`Đã nạp thành công ${selectedList.length} trang mẫu của Fermat vào bảng cấu hình!`, {
      title: 'Đã nạp trang mẫu',
      tone: 'success',
    });
    setShowAddForm(false); setPresetToken('');
  };
  const toggleAllPresets = (checked: boolean) => {
    const next: Record<string, boolean> = {};
    FERMAT_PRESETS.forEach(p => {
      next[p.pageId] = checked;
    });
    setSelectedPresets(next);
  };

  const handleEditTokenClick = (token: TokenRow) => {
    setEditingTokenId(token.id);
    setFormPlatform(token.platform);
    setFormPageId(token.pageId);
    setFormPageName(token.pageName);
    setFormAccessToken(token.accessToken);
    setShowAddForm(true);
  };

  const handleDeleteToken = (idToDelete: string) => {
    setConfirmState({
      isOpen: true,
      title: 'Xóa mã Token',
      message: 'Bạn có chắc chắn muốn xóa mã Token của trang/OA này? Hệ thống sẽ tự động cập nhật danh sách kênh.',
      confirmText: 'Xóa ngay',
      type: 'danger',
      onConfirm: () => {
        const nextList = tokensList.filter(t => t.id !== idToDelete);
        setTokensList(nextList);
        autoSaveTokensList(nextList);
      }
    });
  };

  const toggleTokenVisibility = (tokenId: string) => {
    setVisibleTokens(prev => ({
      ...prev,
      [tokenId]: !prev[tokenId]
    }));
  };

  const handleInitSheets = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    if (!spreadsheetId) {
      void appDialog.alert('Vui lòng nhập Spreadsheet ID hoặc đường dẫn URL đầy đủ!', { title: 'Thiếu Spreadsheet ID', tone: 'warning' });
      return;
    }

    setInitLoading(true);
    setInitStatus({ status: 'idle', message: '' });

    try {
      const res = await fetch('/api/setup/sheets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
          'X-Google-OAuth-Token': googleAccessToken || '',
        },
        body: JSON.stringify({ spreadsheetId }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setSpreadsheetId(data.spreadsheetId);
        setInitStatus({ status: 'success', message: data.message || 'Cấu trúc Google Sheet được khởi tạo hoàn hảo!' });
      } else {
        setInitStatus({ status: 'failed', message: data.error || 'Lỗi khởi tạo cấu trúc Sheet.' });
      }
    } catch (err: any) {
      setInitStatus({ status: 'failed', message: err.message || 'Không thể liên kết đến Google Sheets.' });
    } finally {
      setInitLoading(false);
    }
  };

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin || !newEmail.trim() || !newPassword.trim()) {
      void appDialog.alert('Vui lòng điền đầy đủ Email và Mật khẩu khởi tạo!', { title: 'Thiếu thông tin tài khoản', tone: 'warning' });
      return;
    }

    if (newPassword.trim().length < 6) {
      void appDialog.alert('Mật khẩu khởi tạo tối thiểu phải từ 6 ký tự!', { title: 'Mật khẩu chưa hợp lệ', tone: 'warning' });
      return;
    }

    setUserActionLoading(true);
    try {
      const res = await fetch('/api/admin/create-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({
          email: newEmail.trim(),
          password: newPassword.trim(),
          name: newName.trim(),
          role: newRole
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Lỗi xử lý yêu cầu tạo tài khoản.');
      }

      const newUser: UserProfile = data.user;
      setUsersList(prev => [...prev.filter(u => u.email !== newUser.email), newUser]);
      
      // Reset input form
      setNewEmail('');
      setNewName('');
      setNewPassword('');
      void appDialog.alert(data.message || 'Đã tạo/cập nhật tài khoản người dùng thành công!', { title: 'Cập nhật tài khoản hoàn tất', tone: 'success' });
    } catch (e: any) {
      void appDialog.alert('Lỗi tạo tài khoản: ' + e.message, { title: 'Không thể cập nhật tài khoản', tone: 'danger' });
    } finally {
      setUserActionLoading(false);
    }
  };

  const handleDeleteUser = (email: string) => {
    if (!isAdmin) return;
    setConfirmState({
      isOpen: true,
      title: 'Xóa tài khoản người dùng',
      message: `Bạn có chắc chắn muốn xóa tài khoản ${email}? Hành động này sẽ hủy phân quyền và xóa tài khoản đăng nhập của họ khỏi hệ thống.`,
      confirmText: 'Xóa tài khoản',
      type: 'danger',
      onConfirm: async () => {
        setUserActionLoading(true);
        try {
          const res = await fetch('/api/admin/delete-user', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({ email })
          });

          const data = await res.json();
          if (!res.ok) {
            throw new Error(data.error || 'Lỗi xử lý yêu cầu xóa tài khoản.');
          }

          setUsersList(prev => prev.filter(u => u.email !== email));
          void appDialog.alert(data.message || 'Đã xóa tài khoản thành công!', { title: 'Xóa tài khoản hoàn tất', tone: 'success' });
        } catch (e: any) {
          void appDialog.alert('Lỗi xóa người dùng: ' + e.message, { title: 'Không thể xóa tài khoản', tone: 'danger' });
        } finally {
          setUserActionLoading(false);
        }
      }
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-150 pb-5">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Cấu Hình Hệ Thống</h2>
          <p className="text-sm text-slate-500">Cấu hình Google Sheets, đồng bộ lịch trình, phân quyền người dùng và quản lý khóa bảo mật.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Tokens Management Table */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white p-6 rounded-2xl border border-slate-150 shadow-sm space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                  <KeyRound className="w-5 h-5 text-blue-600" />
                  Bảng quản lý mã Tokens đa kênh (Facebook / Zalo OA)
                </h3>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  Đăng ký và quản lý bảo mật cho nhiều Page Facebook hoặc Zalo Official Account cùng một lúc. Hệ thống sẽ tự động đồng bộ tương tác cho tất cả các kênh được cấu hình bên dưới.
                </p>
              </div>

              {isAdmin && !showAddForm && (
                <button
                  onClick={() => {
                    setEditingTokenId(null);
                    setFormPlatform('facebook');
                    setFormPageId('');
                    setFormPageName('');
                    setFormAccessToken('');
                    setShowAddForm(true);
                  }}
                  className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs px-3.5 py-2 rounded-xl shadow-sm transition-all cursor-pointer active:scale-95 shrink-0"
                >
                  <Plus className="w-4 h-4" />
                  Thêm mã Token mới
                </button>
              )}
            </div>

            {/* Token Editor Form */}
            {showAddForm && (
              <div className="bg-slate-50 p-5 rounded-2xl border border-slate-150 space-y-5 animate-fade-in">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-200 pb-3 gap-2">
                  <div>
                    <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                      {editingTokenId ? 'Cập nhật thông tin Token' : 'Chọn cách nạp thông tin Token'}
                    </h4>
                    <p className="text-[10px] text-slate-400 mt-0.5">Hỗ trợ nhập thủ công, quét tự động từ Facebook hoặc nạp theo mẫu danh sách của Fermat</p>
                  </div>
                  {!editingTokenId && (
                    <div className="flex bg-slate-200/60 p-1 rounded-xl text-[11px] font-bold text-slate-600 gap-1 self-start">
                      <button
                        type="button"
                        onClick={() => navigateConfigTab('manual')}
                        className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${activeTab === 'manual' ? 'bg-white text-slate-900 shadow-sm' : 'hover:text-slate-800'}`}
                      >
                        Thủ công
                      </button>
                      <button
                        type="button"
                        onClick={() => navigateConfigTab('fb_scan')}
                        className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer flex items-center gap-1 ${activeTab === 'fb_scan' ? 'bg-white text-slate-900 shadow-sm' : 'hover:text-slate-800'}`}
                      >
                        <Search className="w-3 h-3 text-blue-500 shrink-0" />
                        Quét tự động FB
                      </button>
                      <button
                        type="button"
                        onClick={() => navigateConfigTab('presets')}
                        className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer flex items-center gap-1 ${activeTab === 'presets' ? 'bg-white text-slate-900 shadow-sm' : 'hover:text-slate-800'}`}
                      >
                        <Sparkles className="w-3 h-3 text-indigo-500 shrink-0" />
                        Mẫu Fermat (9 Trang)
                      </button>
                    </div>
                  )}
                </div>

                {/* Tab Content: Manual */}
                {(activeTab === 'manual' || editingTokenId) && (
                  <form onSubmit={handleAddOrUpdateToken} className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-[11px] font-bold text-slate-500 mb-1">Nền tảng</label>
                        <select
                          value={formPlatform}
                          onChange={(e) => setFormPlatform(e.target.value as any)}
                          className="w-full bg-white border border-slate-200 text-xs rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-blue-500 text-slate-700 font-medium"
                        >
                          <option value="facebook">Facebook Page</option>
                          <option value="zalo">Zalo Official Account (OA)</option>
                          <option value="mock">Mock Platform (Để thử nghiệm)</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-slate-500 mb-1">ID Trang / OA ID</label>
                        <input
                          type="text"
                          required
                          placeholder="Ví dụ: 1133904153144780"
                          value={formPageId}
                          onChange={(e) => setFormPageId(e.target.value)}
                          className="w-full bg-white border border-slate-200 text-xs rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono text-slate-700"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-slate-500 mb-1">Tên nhãn gợi nhớ</label>
                        <input
                          type="text"
                          placeholder="Ví dụ: AYSBC Việt Nam"
                          value={formPageName}
                          onChange={(e) => setFormPageName(e.target.value)}
                          className="w-full bg-white border border-slate-200 text-xs rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-blue-500 text-slate-700"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-500 mb-1">Access Token bảo mật</label>
                      <textarea
                        required
                        placeholder="Dán mã Access Token dài hạn vào đây..."
                        value={formAccessToken}
                        onChange={(e) => setFormAccessToken(e.target.value)}
                        rows={3}
                        className="w-full bg-white border border-slate-200 text-xs rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono text-slate-700"
                      />
                    </div>

                    <div className="flex justify-end gap-2.5 pt-1 border-t border-slate-200/60">
                      <button
                        type="button"
                        onClick={() => {
                          setShowAddForm(false);
                          setEditingTokenId(null);
                        }}
                        className="bg-white hover:bg-slate-100 text-slate-600 font-bold text-xs px-3.5 py-2 rounded-lg border border-slate-200 transition-colors cursor-pointer"
                      >
                        Hủy bỏ
                      </button>
                      <button
                        type="submit"
                        className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs px-4 py-2 rounded-lg transition-colors cursor-pointer"
                      >
                        {editingTokenId ? 'Cập nhật dòng' : 'Xác nhận Thêm'}
                      </button>
                    </div>
                  </form>
                )}

                {/* Tab Content: Facebook Scan */}
                {activeTab === 'fb_scan' && !editingTokenId && (
                  <div className="space-y-4">
                    <div className="bg-blue-50 border border-blue-100 p-4 rounded-xl text-xs text-blue-800 leading-relaxed space-y-1.5">
                      <div className="font-bold flex items-center gap-1">
                        <Sparkles className="w-4 h-4 text-blue-500 shrink-0" />
                        Công cụ Tự Động Quét danh sách Trang của Facebook
                      </div>
                      <p>
                        Dán <strong>Facebook User Access Token</strong> của bạn dưới đây. Hệ thống sẽ tự động gửi yêu cầu an toàn đến Facebook Graph API để lấy danh sách tất cả các trang bạn quản lý kèm mã Page Access Token tương ứng của chúng.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <label className="block text-[11px] font-bold text-slate-500">Facebook User Access Token (Mã token mở rộng của Lê Bình)</label>
                      <textarea
                        placeholder="Dán mã Facebook User Access Token vào đây (bắt đầu bằng EAAC...)"
                        value={fbUserToken}
                        onChange={(e) => setFbUserToken(e.target.value)}
                        rows={3}
                        className="w-full bg-white border border-slate-200 text-xs rounded-lg p-2.5 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono text-slate-700"
                      />
                    </div>

                    <div className="flex justify-between items-center pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          setShowAddForm(false);
                          setScannedPages([]);
                        }}
                        className="bg-white hover:bg-slate-100 text-slate-600 font-bold text-xs px-3.5 py-2 rounded-lg border border-slate-200 transition-colors cursor-pointer"
                      >
                        Hủy bỏ
                      </button>

                      <button
                        type="button"
                        onClick={handleFbScan}
                        disabled={scanningFb || !fbUserToken.trim()}
                        className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold text-xs px-4 py-2.5 rounded-lg transition-all cursor-pointer shadow-sm"
                      >
                        {scanningFb ? (
                          <Settings className="w-4 h-4 animate-spin" />
                        ) : (
                          <Search className="w-4 h-4" />
                        )}
                        {scanningFb ? 'Đang gửi yêu cầu quét Facebook...' : 'Quét danh sách Trang từ Facebook'}
                      </button>
                    </div>

                    {scanError && (
                      <div className="bg-red-50 border border-red-200 text-red-800 p-3.5 rounded-xl text-xs flex items-start gap-2">
                        <AlertCircle className="w-4.5 h-4.5 text-red-500 shrink-0 mt-0.5" />
                        <div>
                          <strong className="font-bold">Lỗi truy xuất Facebook API:</strong>
                          <p className="mt-0.5 font-mono text-[10px] bg-white/60 p-1.5 rounded border border-red-150/40">{scanError}</p>
                        </div>
                      </div>
                    )}

                    {scannedPages.length > 0 && (
                      <div className="space-y-3.5 border-t border-slate-200 pt-4 animate-fade-in">
                        <div className="flex items-center justify-between">
                          <h5 className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                            Tìm thấy {scannedPages.length} trang phù hợp:
                          </h5>
                          <span className="text-[10px] text-slate-400">Tích chọn để nhập hàng loạt</span>
                        </div>

                        <div className="max-h-[220px] overflow-y-auto border border-slate-200 rounded-xl bg-white divide-y divide-slate-100 shadow-sm">
                          {scannedPages.map((page, idx) => (
                            <label key={page.id} className="flex items-center gap-3 p-3 hover:bg-slate-50 cursor-pointer text-xs select-none">
                              <input
                                type="checkbox"
                                checked={page.checked}
                                onChange={(e) => {
                                  const checked = e.target.checked;
                                  setScannedPages(prev => prev.map((p, i) => i === idx ? { ...p, checked } : p));
                                }}
                                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                              />
                              <div className="flex-1">
                                <div className="font-bold text-slate-800">{page.name}</div>
                                <div className="text-[10px] text-slate-400 font-mono">ID: {page.id}</div>
                              </div>
                              <span className="text-[9px] bg-emerald-50 text-emerald-700 border border-emerald-100 font-bold px-2 py-0.5 rounded-full uppercase shrink-0">
                                Sẵn sàng nạp
                              </span>
                            </label>
                          ))}
                        </div>

                        <button
                          type="button"
                          onClick={handleImportScannedPages}
                          className="w-full flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs py-3 rounded-xl shadow-sm transition-all cursor-pointer active:scale-[0.99]"
                        >
                          <Plus className="w-4 h-4" />
                          Nạp {scannedPages.filter(p => p.checked).length} Trang đã chọn vào Bảng quản lý
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Tab Content: Fermat Presets list */}
                {activeTab === 'presets' && !editingTokenId && (
                  <div className="space-y-4">
                    <div className="bg-indigo-50 border border-indigo-100 p-4 rounded-xl text-xs text-indigo-900 leading-relaxed space-y-1">
                      <div className="font-bold flex items-center gap-1 text-indigo-950">
                        <Sparkles className="w-4 h-4 text-indigo-500 shrink-0" />
                        Cơ chế nạp nhanh danh sách Trang mẫu của Fermat
                      </div>
                      <p>
                        Không cần phải copy-paste từng dòng mệt mỏi! Chỉ cần dán mã <strong>User Access Token / Page Access Token</strong> của bạn, sau đó tích chọn các trang trong danh sách 9 trang mẫu của hệ thống để nạp đồng loạt cùng một lúc.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <label className="block text-[11px] font-bold text-slate-500">Mã Access Token áp dụng cho các trang được chọn</label>
                      <textarea
                        required
                        placeholder="Dán mã Access Token dài hạn của bạn vào đây..."
                        value={presetToken}
                        onChange={(e) => setPresetToken(e.target.value)}
                        rows={2}
                        className="w-full bg-white border border-slate-200 text-xs rounded-lg p-2.5 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono text-slate-700"
                      />
                    </div>

                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between border-b border-slate-200 pb-1.5">
                        <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Danh sách 9 Trang mẫu Fermat:</span>
                        <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500">
                          <button
                            type="button"
                            onClick={() => toggleAllPresets(true)}
                            className="hover:text-blue-600 cursor-pointer"
                          >
                            Chọn tất cả
                          </button>
                          <span className="text-slate-300">|</span>
                          <button
                            type="button"
                            onClick={() => toggleAllPresets(false)}
                            className="hover:text-red-500 cursor-pointer"
                          >
                            Bỏ chọn hết
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-[220px] overflow-y-auto bg-white border border-slate-200 p-3 rounded-xl shadow-sm">
                        {FERMAT_PRESETS.map((preset) => (
                          <label key={preset.pageId} className="flex items-start gap-2.5 p-2 rounded-lg hover:bg-slate-50 cursor-pointer transition-colors text-[11px] select-none">
                            <input
                              type="checkbox"
                              checked={!!selectedPresets[preset.pageId]}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                setSelectedPresets(prev => ({ ...prev, [preset.pageId]: checked }));
                              }}
                              className="w-3.5 h-3.5 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500 mt-0.5"
                            />
                            <div className="flex-1">
                              <span className="font-bold text-slate-700 block line-clamp-1">{preset.pageName}</span>
                              <span className="text-[9px] text-slate-400 font-mono">ID: {preset.pageId}</span>
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>

                    <div className="flex justify-between items-center pt-2 border-t border-slate-200/60">
                      <button
                        type="button"
                        onClick={() => {
                          setShowAddForm(false);
                          setPresetToken('');
                        }}
                        className="bg-white hover:bg-slate-100 text-slate-600 font-bold text-xs px-3.5 py-2 rounded-lg border border-slate-200 transition-colors cursor-pointer"
                      >
                        Hủy bỏ
                      </button>

                      <button
                        type="button"
                        onClick={handleImportPresets}
                        disabled={!presetToken.trim() || FERMAT_PRESETS.filter(p => selectedPresets[p.pageId]).length === 0}
                        className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs px-4.5 py-2.5 rounded-lg transition-all cursor-pointer shadow-sm disabled:opacity-40"
                      >
                        <Sparkles className="w-3.5 h-3.5 text-white" />
                        Nạp {FERMAT_PRESETS.filter(p => selectedPresets[p.pageId]).length} Trang mẫu Fermat
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Tokens Table View */}
            <div className="overflow-hidden border border-slate-150 rounded-2xl shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-150 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      <th className="p-4">Nền tảng</th>
                      <th className="p-4">ID Trang / OA</th>
                      <th className="p-4">Tên gợi nhớ</th>
                      <th className="p-4">Mã Access Token</th>
                      <th className="p-4">Thời hạn</th>
                      {isAdmin && <th className="p-4 text-center">Tác vụ</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {tokensList.length === 0 ? (
                      <tr>
                        <td colSpan={isAdmin ? 6 : 5} className="p-8 text-center text-slate-400 italic">
                          Chưa có mã Token nào được cấu hình trong bảng quản lý. Hãy bấm nút phía trên để bắt đầu thêm.
                        </td>
                      </tr>
                    ) : (
                      tokensList.map((token) => (
                        <tr key={token.id} className="hover:bg-slate-50/50">
                          <td className="p-4">
                            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full font-bold text-[10px] ${
                              token.platform === 'facebook' 
                                ? 'bg-blue-50 text-blue-700 border border-blue-100' 
                                : 'bg-cyan-50 text-cyan-700 border border-cyan-100'
                            }`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${token.platform === 'facebook' ? 'bg-blue-500' : 'bg-cyan-500'}`}></span>
                              {token.platform === 'facebook' ? 'Facebook' : 'Zalo OA'}
                            </span>
                          </td>
                          <td className="p-4 font-mono text-slate-500 select-all font-medium">{token.pageId}</td>
                          <td className="p-4 font-semibold text-slate-800">{token.pageName}</td>
                          <td className="p-4">
                            <div className="flex items-center gap-1.5 font-mono max-w-[200px]">
                              <span className="text-slate-400 select-all truncate">
                                {visibleTokens[token.id] ? token.accessToken : '••••••••••••••••••••••••••••'}
                              </span>
                              <button
                                onClick={() => toggleTokenVisibility(token.id)}
                                className="p-1 text-slate-400 hover:text-slate-600 transition-colors"
                                title={visibleTokens[token.id] ? "Ẩn mã Token" : "Hiện mã Token"}
                              >
                                {visibleTokens[token.id] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                              </button>
                            </div>
                          </td>
                          <td className={`p-4 text-xs font-semibold ${tokenExpiryClass(token.expiresAt)}`}>{tokenExpiryLabel(token.expiresAt)}</td>
                          {isAdmin && (
                            <td className="p-4 text-center">
                              <div className="inline-flex items-center gap-1">
                                <button
                                  onClick={() => handleEditTokenClick(token)}
                                  className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-all"
                                  title="Chỉnh sửa dòng"
                                >
                                  <Edit3 className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => handleDeleteToken(token.id)}
                                  className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-all"
                                  title="Xóa Token"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Quick Helper Tips */}
            <div className="bg-blue-50/50 p-4 rounded-xl border border-blue-100/30 text-xs text-slate-600 leading-relaxed flex gap-2.5">
              <HelpCircle className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
              <div>
                <strong className="text-slate-800 block mb-0.5">Tự động Lưu & Đồng bộ:</strong>
                Hệ thống hỗ trợ <strong className="text-emerald-600 font-bold">tự động lưu cấu hình (Auto-Save)</strong> và tự động kích hoạt kênh MXH tương ứng ngay khi bạn thêm, sửa, xóa hoặc nạp trang. Các thay đổi sẽ được lưu trữ vĩnh viễn và hiển thị trực tiếp tại trang Tổng quan.
              </div>
            </div>

            {/* Advanced Toggle for Raw JSON view */}
            <div className="pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowAdvancedJson(!showAdvancedJson)}
                className="flex items-center gap-1.5 text-slate-400 hover:text-slate-600 text-xs font-semibold transition-colors"
              >
                <FileCode className="w-4 h-4" />
                {showAdvancedJson ? "Ẩn cấu hình JSON nâng cao" : "Xem cấu hình JSON gốc (Nâng cao)"}
              </button>

              {showAdvancedJson && (
                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200 animate-fade-in font-mono text-xs">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Raw Facebook Pages JSON</label>
                    <pre className="bg-white p-3 rounded-lg border border-slate-200 overflow-auto max-h-[150px] text-[11px] text-slate-600">
                      {metaPageTokensJson || "{}"}
                    </pre>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Raw Zalo OA JSON</label>
                    <pre className="bg-white p-3 rounded-lg border border-slate-200 overflow-auto max-h-[150px] text-[11px] text-slate-600">
                      {zaloOaTokensJson || "{}"}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          </div>

          {facebookScanTokens.length > 0 && <section className="rounded-2xl border border-blue-100 bg-blue-50/50 p-4">
            <h3 className="text-sm font-extrabold text-slate-800">Token quét Facebook đã lưu</h3>
            <p className="mt-1 text-xs text-slate-500">Ngày hết hạn chỉ là mốc dự kiến. Trạng thái xác minh với Facebook mới quyết định token còn sử dụng được hay không.</p>
            <div className="mt-3 grid gap-2 md:grid-cols-2">{facebookScanTokens.map(token => {
              const status = scanTokenStatus(token);
              const refreshing = refreshingScanTokenId === token.id;
              return <div key={token.id} className="rounded-xl border border-blue-100 bg-white px-3 py-3 text-xs">
                <b className="block text-slate-700">{scanTokenLabel(token)}</b>
                <span className={status.className}>{token.pageNames.length} trang · {status.text}</span>
                {token.lastValidationError && token.validationStatus !== 'valid' && <span className="mt-1 block text-[11px] text-rose-600">{token.lastValidationError}</span>}
                <button
                  type="button"
                  disabled={Boolean(refreshingScanTokenId)}
                  onClick={() => void handleRefreshSavedScanToken(token)}
                  className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 font-bold text-blue-700 transition hover:border-blue-300 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <RefreshCw className={'h-3.5 w-3.5 ' + (refreshing ? 'animate-spin' : '')} />
                  {refreshing ? 'Đang quét quyền...' : 'Quét lại các trang được cấp quyền'}
                </button>
              </div>;
            })}</div>
          </section>}
        </div>

        {/* Right Column: Google Sheets, Users & Global Secrets */}
        <div className="lg:col-span-1 space-y-6">
          {/* Form wrapper for all secondary secrets */}
          <form onSubmit={handleSaveSecrets} className="space-y-6">
            {/* Global Actions Block */}
            <div className="bg-white p-5 rounded-2xl border border-slate-150 shadow-sm space-y-4">
              <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                <Lock className="w-5 h-5 text-blue-600" />
                Hành động hệ thống
              </h3>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Nhấn lưu bên dưới để cập nhật các thiết lập.
              </p>

              {isAdmin ? (
                <button
                  type="submit"
                  disabled={secretsSaveLoading}
                  className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs py-3 rounded-xl shadow-sm transition-all cursor-pointer active:scale-[0.99] disabled:opacity-50"
                >
                  {secretsSaveLoading ? (
                    <Settings className="w-4 h-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4" />
                  )}
                  Lưu cấu hình hệ thống
                </button>
              ) : (
                <div className="bg-amber-50 p-3 rounded-xl border border-amber-100 text-[10px] text-amber-700">
                  Chỉ tài khoản ADMIN mới được phép lưu cập nhật cấu hình bảo mật.
                </div>
              )}

              {secretsSaveStatus.status !== 'idle' && (
                <div className={`p-3 rounded-xl border flex items-start gap-2 text-xs ${
                  secretsSaveStatus.status === 'success' 
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800' 
                    : 'bg-red-50 border-red-200 text-red-800'
                }`}>
                  {secretsSaveStatus.status === 'success' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  )}
                  <div className="flex-1">
                    <strong className="font-bold block text-[11px]">{secretsSaveStatus.status === 'success' ? 'Thành công' : 'Thất bại'}</strong>
                    <p className="text-[10px] mt-0.5 leading-relaxed">{secretsSaveStatus.message}</p>
                  </div>
                </div>
              )}
            </div>

            {/* System Secrets & Emails Block */}
            <div className="bg-white p-5 rounded-2xl border border-slate-150 shadow-sm space-y-4">
              <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                <ShieldAlert className="w-5 h-5 text-indigo-600" />
                Tham số bảo vệ hệ thống
              </h3>

              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">
                  Mã bảo vệ CRON Secret
                </label>
                <input
                  type="password"
                  placeholder="Nhập mã bảo vệ lịch đồng bộ"
                  value={cronSecret}
                  onChange={(e) => setCronSecret(e.target.value)}
                  disabled={!isAdmin}
                  className="w-full bg-slate-50 border border-slate-200 text-xs rounded-lg p-2.5 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono text-slate-700"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">
                  Mục tiêu Email Admin (ngăn cách bằng dấu phẩy)
                </label>
                <textarea
                  placeholder="admin@ftsocial.com"
                  value={adminEmails}
                  onChange={(e) => setAdminEmails(e.target.value)}
                  disabled={!isAdmin}
                  rows={2}
                  className="w-full bg-slate-50 border border-slate-200 text-xs rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-blue-500 text-slate-700"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">
                  Google Service Account JSON (Khuyên dùng cho Sheets vĩnh viễn)
                </label>
                <textarea
                  placeholder='Dán nội dung JSON của tệp khóa Service Account vào đây...'
                  value={googleServiceAccountJson}
                  onChange={(e) => setGoogleServiceAccountJson(e.target.value)}
                  disabled={!isAdmin}
                  rows={4}
                  className="w-full bg-slate-50 border border-slate-200 text-[10px] rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono text-slate-700"
                />
              </div>
            </div>
          </form>

          {/* Google Sheets Integration widget */}
          <div className="bg-white p-5 rounded-2xl border border-slate-150 shadow-sm space-y-4">
            <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
              <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
              Tích hợp Google Sheets
            </h3>
            
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Nhập mã Spreadsheet ID hoặc dán đường dẫn URL Google Sheet để thiết lập bảng tính đồng bộ báo cáo trực tuyến.
            </p>

            <form onSubmit={handleInitSheets} className="space-y-3">
              <div>
                <input
                  type="text"
                  placeholder="Spreadsheet ID hoặc URL..."
                  value={spreadsheetId}
                  onChange={(e) => setSpreadsheetId(e.target.value)}
                  disabled={!isAdmin}
                  className="w-full bg-slate-50 border border-slate-200 text-xs rounded-lg p-2.5 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
                />
              </div>

              {isAdmin ? (
                <div className="flex flex-col gap-2 pt-1">
                  {!googleAccessToken ? (
                    <button
                      type="button"
                      onClick={onConnectGoogle}
                      className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs py-2.5 rounded-lg shadow-sm transition-colors cursor-pointer"
                    >
                      <svg className="w-4 h-4 mr-1" viewBox="0 0 24 24">
                        <path
                          fill="#ffffff"
                          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                        />
                        <path
                          fill="#ffffff"
                          fillOpacity="0.8"
                          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                        />
                        <path
                          fill="#ffffff"
                          fillOpacity="0.7"
                          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.85z"
                        />
                        <path
                          fill="#ffffff"
                          fillOpacity="0.9"
                          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.85c.87-2.6 3.3-4.53 6.16-4.53z"
                        />
                      </svg>
                      Kết nối tài khoản Google (Yêu cầu để ghi Sheets)
                    </button>
                  ) : (
                    <button
                      type="submit"
                      disabled={initLoading}
                      className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs py-2.5 rounded-lg shadow-sm transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      {initLoading ? (
                        <Settings className="w-4 h-4 animate-spin" />
                      ) : (
                        <FileSpreadsheet className="w-4 h-4" />
                      )}
                      Khởi tạo cấu trúc Sheets
                    </button>
                  )}

                  {googleAccessToken && (
                    <div className="flex justify-between items-center px-1 text-[10px] text-emerald-600 font-semibold bg-emerald-50 py-1.5 rounded-lg border border-emerald-100">
                      <span className="flex items-center gap-1">
                        <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping"></span>
                        Đã kết nối tài khoản Google
                      </span>
                      <button
                        type="button"
                        onClick={onConnectGoogle}
                        className="text-blue-600 hover:underline hover:text-blue-800"
                      >
                        Đổi tài khoản
                      </button>
                    </div>
                  )}

                  {spreadsheetId && (
                    <a
                      href={`https://docs.google.com/spreadsheets/d/${spreadsheetId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center gap-1.5 bg-slate-50 hover:bg-slate-100 text-slate-600 font-semibold text-xs py-2 rounded-lg border border-slate-200 transition-colors"
                    >
                      Mở bảng tính Google Sheet
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>
              ) : (
                <p className="text-[10px] text-amber-600 italic">Chỉ ADMIN mới có quyền liên kết Sheets.</p>
              )}
            </form>

            {spreadsheetId && (
              <div className="pt-3 border-t border-slate-100 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-xs font-bold text-slate-700 flex items-center gap-1">
                      <span>Tự động đồng bộ (6:00 AM)</span>
                    </label>
                    <p className="text-[10px] text-slate-400">Tự động đẩy dữ liệu sang Google Sheet hàng ngày lúc 6h00 sáng.</p>
                  </div>
                  <button
                    type="button"
                    disabled={!isAdmin}
                    onClick={async () => {
                      const nextState = !autoSyncEnabled;
                      setAutoSyncEnabled(nextState);
                      try {
                        const metaObj: Record<string, string> = {};
                        const zaloObj: Record<string, string> = {};
                        tokensList.forEach((t) => {
                          if (t.platform === 'facebook') {
                            metaObj[t.pageId] = t.accessToken;
                          } else if (t.platform === 'zalo') {
                            zaloObj[t.pageId] = t.accessToken;
                          }
                        });
                        const serializedMeta = JSON.stringify(metaObj, null, 2);
                        const serializedZalo = JSON.stringify(zaloObj, null, 2);

                        await fetch('/api/admin/config', {
                          method: 'POST',
                          headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${idToken}`
                          },
                          body: JSON.stringify({
                            metaPageTokensJson: serializedMeta,
                            zaloOaTokensJson: serializedZalo,
                            detailedTokensList: tokensList,
          facebookScanTokens,
                            cronSecret: cronSecret.trim(),
                            adminEmails: adminEmails.trim(),
                            autoSyncEnabled: nextState,
                            googleServiceAccountJson
                          })
                        });
                      } catch (e) {
                        console.error('Lỗi khi lưu trạng thái tự động đồng bộ:', e);
                      }
                    }}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      autoSyncEnabled ? 'bg-emerald-600' : 'bg-slate-200'
                    } ${!isAdmin ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <span
                      aria-hidden="true"
                      className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                        autoSyncEnabled ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>
            )}

            {!googleAccessToken && (
              <div className="bg-amber-50 border border-amber-200/50 p-3 rounded-xl flex items-start gap-2 text-[10px] text-amber-800">
                <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <p>Cần Đăng nhập lại bằng Google (đồng thời cấp quyền Sheets) khi cần cấu hình hoặc đồng bộ trực tiếp lên Sheets.</p>
              </div>
            )}

            {initStatus.status !== 'idle' && (
              <div className={`p-3 rounded-xl border flex items-start gap-2 text-xs ${
                initStatus.status === 'success' 
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800' 
                  : 'bg-red-50 border-red-200 text-red-800'
              }`}>
                {initStatus.status === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                )}
                <div className="flex-1">
                  <strong className="font-semibold block text-[11px]">{initStatus.status === 'success' ? 'Thành công' : 'Lỗi liên kết'}</strong>
                  <p className="text-[10px] mt-0.5 leading-relaxed">{initStatus.message}</p>
                </div>
              </div>
            )}
          </div>

          {showUserManagement && (
          <div className="bg-white p-5 rounded-2xl border border-slate-150 shadow-sm space-y-4">
            <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
              <Users className="w-5 h-5 text-blue-600" />
              Quản lý tài khoản & Phân quyền
            </h3>
            
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Tạo tài khoản đăng nhập mới hoặc thay đổi mật khẩu/vai trò của tài khoản hiện có bằng biểu mẫu bên dưới. Hệ thống không mở đăng ký tự do để đảm bảo an ninh thông tin.
            </p>
            
            {isAdmin && (
              <form onSubmit={handleAddUser} className="space-y-2.5 bg-slate-50 p-3.5 rounded-xl border border-slate-100">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Email đăng nhập</label>
                  <input
                    type="email"
                    placeholder="VD: user@company.com"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    required
                    className="w-full bg-white border border-slate-200 text-xs rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Họ và Tên (Tên hiển thị)</label>
                  <input
                    type="text"
                    placeholder="VD: Nguyễn Văn A"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="w-full bg-white border border-slate-200 text-xs rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Mật khẩu khởi tạo / Đổi mới</label>
                  <input
                    type="password"
                    placeholder="Tối thiểu 6 ký tự..."
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    className="w-full bg-white border border-slate-200 text-xs rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Vai trò hệ thống</label>
                  <select
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value as any)}
                    className="w-full bg-white border border-slate-200 text-xs rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="MANAGER">MANAGER (Quản lý)</option><option value="EMPLOYEE">EMPLOYEE (Nhân viên)</option>
                    <option value="ADMIN">ADMIN (Quản trị toàn quyền)</option>
                  </select>
                </div>

                <button
                  type="submit"
                  disabled={userActionLoading}
                  className="w-full flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs py-2 rounded-lg shadow-sm transition-colors cursor-pointer disabled:opacity-50"
                >
                  {userActionLoading ? (
                    <Settings className="w-4 h-4 animate-spin" />
                  ) : (
                    <Plus className="w-4 h-4" />
                  )}
                  Tạo mới / Cập nhật tài khoản
                </button>
              </form>
            )}

            <div className="overflow-x-auto border border-slate-150 rounded-xl">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    <th className="p-3">Thành viên</th>
                    <th className="p-3">Quyền</th>
                    {isAdmin && <th className="p-3 text-right">Tác vụ</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {loadingUsers ? (
                    <tr>
                      <td colSpan={3} className="p-3 text-center text-slate-400">Đang tải...</td>
                    </tr>
                  ) : usersList.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="p-3 text-center text-slate-400 italic">Chưa có thành viên nào.</td>
                    </tr>
                  ) : (
                    usersList.map((user) => (
                      <tr key={user.email} className="hover:bg-slate-50/50">
                        <td className="p-3 break-all">
                          <div className="font-semibold text-slate-800">{user.name || 'Thành viên'}</div>
                          <div className="text-[10px] text-slate-400 font-mono">{user.email}</div>
                        </td>
                        <td className="p-3">
                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full font-bold text-[9px] ${
                            user.role === 'ADMIN' 
                              ? 'bg-blue-50 text-blue-700' 
                              : 'bg-slate-100 text-slate-600'
                          }`}>
                            <Shield className="w-2.5 h-2.5" />
                            {user.role}
                          </span>
                        </td>
                        {isAdmin && (
                          <td className="p-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => {
                                  setNewEmail(user.email);
                                  setNewName(user.name || '');
                                  setNewRole(user.role);
                                  setNewPassword(''); // Trống để họ nhập pass mới
                                }}
                                className="p-1 hover:bg-blue-50 text-slate-400 hover:text-blue-600 rounded transition-colors cursor-pointer"
                                title="Chọn để cập nhật mật khẩu"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleDeleteUser(user.email)}
                                className="p-1 hover:bg-red-50 text-slate-400 hover:text-red-600 rounded transition-colors cursor-pointer"
                                title="Xóa tài khoản này"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
          )}
        </div>
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
