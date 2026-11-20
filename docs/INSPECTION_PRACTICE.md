# Inspection practice

SnagWalk's room checklists follow the methods professional possession-day inspectors in India use. The rules live
in `src/lib/inspection-practice.ts`. They go into Gemini's checklist prompt (`generateRoomChecklist` in
`src/lib/gemini.ts`) and are also used as the offline checklist when Gemini is unavailable. Tests:
`src/lib/inspection-practice.test.ts`.

## Methods (each one needs only a phone, a coin, a bucket or a charger)

| Method | What it catches | Sources |
|---|---|---|
| Inspect in daylight with water and power on; go top to bottom, left to right | Missed rooms and dead points | MagicBricks, Signature Properties |
| Coin tap every floor and wall tile | Hollow tiles that crack or pop within a year | MagicBricks, Ghar Insight, Signature Properties |
| Bucket water test in bathrooms and balconies; water runs straight to the drain (about 1:80 to 1:100 fall) | Slope faults, pooling, future seepage | Ghar Insight, Signature Properties, StudioMatrx |
| Phone torch held flat along walls | Waviness, patches, uneven plaster | Ghar Insight |
| Damp stains near beams, windows, skirting and walls shared with bathrooms or terraces | Seepage | MagicBricks, Signature Properties |
| Every switch and socket with a charger or socket tester; earthing; ELCB or RCCB trip | Dummy points, missing earthing | Ghar Insight, Genext, Signature Properties |
| Flush every toilet; run every tap; look under sinks | Base seepage, slow refill, hidden leaks | Ghar Insight, Signature Properties |
| Open, close and lock every door and window | Scraping, gaps, missing rain sealant | MagicBricks, Signature Properties |
| Measure rooms against the RERA plan | Carpet area shortfall | Ghar Insight, Signature Properties |

The snag list format these guides recommend (number every defect, name the room and element, describe it, attach a
photo, ask for written confirmation, re-inspect) is exactly what SnagWalk's builder letter produces.

## Sources

- MagicBricks, "Checklist for taking final possession": https://www.magicbricks.com/blog/checklist-for-taking-final-possession-to-your-new-home/148891.html
- Ghar Insight, "Home inspection checklist India 2026": https://gharinsight.com/blog/home-inspection-checklist-india-2026
- Signature Properties, "Snag list for home possession": https://thesignatureproperties.com/home-inspection-snag-list-possession/
- Genext, "Flat possession inspection checklist": https://genextinc.com/before-you-take-flat-possession-your-must-do-inspection-checklist/
- StudioMatrx, "Bathroom quality inspection checklist (India)": https://www.studiomatrx.org/guides/bathroom-quality-inspection-checklist-india
