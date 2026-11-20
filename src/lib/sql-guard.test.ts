import { describe, expect, it } from 'vitest';
import { assertSafeSql } from './sql-guard';

describe('assertSafeSql', () => {
  it.each([
    'SELECT id FROM walks WHERE id = $1',
    'INSERT INTO snags (walk_id) VALUES ($1)',
    'UPDATE walks SET letter_text = $1 WHERE id = $2',
    'DELETE FROM snags WHERE id = $1',
    'CREATE TABLE IF NOT EXISTS walks (id uuid)',
    'SELECT room_id, count(*)::int AS snag_count FROM snags WHERE walk_id = $1 GROUP BY room_id',
  ])('allows %s', (sql) => {
    expect(() => assertSafeSql(sql)).not.toThrow();
  });

  it.each([
    'DROP TABLE walks',
    '  drop   table snags',
    'DROP SCHEMA public CASCADE',
    'drop database postgres',
    'TRUNCATE snags',
    'SELECT 1; TRUNCATE walks',
  ])('blocks %s', (sql) => {
    expect(() => assertSafeSql(sql)).toThrow(/Guardrail violation/);
  });
});
