import { NextRequest, NextResponse } from 'next/server';
import { getNumberedSnags, isUuid } from '@/lib/walks';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ walkId: string }> }) {
  try {
    const { walkId } = await params;
    if (!isUuid(walkId)) return NextResponse.json({ error: 'Walk not found' }, { status: 404 });
    const { snags } = await getNumberedSnags(walkId);
    return NextResponse.json({ snags, total_count: snags.length });
  } catch (error) {
    console.error('[api/walks/:id/snags] failed:', error);
    return NextResponse.json({ error: 'Could not load snags.' }, { status: 500 });
  }
}
