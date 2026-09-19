import React, { useState, useEffect, useRef } from 'react';
import { 
  Tag, 
  Settings, 
  Layout, 
  BookOpen, 
  HelpCircle,
  FileText,
  AlertTriangle,
  Play,
  ArrowLeft,
  ContactRound,
  MailPlus,
  RotateCcw,
  Upload
} from 'lucide-react';

import { BlockType, EmailBlock, EmailSettings, EmailTemplate, EmailVariable } from '../../types/emailBuilder';
import { createEmailBlock, getBlockDefinition } from '../../data/emailBlockRegistry';
import { matchesSearch } from '../../lib/searchText';
import { addEmailBlock, addEmailBlockRelative, duplicateEmailBlock, findEmailBlock, moveEmailBlock, moveEmailBlockByDirection, removeEmailBlock, replaceEmailBlock, updateEmailBlock } from '../../lib/emailBlockTree';
import { 
  loadTemplates, 
  saveTemplates, 
  getActiveTemplateId, 
  setActiveTemplateId,
  restoreDefaultTemplates
} from '../../lib/emailStorage';
import {
  createTemplateAsync,
  deleteTemplateAsync,
  loadTemplatesAsync,
  publishTemplateAsync,
  unpublishTemplateAsync,
  saveTemplateAsync,
  saveTemplateOrThrow,
  saveTemplatesAsync,
  loadUserPrefsAsync,
  saveUserPrefsAsync,
} from '../../lib/emailStorageApi';
import { DEFAULT_EMAIL_VARIABLES } from '../../data/defaultEmailVariables';
import { generateEmailHtml } from '../../lib/emailHtmlGenerator';
import { copyEmailToClipboard, copyTextToClipboard } from '../../lib/emailClipboard';
import { createBlankEmailTemplate, createEmailTemplateFromHtml, HtmlImportMode, isHtmlEmailFile } from '../../lib/emailTemplateFactory';
import { prepareEmailIconsForDelivery } from '../../lib/emailIconDelivery';
import ModuleMobileNav from '../ModuleMobileNav';
import ModuleShellHeader from '../layout/ModuleShellHeader';
import type { ModuleNavItem } from '../../config/workspaceNavigation';
import { splitEmailHtmlPreservingLayout } from '../../lib/emailHtmlSectionSplitter';

import BlockLibrary from './BlockLibrary';
import EmailCanvas, { EmailCanvasHandle, EmailSelectionFormat } from './EmailCanvas';
import BlockSettings from './BlockSettings';
import EmailSettingsComponent from './EmailSettings';
import EmailPreview from './EmailPreview';
import { countEmailBlocks } from '../../lib/emailBlockTree';
import VariablePicker from './VariablePicker';
import EmailBuilderHeader from './EmailBuilderHeader';
import EmailHtmlImportDialog from './EmailHtmlImportDialog';
import EmailHtmlSourceDialog from './EmailHtmlSourceDialog';
import AccountMenu from '../AccountMenu';
import { EmailBuilderDialogProvider, useEmailBuilderDialog } from './EmailBuilderDialog';

interface EmailTemplateBuilderProps {
  onBackToWorkspace: () => void;
  backLabel?: string;
  onAccountClick: () => void;
  onLogout: () => void;
  isGuest: boolean;
  userName?: string | null;
  userRole?: string | null;
  photoURL?: string | null;
  userEmail?: string | null;
  onOpenSignatureBuilder: () => void;
  /** Horizontal menu of the tools area, supplied by the shell. */
  navItems?: ModuleNavItem[];
  onNavSelect?: (id: string) => void;
}

function sortEmailTemplates(templates: EmailTemplate[]): EmailTemplate[] {
  return [...templates].sort((a, b) => {
    const aIsSystem = a.id.startsWith('aysbc-');
    const bIsSystem = b.id.startsWith('aysbc-');
    if (aIsSystem !== bIsSystem) return aIsSystem ? -1 : 1;
    return Number(b.lastUpdated || 0) - Number(a.lastUpdated || 0);
  });
}

export default function EmailTemplateBuilder(props: EmailTemplateBuilderProps) {
  return <EmailBuilderDialogProvider><EmailTemplateBuilderContent {...props} /></EmailBuilderDialogProvider>;
}

function EmailTemplateBuilderContent({ onBackToWorkspace, backLabel = 'Quay lại Workspace', onAccountClick, onLogout, isGuest, userName, userRole, photoURL, userEmail, onOpenSignatureBuilder, navItems = [], onNavSelect }: EmailTemplateBuilderProps) {
  const dialog = useEmailBuilderDialog();
  // 1. Storage & State Management
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [activeTemplateId, setActiveTemplateIdState] = useState<string>('');
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [selectionFormat, setSelectionFormat] = useState<EmailSelectionFormat | null>(null);
  const [isLoading, setIsLoading] = useState(true); // Loading state khi fetch từ server
  
  const [variables, setVariables] = useState<EmailVariable[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [showHtmlImport, setShowHtmlImport] = useState(false);
  const [showHtmlSource, setShowHtmlSource] = useState(false);
  const [htmlSource, setHtmlSource] = useState('');
  const [showVarPicker, setShowVarPicker] = useState(false);
  const [insertedVar, setInsertedVar] = useState<{ blockId: string; varName: string } | null>(null);
  const canvasRef = useRef<EmailCanvasHandle>(null);
  const listImportRef = useRef<HTMLInputElement>(null);
  const templatesRef = useRef<EmailTemplate[]>([]);
  const editorHistory = useRef<Record<string, { past: EmailTemplate[]; future: EmailTemplate[]; lastCommitAt: number; lastSignature: string }>>({});
  const pendingTemplateSaves = useRef<Record<string, { revision: number; saving: boolean; latest: EmailTemplate }>>({});
  const templateMutationClock = useRef(0);
  const panelWidthSyncTimer = useRef<NodeJS.Timeout | null>(null);

  // Routing modes
  const [editorMode, setEditorMode] = useState<'list' | 'edit'>('list');
  const [searchQuery, setSearchQuery] = useState('');

  // UI Tabs
  const [activeRightTab, setActiveRightTab] = useState<'block' | 'email'>('email');
  const [mobileActiveTab, setMobileActiveTab] = useState<'library' | 'canvas' | 'settings'>('canvas');
  const [leftPanelWidth, setLeftPanelWidth] = useState(152);
  const [rightPanelWidth, setRightPanelWidth] = useState(300);
  
  // Toast notifications
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);
  const [copySubjectSuccess, setCopySubjectSuccess] = useState(false);

  // Debounced panel width sync lên server (tránh quá nhiều request khi kéo)
  useEffect(() => {
    if (isGuest) return;
    if (panelWidthSyncTimer.current) clearTimeout(panelWidthSyncTimer.current);
    panelWidthSyncTimer.current = setTimeout(() => {
      saveUserPrefsAsync({ leftPanelWidth, rightPanelWidth });
      // Giữ localStorage compatibility
      localStorage.setItem('ft_email_left_panel_width', String(leftPanelWidth));
      localStorage.setItem('ft_email_right_panel_width', String(rightPanelWidth));
    }, 1500);
    return () => { if (panelWidthSyncTimer.current) clearTimeout(panelWidthSyncTimer.current); };
  }, [leftPanelWidth, rightPanelWidth, isGuest]);

  // Initialize templates and variables (async - fetch từ server, fallback về localStorage)
  useEffect(() => {
        let cancelled = false;

    const initAsync = async () => {
      setIsLoading(true);
      try {
        // 1. Load user preferences (panel widths, active template)
        const prefs = isGuest ? null : await loadUserPrefsAsync();
        if (!cancelled && prefs) {
          if (prefs.leftPanelWidth) {
            const max = Math.max(152, Math.floor(window.innerWidth * 0.25));
            setLeftPanelWidth(Math.max(96, Math.min(max, prefs.leftPanelWidth)));
          }
          if (prefs.rightPanelWidth) setRightPanelWidth(prefs.rightPanelWidth);
        }

        // 2. Load email templates từ server (hoặc localStorage fallback)
        let loaded = await loadTemplatesAsync();
        // Nếu server không có dữ liệu, fallback về localStorage rồi dùng defaults
        if (!loaded || loaded.length === 0) {
          loaded = loadTemplates();
        }
        loaded = sortEmailTemplates(loaded);
        if (!cancelled) {
          templatesRef.current = loaded;
          setTemplates(loaded);

          // 3. Xác định template đang active
          const params = new URLSearchParams(window.location.search);
          const templateId = params.get('id');

          if (templateId && loaded.some(t => t.id === templateId)) {
            setActiveTemplateIdState(templateId);
            setEditorMode('edit');
          } else {
            setEditorMode('list');
            if (loaded.length > 0) setActiveTemplateIdState(loaded[0].id);
          }
        }
      } catch (err: any) {
        console.warn('[EmailTemplateBuilder] Lỗi load templates:', err.message);
        // Fallback an toàn về localStorage
        const loaded = sortEmailTemplates(loadTemplates());
        if (!cancelled) {
          templatesRef.current = loaded;
          setTemplates(loaded);
          if (loaded.length > 0) setActiveTemplateIdState(loaded[0].id);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }

      // Variables (vẫn dùng localStorage)
      const storedVars = localStorage.getItem('ft_email_variables');
      if (storedVars) {
        try {
          const savedVariables: EmailVariable[] = JSON.parse(storedVars);
          const savedByKey = new Map(savedVariables.map(variable => [variable.key, variable]));
          const mergedVariables = [
            ...DEFAULT_EMAIL_VARIABLES.map(variable => savedByKey.get(variable.key) || variable),
            ...savedVariables.filter(variable => !DEFAULT_EMAIL_VARIABLES.some(defaultVariable => defaultVariable.key === variable.key))
          ];
          if (!cancelled) setVariables(mergedVariables);
          localStorage.setItem('ft_email_variables', JSON.stringify(mergedVariables));
        } catch (e) {
          if (!cancelled) setVariables(DEFAULT_EMAIL_VARIABLES);
        }
      } else {
        if (!cancelled) setVariables(DEFAULT_EMAIL_VARIABLES);
        localStorage.setItem('ft_email_variables', JSON.stringify(DEFAULT_EMAIL_VARIABLES));
      }
    };

    initAsync();

    // Popstate route listener inside builder
    const handlePopState = () => {
      const p = new URLSearchParams(window.location.search);
      const tId = p.get('id');
      const currentTemplates = templatesRef.current;
      if (tId && currentTemplates.some(t => t.id === tId)) {
        setActiveTemplateIdState(tId);
        setEditorMode('edit');
      } else {
        setEditorMode('list');
      }
    };
    window.addEventListener('popstate', handlePopState);

    return () => {
      cancelled = true;
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  // Save templates list automatically on changes (async: server + localStorage cache)
  const updateTemplatesList = (newList: EmailTemplate[]) => {
    const ordered = sortEmailTemplates(newList);
    templatesRef.current = ordered;
    setTemplates(ordered);
    saveTemplates(ordered);
    saveTemplatesAsync(ordered);
  };

  // Helper: Find active template
  const activeTemplate = templates.find(t => t.id === activeTemplateId);
  const isTemplateOwner = (template?: EmailTemplate) => {
    if (!template || isGuest) return false;
    if (!template.createdBy) return true;
    return Boolean(userEmail) && template.createdBy.trim().toLowerCase() === userEmail.trim().toLowerCase();
  };
  const applyServerTemplate = (serverTemplate: EmailTemplate) => {
    const localTemplate = templatesRef.current.find(template => template.id === serverTemplate.id);
    if (localTemplate && Number(serverTemplate.lastUpdated || 0) < Number(localTemplate.lastUpdated || 0)) return;
    updateTemplatesList(templatesRef.current.map(template => template.id === serverTemplate.id ? serverTemplate : template));
  };

  // Keep only the newest unsaved editor state per template. This prevents an
  // earlier save response from repainting a newer undo/redo state.
  const saveLatestTemplate = (template: EmailTemplate) => {
    const templateId = template.id;
    const pending = pendingTemplateSaves.current[templateId] || { revision: 0, saving: false, latest: structuredClone(template) };
    pending.latest = structuredClone(template);
    pending.revision += 1;
    pendingTemplateSaves.current[templateId] = pending;
    if (pending.saving) return;

    pending.saving = true;
    void (async () => {
      while (true) {
        const revision = pending.revision;
        const snapshot = pending.latest;
        const serverTemplate = await saveTemplateAsync(snapshot);
        if (pending.revision === revision) {
          pending.saving = false;
          if (serverTemplate) applyServerTemplate(serverTemplate);
          return;
        }
      }
    })();
  };

  const nextTemplateTimestamp = (current?: EmailTemplate) => {
    templateMutationClock.current = Math.max(Date.now(), templateMutationClock.current + 1, Number(current?.lastUpdated || 0) + 1);
    return templateMutationClock.current;
  };

  const getTemplateHistory = (templateId: string) => {
    if (!editorHistory.current[templateId]) editorHistory.current[templateId] = { past: [], future: [], lastCommitAt: 0, lastSignature: '' };
    return editorHistory.current[templateId];
  };

  const commitActiveTemplate = (nextTemplate: EmailTemplate) => {
    const currentTemplates = templatesRef.current;
    const current = currentTemplates.find(template => template.id === activeTemplateId);
    if (!current || current.id !== nextTemplate.id) return;
    const comparableCurrent = { ...current, lastUpdated: 0 };
    const comparableNext = { ...nextTemplate, lastUpdated: 0 };
    if (JSON.stringify(comparableCurrent) === JSON.stringify(comparableNext)) return;
    const history = getTemplateHistory(activeTemplateId);
    // A discrete UI action (add row, add block, remove column, ...) must always
    // be reversible with one Ctrl+Z. Do not merge it with a nearby action.
    history.past.push(structuredClone(current));
    if (history.past.length > 100) history.past.shift();
    history.lastCommitAt = 0;
    history.lastSignature = '';
    history.future = [];
    const updatedTemplate = { ...nextTemplate, lastUpdated: nextTemplateTimestamp(current) };
    const updated = currentTemplates.map(template => template.id === activeTemplateId ? updatedTemplate : template);
    updateTemplatesList(updated);
    saveLatestTemplate(updatedTemplate);
  };

  const handleUndo = () => {
    canvasRef.current?.flushPendingChanges();
    const currentTemplates = templatesRef.current;
    const current = currentTemplates.find(template => template.id === activeTemplateId);
    const history = getTemplateHistory(activeTemplateId);
    const previous = history.past.pop();
    if (!current || !previous) return;
    history.future.push(structuredClone(current));
    history.lastCommitAt = 0;
    history.lastSignature = '';
    const restored = { ...previous, lastUpdated: nextTemplateTimestamp(current) };
    updateTemplatesList(currentTemplates.map(template => template.id === activeTemplateId ? restored : template));
    saveLatestTemplate(restored);
    setSelectedBlockId(selected => selected && findEmailBlock(previous.blocks, selected) ? selected : null);
    showToast('Đã hoàn tác thay đổi.');
  };

  const handleRedo = () => {
    const currentTemplates = templatesRef.current;
    const current = currentTemplates.find(template => template.id === activeTemplateId);
    const history = getTemplateHistory(activeTemplateId);
    const next = history.future.pop();
    if (!current || !next) return;
    history.past.push(structuredClone(current));
    history.lastCommitAt = 0;
    history.lastSignature = '';
    const restored = { ...next, lastUpdated: nextTemplateTimestamp(current) };
    updateTemplatesList(currentTemplates.map(template => template.id === activeTemplateId ? restored : template));
    saveLatestTemplate(restored);
    setSelectedBlockId(selected => selected && findEmailBlock(next.blocks, selected) ? selected : null);
    showToast('Đã làm lại thay đổi.');
  };

  const canUndo = Boolean(activeTemplateId && getTemplateHistory(activeTemplateId).past.length);
  const canRedo = Boolean(activeTemplateId && getTemplateHistory(activeTemplateId).future.length);

  // Auto-select block tab when selecting a block
  useEffect(() => {
    if (selectedBlockId) {
      setActiveRightTab('block');
    } else {
      setActiveRightTab('email');
    }
  }, [selectedBlockId]);

  // 2. Navigation Handlers
  const handleEditTemplate = (id: string) => {
    setActiveTemplateIdState(id);
    setActiveTemplateId(id);
    setSelectedBlockId(null);
    setEditorMode('edit');
    window.history.pushState(null, '', `/communication-tools/email?id=${id}`);
  };

  const handleBackToList = () => {
    setEditorMode('list');
    setSelectedBlockId(null);
    window.history.pushState(null, '', '/communication-tools/email');
  };

  const handleDuplicateTemplateInline = (tpl: EmailTemplate) => {
    const { createdBy: _createdBy, updatedBy: _updatedBy, ownerName: _ownerName, isPublished: _isPublished, publishedAt: _publishedAt, ...copySource } = tpl;
    const clone: EmailTemplate = {
      ...copySource,
      id: `copy-${Date.now()}`,
      name: `Bản sao - ${tpl.name}`,
      lastUpdated: Date.now(),
    };
    updateTemplatesList([...templates, clone]);
    void createTemplateAsync(clone).then(serverTemplate => {
      if (serverTemplate) applyServerTemplate(serverTemplate);
    });
    showToast('Đã nhân bản thành mẫu riêng của bạn.');
  };
  const activeBlock = selectedBlockId ? findEmailBlock(activeTemplate?.blocks || [], selectedBlockId) : undefined;

  const resizePanel = (side: 'left' | 'right', event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault(); const startX = event.clientX; const startWidth = side === 'left' ? leftPanelWidth : rightPanelWidth;
    const move = (e: PointerEvent) => { const max = Math.floor(window.innerWidth * 0.25); const next = Math.max(side === 'left' ? 96 : 56, Math.min(max, startWidth + (side === 'left' ? e.clientX - startX : startX - e.clientX))); if (side === 'left') setLeftPanelWidth(next); else setRightPanelWidth(next); };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  useEffect(() => {
    if (isGuest) return;
    if (panelWidthSyncTimer.current) clearTimeout(panelWidthSyncTimer.current);
    panelWidthSyncTimer.current = setTimeout(() => {
      saveUserPrefsAsync({ leftPanelWidth, rightPanelWidth });
      localStorage.setItem('ft_email_left_panel_width', String(leftPanelWidth));
      localStorage.setItem('ft_email_right_panel_width', String(rightPanelWidth));
    }, 1500);
  }, [leftPanelWidth, rightPanelWidth, isGuest]);

  const getBlockLabel = (type?: BlockType) => {
    switch (type) {
      case 'logo': return 'Logo';
      case 'heading': return 'Tiêu đề';
      case 'paragraph': return 'Đoạn văn';
      case 'image': return 'Hình ảnh';
      case 'icon-text': return 'Icon + chữ';
      case 'button': return 'Nút CTA';
      case 'button-group': return 'Nhóm 2 nút';
      case 'button-group-3': return 'Nhóm 3 nút';
      case 'bullet-list': return 'Danh sách';
      case 'number-list': return 'Danh sách số';
      case 'highlight-box': return 'Hộp nổi bật';
      case 'divider': return 'Đường kẻ';
      case 'spacer': return 'Khoảng trắng';
      case 'signature': return 'Chữ ký';
      case 'signature-builder': return 'Trình tạo chữ ký';
      case 'social-links': return 'Mạng xã hội';
      default: return 'Email';
    }
  };

  // 3. Active Template Operations
  const handleSelectTemplate = (id: string) => {
    setActiveTemplateIdState(id);
    setActiveTemplateId(id);
    setSelectedBlockId(null);
    window.history.pushState(null, '', `/communication-tools/email?id=${id}`);
  };

  const handleUpdateTemplateBlocks = (newBlocks: EmailBlock[]) => {
    if (!activeTemplate) return;
    commitActiveTemplate({ ...activeTemplate, blocks: newBlocks });
  };

  const handleUpdateTemplateSettings = (newSettings: EmailSettings) => {
    if (!activeTemplate) return;
    commitActiveTemplate({ ...activeTemplate, settings: newSettings });
  };

  const handleUpdateSubject = (subject: string) => {
    if (!activeTemplate) return;
    commitActiveTemplate({ ...activeTemplate, subject });
  };

  // 4. Canvas Block Operations
  const handleAddBlock = (type: BlockType, parentId?: string, slotIndex?: number) => {
    if (!activeTemplate) return;
    const newBlock = createEmailBlock(type);
    handleUpdateTemplateBlocks(addEmailBlock(activeTemplate.blocks, newBlock, parentId, slotIndex));
    setSelectedBlockId(newBlock.id); setMobileActiveTab('canvas');
  };

  const handleMoveBlock = (id: string, direction: 'up' | 'down') => {
    if (!activeTemplate) return;
    handleUpdateTemplateBlocks(moveEmailBlockByDirection(activeTemplate.blocks, id, direction));
  };

  const handleDuplicateBlock = (id: string) => {
    if (!activeTemplate) return;
    const result = duplicateEmailBlock(activeTemplate.blocks, id);
    handleUpdateTemplateBlocks(result.blocks);
    if (result.cloneId) setSelectedBlockId(result.cloneId);
  };

  const handleDeleteBlock = (id: string) => {
    if (!activeTemplate) return;
    const blocks = removeEmailBlock(activeTemplate.blocks, id);
    handleUpdateTemplateBlocks(blocks);
    if (selectedBlockId === id) {
      setSelectedBlockId(null);
    }
  };

  const handleToggleVisibility = (id: string) => {
    if (!activeTemplate) return;
    const blocks = updateEmailBlock(activeTemplate.blocks, id, block => ({ ...block, visible: !block.visible }));
    handleUpdateTemplateBlocks(blocks);
  };

  const handleUpdateBlockContent = (id: string, newContent: Record<string, any>) => {
    if (!activeTemplate) return;
    const blocks = updateEmailBlock(activeTemplate.blocks, id, block => ({ ...block, content: newContent }));
    handleUpdateTemplateBlocks(blocks);
  };

  const handleInsertBlock = (type: BlockType, targetId: string, position: 'before' | 'after') => {
    if (!activeTemplate) return;
    const newBlock = createEmailBlock(type);
    handleUpdateTemplateBlocks(addEmailBlockRelative(activeTemplate.blocks, newBlock, targetId, position));
    setSelectedBlockId(newBlock.id);
    setMobileActiveTab('canvas');
  };

  const handleDropBlock = (sourceId: string, targetId: string, slotIndex?: number, position: 'before' | 'after' = 'after') => {
    if (!activeTemplate) return;
    handleUpdateTemplateBlocks(moveEmailBlock(activeTemplate.blocks, sourceId, targetId, slotIndex, position));
    setSelectedBlockId(sourceId);
  };

  const handleUpdateBlockStyles = (id: string, newStyles: Record<string, any>) => {
    if (!activeTemplate) return;
    const blocks = updateEmailBlock(activeTemplate.blocks, id, block => ({ ...block, styles: newStyles }));
    handleUpdateTemplateBlocks(blocks);
  };
  const handleUpdateWholeBlock = (id: string, nextBlock: EmailBlock) => {
    if (!activeTemplate) return;
    const blocks = updateEmailBlock(activeTemplate.blocks, id, () => ({ ...nextBlock, id }));
    handleUpdateTemplateBlocks(blocks);
  };

  const handleSplitCustomHtml = async (id: string) => {
    if (!activeTemplate) return;
    const sourceBlock = findEmailBlock(activeTemplate.blocks, id);
    if (sourceBlock?.type !== 'custom-html') return;
    const sourceHtml = String(sourceBlock.content.html || '').trim();
    if (!sourceHtml) { showToast('Khối HTML này chưa có nội dung để tách.'); return; }

    // Let the button state paint before parsing a long clipboard payload. The
    // splitter intentionally preserves table wrappers instead of translating
    // email markup into native blocks, which is what used to lose the form.
    await new Promise<void>(resolve => window.setTimeout(resolve, 0));
    const fragments = splitEmailHtmlPreservingLayout(sourceHtml);
    if (fragments.length < 2) {
      showToast('Không tìm thấy ít nhất 2 section độc lập trong HTML này. Hãy tách tại một bảng/hàng nội dung có từ 2 phần trở lên.');
      return;
    }
    const splitBlocks: EmailBlock[] = fragments.map((html, index) => ({
      id: `custom-html-${Date.now()}-${index}`,
      type: 'custom-html',
      content: { variant: 'style-1', html, htmlSanitized: true },
      styles: {
        marginTop: index === 0 ? sourceBlock.styles.marginTop ?? 0 : 0,
        marginBottom: index === fragments.length - 1 ? sourceBlock.styles.marginBottom ?? 0 : 0,
      },
      visible: sourceBlock.visible,
    }));
    const accepted = await dialog.confirm(
      `Tách HTML này thành ${splitBlocks.length} section giữ nguyên bố cục? Mỗi section sẽ là một Custom HTML riêng để bạn sửa mã mà không mất bảng/style bọc.`,
      { title: 'Tách HTML theo section', confirmText: 'Tách section' },
    );
    if (!accepted) return;
    handleUpdateTemplateBlocks(replaceEmailBlock(activeTemplate.blocks, id, splitBlocks));
    setSelectedBlockId(splitBlocks[0].id);
    showToast(`Đã tách HTML thành ${splitBlocks.length} section giữ nguyên bố cục.`);
  };
  // 5. Variables Operations
  const updateVariablesList = (newList: EmailVariable[]) => {
    setVariables(newList);
    localStorage.setItem('ft_email_variables', JSON.stringify(newList));
  };

  const handleAddVariable = (newVar: EmailVariable) => {
    updateVariablesList([...variables, newVar]);
    showToast(`Đã thêm biến {{${newVar.key}}}`);
  };

  const handleEditVariable = (oldKey: string, updatedVar: EmailVariable) => {
    const newList = variables.map(v => (v.key === oldKey ? updatedVar : v));
    updateVariablesList(newList);
    showToast(`Đã cập nhật biến {{${updatedVar.key}}}`);
  };

  const handleDeleteVariable = (key: string) => {
    updateVariablesList(variables.filter(v => v.key !== key));
    showToast(`Đã xóa biến {{${key}}}`);
  };

  const handleInsertVariable = (varName: string) => {
    if (selectedBlockId) {
      setInsertedVar({ blockId: selectedBlockId, varName });
      setShowVarPicker(false);
      showToast(`Chèn {{${varName}}} thành công`);
    } else {
      void dialog.alert('Vui lòng chọn khối Văn bản hoặc Hộp thông tin trên Canvas để chèn biến!', 'Chưa chọn khối');
    }
  };

  // 6. Header Template Operations
  const handleRenameTemplate = (newName: string) => {
    if (!activeTemplate) return;
    commitActiveTemplate({ ...activeTemplate, name: newName });
    showToast('Đã đổi tên mẫu email.');
  };

  const handleDuplicateTemplate = () => {
    if (!activeTemplate) return;
    const { createdBy: _createdBy, updatedBy: _updatedBy, ownerName: _ownerName, isPublished: _isPublished, publishedAt: _publishedAt, ...copySource } = activeTemplate;
    const clone: EmailTemplate = {
      ...copySource,
      id: `copy-${Date.now()}`,
      name: `Bản sao - ${activeTemplate.name}`,
      lastUpdated: Date.now(),
    };
    updateTemplatesList([...templates, clone]);
    setActiveTemplateIdState(clone.id);
    setActiveTemplateId(clone.id);
    void createTemplateAsync(clone).then(serverTemplate => {
      if (serverTemplate) applyServerTemplate(serverTemplate);
    });
    showToast('Đã nhân bản thành mẫu riêng của bạn.');
  };

  const handleDeleteTemplate = async () => {
    if (!activeTemplate || templates.length <= 1 || !isTemplateOwner(activeTemplate)) return;
    try {
      await deleteTemplateAsync(activeTemplate.id);
      const remaining = templatesRef.current.filter(template => template.id !== activeTemplate.id);
      updateTemplatesList(remaining);
      setActiveTemplateIdState(remaining[0].id);
      setActiveTemplateId(remaining[0].id);
      setSelectedBlockId(null);
      showToast('Đã xóa mẫu email.');
    } catch (error: any) {
      await dialog.alert(error?.message || 'Không thể xóa mẫu email.', 'Không thể xóa mẫu');
    }
  };

  const handlePublishTemplate = async () => {
    if (!activeTemplate || !isTemplateOwner(activeTemplate) || activeTemplate.isPublished) return;
    try {
      canvasRef.current?.flushPendingChanges();
      const saved = await saveTemplateOrThrow(activeTemplate);
      const published = await publishTemplateAsync(saved.id);
      applyServerTemplate(published);
      showToast('Đã chia sẻ mẫu. Mọi nhân viên có thể xem và chỉnh sửa; chỉ bạn có thể xóa.');
    } catch (error: any) {
      await dialog.alert(error?.message || 'Không thể chia sẻ mẫu email.', 'Không thể chia sẻ mẫu');
    }
  };
  const handleUnpublishTemplate = async () => {
    if (!activeTemplate || !isTemplateOwner(activeTemplate) || !activeTemplate.isPublished) return;
    try {
      const unpublished = await unpublishTemplateAsync(activeTemplate.id);
      applyServerTemplate(unpublished);
      showToast('Mẫu đã chuyển về riêng tư. Chỉ bạn có thể xem và chỉnh sửa.');
    } catch (error: any) {
      await dialog.alert(error?.message || 'Không thể dừng chia sẻ mẫu email.', 'Không thể dừng chia sẻ');
    }
  };

  const handleRestoreDefaults = () => {
    const restored = restoreDefaultTemplates();
    templatesRef.current = restored;
    setTemplates(restored);
    setActiveTemplateIdState(restored[0].id);
    setActiveTemplateId(restored[0].id);
    setSelectedBlockId(null);
    showToast('Đã khôi phục các mẫu gốc.');
  };

  const handleImportTemplate = (imported: EmailTemplate) => {
    const { createdBy: _createdBy, updatedBy: _updatedBy, ownerName: _ownerName, isPublished: _isPublished, publishedAt: _publishedAt, ...importSource } = imported;
    const cleanImported: EmailTemplate = {
      ...importSource,
      id: `imported-${Date.now()}`,
      lastUpdated: Date.now(),
    };
    updateTemplatesList([...templates, cleanImported]);
    void createTemplateAsync(cleanImported).then(serverTemplate => {
      if (serverTemplate) applyServerTemplate(serverTemplate);
    });
    handleEditTemplate(cleanImported.id);
  };
  const handleImportFile = async (file: File) => {
    try {
      const contents = await file.text();
      if (isHtmlEmailFile(file, contents)) {
        const imported = createEmailTemplateFromHtml(contents, file.name);
        handleImportTemplate(imported);
        showToast(`Đã nhập và tách HTML thành ${countEmailBlocks(imported.blocks)} khối chỉnh sửa.`);
        return;
      }
      const parsed = JSON.parse(contents);
      if (!parsed?.name || !Array.isArray(parsed.blocks) || !parsed.settings) {
        throw new Error('File JSON không đúng định dạng mẫu email.');
      }
      handleImportTemplate(parsed as EmailTemplate);
      showToast('Đã nhập mẫu từ tệp JSON.');
    } catch (error: any) {
      await dialog.alert(error?.message || 'Không thể đọc tệp mẫu email.', 'Không thể nhập mẫu');
    }
  };

  const handleImportPastedHtml = async (templateName: string, source: string, mode: HtmlImportMode): Promise<string | null> => {
    try {
      const imported = createEmailTemplateFromHtml(source, templateName, Date.now(), mode);
      handleImportTemplate(imported);
      const count = countEmailBlocks(imported.blocks);
      showToast(mode === 'editable' ? `Đã tách mã HTML thành ${count} khối chỉnh sửa.` : 'Đã giữ nguyên HTML trong một khối tùy chỉnh.');
      return null;
    } catch (error: any) {
      return error?.message || 'Không thể đọc mã HTML.';
    }
  };

  const handleApplyPastedHtmlToCurrentTemplate = async (source: string, mode: HtmlImportMode, placement: 'append' | 'replace'): Promise<string | null> => {
    const current = templatesRef.current.find(template => template.id === activeTemplateId);
    if (!current) return 'Không tìm thấy email đang chỉnh sửa.';
    try {
      canvasRef.current?.flushPendingChanges();
      const imported = createEmailTemplateFromHtml(source, current.name, Date.now(), mode);
      const replacing = placement === 'replace';
      commitActiveTemplate({
        ...current,
        subject: replacing && imported.subject ? imported.subject : current.subject,
        settings: replacing ? imported.settings : current.settings,
        blocks: replacing ? imported.blocks : [...current.blocks, ...imported.blocks],
      });
      setSelectedBlockId(imported.blocks[0]?.id || null);
      const count = countEmailBlocks(imported.blocks);
      showToast(replacing
        ? `Đã thay thế email hiện tại bằng ${count} khối từ HTML.`
        : `Đã thêm ${count} khối từ HTML vào email hiện tại.`);
      return null;
    } catch (error: any) {
      return error?.message || 'Không thể đọc mã HTML.';
    }
  };

  const handleOpenHtmlSource = async () => {
    const hadPendingChanges = canvasRef.current?.flushPendingChanges();
    if (hadPendingChanges) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const current = templatesRef.current.find(template => template.id === activeTemplateId);
    if (!current) return;
    setHtmlSource(generateEmailHtml(current, variables, false).html);
    setShowHtmlSource(true);
  };

  const handleApplyHtmlSourceToCurrentTemplate = async (source: string): Promise<string | null> => {
    const current = templatesRef.current.find(template => template.id === activeTemplateId);
    if (!current) return 'Không tìm thấy email đang chỉnh sửa.';
    try {
      const imported = createEmailTemplateFromHtml(source, current.name, Date.now(), 'editable');
      commitActiveTemplate({
        ...current,
        subject: imported.subject || current.subject,
        settings: current.settings,
        blocks: imported.blocks,
      });
      setSelectedBlockId(null);
      showToast('Đã áp dụng mã HTML vào email hiện tại.');
      return null;
    } catch (error: any) {
      return error?.message || 'Không thể đọc mã HTML.';
    }
  };

  const prepareActiveTemplateForDelivery = async () => {
    const current = templatesRef.current.find(template => template.id === activeTemplateId) || activeTemplate;
    if (!current) return null;
    const prepared = await prepareEmailIconsForDelivery(current);
    if (prepared !== current) {
      updateTemplatesList(templatesRef.current.map(template => template.id === prepared.id ? prepared : template));
    }
    return prepared;
  };

  const downloadTemplateHtml = (template: EmailTemplate) => {
    const { html } = generateEmailHtml(template, variables, false);
    const safeName = (template.name || 'email')
      .trim()
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
      .replace(/\s+/g, ' ');
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const downloadAnchor = document.createElement('a');
    downloadAnchor.href = url;
    downloadAnchor.download = `${safeName || 'email'}.html`;
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    URL.revokeObjectURL(url);
  };

  const handleExportHtml = async () => {
    const changed = canvasRef.current?.flushPendingChanges();
    if (changed) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const templateToExport = await prepareActiveTemplateForDelivery();
    if (!templateToExport) return;
    downloadTemplateHtml(templateToExport);
    showToast('Đã xuất file HTML.');
  };

  const handleExportTemplateHtml = async (template: EmailTemplate) => {
    const prepared = await prepareEmailIconsForDelivery(template);
    downloadTemplateHtml(prepared);
    showToast('Đã xuất file HTML.');
  };

  // 7. Copying to Clipboard
  const handleCopyEmail = async () => {
    if (!activeTemplate) return;
    const changed = canvasRef.current?.flushPendingChanges();
    if (changed) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const templateToCopy = await prepareActiveTemplateForDelivery();
    if (!templateToCopy) return;
    const { copyHtml, plainText } = generateEmailHtml(templateToCopy, variables, false);
    const success = await copyEmailToClipboard(copyHtml, plainText, templateToCopy.settings.maxWidth);
    if (success) {
      setCopySuccess(true);
      showToast('Đã copy nội dung email.');
      setTimeout(() => setCopySuccess(false), 3000);
    } else {
      await dialog.alert('Không thể sao chép tự động. Vui lòng mở chế độ xem trước, quét chọn văn bản để sao chép.', 'Không thể sao chép');
    }
  };

  const handlePreviewEmail = async () => {
    const changed = canvasRef.current?.flushPendingChanges();
    if (changed) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    await prepareActiveTemplateForDelivery();
    setShowPreview(true);
  };

  const handleCopySubject = async () => {
    if (!activeTemplate) return;
    const success = await copyTextToClipboard(activeTemplate.subject);
    if (success) {
      setCopySubjectSuccess(true);
      showToast('Đã copy tiêu đề email.');
      setTimeout(() => setCopySubjectSuccess(false), 3000);
    }
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  useEffect(() => {
    if (editorMode !== 'edit') return;
    const handleHistoryShortcut = (event: KeyboardEvent) => {
      if (event.isComposing || !(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) { event.preventDefault(); handleUndo(); }
      else if (key === 'y' || (key === 'z' && event.shiftKey)) { event.preventDefault(); handleRedo(); }
    };
    window.addEventListener('keydown', handleHistoryShortcut, true);
    return () => window.removeEventListener('keydown', handleHistoryShortcut, true);
  }, [editorMode, activeTemplateId, templates]);

  const handleCreateBlankTemplate = async (name: string): Promise<string | null> => {
    const cleanName = name.trim();
    if (!cleanName) return 'Vui lòng nhập tên mẫu email.';
    try {
      const newTemplate = createBlankEmailTemplate(cleanName);
      const newId = newTemplate.id;
      updateTemplatesList([...templatesRef.current, newTemplate]);
      void createTemplateAsync(newTemplate).then(serverTemplate => {
        if (serverTemplate) applyServerTemplate(serverTemplate);
      });
      handleEditTemplate(newId);
      showToast('Đã tạo mẫu email mới.');
      return null;
    } catch (error: any) {
      return error?.message || 'Không thể tạo mẫu email.';
    }
  };

  const handleCreateTemplate = () => setShowHtmlImport(true);

  const filteredTemplates = templates.filter(t => 
    matchesSearch(`${t.name} ${t.subject}`, searchQuery)
  );
  const addEmailTileIndex = Math.max(0, filteredTemplates.findIndex(template => !template.id.startsWith('aysbc-')));

  // LOADING SKELETON khi đang fetch templates từ server
  if (isLoading) {
    return (
      <div className="ft-module-shell ft-email-builder flex flex-col h-screen font-sans items-center justify-center gap-4">
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 bg-gradient-to-tr from-blue-600 to-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-lg animate-pulse">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <div className="text-sm font-bold text-slate-600">Đang tải mẫu email...</div>
          <div className="text-xs text-slate-400 font-medium">Đồng bộ từ server</div>
        </div>
        <div className="flex gap-2 mt-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="w-48 h-24 bg-slate-200 rounded-2xl animate-pulse" style={{ animationDelay: `${i * 100}ms` }} />
          ))}
        </div>
      </div>
    );
  }

  // RENDER LIST MODE
  if (editorMode === 'list') {
    return (
      <div className="ft-module-shell ft-email-builder flex h-screen overflow-hidden font-sans">
        
        {/* Toast Notification */}
        {toastMessage && (
          <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 z-55 bg-slate-900/90 backdrop-blur-md text-white text-xs font-bold py-3 px-6 rounded-2xl border border-slate-750/80 shadow-2xl flex items-center gap-2.5 animate-bounce-short">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
            {toastMessage}
          </div>
        )}

        <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          <ModuleShellHeader
            eyebrow="Bộ công cụ FermatTech"
            title="Trình quản lý mẫu Email"
            items={navItems}
            activeId="email-builder"
            onSelect={(id) => (onNavSelect ? onNavSelect(id) : onBackToWorkspace())}
            ariaLabel="Điều hướng bộ công cụ FermatTech"
            actions={(
              <>
                <button type="button" onClick={handleCreateTemplate} className="ft-btn ft-btn-primary text-xs"><MailPlus className="h-4 w-4" />Tạo mẫu mới</button>
                <label className="ft-btn ft-btn-secondary cursor-pointer text-xs" title="Nhập mẫu từ tệp JSON hoặc HTML">
                  <Upload className="h-4 w-4" />
                  <input
                    type="file"
                    accept=".json,.html,.htm,application/json,text/html"
                    onChange={async e => {
                      const input = e.currentTarget;
                      const file = input.files?.[0];
                      if (!file) return;
                      try {
                        await handleImportFile(file);
                      } finally {
                        input.value = '';
                      }
                    }}
                    className="hidden"
                  />
                  <span className="hidden lg:inline">Tải tệp mẫu</span>
                </label>
                <button type="button" onClick={handleRestoreDefaults} className="ft-btn ft-btn-secondary text-xs" title="Khôi phục mẫu gốc"><RotateCcw className="h-4 w-4" /></button>
              </>
            )}
            account={<AccountMenu userName={userName} userRole={userRole} photoURL={photoURL} isGuest={isGuest} onAccountClick={onAccountClick} onLogout={onLogout} variant="avatar"/>}
          />
          <input
            ref={listImportRef}
            type="file"
            accept=".json,.html,.htm,application/json,text/html"
            onChange={async (event) => {
              const input = event.currentTarget;
              const file = input.files?.[0];
              if (!file) return;
              try {
                await handleImportFile(file);
              } finally {
                input.value = "";
              }
            }}
            className="hidden"
          />
          <div className="ft-module-content mx-auto w-full max-w-6xl space-y-6 p-6 md:p-8">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <h2 className="text-base font-black text-slate-800">Danh sách mẫu thiết kế ({templates.length})</h2>
              <p className="text-xs text-slate-400">Chọn một mẫu email bên dưới để tiến hành chỉnh sửa hoặc sao chép.</p>
            </div>
            
            <div className="w-full md:w-80">
              <input
                type="text"
                placeholder="Tìm kiếm mẫu email..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full text-xs rounded-xl border border-slate-200 px-4 py-2.5 outline-none focus:border-blue-500 bg-white shadow-sm"
              />
            </div>
          </div>

          {filteredTemplates.length === 0 ? (
            <div className="text-center py-20 bg-white rounded-3xl border border-slate-200/80 shadow-sm space-y-3">
              <p className="text-sm font-semibold text-slate-450">Không tìm thấy mẫu email nào khớp với tìm kiếm.</p>
              <button 
                onClick={() => setSearchQuery('')}
                className="text-xs text-blue-650 font-bold hover:underline"
              >
                Xóa bộ lọc tìm kiếm
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredTemplates.map((tpl, index) => {
                const isDefault = tpl.id.startsWith('aysbc-');
                const lastUpdatedStr = new Date(tpl.lastUpdated || Date.now()).toLocaleDateString('vi-VN', {
                  hour: '2-digit',
                  minute: '2-digit',
                  day: '2-digit',
                  month: '2-digit'
                });

                return (
                  <React.Fragment key={tpl.id}>
                    <div
                      key={tpl.id}
                    onClick={() => handleEditTemplate(tpl.id)}
                    className="bg-white border border-slate-200/80 hover:border-blue-300 rounded-3xl p-5 shadow-sm hover:shadow-lg transition-all duration-350 cursor-pointer flex flex-col justify-between group min-h-[190px]"
                  >
                    <div className="space-y-3.5">
                      <div className="flex justify-between items-start gap-2">
                        <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${isDefault ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-emerald-50 border-emerald-200 text-emerald-700'}`}>
                          {isDefault ? 'Mẫu mặc định' : 'Mẫu tùy chỉnh'}
                        </span>
                        <span className="text-[9px] text-slate-450 font-bold">{lastUpdatedStr}</span>
                      </div>
                      
                      <div className="space-y-1">
                        <h3 className="text-sm font-black text-slate-900 group-hover:text-blue-600 transition-colors leading-tight line-clamp-1">{tpl.name}</h3>
                        <p className="text-[11px] text-slate-500 line-clamp-2 leading-relaxed">
                          <strong>Tiêu đề:</strong> {tpl.subject}
                        </p>
                      </div>
                    </div>

                    <div className="pt-4 border-t border-slate-100 flex items-center justify-between mt-4">
                      <span className="text-[10px] text-slate-450 font-extrabold">
                        {countEmailBlocks(tpl.blocks)} khối nội dung
                      </span>
                      
                      <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => handleDuplicateTemplateInline(tpl)}
                          title="Nhân bản mẫu"
                          className="p-1.5 hover:bg-slate-100 hover:text-blue-600 text-slate-450 rounded-lg cursor-pointer"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
                          </svg>
                        </button>
                        
                        <button
                          onClick={() => { void handleExportTemplateHtml(tpl); }}
                          title="Xuất file HTML"
                          className="p-1.5 hover:bg-slate-100 hover:text-blue-600 text-slate-450 rounded-lg cursor-pointer"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                          </svg>
                        </button>

                        {!isDefault && isTemplateOwner(tpl) && (
                          <button
                            onClick={async () => {
                              if (await dialog.confirm(`Bạn chắc chắn muốn xóa mẫu "${tpl.name}"?`, { title: 'Xóa mẫu email', confirmText: 'Xóa mẫu', danger: true })) {
                                try {
                                  await deleteTemplateAsync(tpl.id);
                                  updateTemplatesList(templatesRef.current.filter(template => template.id !== tpl.id));
                                  showToast('Đã xóa mẫu email.');
                                } catch (error: any) {
                                  await dialog.alert(error?.message || 'Không thể xóa mẫu email.', 'Không thể xóa mẫu');
                                }
                              }
                            }}
                            title="Xóa mẫu"
                            className="p-1.5 hover:bg-rose-50 text-rose-600 rounded-lg cursor-pointer"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>
                    </div>
                    {index === addEmailTileIndex && (
                      <button type="button" onClick={handleCreateTemplate} className="group flex min-h-[190px] flex-col items-center justify-center rounded-3xl border-2 border-dashed border-blue-200 bg-blue-50/40 p-5 text-center transition-all hover:border-blue-500 hover:bg-blue-50 hover:shadow-lg">
                        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-blue-600 text-4xl font-light leading-none text-white shadow-md transition-transform group-hover:scale-110">+</span>
                        <span className="mt-4 text-sm font-black text-blue-700">Thêm Email mới</span>
                      </button>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          )}
          </div>
        </main>
        {showHtmlImport && <EmailHtmlImportDialog context="create" onClose={() => setShowHtmlImport(false)} onCreateBlank={handleCreateBlankTemplate} onImport={handleImportPastedHtml} onApplyToCurrent={handleApplyPastedHtmlToCurrentTemplate} />}
      </div>
    );
  }

  // RENDER EDIT MODE
  if (!activeTemplate) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-slate-50 space-y-3">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
        <p className="text-xs font-semibold text-slate-500">Đang nạp dữ liệu mẫu email...</p>
      </div>
    );
  }

  return (
    <div className="relative flex h-screen min-h-dvh flex-col overflow-hidden bg-[#f5f6f8] font-sans">
      
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 z-55 bg-slate-900/90 backdrop-blur-md text-white text-xs font-bold py-3 px-6 rounded-2xl border border-slate-750/80 shadow-2xl flex items-center gap-2.5 animate-bounce-short">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
          {toastMessage}
        </div>
      )}

      {/* Main Top Header */}
      <EmailBuilderHeader
        onAccountClick={onAccountClick}
        onLogout={onLogout}
        isGuest={isGuest}
        userName={userName}
        userRole={userRole}
        photoURL={photoURL}
        template={activeTemplate}
        templatesList={templates}
        onSelectTemplate={handleSelectTemplate}
        onRenameTemplate={handleRenameTemplate}
        onDuplicateTemplate={handleDuplicateTemplate}
        onExportHtml={handleExportHtml}
        onDeleteTemplate={handleDeleteTemplate}
        onPublishTemplate={handlePublishTemplate}
        onUnpublishTemplate={handleUnpublishTemplate}
        canDeleteTemplate={isTemplateOwner(activeTemplate)}
        canManageSharing={isTemplateOwner(activeTemplate)}
        onRestoreDefaults={handleRestoreDefaults}
        onImportFile={handleImportFile}
        onEditHtmlClick={handleOpenHtmlSource}
        onPasteHtmlClick={() => setShowHtmlImport(true)}
        onPreviewClick={handlePreviewEmail}
        onBackToWorkspace={handleBackToList}
        onCopyEmail={handleCopyEmail}
        onCopySubject={handleCopySubject}
        copySuccess={copySuccess}
        copySubjectSuccess={copySubjectSuccess}
        onUndo={handleUndo}
        onRedo={handleRedo}
        canUndo={canUndo}
        canRedo={canRedo}
      />

      <ModuleMobileNav
        className="email-editor-mobile-nav"
        onBack={handleBackToList}
        activeId={mobileActiveTab}
        onSelect={(id) => setMobileActiveTab(id as 'library' | 'canvas' | 'settings')}
        items={[
          { id: 'library', label: 'Thư viện khối', icon: BookOpen },
          { id: 'canvas', label: 'Canvas email', icon: Layout },
          { id: 'settings', label: 'Cài đặt', icon: Settings },
        ]}
        ariaLabel="Điều hướng trình tạo Email"
      />

      {/* Editor Layout Frame */}
      <div className="relative flex flex-1 overflow-hidden">
        
        {/* DESKTOP / TABLET view panels */}
        <div className="flex flex-1 overflow-hidden">
          
          {/* Left Block Selection Library */}
          <div className={`hidden lg:flex ${mobileActiveTab === 'library' ? '!block absolute inset-0 z-40 bg-white lg:relative lg:inset-auto lg:z-auto' : ''}`}>
            <BlockLibrary onAddBlock={handleAddBlock} width={leftPanelWidth} />
             <div onPointerDown={(e) => resizePanel('left', e)} className="hidden lg:block w-1.5 cursor-col-resize bg-transparent hover:bg-blue-400/50 active:bg-blue-500" aria-label="Kéo để đổi độ rộng thư viện" />
          </div>

          {/* Middle Email Design Canvas */}
          <div className={`flex min-h-0 min-w-0 flex-1 flex-col ${mobileActiveTab === 'canvas' ? 'flex flex-col' : 'hidden lg:flex'}`}>
            
            {/* Subject field editor */}
            <div className="flex shrink-0 items-center gap-3 border-b border-slate-200/80 bg-white px-5 py-3">
              <label htmlFor="email-subject" className="text-xs font-bold text-slate-500 uppercase tracking-wider shrink-0">Tiêu đề email:</label>
              <input
                id="email-subject"
                type="text"
                placeholder="Nhập tiêu đề email..."
                value={activeTemplate.subject}
                onChange={e => handleUpdateSubject(e.target.value)}
                className="flex-1 text-xs font-bold text-slate-800 outline-none border border-transparent hover:border-slate-200 focus:border-blue-500 rounded-lg px-2.5 py-1.5 transition-all"
              />
              
              <button
                onClick={() => setShowVarPicker(true)}
                className="flex items-center gap-1 text-[11px] font-bold text-blue-650 hover:text-blue-800 bg-blue-50 hover:bg-blue-100/60 border border-blue-200 px-2.5 py-1.5 rounded-xl cursor-pointer"
                title="Quản lý biến / Chèn biến"
              >
                <Tag className="w-3.5 h-3.5" />
                Biến
              </button>
            </div>

            {/* Scrollable design layout */}
            <div className="relative flex flex-1 flex-col overflow-y-auto bg-[#f5f6f8]">
              <EmailCanvas
                ref={canvasRef}
                blocks={activeTemplate.blocks}
                selectedBlockId={selectedBlockId}
                onSelectBlock={id => { if (selectionFormat?.blockId !== id) setSelectionFormat(null); setSelectedBlockId(id); }}
                onSelectionFormatChange={setSelectionFormat}
                onMoveBlock={handleMoveBlock}
                onDuplicateBlock={handleDuplicateBlock}
                onDeleteBlock={handleDeleteBlock}
                onToggleVisibility={handleToggleVisibility}
                onUpdateBlockContent={handleUpdateBlockContent}
                onOpenVariablePicker={() => setShowVarPicker(true)}
                insertedVarName={insertedVar}
                onClearInsertedVar={() => setInsertedVar(null)}
                emailSettings={activeTemplate.settings}
                onAddBlock={handleAddBlock}
                onDropBlock={handleDropBlock}
                onInsertBlock={handleInsertBlock}
                onUpdateBlock={handleUpdateWholeBlock}
              />
            </div>
          </div>

          {/* Right Parameters Settings Sidebar */}
          <div onPointerDown={(e) => resizePanel('right', e)} className="hidden lg:block w-1.5 shrink-0 cursor-col-resize bg-transparent hover:bg-blue-400/50 active:bg-blue-500" aria-label="Kéo để đổi độ rộng bảng cài đặt" />
           <div style={{ width: rightPanelWidth, maxWidth: '25vw', minWidth: 56 }} className={`flex shrink-0 flex-col border-l border-slate-200/80 bg-white ${mobileActiveTab === 'settings' ? 'absolute inset-0 z-40 block lg:relative lg:inset-auto lg:z-auto' : 'hidden lg:flex'}`}>
            <div className="border-b border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Properties</p>
                  <h3 className="mt-1 truncate text-sm font-black text-slate-900">
                    {activeBlock ? getBlockLabel(activeBlock.type) : 'Cài đặt email'}
                  </h3>
                  <p className="mt-1 text-[10px] font-semibold text-slate-500">
                    {activeBlock ? 'Chỉnh nội dung và style của khối đang chọn.' : 'Chọn một khối trên canvas hoặc chỉnh giao diện toàn email.'}
                  </p>
                </div>
                <span className="shrink-0 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[9px] font-black uppercase tracking-wide text-slate-500">
                  {activeBlock ? 'Block' : 'Email'}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1">
                <button
                  onClick={() => setActiveRightTab('block')}
                  disabled={!selectedBlockId}
                  className={`flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md text-xs font-bold transition-all disabled:cursor-not-allowed disabled:opacity-40 ${
                    activeRightTab === 'block'
                      ? 'border border-slate-200/70 bg-white text-blue-650 shadow-sm'
                      : 'text-slate-500 hover:bg-white/50'
                  }`}
                >
                  Khối
                </button>
                <button
                  onClick={() => setActiveRightTab('email')}
                  className={`flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md text-xs font-bold transition-all ${
                    activeRightTab === 'email'
                      ? 'border border-slate-200/70 bg-white text-blue-650 shadow-sm'
                      : 'text-slate-500 hover:bg-white/50'
                  }`}
                >
                  Email
                </button>
              </div>
            </div>

            {/* Sidebar content render */}
            <div className="flex-1 min-h-0 overflow-y-auto">
              {activeRightTab === 'block' && activeBlock ? (
                <BlockSettings
                  block={activeBlock}
                  variables={variables}
                  onUpdateBlockContent={(content) => selectedBlockId && handleUpdateBlockContent(selectedBlockId, content)}
                  onUpdateBlockStyles={(styles) => selectedBlockId && handleUpdateBlockStyles(selectedBlockId, styles)}
                  onUpdateBlock={(nextBlock) => selectedBlockId && handleUpdateWholeBlock(selectedBlockId, nextBlock)}
                  onSplitCustomHtml={() => selectedBlockId && void handleSplitCustomHtml(selectedBlockId)}
                  onApplySelectionFontSize={(size) => selectedBlockId ? canvasRef.current?.applySelectionFontSize(selectedBlockId, size) || false : false}
                  hasTextSelection={selectionFormat?.blockId === selectedBlockId && selectionFormat.hasSelection}
                  selectionFontSize={selectionFormat?.blockId === selectedBlockId && selectionFormat.hasSelection ? selectionFormat.fontSize : undefined}
                  selectionTextColor={selectionFormat?.blockId === selectedBlockId && selectionFormat.hasSelection ? selectionFormat.textColor : undefined}
                  selectionEditorKey={selectionFormat?.blockId === selectedBlockId && selectionFormat.hasSelection ? selectionFormat.editorKey : undefined}
                  onApplySelectionTextColor={(color) => selectedBlockId ? canvasRef.current?.applySelectionTextColor(selectedBlockId, color) || false : false}
                  onUpdateBlockColumns={(columns) => {
                    if (!selectedBlockId || !activeTemplate) return;
                    handleUpdateTemplateBlocks(updateEmailBlock(activeTemplate.blocks, selectedBlockId, block => ({ ...block, columns })));
                  }}
                />
              ) : (
                <EmailSettingsComponent
                  settings={activeTemplate.settings}
                  onUpdateSettings={handleUpdateTemplateSettings}
                />
              )}
            </div>
            <div className="border-t border-slate-100 bg-slate-50 px-4 py-3">
              <p className="text-[10px] font-semibold leading-relaxed text-slate-500">
                Copy nội dung sẽ nhúng ảnh local/upload vào HTML clipboard để dán vào Gmail ổn định hơn.
              </p>
            </div>

          </div>

        </div>

      </div>

      {/* MODALS */}
      {showPreview && (
        <EmailPreview
          template={activeTemplate}
          variables={variables}
          onClose={() => setShowPreview(false)}
        />
      )}
      {showHtmlImport && <EmailHtmlImportDialog context="edit" activeTemplateName={activeTemplate.name} onClose={() => setShowHtmlImport(false)} onCreateBlank={handleCreateBlankTemplate} onImport={handleImportPastedHtml} onApplyToCurrent={handleApplyPastedHtmlToCurrentTemplate} />}
      {showHtmlSource && <EmailHtmlSourceDialog templateName={activeTemplate.name} initialHtml={htmlSource} onClose={() => setShowHtmlSource(false)} onApply={handleApplyHtmlSourceToCurrentTemplate} />}

      {showVarPicker && (
        <VariablePicker
          variables={variables}
          onClose={() => setShowVarPicker(false)}
          onAddVariable={handleAddVariable}
          onEditVariable={handleEditVariable}
          onDeleteVariable={handleDeleteVariable}
          onInsertVariable={handleInsertVariable}
        />
      )}

    </div>
  );
}
