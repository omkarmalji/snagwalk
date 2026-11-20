/**
 * How professional possession-day inspectors in India check a new flat, distilled from published inspector and
 * buyer guides (sources below and in docs/INSPECTION_PRACTICE.md). Used to ground Gemini's room checklists and as
 * the offline checklist when Gemini is unavailable. Pure data: no I/O, safe to import anywhere.
 */

export const PRACTICE_SOURCES = [
  { name: 'MagicBricks: checklist for taking final possession', url: 'https://www.magicbricks.com/blog/checklist-for-taking-final-possession-to-your-new-home/148891.html' },
  { name: 'Ghar Insight: home inspection checklist India 2026', url: 'https://gharinsight.com/blog/home-inspection-checklist-india-2026' },
  { name: 'Signature Properties: snag list for home possession', url: 'https://thesignatureproperties.com/home-inspection-snag-list-possession/' },
  { name: 'Genext: flat possession inspection checklist', url: 'https://genextinc.com/before-you-take-flat-possession-your-must-do-inspection-checklist/' },
  { name: 'StudioMatrx: bathroom quality inspection checklist (India)', url: 'https://www.studiomatrx.org/guides/bathroom-quality-inspection-checklist-india' },
] as const;

/** Methods inspectors agree on. Each is something a buyer can do with a phone, a coin, a bucket or a charger. */
export const INSPECTION_METHODS = [
  'Inspect in daylight with water and power on; work top to bottom, left to right in every room.',
  'Coin tap every floor and wall tile: a hollow sound means an air gap and a tile that will crack or pop.',
  'Water test wet areas: pour a bucket, water must run straight to the drain with no pooling (fall about 1:80 to 1:100); a marble shows the slope.',
  'Hold a phone torch flat along walls and ceilings to reveal waviness, patches and uneven plaster.',
  'Look for damp stains near beams, windows, skirting and walls shared with bathrooms or terraces.',
  'Test every switch and socket with a phone charger or plug-in socket tester; check earthing and that the ELCB or RCCB trips.',
  'Flush every toilet: quick refill, no seepage at the commode base; run every tap and look under sinks.',
  'Open, close and lock every door and window; look for scraping, gaps and missing rain sealant.',
  'Measure rooms with a tape or laser and compare with the RERA plan in the agreement.',
] as const;

type Cat = 'wall_paint' | 'tiles' | 'plumbing' | 'electrical' | 'doors_windows' | 'woodwork' | 'ceiling' | 'flooring' | 'other';
export type PracticeItem = readonly [item: string, category: Cat];

/** Offline checklists, 4 to 6 items per room type, each phrased as a physical check with its method. */
export const ROOM_PRACTICE: Record<'kitchen' | 'bath' | 'balcony' | 'entrance' | 'room', readonly PracticeItem[]> = {
  kitchen: [
    ['Check the platform is level and the granite joints and sink sealing have no gaps', 'woodwork'],
    ['Run the sink tap for a minute; check the trap and pipes below for drips', 'plumbing'],
    ['Coin tap the dado tiles behind the platform for hollow sounds and missing grout', 'tiles'],
    ['Test chimney, purifier and appliance sockets with a charger; confirm the exhaust point', 'electrical'],
    ['Confirm the gas pipeline or cylinder provision matches the agreement', 'other'],
  ],
  bath: [
    ['Pour a bucket of water; it must run straight to the drain with no pooling', 'tiles'],
    ['Coin tap floor and wall tiles for hollow sounds; check grout joints are filled', 'tiles'],
    ['Flush twice; check quick refill and no seepage at the commode base', 'plumbing'],
    ['Run every tap and the health faucet; check hot and cold lines and angle valves', 'plumbing'],
    ['Check the ceiling and shared walls for damp stains from the flat above', 'ceiling'],
    ['Test geyser, exhaust fan and mirror light points', 'electrical'],
  ],
  balcony: [
    ['Pour water and confirm it reaches the drain outlet without pooling', 'flooring'],
    ['Check railing height, weld joints and rust; push to confirm it is firm', 'doors_windows'],
    ['Inspect exterior paint and the floor edge for cracks or seepage marks', 'wall_paint'],
    ['Test the washing machine tap point and outdoor socket', 'electrical'],
  ],
  entrance: [
    ['Open, close and lock the main door; check it does not scrape or leave gaps', 'doors_windows'],
    ['Test the latch, peephole, door stopper and safety chain', 'doors_windows'],
    ['Check the frame and architrave for gaps and cracks at the corners', 'woodwork'],
    ['Find the MCB panel; check labels and that the ELCB or RCCB test button trips', 'electrical'],
    ['Test the doorbell and passage lights', 'electrical'],
  ],
  room: [
    ['Hold a phone torch flat along each wall to spot waviness, patches and cracks', 'wall_paint'],
    ['Coin tap floor tiles across the room for hollow sounds', 'flooring'],
    ['Slide and lock every window; check tracks, glass and rain sealant', 'doors_windows'],
    ['Test every switch and socket with a charger, including AC points', 'electrical'],
    ['Look for damp stains near windows, beams and the skirting', 'wall_paint'],
    ['Measure the room and compare it with the RERA plan', 'other'],
  ],
};

/** Which offline list a room name maps to. */
export function practiceKeyFor(roomName: string): keyof typeof ROOM_PRACTICE {
  const lower = roomName.toLowerCase();
  if (lower.includes('kitchen')) return 'kitchen';
  if (lower.includes('bath') || lower.includes('toilet') || lower.includes('wash')) return 'bath';
  if (lower.includes('balcony') || lower.includes('utility') || lower.includes('terrace')) return 'balcony';
  if (lower.includes('entrance') || lower.includes('passage') || lower.includes('foyer')) return 'entrance';
  return 'room';
}
