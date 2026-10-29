import React, { useRef, useCallback, useState } from 'react';
import { Download, Eye, Check } from 'lucide-react';
import { SurveySummary } from './newsPostTypes';

interface SurveyReportImageProps {
  unitName: string;
  sessionTitle?: string;
  sessionDate?: string;
  surveySummary: SurveySummary;
}

export default function SurveyReportImage({
  unitName,
  sessionTitle = 'Ứng dụng Bộ nhớ dùng chung và Gemini AI trong công tác',
  sessionDate = 'Khảo sát sau tập huấn',
  surveySummary,
}: SurveyReportImageProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloaded, setDownloaded] = useState(false);

  // Chuẩn bị số liệu
  const totalResponses = surveySummary.total_responses || 0;
  const totalRatings = surveySummary.total_ratings || 0;
  const overallSatisfaction = surveySummary.overall_satisfaction_percent || 0;
  const overallSatisfactionStr = overallSatisfaction.toFixed(2).replace('.', ',');

  // Trích xuất danh sách dòng tiêu chí để hiển thị trong bảng
  interface TableRowItem {
    stt: number;
    name: string;
    score: number;
    scoreStr: string;
    isHighest?: boolean;
    isLowest?: boolean;
  }

  const rawCategories = surveySummary.categories || [];
  let tableRows: TableRowItem[] = [];

  if (rawCategories.length > 0) {
    tableRows = rawCategories.map((cat, idx) => ({
      stt: idx + 1,
      name: cat.name,
      score: cat.satisfaction_score || 0,
      scoreStr: (cat.satisfaction_score || 0).toFixed(2).replace('.', ','),
    }));
  } else {
    // Mặc định dự phòng nếu chưa có chi tiết danh mục
    tableRows = [
      { stt: 1, name: 'Trình độ, kiến thức chuyên môn của giảng viên', score: 93.68, scoreStr: '93,68' },
      { stt: 2, name: 'Khả năng truyền đạt, phong thái sư phạm', score: 91.11, scoreStr: '91,11' },
      { stt: 3, name: 'Tính thực tiễn của ví dụ và hướng dẫn', score: 91.58, scoreStr: '91,58' },
      { stt: 4, name: 'Sự nhiệt tình, sẵn sàng giải đáp thắc mắc', score: 93.68, scoreStr: '93,68' },
      { stt: 5, name: 'Khả năng quản lý, kiểm soát thời gian', score: 91.11, scoreStr: '91,11' },
      { stt: 6, name: 'Bộ nhớ dùng chung – Lưu trữ tài liệu', score: 88.42, scoreStr: '88,42' },
      { stt: 7, name: 'Bộ nhớ dùng chung – Khai thác dữ liệu', score: 88.42, scoreStr: '88,42' },
      { stt: 8, name: 'Gemini AI – Sử dụng trợ lý Gem', score: 89.47, scoreStr: '89,47' },
      { stt: 9, name: 'Gemini AI – Soạn thảo, tóm tắt văn bản', score: 89.47, scoreStr: '89,47' },
      { stt: 10, name: 'Gemini AI – Tạo hình ảnh, slide', score: 89.47, scoreStr: '89,47' },
    ];
  }

  // Xác định dòng cao nhất và thấp nhất
  if (tableRows.length > 0) {
    const maxScore = Math.max(...tableRows.map(r => r.score));
    const minScore = Math.min(...tableRows.map(r => r.score));
    tableRows = tableRows.map(r => ({
      ...r,
      isHighest: r.score === maxScore && maxScore > minScore,
      isLowest: r.score === minScore && maxScore > minScore,
    }));
  }

  // Tên nội dung cao nhất & thấp nhất
  const topCriterion = surveySummary.top_rated_criterion || (tableRows.find(r => r.isHighest)?.name) || 'Kiến thức chuyên môn & sự nhiệt tình giải đáp của giảng viên';
  const notableCriterion = surveySummary.notable_criterion || (tableRows.find(r => r.isLowest)?.name) || 'Bộ nhớ dùng chung (lưu trữ & khai thác dữ liệu)';
  const lowestScoreStr = (tableRows.find(r => r.isLowest)?.scoreStr) || '88,42';

  // Xuất tải file PNG
  const handleDownloadPng = useCallback(() => {
    if (!svgRef.current) return;
    setDownloading(true);

    try {
      const svgElement = svgRef.current;
      const svgString = new XMLSerializer().serializeToString(svgElement);
      const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      const blobURL = URL.createObjectURL(svgBlob);

      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 1600;
        canvas.height = 900;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(image, 0, 0);
          const pngUrl = canvas.toDataURL('image/png');
          const cleanUnit = (unitName || 'don-vi').toLowerCase().replace(/[^a-z0-9]+/g, '-');
          const downloadLink = document.createElement('a');
          downloadLink.href = pngUrl;
          downloadLink.download = `Phieu-bao-cao-danh-gia-${cleanUnit}.png`;
          document.body.appendChild(downloadLink);
          downloadLink.click();
          document.body.removeChild(downloadLink);
          setDownloaded(true);
          setTimeout(() => setDownloaded(false), 3000);
        }
        URL.revokeObjectURL(blobURL);
        setDownloading(false);
      };
      image.onerror = () => {
        setDownloading(false);
      };
      image.src = blobURL;
    } catch {
      setDownloading(false);
    }
  }, [unitName]);

  const displayUnit = unitName ? unitName.toUpperCase() : 'XÃ HÒA PHÚ';

  return (
    <div className="flex flex-col gap-3">
      {/* Thanh tác vụ trên ảnh preview */}
      <div className="flex items-center justify-between gap-2 border-b border-[var(--ft-border)] pb-2.5">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-bold text-[var(--ft-text-main)]">
            Ảnh báo cáo khảo sát (1600×900)
          </span>
          <span className="rounded-md bg-blue-100 dark:bg-blue-950/60 px-2 py-0.5 text-[11px] font-bold text-[#0B72CE] dark:text-[#60A5FA]">
            Chuẩn mẫu FermatTech
          </span>
        </div>

        <button
          type="button"
          onClick={handleDownloadPng}
          disabled={downloading}
          className="inline-flex items-center gap-1.5 rounded-xl bg-[#0B72CE] hover:bg-[#075CA8] text-white px-4 py-2 text-xs font-semibold shadow-xs transition cursor-pointer min-h-[44px]"
        >
          {downloaded ? (
            <>
              <Check className="h-4 w-4" />
              <span>Đã tải PNG</span>
            </>
          ) : (
            <>
              <Download className="h-4 w-4" />
              <span>{downloading ? 'Đang tạo ảnh...' : 'Tải ảnh PNG'}</span>
            </>
          )}
        </button>
      </div>

      {/* Khung xem trước SVG Responsive */}
      <div className="relative w-full overflow-hidden rounded-2xl border border-[var(--ft-border)] bg-[#F3F6FA] shadow-md aspect-video">
        <svg
          ref={svgRef}
          viewBox="0 0 1600 900"
          className="w-full h-full block select-none"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Nền toàn ảnh #F3F6FA */}
          <rect width="1600" height="900" fill="#F3F6FA" />

          {/* ══════════════════════════════════════════════════════════
              1. HEADER TIÊU ĐỀ
              ══════════════════════════════════════════════════════════ */}
          <text
            x="800"
            y="65"
            textAnchor="middle"
            fontFamily="Be Vietnam Pro, system-ui, -apple-system, sans-serif"
            fontSize="34"
            fontWeight="900"
            fill="#0B3A78"
            letterSpacing="0.5"
          >
            ĐÁNH GIÁ KẾT QUẢ SAU BUỔI TẬP HUẤN
          </text>

          <text
            x="800"
            y="104"
            textAnchor="middle"
            fontFamily="Be Vietnam Pro, system-ui, -apple-system, sans-serif"
            fontSize="24"
            fontWeight="800"
            fill="#0B72CE"
            letterSpacing="0.5"
          >
            {displayUnit}
          </text>

          <text
            x="800"
            y="134"
            textAnchor="middle"
            fontFamily="Be Vietnam Pro, system-ui, -apple-system, sans-serif"
            fontSize="15"
            fontStyle="italic"
            fontWeight="500"
            fill="#475569"
          >
            {`${sessionTitle} · Khảo sát ${sessionDate}`}
          </text>

          {/* ══════════════════════════════════════════════════════════
              2. HÀNG 4 THẺ THỐNG KÊ (4 STAT CARDS)
              ══════════════════════════════════════════════════════════ */}

          {/* Card 1: Tổng số đánh giá */}
          <g transform="translate(40, 160)">
            <rect width="350" height="115" rx="14" fill="#0B5C9E" />
            {/* Icon ClipboardCheck SVG */}
            <g transform="translate(24, 25)">
              <rect width="64" height="64" rx="14" fill="#FFFFFF" fillOpacity="0.18" />
              <path
                d="M48 20H42C40.9 16.5 37.7 14 34 14C30.3 14 27.1 16.5 26 20H20C17.8 20 16 21.8 16 24V50C16 52.2 17.8 54 20 54H48C50.2 54 52 52.2 52 50V24C52 21.8 50.2 20 48 20ZM34 18C35.1 18 36 18.9 36 20C36 21.1 35.1 22 34 22C32.9 22 32 21.1 32 20C32 18.9 32.9 18 34 18ZM28 38L24 34L26.8 31.2L28 32.4L37.2 23.2L40 26L28 38ZM28 48L24 44L26.8 41.2L28 42.4L37.2 33.2L40 36L28 48Z"
                fill="#FFFFFF"
              />
            </g>
            <text x="105" y="44" fontFamily="Be Vietnam Pro, system-ui, sans-serif" fontSize="15" fontWeight="800" fill="#FFFFFF" letterSpacing="0.4">
              TỔNG SỐ ĐÁNH GIÁ
            </text>
            <text x="105" y="96" fontFamily="Be Vietnam Pro, system-ui, sans-serif" fontSize="48" fontWeight="900" fill="#FFFFFF">
              {totalResponses || 188}
            </text>
          </g>

          {/* Card 2: Mức hài lòng bình quân */}
          <g transform="translate(415, 160)">
            <rect width="350" height="115" rx="14" fill="#006C75" />
            {/* Icon TrendingUp SVG */}
            <g transform="translate(24, 25)">
              <rect width="64" height="64" rx="14" fill="#FFFFFF" fillOpacity="0.18" />
              <path
                d="M20 44L32 32L40 40L52 24M52 24H42M52 24V34"
                stroke="#FFFFFF"
                strokeWidth="4"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </g>
            <text x="105" y="38" fontFamily="Be Vietnam Pro, system-ui, sans-serif" fontSize="14" fontWeight="800" fill="#FFFFFF" letterSpacing="0.4">
              MỨC HÀI LÒNG BÌNH QUÂN
            </text>
            <text x="105" y="96" fontFamily="Be Vietnam Pro, system-ui, sans-serif" fontSize="46" fontWeight="900" fill="#FFFFFF">
              {overallSatisfactionStr ? `${overallSatisfactionStr}%` : '90,64%'}
            </text>
          </g>

          {/* Card 3: Nội dung được đánh giá cao nhất */}
          <g transform="translate(790, 160)">
            <rect width="385" height="115" rx="14" fill="#FFFFFF" stroke="#22863A" strokeWidth="2" />
            <path d="M 0 14 C 0 6.27 6.27 0 14 0 L 371 0 C 378.73 0 385 6.27 385 14 L 385 34 L 0 34 Z" fill="#22863A" />
            <text x="192" y="23" textAnchor="middle" fontFamily="Be Vietnam Pro, system-ui, sans-serif" fontSize="13" fontWeight="800" fill="#FFFFFF" letterSpacing="0.4">
              NỘI DUNG ĐƯỢC ĐÁNH GIÁ CAO NHẤT
            </text>
            {/* Icon Trophy SVG */}
            <g transform="translate(18, 50)">
              <path
                d="M12 6H28V16C28 20.4 24.4 24 20 24C15.6 24 12 20.4 12 16V6ZM12 10H6C4.9 10 4 10.9 4 12V14C4 16.2 5.8 18 8 18H12.5M28 10H34C35.1 10 36 10.9 36 12V14C36 16.2 34.2 18 32 18H27.5M20 24V30M14 30H26"
                stroke="#22863A"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </g>
            <text x="64" y="68" fontFamily="Be Vietnam Pro, system-ui, sans-serif" fontSize="14" fontWeight="800" fill="#0F1F33">
              {topCriterion.length > 35 ? topCriterion.slice(0, 35) + '...' : topCriterion}
            </text>
            <text x="64" y="90" fontFamily="Be Vietnam Pro, system-ui, sans-serif" fontSize="12" fontWeight="600" fill="#22863A">
              Điểm đánh giá dẫn đầu
            </text>
          </g>

          {/* Card 4: Chỉ số cần lưu ý */}
          <g transform="translate(1200, 160)">
            <rect width="360" height="115" rx="14" fill="#FFFFFF" stroke="#D9531E" strokeWidth="2" />
            <path d="M 0 14 C 0 6.27 6.27 0 14 0 L 346 0 C 353.73 0 360 6.27 360 14 L 360 34 L 0 34 Z" fill="#D9531E" />
            <text x="180" y="23" textAnchor="middle" fontFamily="Be Vietnam Pro, system-ui, sans-serif" fontSize="13" fontWeight="800" fill="#FFFFFF" letterSpacing="0.4">
              CHỈ SỐ CẦN LƯU Ý
            </text>
            {/* Icon AlertTriangle SVG */}
            <g transform="translate(18, 50)">
              <path
                d="M20 6L36 32H4L20 6ZM20 16V22M20 26V28"
                stroke="#D9531E"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </g>
            <text x="64" y="68" fontFamily="Be Vietnam Pro, system-ui, sans-serif" fontSize="14" fontWeight="800" fill="#0F1F33">
              {notableCriterion.length > 33 ? notableCriterion.slice(0, 33) + '...' : notableCriterion}
            </text>
            <text x="64" y="90" fontFamily="Be Vietnam Pro, system-ui, sans-serif" fontSize="12" fontWeight="600" fill="#D9531E">
              Ưu tiên hỗ trợ thực hành thêm
            </text>
          </g>

          {/* ══════════════════════════════════════════════════════════
              3. CỘT TRÁI: BẢNG STT / NỘI DUNG / MỨC HÀI LÒNG (%)
              ══════════════════════════════════════════════════════════ */}
          <g transform="translate(40, 295)">
            {/* Header bảng */}
            <path d="M 0 10 C 0 4.48 4.48 0 10 0 L 750 0 C 755.52 0 760 4.48 760 10 L 760 42 L 0 42 Z" fill="#0B3A78" />
            <text x="35" y="27" textAnchor="middle" fontFamily="Be Vietnam Pro, system-ui, sans-serif" fontSize="13" fontWeight="800" fill="#FFFFFF">
              STT
            </text>
            <text x="80" y="27" fontFamily="Be Vietnam Pro, system-ui, sans-serif" fontSize="13" fontWeight="800" fill="#FFFFFF">
              NỘI DUNG ĐÁNH GIÁ
            </text>
            <text x="735" y="27" textAnchor="end" fontFamily="Be Vietnam Pro, system-ui, sans-serif" fontSize="13" fontWeight="800" fill="#FFFFFF">
              MỨC HÀI LÒNG (%)
            </text>

            {/* Các dòng bảng */}
            {tableRows.slice(0, 10).map((row, idx) => {
              const yOffset = 42 + idx * 37;
              const isEven = idx % 2 === 0;

              let rowBg = isEven ? '#FFFFFF' : '#FAFAFC';
              let textColor = '#0F1F33';
              let scoreColor = '#0F1F33';
              let weight = '500';

              if (row.isHighest) {
                rowBg = '#E6F4EA'; // Dòng cao nhất: Xanh lá nhạt
                textColor = '#137333';
                scoreColor = '#137333';
                weight = '700';
              } else if (row.isLowest) {
                rowBg = '#FFEDD5'; // Dòng thấp nhất: Cam nhạt
                textColor = '#C2410C';
                scoreColor = '#C2410C';
                weight = '700';
              }

              return (
                <g key={row.stt} transform={`translate(0, ${yOffset})`}>
                  <rect width="760" height="37" fill={rowBg} stroke="#E2E8F0" strokeWidth="0.5" />
                  <text x="35" y="23" textAnchor="middle" fontFamily="Be Vietnam Pro, system-ui, sans-serif" fontSize="13" fontWeight={weight} fill={textColor}>
                    {row.stt}
                  </text>
                  <text x="80" y="23" fontFamily="Be Vietnam Pro, system-ui, sans-serif" fontSize="13.5" fontWeight={weight} fill={textColor}>
                    {row.name.length > 52 ? row.name.slice(0, 52) + '...' : row.name}
                  </text>
                  <text x="735" y="23" textAnchor="end" fontFamily="Be Vietnam Pro, system-ui, sans-serif" fontSize="14" fontWeight="800" fill={scoreColor}>
                    {row.scoreStr}
                  </text>
                </g>
              );
            })}

            {/* Dòng BÌNH QUÂN */}
            <g transform="translate(0, 412)">
              <rect width="760" height="40" rx="4" fill="#E8F0FE" stroke="#B8D5FA" strokeWidth="1" />
              <text x="80" y="25" fontFamily="Be Vietnam Pro, system-ui, sans-serif" fontSize="14" fontWeight="900" fill="#0B3A78">
                {`BÌNH QUÂN (${totalRatings || 188} lượt chấm)`}
              </text>
              <text x="735" y="25" textAnchor="end" fontFamily="Be Vietnam Pro, system-ui, sans-serif" fontSize="15" fontWeight="900" fill="#0B3A78">
                {overallSatisfactionStr || '90,64'}
              </text>
            </g>
          </g>

          {/* ══════════════════════════════════════════════════════════
              4. CỘT PHẢI: 3 TRỌNG TÂM & NHẬN ĐỊNH NHANH
              ══════════════════════════════════════════════════════════ */}
          <g transform="translate(825, 295)">
            {/* Header: 3 TRỌNG TÂM TRIỂN KHAI SAU TẬP HUẤN */}
            <rect width="735" height="38" rx="8" fill="#0B3A78" />
            <text x="367" y="24" textAnchor="middle" fontFamily="Be Vietnam Pro, system-ui, sans-serif" fontSize="14" fontWeight="800" fill="#FFFFFF" letterSpacing="0.4">
              3 TRỌNG TÂM TRIỂN KHAI SAU TẬP HUẤN
            </text>

            {/* 3 Thẻ Trọng tâm xếp ngang */}
            {/* Thẻ 1: Thực hành sâu Gemini AI */}
            <g transform="translate(0, 50)">
              <rect width="235" height="165" rx="12" fill="#E6F4EA" stroke="#A7F3D0" strokeWidth="1.5" />
              <g transform="translate(16, 16)">
                {/* Icon Sparkles SVG */}
                <path d="M12 2L14.5 9.5L22 12L14.5 14.5L12 22L9.5 14.5L2 12L9.5 9.5L12 2Z" fill="#137333" />
              </g>
              <text x="46" y="26" fontFamily="Be Vietnam Pro, system-ui, sans-serif" fontSize="13" fontWeight="800" fill="#137333">
                THỰC HÀNH SÂU
              </text>
              <text x="46" y="42" fontFamily="Be Vietnam Pro, system-ui, sans-serif" fontSize="13" fontWeight="800" fill="#137333">
                GEMINI AI
              </text>
              <text x="16" y="72" fontFamily="Be Vietnam Pro, system-ui, sans-serif" fontSize="12" fill="#1F2937">
                <tspan x="16" dy="0">Hướng dẫn cách đặt câu</tspan>
                <tspan x="16" dy="18">lệnh để soạn thảo hiệu</tspan>
                <tspan x="16" dy="18">quả, lập bản thuyết trình,</tspan>
                <tspan x="16" dy="18">khai thác tính năng nổi</tspan>
                <tspan x="16" dy="18">trội.</tspan>
              </text>
            </g>

            {/* Thẻ 2: Khai thác bộ nhớ dùng chung */}
            <g transform="translate(250, 50)">
              <rect width="235" height="165" rx="12" fill="#FFEDD5" stroke="#FED7AA" strokeWidth="1.5" />
              <g transform="translate(16, 16)">
                {/* Icon Database SVG */}
                <ellipse cx="12" cy="6" rx="9" ry="3" fill="#C2410C" />
                <path d="M3 6V12C3 13.6 7 15 12 15C17 15 21 13.6 21 12V6" stroke="#C2410C" strokeWidth="2" fill="none" />
                <path d="M3 12V18C3 19.6 7 21 12 21C17 21 21 19.6 21 18V12" stroke="#C2410C" strokeWidth="2" fill="none" />
              </g>
              <text x="46" y="26" fontFamily="Be Vietnam Pro, system-ui, sans-serif" fontSize="13" fontWeight="800" fill="#C2410C">
                KHAI THÁC BỘ NHỚ
              </text>
              <text x="46" y="42" fontFamily="Be Vietnam Pro, system-ui, sans-serif" fontSize="13" fontWeight="800" fill="#C2410C">
                DÙNG CHUNG
              </text>
              <text x="16" y="72" fontFamily="Be Vietnam Pro, system-ui, sans-serif" fontSize="12" fill="#1F2937">
                <tspan x="16" dy="0">Tăng thời lượng thực hành</tspan>
                <tspan x="16" dy="18">lưu trữ và khai thác dữ liệu</tspan>
                <tspan x="16" dy="18">dùng chung – nội dung có</tspan>
                <tspan x="16" dy="18">mức hài lòng thấp nhất</tspan>
                <tspan x="16" dy="18">{`(${lowestScoreStr}%).`}</tspan>
              </text>
            </g>

            {/* Thẻ 3: Hỗ trợ theo vị trí việc làm */}
            <g transform="translate(500, 50)">
              <rect width="235" height="165" rx="12" fill="#E0F2FE" stroke="#BAE6FD" strokeWidth="1.5" />
              <g transform="translate(16, 16)">
                {/* Icon Users SVG */}
                <path
                  d="M16 19C16 16.8 12.4 15 8 15C3.6 15 0 16.8 0 19M8 11C10.2 11 12 9.2 12 7C12 4.8 10.2 3 8 3C5.8 3 4 4.8 4 7C4 9.2 5.8 11 8 11Z"
                  stroke="#0369A1"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              </g>
              <text x="46" y="26" fontFamily="Be Vietnam Pro, system-ui, sans-serif" fontSize="13" fontWeight="800" fill="#0369A1">
                HỖ TRỢ THEO VỊ
              </text>
              <text x="46" y="42" fontFamily="Be Vietnam Pro, system-ui, sans-serif" fontSize="13" fontWeight="800" fill="#0369A1">
                TRÍ VIỆC LÀM
              </text>
              <text x="16" y="72" fontFamily="Be Vietnam Pro, system-ui, sans-serif" fontSize="12" fill="#1F2937">
                <tspan x="16" dy="0">Xây dựng nguồn tài liệu</tspan>
                <tspan x="16" dy="18">cho Gem theo từng vị trí;</tspan>
                <tspan x="16" dy="18">duy trì kênh hỗ trợ từ xa</tspan>
                <tspan x="16" dy="18">khi cán bộ cần.</tspan>
              </text>
            </g>

            {/* Khối: NHẬN ĐỊNH NHANH */}
            <g transform="translate(0, 230)">
              <rect width="735" height="142" rx="12" fill="#FFFFFF" stroke="#CBD5E1" strokeWidth="1" />
              {/* Icon Lightbulb SVG */}
              <g transform="translate(24, 28)">
                <path
                  d="M18 2C10.3 2 4 8.3 4 16C4 20.8 6.4 24.9 10 27.4V32C10 33.1 10.9 34 12 34H24C25.1 34 26 33.1 26 32V27.4C29.6 24.9 32 20.8 32 16C32 8.3 25.7 2 18 2ZM14 38H22"
                  stroke="#0B3A78"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              </g>

              {/* Badge NHẬN ĐỊNH NHANH */}
              <rect x="74" y="20" width="180" height="28" rx="6" fill="#0B3A78" />
              <text x="164" y="39" textAnchor="middle" fontFamily="Be Vietnam Pro, system-ui, sans-serif" fontSize="12.5" fontWeight="800" fill="#FFFFFF" letterSpacing="0.4">
                NHẬN ĐỊNH NHANH
              </text>

              {/* Đoạn văn nhận định */}
              <text x="74" y="72" fontFamily="Be Vietnam Pro, system-ui, sans-serif" fontSize="13.5" fill="#1E293B" fontWeight="500">
                <tspan x="74" dy="0">
                  {`100% lượt chấm đạt Tốt trở lên; mức hài lòng bình quân ${overallSatisfactionStr}% (quy đổi Rất`}
                </tspan>
                <tspan x="74" dy="21">
                  tốt = 100%, Tốt = 80%); giảng viên được đánh giá cao về chuyên môn và sự
                </tspan>
                <tspan x="74" dy="21">
                  nhiệt tình. Các nội dung ứng dụng chủ yếu ở mức Tốt. Học viên mong muốn
                </tspan>
                <tspan x="74" dy="21">
                  được hướng dẫn, thực hành sâu hơn ở các buổi tiếp theo.
                </tspan>
              </text>
            </g>
          </g>

          {/* ══════════════════════════════════════════════════════════
              5. DẢI KẾT LUẬN DƯỚI CÙNG (BOTTOM BANNER)
              ══════════════════════════════════════════════════════════ */}
          <g transform="translate(40, 788)">
            <rect width="1520" height="78" rx="16" fill="#0B3A78" />
            {/* Icon Target SVG */}
            <g transform="translate(32, 22)">
              <circle cx="17" cy="17" r="15" stroke="#FFFFFF" strokeWidth="2.5" fill="none" />
              <circle cx="17" cy="17" r="9" stroke="#FFFFFF" strokeWidth="2.5" fill="none" />
              <circle cx="17" cy="17" r="3" fill="#FFFFFF" />
            </g>

            {/* Dòng chữ vàng nổi bật */}
            <text
              x="760"
              y="46"
              textAnchor="middle"
              fontFamily="Be Vietnam Pro, system-ui, sans-serif"
              fontSize="19"
              fontWeight="800"
              fill="#FDE047"
              letterSpacing="0.2"
            >
              {`Trọng tâm sau tập huấn tại ${unitName || 'đơn vị'}: tăng thời lượng thực hành Gemini AI, khai thác hiệu quả Bộ nhớ dùng chung và hỗ trợ cán bộ theo vị trí việc làm.`}
            </text>

            {/* Icon TrendingUp SVG ở bên phải */}
            <g transform="translate(1450, 22)">
              <path
                d="M4 26L14 16L22 24L32 10M32 10H24M32 10V18"
                stroke="#FFFFFF"
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </g>
          </g>
        </svg>
      </div>
    </div>
  );
}
