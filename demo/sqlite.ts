// node:sqlite's DatabaseSync, as far as IMS uses it, on top of sql.js (SQLite compiled to JavaScript) for the online demo.
const db = () => (globalThis as any).__imsDb;
class Statement {
 constructor(private q: string) {}
 all(...args: unknown[]) {
  const st = db().prepare(this.q);
  try { st.bind(args); const rows: Record<string, unknown>[] = []; while (st.step()) rows.push(st.getAsObject()); return rows; } finally { st.free(); }
 }
 get(...args: unknown[]) { return this.all(...args)[0]; }
 run(...args: unknown[]) {
  const st = db().prepare(this.q);
  try { st.bind(args); st.step(); } finally { st.free(); }
  return {changes: db().getRowsModified(), lastInsertRowid: 0};
 }
}
export class DatabaseSync {
 constructor(_path?: string) {}
 prepare(q: string) { return new Statement(q); }
 exec(s: string) { db().exec(s); }
 close() {}
}
