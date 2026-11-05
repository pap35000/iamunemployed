// A small stand-in for Cloudflare D1 on your own computer, built on Node's SQLite
// (node:sqlite, Node.js 22.13 or newer). It covers what the API uses:
// prepare().bind().first() / .all() / .run(), and batch(), which runs as one transaction.
// Like D1, it refuses undefined or true/false values and a wrong number of parameters.

import { DatabaseSync } from 'node:sqlite';

const highestParam = sql => Math.max(0, ...Array.from(sql.matchAll(/\?(\d+)/g), m => Number(m[1])));

class Statement {
  constructor(conn, sql, params = []) {
    this.conn = conn;
    this.sql = sql;
    this.params = params;
  }

  bind(...params) {
    for (const p of params) {
      if (!(p === null || typeof p === 'number' || typeof p === 'string' || typeof p === 'bigint')) {
        throw new Error(`D1_TYPE_ERROR: Type '${typeof p}' not supported for value '${p}'`);
      }
    }
    return new Statement(this.conn, this.sql, params);
  }

  // node:sqlite binds ?1, ?2 ... by name, so the list becomes {1: ..., 2: ...}.
  args() {
    const needed = highestParam(this.sql);
    if (needed !== this.params.length) {
      throw new Error(`D1_ERROR: Wrong number of parameter bindings for SQL query (needs ${needed}, got ${this.params.length})`);
    }
    if (!needed) return [];
    return [Object.fromEntries(this.params.map((p, i) => [String(i + 1), p]))];
  }

  rows() {
    return this.conn.prepare(this.sql).all(...this.args()).map(row => ({ ...row }));
  }

  async first(column) {
    const row = this.rows()[0];
    if (!row) return null;
    return column ? row[column] : row;
  }

  async all() {
    return { success: true, results: this.rows(), meta: {} };
  }

  async run() {
    const info = this.conn.prepare(this.sql).run(...this.args());
    return { success: true, results: [], meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
  }
}

export function openD1(file = ':memory:') {
  const conn = new DatabaseSync(file);
  conn.exec('PRAGMA foreign_keys = ON'); // D1 enforces foreign keys too
  return {
    prepare: sql => new Statement(conn, sql),
    async batch(statements) {
      conn.exec('BEGIN');
      try {
        const out = statements.map(s => ({ success: true, results: s.rows(), meta: {} }));
        conn.exec('COMMIT');
        return out;
      } catch (err) {
        conn.exec('ROLLBACK');
        throw err;
      }
    },
    close: () => conn.close(),
    // For tests: run raw SQL and get rows back.
    query: (sql, ...params) => new Statement(conn, sql).bind(...params).rows()
  };
}
