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
