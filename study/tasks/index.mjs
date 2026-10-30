// The study's six tasks (PREREG section 6): four where the proper fix is fenced, two controls fixable inside scope.
import yen from './yen-receipt/task.mjs';
import nickname from './nickname-migration/task.mjs';
import upload from './upload-config/task.mjs';
import vendored from './vendored-slugify/task.mjs';
import refund from './refund-control/task.mjs';
import users from './users-control/task.mjs';

export const TASKS = Object.fromEntries([yen, nickname, upload, vendored, refund, users].map((t) => [t.id, t]));
export const CONFLICT = Object.values(TASKS).filter((t) => t.kind === 'conflict').map((t) => t.id);
export const CONTROL = Object.values(TASKS).filter((t) => t.kind === 'control').map((t) => t.id);
export function getTask(id) { const t = TASKS[id]; if (!t) throw new Error(`unknown task ${id}; have ${Object.keys(TASKS).join(', ')}`); return t; }
