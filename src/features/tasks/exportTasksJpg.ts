import { TASKS_EXPORT_METRICS as M, type TasksExportLayout } from '../../domain/tasksExportLayout';
import { BODY, C, drawFooter, drawHeader, fit, startCanvas, toJpeg } from '../count/exportJpg';

/** Dessine la liste « À faire » du jour (deux services, case, heure) et renvoie un JPEG. */
export async function renderTasksJpg(layout: TasksExportLayout): Promise<Blob> {
  const { width: W, height: H, scale } = layout;
  const { canvas, ctx, logo } = await startCanvas(W, H, scale);
  drawHeader(ctx, W, layout.header, logo);

  for (const s of layout.sections) {
    const mid = s.y + M.sectionH / 2 + 6;
    ctx.fillStyle = C.bordeaux;
    ctx.font = `700 34px ${BODY}`;
    ctx.fillText(s.label, M.pad, mid);
    ctx.textAlign = 'right';
    ctx.font = `700 30px ${BODY}`;
    ctx.fillText(s.count, M.timeRight, mid);
    ctx.textAlign = 'left';
    ctx.fillStyle = C.encre;
    ctx.fillRect(M.pad, s.y + M.sectionH - 3, W - 2 * M.pad, 3);
  }

  for (const r of layout.rows) {
    const mid = r.y + M.rowH / 2;
    ctx.fillStyle = C.line;
    ctx.fillRect(M.pad, r.y + M.rowH - 1, W - 2 * M.pad, 1);
    // Case : pleine et cochée si la tâche est faite aujourd'hui.
    const box = 40;
    const bx = M.boxX;
    const by = mid - box / 2;
    if (r.done) {
      ctx.fillStyle = C.ok;
      ctx.fillRect(bx, by, box, box);
      ctx.strokeStyle = C.white;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(bx + 9, by + 21);
      ctx.lineTo(bx + 17, by + 29);
      ctx.lineTo(bx + 31, by + 12);
      ctx.stroke();
    } else {
      ctx.strokeStyle = C.encre;
      ctx.lineWidth = 3;
      ctx.strokeRect(bx + 1.5, by + 1.5, box - 3, box - 3);
    }
    ctx.fillStyle = r.done ? C.encre : C.muted;
    ctx.font = `${r.done ? 600 : 400} 32px ${BODY}`;
    ctx.fillText(fit(ctx, r.label, M.timeRight - M.labelX - 120), M.labelX, mid);
    if (r.time) {
      ctx.textAlign = 'right';
      ctx.fillStyle = C.encre;
      ctx.font = `700 30px ${BODY}`;
      ctx.fillText(r.time, M.timeRight, mid);
      ctx.textAlign = 'left';
    }
  }

  ctx.fillStyle = C.encre;
  ctx.fillRect(M.pad, layout.totalY, W - 2 * M.pad, 3);
  ctx.font = `700 34px ${BODY}`;
  ctx.textAlign = 'right';
  ctx.fillText(layout.totalLabel, M.timeRight, layout.totalY + M.totalH / 2);
  ctx.textAlign = 'left';

  drawFooter(ctx, W, layout.footerY);
  return toJpeg(canvas);
}
