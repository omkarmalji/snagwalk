import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { generateSnagLetter } from '@/lib/gemini';
import {
  getNumberedSnags,
  getWalk,
  isUuid,
  letterFingerprint,
  packLetter,
  toLetterWalk,
  unpackLetter,
} from '@/lib/walks';

type Ctx = { params: Promise<{ walkId: string }> };

/** Returns the saved letter and whether it is stale relative to the current snags. */
export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const { walkId } = await params;
    if (!isUuid(walkId)) return NextResponse.json({ error: 'Walk not found' }, { status: 404 });
    const found = await getWalk(walkId);
    if (!found) return NextResponse.json({ error: 'Walk not found' }, { status: 404 });

    const { snags, groups } = await getNumberedSnags(walkId);
    const saved = unpackLetter(found.letterText);
    return NextResponse.json({
      walk: found.walk,
      snags,
      letter: saved?.markdown ?? null,
      source: saved?.source ?? null,
      stale: saved ? saved.fp !== letterFingerprint(found.walk, groups) : true,
    });
  } catch (error) {
    console.error('[api/letter] GET failed:', error);
    return NextResponse.json({ error: 'Could not load the letter.' }, { status: 500 });
  }
}

/** Generates the builder letter from the snags table (never invents defects) and persists it. */
export async function POST(_req: NextRequest, { params }: Ctx) {
  try {
    const { walkId } = await params;
    if (!isUuid(walkId)) return NextResponse.json({ error: 'Walk not found' }, { status: 404 });
    const found = await getWalk(walkId);
    if (!found) return NextResponse.json({ error: 'Walk not found' }, { status: 404 });

    const { snags, groups } = await getNumberedSnags(walkId);
    const { data: markdown, source } = await generateSnagLetter(toLetterWalk(found.walk), groups);
    const fp = letterFingerprint(found.walk, groups);

    await query(`UPDATE walks SET letter_text = $1 WHERE id = $2`, [packLetter(markdown, fp, source), walkId]);

    return NextResponse.json({ walk: found.walk, snags, letter: markdown, source, stale: false });
  } catch (error) {
    console.error('[api/letter] POST failed:', error);
    return NextResponse.json({ error: 'Could not generate the letter.' }, { status: 500 });
  }
}
