import PDFDocument from 'pdfkit';
import { config } from '../config.js';

const fmtL = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${Number(v).toLocaleString('en-CA')} L`);
const fmtTime = (d: Date | string | null | undefined) =>
  d
    ? new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(d))
    : '—';

/** One-page delivery ticket for a completed job. */
export function ticketPdf(job: Record<string, any>, images: { meterPhoto?: Buffer; signature?: Buffer }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 54, info: { Title: `Delivery ticket #${job.number}` } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const org = process.env.ORG_NAME ?? 'Water Delivery';
    doc.fontSize(20).font('Helvetica-Bold').text(org);
    doc.fontSize(12).font('Helvetica').fillColor('#555').text('Water delivery ticket');
    doc.moveUp(2).fontSize(20).fillColor('#000').font('Helvetica-Bold').text(`#${job.number}`, { align: 'right' });
    doc.moveDown(1.5);
    doc.moveTo(54, doc.y).lineTo(558, doc.y).strokeColor('#ccc').stroke();
    doc.moveDown();

    const row = (label: string, value: string) => {
      const y = doc.y;
      doc.font('Helvetica').fontSize(10).fillColor('#666').text(label, 54, y, { width: 150 });
      doc.font('Helvetica').fontSize(11).fillColor('#000').text(value, 210, y, { width: 348 });
      doc.moveDown(0.6);
    };
    row('Customer', `${job.customer_name}`);
    row('Delivery point', [job.site_label, job.site_address].filter(Boolean).join('\n'));
    row('Delivered', fmtTime(job.delivered_at ?? job.completed_at));
    row('Truck', job.truck_name ?? '—');
    row('Driver', job.driver_name ?? '—');
    doc.moveDown(0.5);

    doc.font('Helvetica-Bold').fontSize(28).fillColor('#000').text(fmtL(job.delivered_litres), 54);
    doc.font('Helvetica').fontSize(10).fillColor('#666').text('Litres delivered (truck meter)');
    doc.moveDown();
    row('Meter start', job.meter_start == null ? '—' : String(job.meter_start));
    row('Meter end', job.meter_end == null ? '—' : String(job.meter_end));
    row('Requested', fmtL(job.requested_litres));
    if (job.arrived_at) row('Arrived on site', `${fmtTime(job.arrived_at)} (${job.arrival_source ?? 'logged'})`);
    if (job.recipient_name) row('Received by', job.recipient_name);
    if (job.delivery_notes) row('Driver notes', job.delivery_notes);

    const imgTop = Math.max(doc.y + 10, 470);
    if (images.meterPhoto) {
      doc.font('Helvetica').fontSize(10).fillColor('#666').text('Meter photo', 54, imgTop);
      try {
        doc.image(images.meterPhoto, 54, imgTop + 14, { fit: [240, 200] });
      } catch {
        doc.text('(photo could not be shown)', 54, imgTop + 14);
      }
    }
    if (images.signature) {
      doc.font('Helvetica').fontSize(10).fillColor('#666').text('Signature', 318, imgTop);
      try {
        doc.image(images.signature, 318, imgTop + 14, { fit: [240, 120] });
      } catch {
        doc.text('(signature could not be shown)', 318, imgTop + 14);
      }
    }
    // Writing inside the bottom margin would start a second page.
    doc.page.margins.bottom = 0;
    doc.fontSize(8).fillColor('#999').text(`Generated ${fmtTime(new Date())}`, 54, 750, { align: 'center', width: 504, lineBreak: false });
    doc.end();
  });
}

const fmtMoney = (v: number | string | null | undefined) =>
  Number(v ?? 0).toLocaleString('en-CA', { style: 'currency', currency: 'CAD' });
const fmtDate = (d: string | Date | null | undefined) =>
  d ? new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(typeof d === 'string' && d.length === 10 ? `${d}T12:00:00Z` : d)) : '—';

/** A customer invoice: company header, bill-to, one row per line item grouped by delivery, totals. */
export function invoicePdf(inv: Record<string, any>, settings: { company: Record<string, string>; tax: { label: string; rate: number }; invoice: { footer: string; prefix: string } }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 48, info: { Title: `Invoice ${settings.invoice.prefix}${inv.number}` } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const W = 612;
    const L = 48;
    const R = W - 48;
    const accent = '#1765d1';

    doc.rect(0, 0, W, 6).fill(accent);
    doc.fillColor('#0d1420').font('Helvetica-Bold').fontSize(18).text(settings.company.name || process.env.ORG_NAME || 'Water Delivery', L, 36);
    doc.font('Helvetica').fontSize(9).fillColor('#5f6b7d');
    const companyLines = [settings.company.address, settings.company.phone, settings.company.email, settings.company.tax_number ? `${settings.tax.label} # ${settings.company.tax_number}` : ''].filter(Boolean);
    doc.text(companyLines.join('\n'), L, 60, { width: 260 });

    doc.font('Helvetica-Bold').fontSize(22).fillColor('#0d1420').text('Invoice', 360, 34, { width: R - 360, align: 'right' });
    doc.font('Helvetica').fontSize(10).fillColor('#5f6b7d');
    const meta: [string, string][] = [
      ['Invoice', `${settings.invoice.prefix}${inv.number}`],
      ['Issued', fmtDate(inv.issue_date)],
      ['Due', fmtDate(inv.due_date)],
      ['Period', `${fmtDate(inv.period_start)} – ${fmtDate(inv.period_end)}`],
    ];
    let my = 64;
    for (const [k, v] of meta) {
      doc.fillColor('#8b95a5').text(k, 360, my, { width: 80 });
      doc.fillColor('#0d1420').text(v, 430, my, { width: R - 430, align: 'right' });
      my += 15;
    }

    let y = Math.max(doc.y, my) + 20;
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#8b95a5').text('BILL TO', L, y);
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#0d1420').text(inv.customer_name, L, y + 13);
    doc.font('Helvetica').fontSize(9).fillColor('#5f6b7d').text([inv.account_code ? `Account ${inv.account_code}` : '', inv.customer_phone, inv.customer_email].filter(Boolean).join(' · '), L, y + 29);
    y += 58;

    const cols = { date: L, desc: L + 70, qty: 360, rate: 430, amt: 500 };
    const header = () => {
      doc.rect(L, y, R - L, 22).fill('#f4f6fa');
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#5f6b7d');
      doc.text('DATE', cols.date + 8, y + 7);
      doc.text('DESCRIPTION', cols.desc, y + 7);
      doc.text('QTY', cols.qty, y + 7, { width: 60, align: 'right' });
      doc.text('RATE', cols.rate, y + 7, { width: 60, align: 'right' });
      doc.text('AMOUNT', cols.amt, y + 7, { width: R - cols.amt - 8, align: 'right' });
      y += 28;
    };
    header();
    doc.font('Helvetica').fontSize(9.5);
    for (const l of inv.lines as Record<string, any>[]) {
      if (y > 680) {
        doc.addPage();
        y = 48;
        header();
        doc.font('Helvetica').fontSize(9.5);
      }
      const desc = `${l.description} — Job #${l.job_number}, ${l.site_label}`;
      const h = Math.max(14, doc.heightOfString(desc, { width: cols.qty - cols.desc - 10 }));
      doc.fillColor('#5f6b7d').text(fmtDate(l.completed_at), cols.date + 8, y, { width: 62 });
      doc.fillColor('#0d1420').text(desc, cols.desc, y, { width: cols.qty - cols.desc - 10 });
      doc.text(`${Number(l.quantity).toLocaleString('en-CA')}${l.unit ? ` ${l.unit === 'litre' ? 'L' : l.unit}` : ''}`, cols.qty, y, { width: 60, align: 'right' });
      doc.text(Number(l.unit_price) < 1 ? `$${Number(l.unit_price).toFixed(4)}` : fmtMoney(l.unit_price), cols.rate, y, { width: 60, align: 'right' });
      doc.text(fmtMoney(l.amount), cols.amt, y, { width: R - cols.amt - 8, align: 'right' });
      y += h + 8;
      doc.moveTo(L, y - 4).lineTo(R, y - 4).strokeColor('#eef1f5').lineWidth(0.6).stroke();
    }
    if (y > 640) {
      doc.addPage();
      y = 48;
    }
    y += 8;
    const tot = (label: string, value: string, bold = false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 12 : 10).fillColor(bold ? '#0d1420' : '#5f6b7d');
      doc.text(label, 360, y, { width: 120 });
      doc.fillColor('#0d1420').text(value, 430, y, { width: R - 430 - 8, align: 'right' });
      y += bold ? 20 : 16;
    };
    tot('Subtotal', fmtMoney(inv.subtotal));
    tot(`${settings.tax.label} (${(settings.tax.rate * 100).toFixed(settings.tax.rate * 100 % 1 ? 2 : 0)}%)`, fmtMoney(inv.tax));
    doc.moveTo(360, y).lineTo(R, y).strokeColor('#d3d9e3').lineWidth(1).stroke();
    y += 8;
    tot('Total due', fmtMoney(inv.total), true);
    if (inv.notes) {
      doc.font('Helvetica').fontSize(9.5).fillColor('#5f6b7d').text(inv.notes, L, y + 10, { width: 280 });
    }
    doc.page.margins.bottom = 0;
    doc.font('Helvetica').fontSize(9).fillColor('#8b95a5').text(settings.invoice.footer || '', L, 740, { width: R - L, align: 'center', lineBreak: false });
    doc.end();
  });
}
