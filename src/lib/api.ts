import { jsPDF } from 'jspdf';
import * as XLSX from 'xlsx';
import type { UserRole } from '../types/rail.ts';

let currentRole: UserRole = 'CONTROLLER';
let authToken: string | null = null;

export function setClientAuth(role: UserRole, token?: string | null) {
  currentRole = role;
  if (token !== undefined) authToken = token;
}

export function getClientRole(): UserRole {
  return currentRole;
}

export async function apiFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Demo-Role': currentRole,
    ...(init.headers as Record<string, string> | undefined),
  };
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }
  const res = await fetch(`/api/v1${path}`, { ...init, headers });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const err = (await res.json()) as { error?: string };
      if (err?.error) msg = err.error;
    } catch {
      // ignore parse failure
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

export function formatTimeMin(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function exportRowsToCsv(filename: string, rows: Array<Record<string, unknown>>) {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(','),
    ...rows.map((r) =>
      headers
        .map((h) => {
          const val = r[h] ?? '';
          const str = String(val).replace(/"/g, '""');
          return str.includes(',') || str.includes('"') || str.includes('\n') ? `"${str}"` : str;
        })
        .join(',')
    ),
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportRowsToExcel(filename: string, sheets: Array<{ name: string; rows: Array<Record<string, unknown>> }>) {
  const wb = XLSX.utils.book_new();
  for (const sh of sheets) {
    const ws = XLSX.utils.json_to_sheet(sh.rows.length > 0 ? sh.rows : [{ info: 'No rows' }]);
    XLSX.utils.book_append_sheet(wb, ws, sh.name.slice(0, 31));
  }
  XLSX.writeFile(wb, filename);
}

export function generatePdfReport(title: string, sections: Array<{ heading: string; lines: string[] }>, filename: string) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  let y = 48;

  doc.setFillColor(11, 27, 51);
  doc.rect(0, 0, 595, 72, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.text('RAILSMART AI — OPERATIONS & OPTIMIZATION REPORT', 40, 34);
  doc.setFontSize(10);
  doc.setTextColor(148, 163, 184);
  doc.text(`${title}  |  Generated: ${new Date().toISOString().slice(0, 19).replace('T', ' ')} UTC`, 40, 54);

  y = 96;
  doc.setTextColor(180, 83, 9);
  doc.setFontSize(9);
  doc.text('DISCLAIMER: Decision support & simulation prototype only. Not certified for real train control. Final authority rests with the Section Controller.', 40, y, { maxWidth: 515 });
  y += 28;

  for (const sec of sections) {
    if (y > 740) {
      doc.addPage();
      y = 48;
    }
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(12);
    doc.text(sec.heading, 40, y);
    y += 16;
    doc.setFontSize(9.5);
    doc.setTextColor(51, 65, 85);
    for (const line of sec.lines) {
      if (y > 760) {
        doc.addPage();
        y = 48;
      }
      const wrapped = doc.splitTextToSize(line, 515) as string[];
      doc.text(wrapped, 40, y);
      y += wrapped.length * 13;
    }
    y += 12;
  }

  doc.save(filename);
}
