import { EmailSettings } from '../../types/emailBuilder';
import ColorField from './ColorField';

interface EmailSettingsComponentProps {
  settings: EmailSettings;
  onUpdateSettings: (settings: EmailSettings) => void;
}

export default function EmailSettingsComponent({
  settings,
  onUpdateSettings
}: EmailSettingsComponentProps) {

  const updateSetting = (key: keyof EmailSettings, value: any) => {
    onUpdateSettings({
      ...settings,
      [key]: value
    });
  };

  const fonts = [
    { value: 'Roboto, "Helvetica Neue", Arial, sans-serif', label: 'Roboto' },
    { value: 'Arial, Helvetica, sans-serif', label: 'Arial' },
    { value: 'Verdana, Geneva, sans-serif', label: 'Verdana' },
    { value: 'Tahoma, Arial, sans-serif', label: 'Tahoma' },
    { value: '"Trebuchet MS", Arial, sans-serif', label: 'Trebuchet MS' },
    { value: 'Georgia, "Times New Roman", serif', label: 'Georgia' },
    { value: '"Times New Roman", Times, serif', label: 'Times New Roman' },
    { value: '"Courier New", Courier, monospace', label: 'Courier New' }
  ];

  return (
    <div className="space-y-5 p-5 bg-white overflow-y-auto h-full select-text">
      <div>
        <h3 className="text-xs font-black text-slate-800 uppercase tracking-widest">Email chung</h3>
        <p className="text-[10px] text-slate-450 mt-1">Cấu hình thông số kích thước, font chữ chủ đạo và bảng màu cho khung email.</p>
      </div>

      <div className="space-y-4">
        {/* Layout Dimensions */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">Chiều rộng tối đa (px)</label>
            <input
              type="number"
              min="300"
              max="1200"
              value={settings.maxWidth || 650}
              onChange={e => updateSetting('maxWidth', parseInt(e.target.value) || 650)}
              className="w-full text-xs rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-blue-500 shadow-sm"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">Bo góc viền khung (px)</label>
            <input
              type="number"
              min="0"
              max="50"
              value={settings.borderRadius ?? 16}
              onChange={e => updateSetting('borderRadius', parseInt(e.target.value) || 0)}
              className="w-full text-xs rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-blue-500 shadow-sm"
            />
          </div>
        </div>

        {/* Spacings & Typography */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">Mép đệm dọc (px)</label>
            <input
              type="number"
              min="0"
              max="100"
              value={settings.contentPadding ?? 24}
              onChange={e => updateSetting('contentPadding', parseInt(e.target.value) || 0)}
              className="w-full text-xs rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-blue-500 shadow-sm"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">Font chữ chủ đạo</label>
            <select
              value={settings.fontFamily || 'Arial, Helvetica, sans-serif'}
              onChange={e => updateSetting('fontFamily', e.target.value)}
              className="w-full text-xs rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-blue-500 bg-white shadow-sm"
            >
              {fonts.map(f => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Brand System Colors */}
        <div className="border-t border-slate-100 pt-4 space-y-4">
          <h4 className="text-[10px] font-black text-slate-700 uppercase tracking-wider">Hệ màu khung nền</h4>
          
          <ColorField
            label="Màu nền nội dung (Content Background)"
            value={settings.contentBg || '#ffffff'}
            onChange={color => updateSetting('contentBg', color)}
          />
        </div>

        {/* Fonts & Links colors */}
        <div className="border-t border-slate-100 pt-4 space-y-4">
          <h4 className="text-[10px] font-black text-slate-700 uppercase tracking-wider">Màu chữ & Liên kết</h4>

          <div className="grid grid-cols-2 gap-3">
            <ColorField
              label="Màu chữ chính"
              value={settings.textColor || '#1e293b'}
              onChange={color => updateSetting('textColor', color)}
            />
            <ColorField
              label="Màu liên kết (Link)"
              value={settings.linkColor || '#1473d1'}
              onChange={color => updateSetting('linkColor', color)}
            />
          </div>
        </div>

        {/* Button defaults */}
        <div className="border-t border-slate-100 pt-4 space-y-4">
          <h4 className="text-[10px] font-black text-slate-700 uppercase tracking-wider">Màu nút bấm mặc định</h4>

          <div className="grid grid-cols-2 gap-3">
            <ColorField
              label="Nền nút mặc định"
              value={settings.btnDefaultBg || '#1473d1'}
              onChange={color => updateSetting('btnDefaultBg', color)}
            />
            <ColorField
              label="Chữ nút mặc định"
              value={settings.btnDefaultTextColor || '#ffffff'}
              onChange={color => updateSetting('btnDefaultTextColor', color)}
            />
          </div>
        </div>

      </div>
    </div>
  );
}
