/**
 * DIAG FUMEROLLE — combien de bouches, où, et à quelle distance l'une de l'autre.
 *
 * Le semis des fumerolles est POSITIONNEL (`fumerolle.ts` : `MAILLE` × `PART`, pas de passe de
 * worldgen) et le CŒUR de la cendre décide lesquelles sont éveillées. Deux réglages, donc, et
 * aucun des deux ne se lit dans le code : « une maille sur trois » ne dit pas combien on en
 * croise, parce que la cendre n'a pris qu'une part de la vallée et que la maille est bornée par
 * la carte. Cet instrument rend les trois nombres qui décident — le COMPTE, l'écart aux
 * VOISINES (une fumerolle doit rester un lieu), et la part de la cendre qui en porte une.
 *
 * Il joue le vrai worldgen et le vrai champ de coût.
 *
 *     node --import tsx tools/diag-fumerolle.mts [seed]
 *     node --import tsx tools/diag-fumerolle.mts 2026 --compare 40,0.5
 *         └─ rejoue la MÊME carte sous un AUTRE semis (maille, part) : le champ de coût ne
 *            dépend pas du semis, une seule génération suffit à comparer deux réglages au même
 *            endroit (mémoire `mesurer-avant-apres-sans-stash`).
 */
import { generateZonedTerrain, MONDE, MONDE_JOUE, BALANCE } from '../packages/sim/src/index'
import { CENDRE, foyersDeLaCarte, estCendre, avanceeDeCendre, auCoeurDeLaCendre } from '../packages/sim/src/cendre'
import { FUMEROLLE, toutesLesFumerolles } from '../packages/sim/src/fumerolle'
import { hash2 } from '../packages/sim/src/noise'
import { TERRAINS, TERRAIN_BURNT_FOREST } from '../packages/sim/src/balance'
import { estSolCendre } from '../packages/sim/src/cendre'

const args = process.argv.slice(2)
const seed = Number(args.find((a) => !a.startsWith('--')) ?? 2026)
const compare = args[args.indexOf('--compare') + 1]
const AUTRE = args.includes('--compare') && compare ? compare.split(',').map(Number) : null

const monde = generateZonedTerrain(seed, MONDE.JOUEURS_CIBLE, MONDE_JOUE)
const map = monde.map
const foyers = foyersDeLaCarte(map)
const REVEIL = (CENDRE.ACTE_DEPART - 1) * BALANCE.ACT_DAYS + 1

/**
 * Le semis, PARAMÉTRÉ — une COPIE de `bouchePotentielle`, maille et part libres. C'est ce qui
 * permet de balayer des réglages sans toucher au code.
 *
 * ⚠ **ET C'EST POURQUOI ELLE IGNORE LE CARACTÈRE DES FOSSES** (`cendre.md` R21, 2026-08-27) : une
 * Salée sature sa part à 1, une Gueule la divise par trois, et cette copie n'en sait rien. Les
 * comptes ci-dessous sont donc ceux du semis NU. Le vrai compte est relevé à part (« vrai chemin »
 * en fin de sortie) et par fosse dans `tools/diag-foyer-caractere.mts`.
 */
function bouche(mx: number, my: number, M: number, part: number): { tx: number; ty: number } | null {
  const sel = (seed ^ 0x46554d45) | 0
  if (hash2(mx, my, sel) >= part) return null
  const J = FUMEROLLE.JEU
  const bord = M * ((1 - J) / 2)
  const dx = Math.floor(bord + hash2(mx, my, (sel ^ 0x1111) | 0) * M * J)
  const dy = Math.floor(bord + hash2(mx, my, (sel ^ 0x2222) | 0) * M * J)
  return { tx: mx * M + dx, ty: my * M + dy }
}

function solTenable(tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return false
  const t = map.terrain[ty * map.width + tx]
  if (t === undefined) return false
  return TERRAINS[t]?.walkable === true || t === TERRAIN_BURNT_FOREST || estSolCendre(t)
}

function bouches(M: number, part: number, av: readonly number[]): { tx: number; ty: number }[] {
  const out: { tx: number; ty: number }[] = []
  for (let my = 0; my <= Math.floor((map.height - 1) / M); my++) {
    for (let mx = 0; mx <= Math.floor((map.width - 1) / M); mx++) {
      const b = bouche(mx, my, M, part)
      if (!b || b.tx >= map.width || b.ty >= map.height) continue
      if (!solTenable(b.tx, b.ty)) continue
      if (!auCoeurDeLaCendre(map, b.tx, b.ty, av, seed)) continue
      out.push(b)
    }
  }
  return out
}

/** Les tuiles de CENDRE, échantillonnées — le dénominateur : une fumerolle pour combien ? */
function tuilesDeCendre(av: readonly number[]): number {
  let n = 0
  for (let ty = 0; ty < map.height; ty += 2) {
    for (let tx = 0; tx < map.width; tx += 2) if (estCendre(map, tx, ty, av, seed)) n += 1
  }
  return n * 4
}

function releve(M: number, part: number, nom: string): void {
  console.log(`\n═══ ${nom} — maille ${M} · part ${part} · ${foyers.length} foyers ═══`)
  console.log('  jour   bouches   par foyer   voisine min   voisine méd   cendre(tuiles)   1 pour')
  for (const j of [120, 240, 360, 600, 840, 1200]) {
    const av = foyers.map(() => avanceeDeCendre(Math.max(0, j - REVEIL)))
    const bs = bouches(M, part, av)
    const cendre = tuilesDeCendre(av)
    const ecarts: number[] = []
    for (const a of bs) {
      let d = Infinity
      for (const b of bs) {
        if (a === b) continue
        const e = Math.sqrt((a.tx - b.tx) ** 2 + (a.ty - b.ty) ** 2)
        if (e < d) d = e
      }
      if (d < Infinity) ecarts.push(d)
    }
    ecarts.sort((x, y) => x - y)
    const min = ecarts[0]
    const med = ecarts[Math.floor(ecarts.length / 2)]
    console.log(
      `  ${String(j).padStart(4)}   ${String(bs.length).padStart(7)}   ${(bs.length / foyers.length).toFixed(2).padStart(9)}` +
        `   ${(min ?? NaN).toFixed(0).padStart(11)}   ${(med ?? NaN).toFixed(0).padStart(11)}` +
        `   ${String(cendre).padStart(14)}   ${bs.length ? Math.round(cendre / bs.length) : 0} tuiles`,
    )
  }
}

console.log(`carte ${map.width}×${map.height} · seed ${seed} · réveil de la cendre : jour ${REVEIL}`)
console.log(`(un écran fait ~36 tuiles de large — une « voisine » sous 36 met deux bouches au même cadre)`)
releve(FUMEROLLE.MAILLE, FUMEROLLE.PART, 'SEMIS COURANT (NU — sans le caractère des fosses)')

// LE VRAI CHEMIN — `toutesLesFumerolles`, caractères compris. L'écart avec la ligne ci-dessus EST
// l'effet des cadrans `fumerolles` de R21 ; s'il est nul, ils ne mordent pas.
console.log('\n═══ LE VRAI CHEMIN (toutesLesFumerolles — caractères compris) ═══')
console.log('  jour   bouches   écart au semis nu')
for (const j of [120, 240, 360, 600, 840, 1200]) {
  const av = foyers.map(() => avanceeDeCendre(Math.max(0, j - REVEIL)))
  const n = toutesLesFumerolles(map, av, seed).length
  const nu = bouches(FUMEROLLE.MAILLE, FUMEROLLE.PART, av).length
  console.log(`  ${String(j).padStart(4)}   ${String(n).padStart(7)}   ${(n - nu >= 0 ? '+' : '') + String(n - nu)}`)
}
if (AUTRE) releve(AUTRE[0]!, AUTRE[1]!, 'COMPARAISON')
