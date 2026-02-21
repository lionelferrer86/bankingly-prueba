#!/usr/bin/env node
/**
 * Genera reporte ejecutivo de tickets en HTML estático (CSS inline).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, '..', 'data.json');
const OUTPUT_DIR = path.join(__dirname, 'output');

const CATEGORY_ES = {
  'Production Incident': 'Incidente de producción',
  'Certification Issue': 'Problema de certificación',
  'App Store Release': 'Lanzamiento App Store',
  'Report Request': 'Solicitud de reporte',
  'Functional Question': 'Pregunta funcional',
  'Access Request': 'Solicitud de acceso',
  'Google Play Release': 'Lanzamiento Google Play',
  'Improvement Request': 'Solicitud de mejora',
};

const CSS = `*{box-sizing:border-box}body{font-family:system-ui,sans-serif;line-height:1.5;color:#1a1a1a;background:#f8f9fa;margin:0;padding:2rem;max-width:720px;margin:0 auto}h1{font-size:1.5rem;font-weight:700;margin:0 0 1.5rem;color:#0d47a1}h2{font-size:1.1rem;font-weight:600;margin:1.5rem 0 .75rem;color:#1565c0}h3{font-size:.95rem;font-weight:600;margin:1rem 0 .5rem;color:#37474f}.block{background:#fff;border-radius:8px;padding:1.25rem 1.5rem;margin-bottom:1rem;box-shadow:0 1px 3px rgba(0,0,0,.08)}.note{font-size:.85rem;color:#546e7a;margin:0 0 .75rem;font-style:italic}table{width:100%;border-collapse:collapse;font-size:.9rem}td{padding:.4rem .6rem;border-bottom:1px solid #e8e8e8}td.num{text-align:right;font-variant-numeric:tabular-nums}.ticket-link{color:#1565c0;text-decoration:none}.ticket-link:hover{text-decoration:underline}.client-card{background:#f5f5f5;border-radius:6px;padding:1rem;border-left:4px solid #ff9800;margin-bottom:1rem}.client-card h3{margin-top:0}.client-card p{margin:.35rem 0}`;

function loadData() {
  return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
}

function getSeverity(t) {
  return t.internal?.severity || 'Unknown';
}

function getClientKey(t) {
  return t.client?.institution_name || t.client?.tenant_id || 'Sin cliente';
}

function calculateTTR(t) {
  if (t.status !== 'Closed' || !t.created_at || !t.closed_at) return null;
  return (new Date(t.closed_at) - new Date(t.created_at)) / (1000 * 60 * 60);
}

function buildReport(tickets) {
  const report = {
    bySeverity: {},
    byStatus: {},
    byCategory: {},
    ttrAll: { tickets: [], avgHours: null },
    ttrBySeverity: { Critical: [], High: [], Medium: [], Low: [] },
    csatAll: { tickets: [], avg: null },
    csatBySeverity: { Critical: [], High: [], Medium: [], Low: [] },
    clientsAtRisk: [],
  };

  const calcAvg = (arr) =>
    arr.length ? arr.reduce((s, x) => s + x.ttrHours, 0) / arr.length : null;

  for (const t of tickets) {
    const sev = getSeverity(t);
    const clientKey = getClientKey(t);

    report.bySeverity[sev] = (report.bySeverity[sev] || 0) + 1;
    report.byStatus[t.status] = (report.byStatus[t.status] || 0) + 1;
    report.byCategory[t.category] = (report.byCategory[t.category] || 0) + 1;

    if (t.status === 'Closed') {
      const ttr = calculateTTR(t);
      if (ttr !== null) {
        report.ttrAll.tickets.push({ id: t.ticket_id, ttrHours: ttr });
        const ttrBucket = report.ttrBySeverity[sev];
        if (ttrBucket) ttrBucket.push({ id: t.ticket_id, ttrHours: ttr });
      }
      if (t.csat != null && t.csat >= 1 && t.csat <= 5) {
        report.csatAll.tickets.push({ id: t.ticket_id, csat: t.csat });
        const csatBucket = report.csatBySeverity[sev];
        if (csatBucket) csatBucket.push({ id: t.ticket_id, csat: t.csat });
      }
    }

    const isCriticalOrHigh = sev === 'Critical' || sev === 'High';
    const isOpen = t.status === 'Open' || t.status === 'In Progress';
    const isEscalated = t.status === 'Escalated';
    const criticalNoWorkaround = sev === 'Critical' && !t.internal?.workaround && isOpen;

    if (
      clientKey !== 'Sin cliente' &&
      (isEscalated || criticalNoWorkaround || (isCriticalOrHigh && isOpen))
    ) {
      const ticketReasons = [
        isEscalated && 'Ticket escalado',
        criticalNoWorkaround && 'Critical sin workaround',
        isCriticalOrHigh && isOpen && 'Critical/High abierto',
      ].filter(Boolean);

      const existing = report.clientsAtRisk.find((c) => c.client === clientKey);
      if (existing) {
        existing.tickets.push(t.ticket_id);
        existing.count++;
        for (const r of ticketReasons) {
          if (!existing.reasons.includes(r)) existing.reasons.push(r);
        }
      } else {
        report.clientsAtRisk.push({
          client: clientKey,
          country: t.client?.country,
          tickets: [t.ticket_id],
          count: 1,
          reasons: [...ticketReasons],
        });
      }
    }
  }

  report.ttrAll.avgHours = calcAvg(report.ttrAll.tickets);
  const calcCsatAvg = (arr) =>
    arr.length ? arr.reduce((s, x) => s + x.csat, 0) / arr.length : null;
  report.csatAll.avg = calcCsatAvg(report.csatAll.tickets);
  const SEVERITY_ORDER = ['Critical', 'High', 'Medium', 'Low'];
  for (const s of SEVERITY_ORDER) {
    report.ttrBySeverity[s].avgHours = calcAvg(report.ttrBySeverity[s]);
    report.csatBySeverity[s].avg = calcCsatAvg(report.csatBySeverity[s]);
  }
  report.clientsAtRisk.sort((a, b) => b.count - a.count);

  return report;
}

function toHtml(report) {
  const fmt = (h) => (h != null ? `${h.toFixed(1)} h` : 'N/A (sin datos)');
  const fmtCsat = (v) => (v != null ? v.toFixed(1) : 'N/A (sin datos)');
  const link = (id) => `<a href="#${id}" class="ticket-link">${id}</a>`;
  const row = (label, val) => `<tr><td>${label}</td><td class="num">${val}</td></tr>`;

  const severityRows = Object.entries(report.bySeverity)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => row(k, v))
    .join('');
  const statusRows = Object.entries(report.byStatus).map(([k, v]) => row(k, v)).join('');
  const categoryRows = Object.entries(report.byCategory)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => row(CATEGORY_ES[k] || k, v))
    .join('');

  const clientsHtml =
    report.clientsAtRisk.length === 0
      ? '<p>No se identificaron clientes en riesgo.</p>'
      : report.clientsAtRisk
          .map(
            (c) =>
              `<div class="client-card"><h3>${c.client} (${c.country || 'N/A'})</h3><p><strong>Tickets:</strong> ${c.tickets.map(link).join(', ')}</p><p><strong>Motivos:</strong> ${c.reasons.join('; ')}</p></div>`
          )
          .join('');

  const SEVERITY_ORDER = ['Critical', 'High', 'Medium', 'Low'];
  const ttrRows =
    `<tr><td>Global (todos cerrados)</td><td class="num">${fmt(report.ttrAll.avgHours)} promedio</td><td class="num">${report.ttrAll.tickets.length} tickets</td></tr>` +
    SEVERITY_ORDER.map(
      (s) =>
        `<tr><td>${s} (cerrados)</td><td class="num">${fmt(report.ttrBySeverity[s]?.avgHours)} promedio</td><td class="num">${report.ttrBySeverity[s]?.length ?? 0} tickets</td></tr>`
    ).join('');
  const csatRows =
    `<tr><td>Global (cerrados con respuesta)</td><td class="num">${fmtCsat(report.csatAll.avg)}</td><td class="num">${report.csatAll.tickets.length} tickets</td></tr>` +
    SEVERITY_ORDER.map(
      (s) =>
        `<tr><td>${s} (cerrados)</td><td class="num">${fmtCsat(report.csatBySeverity[s]?.avg)}</td><td class="num">${report.csatBySeverity[s]?.length ?? 0} tickets</td></tr>`
    ).join('');

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Reporte Ejecutivo - Tickets TAM</title>
<style>${CSS}</style>
</head>
<body>
<h1>Reporte Ejecutivo - Tickets TAM</h1>
<section class="block">
<h2>1. Resumen por criterios</h2>
<h3>Por severidad</h3>
<table><tbody>${severityRows}</tbody></table>
<h3>Por estado</h3>
<table><tbody>${statusRows}</tbody></table>
<h3>Por categoría</h3>
<table><tbody>${categoryRows}</tbody></table>
</section>
<section class="block">
<h2>2. Tiempo de Resolución (TTR)</h2>
<p class="note">TTR = closed_at - created_at (horas). Valores: promedio por ticket.</p>
<table>
<tbody>${ttrRows}</tbody>
</table>
</section>
<section class="block">
<h2>3. CSAT (satisfacción del cliente)</h2>
<p class="note">Calificación 1-5 en tickets cerrados. Promedio por ticket.</p>
<table>
<tbody>${csatRows}</tbody>
</table>
</section>
<section class="block">
<h2>4. Clientes en riesgo</h2>
<p class="note">Clientes con tickets Critical/High abiertos, escalados o sin workaround.</p>
${clientsHtml}
</section>
<footer style="margin-top:2rem;font-size:.8rem;color:#78909c">Fin del reporte</footer>
</body>
</html>`;
}

function main() {
  if (!fs.existsSync(DATA_PATH)) {
    console.error('No se encontró data.json en', DATA_PATH);
    process.exit(1);
  }
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const report = buildReport(loadData().tickets);
  const htmlPath = path.join(OUTPUT_DIR, 'reporte-ejecutivo.html');
  fs.writeFileSync(htmlPath, toHtml(report), 'utf8');
  console.log('Reporte generado:', htmlPath);
}

main();
