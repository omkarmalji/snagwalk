import { NextRequest, NextResponse } from 'next/server';
import { getStore } from '@/lib/store';
import { generateSnagLetter } from '@/lib/gemini';
import { parseLetterLanguage } from '@/lib/shared';
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
      language: saved?.language ?? 'en',
      stale: saved ? saved.fp !== letterFingerprint(found.walk, groups) : true,
    });
  } catch (error) {
    console.error('[api/letter] GET failed:', error);
    return NextResponse.json({ error: 'Could not load the letter.' }, { status: 500 });
  }
}

/** Generates the builder letter from the snags table (never invents defects) and persists it. */
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const { walkId } = await params;
    if (!isUuid(walkId)) return NextResponse.json({ error: 'Walk not found' }, { status: 404 });
    const found = await getWalk(walkId);
    if (!found) return NextResponse.json({ error: 'Walk not found' }, { status: 404 });

    const body = (await req.json().catch(() => ({}))) as { language?: unknown };
    const language = parseLetterLanguage(body.language);

    const { snags, groups } = await getNumberedSnags(walkId);
    const { data: markdown, source } = await generateSnagLetter(toLetterWalk(found.walk), groups, language);
    const fp = letterFingerprint(found.walk, groups);

    await getStore().setLetter(walkId, packLetter(markdown, fp, source, language));

    return NextResponse.json({ walk: found.walk, snags, letter: markdown, source, language, stale: false });
  } catch (error) {
    console.error('[api/letter] POST failed:', error);
    return NextResponse.json({ error: 'Could not generate the letter.' }, { status: 500 });
  }
}
