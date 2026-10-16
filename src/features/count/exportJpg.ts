import { EXPORT_METRICS as M, type ExportLayout } from '../../domain/exportLayout';

const C = { bordeaux: '#8e1b1f', email: '#f6f4ee', encre: '#1d2433', laiton: '#b8892e', carotte: '#d22a2f', line: '#ddd6c6', muted: '#5b6273', white: '#ffffff' };
const DISPLAY = '"Alfa Slab One", Georgia, serif';
const BODY = '"Barlow Semi Condensed", system-ui, sans-serif';

function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > max) t = t.slice(0, -1);
  return t + '…';
}

function carotte(ctx: CanvasRenderingContext2D, x: number, y: number, h: number) {
  const w = h / 2;
  ctx.fillStyle = C.carotte;
  ctx.beginPath();
  ctx.moveTo(x + w / 2, y);
  ctx.lineTo(x + w, y + h * 0.3);
  ctx.lineTo(x + w, y + h * 0.7);
  ctx.lineTo(x + w / 2, y + h);
  ctx.lineTo(x, y + h * 0.7);
  ctx.lineTo(x, y + h * 0.3);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = C.email;
  for (const f of [0.38, 0.5, 0.62]) ctx.fillRect(x + w * 0.2, y + h * f - 2, w * 0.6, 4);
}

/** Dessine le comptage complet sur un canvas et renvoie un JPEG (qualité 0,92). */
export async function renderExportJpg(layout: ExportLayout): Promise<Blob> {
  try {
    await Promise.all([document.fonts.load(`40px ${DISPLAY}`), document.fonts.load(`600 28px ${BODY}`), document.fonts.load(`700 28px ${BODY}`)]);
  } catch {
    /* polices de secours */
  }
  const { width: W, height: H, scale } = layout;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(W * scale);
  canvas.height = Math.round(H * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.textBaseline = 'middle';

  ctx.fillStyle = C.white;
  ctx.fillRect(0, 0, W, H);

  // Bandeau
  ctx.fillStyle = C.bordeaux;
  ctx.fillRect(0, 0, W, M.headerH);
  ctx.fillStyle = C.laiton;
  ctx.fillRect(0, M.headerH - 10, W, 3);
  ctx.fillRect(0, M.headerH - 4, W, 3);
  carotte(ctx, M.pad, 40, 120);
  ctx.fillStyle = C.email;
  ctx.font = `48px ${DISPLAY}`;
  ctx.fillText(fit(ctx, layout.header.shop, W - 2 * M.pad - 90), M.pad + 90, 76);
  ctx.font = `600 32px ${BODY}`;
  ctx.fillText(`${layout.header.title} · ${layout.header.stamp}`, M.pad + 90, 136);

  // En-tête du tableau
  const headMid = layout.headRowY + M.headRowH / 2;
  ctx.font = `700 24px ${BODY}`;
  ctx.fillStyle = C.bordeaux;
  ctx.fillText('CODE-BARRES', M.cols.code, headMid);
  ctx.fillText('NOM DU JEU', M.cols.name, headMid);
  ctx.textAlign = 'right';
  ctx.fillText('LINÉAIRE', M.cols.linearRight, headMid);
  ctx.fillText('STOCK', M.cols.stockRight, headMid);
  ctx.textAlign = 'left';
  ctx.fillText('MODIFIÉ LE', M.cols.date, headMid);
  ctx.fillStyle = C.encre;
  ctx.fillRect(M.pad, layout.headRowY + M.headRowH - 3, W - 2 * M.pad, 3);

  // Lignes
  for (const r of layout.rows) {
    const mid = r.y + M.rowH / 2;
    ctx.fillStyle = C.line;
    ctx.fillRect(M.pad, r.y + M.rowH - 1, W - 2 * M.pad, 1);
    ctx.fillStyle = C.muted;
    ctx.font = `400 26px ${BODY}`;
    ctx.fillText(fit(ctx, r.cells[0], M.cols.name - M.cols.code - 16), M.cols.code, mid);
    ctx.fillStyle = C.encre;
    ctx.font = `600 30px ${BODY}`;
    ctx.fillText(fit(ctx, r.cells[1], M.cols.linearRight - M.cols.name - 120), M.cols.name, mid);
    ctx.font = `700 34px ${BODY}`;
    ctx.textAlign = 'right';
    ctx.fillText(r.cells[2], M.cols.linearRight, mid);
    ctx.fillText(r.cells[3], M.cols.stockRight, mid);
    ctx.textAlign = 'left';
    ctx.fillStyle = C.muted;
    ctx.font = `400 26px ${BODY}`;
    ctx.fillText(r.cells[4], M.cols.date, mid);
  }

  // Total
  ctx.fillStyle = C.encre;
  ctx.fillRect(M.pad, layout.totalY, W - 2 * M.pad, 3);
  const totMid = layout.totalY + M.totalH / 2;
  ctx.font = `700 32px ${BODY}`;
  ctx.fillText(layout.totalLabel, M.cols.name, totMid);
  ctx.font = `700 38px ${BODY}`;
  ctx.textAlign = 'right';
  ctx.fillText(String(layout.totals.linear), M.cols.linearRight, totMid);
  ctx.fillText(String(layout.totals.stock), M.cols.stockRight, totMid);

  // Pied
  ctx.fillStyle = C.muted;
  ctx.font = `400 22px ${BODY}`;
  ctx.fillText('Exporté avec La Carotte', W - M.pad, layout.footerY + M.footerH / 2);
  ctx.textAlign = 'left';

  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Impossible de créer l'image"))), 'image/jpeg', 0.92),
  );
}
