/**
 * DIAG FICHE — ce qu'une fiche de lieu aurait à DIRE, sur une vraie carte (T5, l'écran du
 * registre par lieu).
 *
 * `registreDuLieu` rend deux tableaux : les faits d'annales du lieu, et les lignes de
 * chronique qui le nomment. L'écran les interfeuille en UNE colonne. Avant d'en écrire une
 * ligne, deux questions qu'aucune lecture de code ne répond :
 *
 *   1. **Combien de faits porte un lieu ?** Une fiche à zéro fait n'est pas une fiche — et la
 *      moyenne ne dit rien : c'est la distribution qui décide si l'écran vaut d'exister.
 *   2. **Que reste-t-il sous la SAILLANCE (R4) ?** La spec dit « R4 vaut pour TOUT lecteur ».
 *      Appliquée telle quelle à la fiche, elle peut la vider — il faut le CHIFFRE avant de
 *      choisir, pas après.
 *
 * Il ne joue rien : il génère le monde joué et lit ses annales, comme la sim les lit.
 *
 *     node --import tsx tools/diag-fiche.mts [seed]
 */
import { generateZonedTerrain, MONDE, MONDE_JOUE } from '../packages/sim/src/index'
import { faitsDuLieu, saillant, texteDeStele } from '../packages/sim/src/annales'

const seed = Number(process.argv[2] ?? 2026)
const { map } = generateZonedTerrain(seed, MONDE.JOUEURS_CIBLE, MONDE_JOUE)

const lieux = map.zones
  .map((z, poiId) => ({ poiId, z }))
  .filter(({ z }) => z.kind !== undefined)

console.log(`seed ${seed} — ${map.zones.length} zones, dont ${lieux.length} LIEUX (kind défini)`)
console.log(`annales de la carte : ${(map.annales ?? []).length} faits\n`)

const histoTotal = new Map<number, number>()
const histoSaillant = new Map<number, number>()
const parType = new Map<string, { total: number; saillants: number }>()
let lieuxAvecFait = 0
let lieuxAvecSaillant = 0

for (const { poiId, z } of lieux) {
  const faits = faitsDuLieu(map, z)
  const saillants = faits.filter((f) => saillant(map, f))
  histoTotal.set(faits.length, (histoTotal.get(faits.length) ?? 0) + 1)
  histoSaillant.set(saillants.length, (histoSaillant.get(saillants.length) ?? 0) + 1)
  if (faits.length > 0) lieuxAvecFait += 1
  if (saillants.length > 0) lieuxAvecSaillant += 1
  for (const f of faits) {
    const clef = f.cause === undefined ? f.type : `${f.type}:${f.cause}`
    const e = parType.get(clef) ?? { total: 0, saillants: 0 }
    e.total += 1
    if (saillant(map, f)) e.saillants += 1
    parType.set(clef, e)
  }
  if (poiId < 6 || faits.length >= 3) {
    const rendu = faits.map((f) => `${f.type}${f.cause ? `:${f.cause}` : ''}${saillant(map, f) ? '' : '·tu'}`).join(' ')
    console.log(`  #${String(poiId).padStart(3)} ${z.kind?.padEnd(14)} ${z.name.padEnd(28)} ${rendu || '(aucun fait)'}`)
  }
}

const ligne = (h: Map<number, number>): string =>
  [...h.entries()].sort((a, b) => a[0] - b[0]).map(([n, c]) => `${n} fait${n > 1 ? 's' : ''}: ${c}`).join(' · ')

console.log(`\nTOUS LES FAITS      — ${lieuxAvecFait}/${lieux.length} lieux parlent`)
console.log(`  ${ligne(histoTotal)}`)
console.log(`SOUS LA SAILLANCE   — ${lieuxAvecSaillant}/${lieux.length} lieux parlent`)
console.log(`  ${ligne(histoSaillant)}`)

console.log('\npar (type, cause) — total → saillants :')
for (const [clef, e] of [...parType.entries()].sort((a, b) => b[1].total - a[1].total)) {
  console.log(`  ${clef.padEnd(20)} ${String(e.total).padStart(4)} → ${String(e.saillants).padStart(4)}`)
}

// ── LES KINDS DE LA CARTE, et les types d'annales MORTS dans le monde joué ──
const kinds = new Map<string, number>()
for (const { z } of lieux) kinds.set(z.kind!, (kinds.get(z.kind!) ?? 0) + 1)
console.log('\nkinds de lieu présents :')
console.log('  ' + [...kinds.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}×${n}`).join(' · '))
const VOCABULAIRE = ['fondation', 'sort', 'essart', 'gravure', 'guet', 'fuite', 'fosse', 'taille', 'gue', 'croisee', 'porte']
const vus = new Set((map.annales ?? []).map((f) => f.type))
console.log(`\ntypes JAMAIS émis sur cette carte : ${VOCABULAIRE.filter((t) => !vus.has(t)).join(', ') || '(aucun)'}`)
console.log(`champ de cendre : ${map.cendre ? 'présent' : 'ABSENT'} · affleurements : ${(map as { affleurements?: unknown[] }).affleurements?.length ?? 'ABSENT'}`)

// ── LES STÈLES PARLENT-ELLES ? (`texteDeStele` rend `undefined` sans croisee/gue à portée) ──
{
  const steles = lieux.filter(({ z }) => z.kind === 'stele')
  console.log(`\nstèles posées : ${steles.length}`)
  for (const { poiId, z } of steles) {
    const sx = Math.floor(z.x + z.w / 2)
    const sy = Math.floor(z.y + z.h / 2)
    const t = texteDeStele(map, sx, sy)
    console.log(`  #${poiId} ${z.name} (${sx},${sy}) → ${t ? `${t.brisee ? 'BRISÉE ' : ''}« ${t.lignes.join(' ')} »` : 'MUETTE (aucun fait croisee/gue à portée)'}`)
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// PHASE 2 (`--joue [cycles]`) — CE QU'UN LIEU AURAIT À RACONTER, une fois le monde JOUÉ.
//
// La question que la phase 1 ne peut pas poser : `entree.lieu` n'est posé aujourd'hui que par
// `poi_first_visit` et `refugee_rumeur` — une fiche tient donc UNE ligne, à jamais. Beaucoup
// d'autres faits de chronique portent pourtant un (tx, ty). On mesure ici combien d'entre eux
// tomberaient dans un lieu, selon la RÈGLE d'appartenance qu'on choisirait :
//   R = 0   — l'empreinte stricte (ce que `lieuAt` sait faire aujourd'hui) ;
//   R = 20  — la couronne proche (« au pied du Charnier ») ;
//   R = 40  — l'écran (« près du Charnier »).
//
// ⚠ LE BANC N'A PAS DE JOUEUR : `poi_first_visit` ne peut pas y tomber. On mesure donc
// exactement les faits qui MANQUENT à la fiche, pas ceux qu'elle a déjà.
// ═══════════════════════════════════════════════════════════════════════════════════════════
if (process.argv.includes('--joue')) {
  const { construireMondeDuBanc } = await import('../packages/sim/src/scenario')
  const { drainEvents } = await import('../packages/sim/src/events')
  const { step } = await import('../packages/sim/src/sim')
  const { TICKS_PER_CYCLE } = await import('../packages/sim/src/time')
  const { CHRONICLE_EVENT_TYPES } = await import('../packages/sim/src/chronicle')

  const cycles = Number(process.argv[process.argv.indexOf('--joue') + 1]) || 12
  const { sim } = construireMondeDuBanc(seed)
  const carteJouee = sim.map
  const centres = carteJouee.zones
    .map((z, poiId) => ({ poiId, z, cx: z.x + z.w / 2, cy: z.y + z.h / 2 }))
    .filter(({ z }) => z.kind !== undefined)

  const RAYONS = [0, 20, 40]
  const capte = new Map<number, Map<string, number>>(RAYONS.map((r) => [r, new Map()]))
  const positionnes = new Map<string, number>()
  const sansPosition = new Map<string, number>()

  console.log(`\n\n═══ PHASE 2 — le monde joué ${cycles} cycles (banc, seed ${seed}) ═══`)
  for (let c = 0; c < cycles; c += 1) {
    for (let t = 0; t < TICKS_PER_CYCLE; t += 1) step(sim, [])
    for (const e of drainEvents(sim)) {
      if (!CHRONICLE_EVENT_TYPES.has(e.type)) continue
      const p = e as { tx?: number; ty?: number }
      if (p.tx === undefined || p.ty === undefined) {
        sansPosition.set(e.type, (sansPosition.get(e.type) ?? 0) + 1)
        continue
      }
      positionnes.set(e.type, (positionnes.get(e.type) ?? 0) + 1)
      for (const r of RAYONS) {
        // R = 0 : l'empreinte stricte. R > 0 : la couronne autour du CENTRE du lieu.
        const dedans = centres.some(({ z, cx, cy }) =>
          r === 0
            ? p.tx! >= z.x && p.tx! < z.x + z.w && p.ty! >= z.y && p.ty! < z.y + z.h
            : (p.tx! - cx) * (p.tx! - cx) + (p.ty! - cy) * (p.ty! - cy) <= r * r)
        if (dedans) capte.get(r)!.set(e.type, (capte.get(r)!.get(e.type) ?? 0) + 1)
      }
    }
  }

  const somme = (m: Map<string, number>): number => [...m.values()].reduce((a, b) => a + b, 0)
  console.log(`\nfaits de chronique POSITIONNÉS : ${somme(positionnes)}`)
  for (const [t, n] of [...positionnes.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${t.padEnd(22)} ${String(n).padStart(4)}  →  ` +
      RAYONS.map((r) => `R${r}: ${capte.get(r)!.get(t) ?? 0}`).join(' · '))
  }
  console.log(`\nTOTAL capté : ` + RAYONS.map((r) => `R${r} → ${somme(capte.get(r)!)}/${somme(positionnes)}`).join(' · '))
  console.log(`\nfaits de chronique SANS POSITION (aucune règle géométrique ne les attrapera) : ${somme(sansPosition)}`)
  for (const [t, n] of [...sansPosition.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${t.padEnd(22)} ${String(n).padStart(4)}`)
}
