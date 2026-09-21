import React from 'react';
import {
  ATTACHMENT_OPTIONS, DECISION_OPTIONS, FundingProposal,
  dateWords, dotted, lineAmount, money, shortDate, totalsOf,
} from './fundingProposal';

/** A4 rendering of the form: the same content the .docx carries, so what the
 *  user approves on screen is what Word prints. */
export default function FundingProposalPreview({ value }: { value: FundingProposal }) {
  const totals = totalsOf(value);
  const box = (checked: boolean, label: string) => (
    <span className="fp-box">{checked ? '☒' : '☐'} {label}</span>
  );
  const rows = value.items.length ? value.items : [];

  return (
    <article className="fp-page" aria-label="Xem trước phiếu đề xuất kinh phí">
      <table className="fp-letterhead">
        <tbody>
          <tr>
            <td><b>CÔNG TY CỔ PHẦN</b><br /><b>CÔNG NGHỆ FERMAT</b></td>
            <td><b>CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</b><br /><b>Độc lập - Tự do - Hạnh phúc</b></td>
          </tr>
          <tr>
            <td>Số: {value.documentNumber.trim() || '……/PĐXKP-FT'}</td>
            <td><i>{dateWords(value.issuedOn)}</i></td>
          </tr>
        </tbody>
      </table>

      <h1 className="fp-title">PHIẾU ĐỀ XUẤT KINH PHÍ</h1>
      <p className="fp-subtitle">Dùng cho đề xuất mới và điều chỉnh kinh phí</p>
      <p className="fp-line">Kính gửi: Tổng Giám đốc Công ty Cổ phần Công nghệ Fermat.</p>

      <h2 className="fp-section">1. Thông tin đề xuất</h2>
      <p className="fp-line">
        Loại đề xuất: {box(value.kind === 'new', 'Mới')} {box(value.kind === 'adjustment', 'Điều chỉnh, bổ sung')}
        {'  '}Lần trình: {dotted(value.submissionRound, 4)}
      </p>
      <p className="fp-line">Người đề xuất: {dotted(value.proposer, 18)}  Bộ phận: {dotted(value.department, 16)}</p>
      <p className="fp-line">Công việc/dự án: {dotted(value.project, 40)}</p>
      <p className="fp-line">Trưởng bộ phận: {dotted(value.departmentHead, 40)}</p>
      <p className="fp-line">Mục đích, kết quả cần đạt: {dotted(value.purpose, 34)}</p>
      <p className="fp-line">Hạn cần duyệt: {shortDate(value.approvalDeadline)}</p>

      <h2 className="fp-section">2. Dự toán và phương án thực hiện</h2>
      <p className="fp-note">Đơn vị tiền: đồng.</p>
      <table className="fp-table">
        <thead>
          <tr>
            <th style={{ width: '6%' }}>TT</th>
            <th style={{ width: '38%' }}>Nội dung, quy cách và cấu phần chi phí</th>
            <th style={{ width: '10%' }}>ĐVT</th>
            <th style={{ width: '10%' }}>Số lượng</th>
            <th style={{ width: '17%' }}>Đơn giá chưa thuế</th>
            <th style={{ width: '19%' }}>Thành tiền chưa thuế</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item, index) => (
            <tr key={item.id}>
              <td className="fp-center">{index + 1}</td>
              <td>{dotted(item.description, 24)}</td>
              <td className="fp-center">{dotted(item.unit, 4)}</td>
              <td className="fp-center">{dotted(item.quantity, 4)}</td>
              <td className="fp-right">{dotted(money(Number(item.unitPrice) || 0), 6)}</td>
              <td className="fp-right">{dotted(money(lineAmount(item)), 6)}</td>
            </tr>
          ))}
          <tr>
            <td colSpan={5} className="fp-right"><b>CỘNG</b></td>
            <td className="fp-right"><b>{dotted(money(totals.subtotal), 6)}</b></td>
          </tr>
          <tr>
            <td colSpan={5} className="fp-right">
              Thuế GTGT VAT ({value.vatRate.trim() ? `${value.vatRate}%` : ' …%'})
            </td>
            <td className="fp-right">{dotted(money(totals.vat), 6)}</td>
          </tr>
          <tr>
            <td colSpan={5} className="fp-right">CHI PHÍ KHÁC</td>
            <td className="fp-right">{dotted(money(totals.other), 6)}</td>
          </tr>
          <tr>
            <td colSpan={5} className="fp-right"><b>TỔNG CỘNG</b></td>
            <td className="fp-right"><b>{dotted(money(totals.total), 6)}</b></td>
          </tr>
        </tbody>
      </table>

      <p className="fp-line">Tổng kinh phí đề nghị (A + B + C): {dotted(money(totals.total), 20)} đồng.</p>
      <p className="fp-line">Thông tin nhà cung cấp: {dotted(value.supplier, 36)}</p>
      <p className="fp-line">
        Thanh toán: {box(value.paymentMethod === 'transfer', 'Chuyển khoản')} {box(value.paymentMethod === 'cash', 'Tiền mặt')};
      </p>
      <p className="fp-line">
        Tạm ứng (nếu có): {dotted(money(Number(value.advanceAmount) || 0), 14)} đồng tại phiếu số:{' '}
        {dotted(value.advanceDocument, 6)} {dateWords(value.advanceDate, 'ngày')}
      </p>

      <h2 className="fp-section">3. Đối chiếu điều chỉnh và hồ sơ kèm theo</h2>
      <p className="fp-note">Chỉ điền phần đối chiếu khi điều chỉnh; đề xuất mới ghi “Không áp dụng”.</p>
      <p className="fp-line">Căn cứ lần duyệt trước (số phiếu/email, ngày, người duyệt): {dotted(value.previousApproval, 16)}</p>
      <table className="fp-table">
        <thead>
          <tr>
            <th style={{ width: '31%' }}>Nội dung</th>
            <th style={{ width: '23%' }}>Đã duyệt trước</th>
            <th style={{ width: '23%' }}>Đề nghị lần này</th>
            <th style={{ width: '23%' }}>Tăng/giảm</th>
          </tr>
        </thead>
        <tbody>
          {([['quantity', 'Số lượng/đơn giá hạng mục thay đổi'], ['total', 'Tổng kinh phí cùng phạm vi và cơ sở thuế']] as const).map(([key, label]) => (
            <tr key={key}>
              <td>{label}</td>
              <td className="fp-center">{dotted(value.comparison[key].previous, 8)}</td>
              <td className="fp-center">{dotted(value.comparison[key].current, 8)}</td>
              <td className="fp-center">{dotted(value.comparison[key].delta, 8)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="fp-line">Lý do thay đổi; tác động đến tiến độ, ngân sách: {dotted(value.changeReason, 24)}</p>
      <p className="fp-line">
        Tổng sau điều chỉnh: {dotted(money(Number(value.adjustedTotal) || 0), 12)} đồng; đã chi/cam kết:{' '}
        {dotted(money(Number(value.committedAmount) || 0), 12)} đồng.
      </p>
      <p className="fp-line">
        Số tiền còn phải bố trí: {dotted(money(Number(value.remainingAmount) || 0), 12)} đồng; phần xin tăng:{' '}
        {dotted(money(Number(value.increaseAmount) || 0), 10)} đồng.
      </p>
      <p className="fp-line">
        Hồ sơ kèm theo: {ATTACHMENT_OPTIONS.slice(0, 2).map(option => (
          <React.Fragment key={option.value}>{box(value.attachments.includes(option.value), option.label)} </React.Fragment>
        ))}
      </p>
      <p className="fp-line">
        {ATTACHMENT_OPTIONS.slice(2).map(option => (
          <React.Fragment key={option.value}>{box(value.attachments.includes(option.value), option.label)} </React.Fragment>
        ))}
        {box(!!value.attachmentOther.trim(), `Tài liệu khác: ${dotted(value.attachmentOther, 10)}`)}
      </p>
      <p className="fp-line">Đường dẫn hồ sơ BNDC: {dotted(value.bndcLink, 30)}</p>

      <h2 className="fp-section">4. Xác nhận và ý kiến kiểm tra</h2>
      <p className="fp-line">
        Người lập chịu trách nhiệm về nhu cầu, số lượng, cấu phần chi phí và việc không đề xuất trùng khoản
        đã được duyệt hoặc thanh toán.
      </p>

      <h2 className="fp-section">5. Phê duyệt của người có thẩm quyền</h2>
      <p className="fp-line">
        {DECISION_OPTIONS.map(option => (
          <React.Fragment key={option.value}>{box(value.decision === option.value, option.label)} </React.Fragment>
        ))}
      </p>
      <p className="fp-line">Tổng mức được duyệt (gồm thuế, phí): {dotted(money(Number(value.approvedTotal) || 0), 20)} đồng.</p>
      <p className="fp-line">Điều kiện; người thực hiện; thời hạn: {dotted(value.conditions, 24)}</p>
      <p className="fp-note">Ký, ghi rõ họ tên, ngày ký; người phê duyệt ghi thêm chức vụ.</p>

      <table className="fp-signatures">
        <tbody>
          <tr>
            {['NGƯỜI LẬP PHIẾU', 'PHỤ TRÁCH BỘ PHẬN', 'KẾ TOÁN KIỂM TRA', 'NGƯỜI PHÊ DUYỆT'].map(label => (
              <td key={label}><b>{label}</b><div className="fp-sign-space" />…………………</td>
            ))}
          </tr>
        </tbody>
      </table>

      <p className="fp-note">
        Phiếu dùng để duyệt kinh phí; hồ sơ tạm ứng, thanh toán thực hiện riêng. Phát sinh vượt mức/phạm vi
        đã duyệt phải trình lại trước khi cam kết chi.
      </p>
    </article>
  );
}
