/**
 * LES PAVÉS — gardes du module pur (spec `sol-dessine.md` R9-R10).
 *
 * Tout se vérifie sur un petit monde bâti à la main : deux terrains, un bord, de l'eau. La
 * propriété affirmée à chaque fois est UNE propriété de l'image cuite — jamais un pixel choisi.
 */
import { describe, expect, it } from 'vitest'
import { COTE_E, COTE_N, COTE_O, COTE_S, LAPIAZ, soleilDuPavement, PAVE, PAVE_COTE, PAVE_COTE_BAVE, PAVE_PX, PRIORITE_PAVE, SURFACES, cuireChunk, engrenageGagne, estEau, mouchetureIci, estStructurel, estSurface, frange, prioriteDe } from './paves'
import { TERRAIN_BOULDERS, TERRAINS } from '@ashes/sim'

const N = PAVE.CHUNK
const S = N * PAVE_PX

/** Un chunk (0,0) dont le terrain est donné par une fonction ; couleur unie, grain plat. Le SOL. */
function cuire(terrainAt: (tx: number, ty: number) => number, couleur = 0x808080): Uint8ClampedArray {
  return cuireChunk({ seed: 0, soleil: soleilDuPavement(0), cx: 0, cy: 0, terrainAt, couleurAt: () => couleur, trameDe: () => null }).sol
}
/** Le pixel (x, y) DU CHUNK — le tampon, lui, porte le débord (`PAVE.BAVE`) tout autour, donc
 *  ses coordonnées sont décalées d'autant. Toutes les gardes se lisent en coordonnées de chunk :
 *  le débord est une affaire de pose, pas de contenu. */
const px = (img: Uint8ClampedArray, x: number, y: number): [number, number, number, number] => {
  const o = ((y + PAVE.BAVE) * PAVE_COTE_BAVE + (x + PAVE.BAVE)) * 4
  return [img[o]!, img[o + 1]!, img[o + 2]!, img[o + 3]!]
}

describe('l’ordre de recouvrement', () => {
  it('un structurel vaut −1, l’eau et un terrain inconnu 0, les autres leur rang', () => {
    for (const t of [0, 7, 23]) {
      expect(estStructurel(t)).toBe(true)
      expect(prioriteDe(t)).toBe(-1)
    }
    for (const t of [4, 6]) {
      expect(estEau(t)).toBe(true)
      expect(estStructurel(t)).toBe(false)
      expect(prioriteDe(t)).toBe(0) // l'eau cède à toute terre, et ne recouvre rien
    }
    expect(prioriteDe(99)).toBe(0)
    expect(prioriteDe(17)).toBe(PRIORITE_PAVE[17])
    // LE MARAIS EST UNE SURFACE : au-dessus de l'eau, sous TOUTE terre — aucune égalité possible
    // (une égalité est une couture nue : c'était le défaut marais / prairie humide).
    for (const t of [8, 18]) {
      expect(estSurface(t)).toBe(true)
      expect(prioriteDe(t)).toBeGreaterThan(prioriteDe(4))
    }
    // LES RANGS SE COMPARENT PAR COUCHE. La carte (terrains < 100) et le manteau (terrains
    // virtuels ≥ 100, `render/manteau.ts`) ne se cuisent JAMAIS ensemble : comparer au travers
    // ferait rougir la crue contre la sente, qui ne se rencontrent nulle part.
    const plafondDeCouche = (virtuel: boolean): number =>
      Math.max(...Object.keys(SURFACES).map(Number).filter((t) => t >= 100 === virtuel).map((t) => SURFACES[t]!))
    for (const [t, rang] of Object.entries(PRIORITE_PAVE)) {
      expect(estSurface(Number(t))).toBe(false)
      expect(rang, `la terre ${t} domine toute surface de sa couche`).toBeGreaterThan(plafondDeCouche(Number(t) >= 100))
    }
    expect(prioriteDe(19)).toBeGreaterThan(prioriteDe(8)) // roselière sur marais
    expect(prioriteDe(25)).toBeGreaterThan(prioriteDe(19)) // prairie humide sur roselière (A11)
    // La fleuraie recouvre l'herbe, qui recouvre la litière, qui recouvre la roche.
    expect(prioriteDe(17)).toBeGreaterThan(prioriteDe(1))
    expect(prioriteDe(1)).toBeGreaterThan(prioriteDe(3))
    expect(prioriteDe(3)).toBeGreaterThan(prioriteDe(5))
  })

  it('la frange est bornée, irrégulière et déterministe', () => {
    const vus = new Set<number>()
    for (let i = 0; i < 200; i++) {
      const d = frange(i, i * 7, i % 4, i % 4)
      expect(d).toBeGreaterThanOrEqual(PAVE.FRANGE_MIN)
      expect(d).toBeLessThanOrEqual(PAVE.FRANGE_MAX)
      vus.add(d)
      expect(frange(i, i * 7, i % 4, i % 4)).toBe(d)
    }
    expect(vus.size).toBe(PAVE.FRANGE_MAX - PAVE.FRANGE_MIN + 1)
  })
})

describe('la cuisson d’un chunk', () => {
  it('un chunk d’un seul terrain est opaque, de la couleur donnée, avec ses seuls brins', () => {
    const img = cuire(() => 1, 0x406080)
    let plats = 0
    let transparents = 0
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const [r, g, b, a] = px(img, x, y)
        if (a !== 255) transparents++
        if (r === 0x40 && g === 0x60 && b === 0x80) plats++
      }
    }
    expect(transparents).toBe(0)
    // Deux brins de 3 px par tuile : au plus 6 × N² pixels marqués, le reste à plat.
    expect(plats).toBeGreaterThanOrEqual(S * S - 6 * N * N)
    expect(plats).toBeLessThan(S * S) // et il y a bien des brins
  })

  /**
   * LA MARQUE SUIT LA MATIÈRE (Alexis, 2026-08-28 : « les biomes cendre ou shallow_water
   * n'ont pas d'herbes ») — table `MARQUES` de `paves.ts`. Ce qui ferait rougir : le brin
   * unique de retour partout (la neige marquée, la cendre avec du clair qui dépasse).
   */
  it('la marque suit la matière : la neige est lisse, la cendre n’a que du charbon, l’éboulis a ses cailloux', () => {
    const compte = (terrain: number): { clairs: number; sombres: number } => {
      const img = cuire(() => terrain, 0x808080)
      let clairs = 0
      let sombres = 0
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          const [r] = px(img, x, y)
          if (r! > 0x80) clairs++
          else if (r! < 0x80) sombres++
        }
      }
      return { clairs, sombres }
    }
    // La neige (famille `neige`) : AUCUNE marque — une congère est lisse et balayée.
    const neige = compte(10)
    expect(neige.clairs + neige.sombres, 'la neige est lisse').toBe(0)
    // La cendre : du sombre seul — rien de clair ne dépasse d'une poussière.
    const cendre = compte(27)
    expect(cendre.clairs, 'rien de clair sur la cendre').toBe(0)
    expect(cendre.sombres, 'les charbons existent').toBeGreaterThan(0)
    // L'éboulis (famille `mineral`) : le caillou — du clair ET du sombre.
    const scree = compte(9)
    expect(scree.clairs, 'le dessus clair du caillou').toBeGreaterThan(0)
    expect(scree.sombres, 'l’ombre du caillou').toBeGreaterThan(0)
    // L'herbe garde son brin — clair et sombre aussi (le test d'au-dessus le couvre déjà en
    // budget ; ici on affirme que la différenciation n'a pas éteint le brin).
    const herbe = compte(1)
    expect(herbe.clairs, 'le brin clair de l’herbe').toBeGreaterThan(0)
    expect(herbe.sombres, 'le pied sombre du brin').toBeGreaterThan(0)
  })

  it('LE DÉBORD (PAVE.BAVE) — l’image dépasse d’un pixel, et ce pixel est CELUI DU VOISIN', () => {
    // La couture d'un pixel qu'Alexis voyait venait du bord de deux images qui se TOUCHENT à un
    // demi-pixel d'écran. Le débord les fait se RECOUVRIR — mais il ne vaut que si le pixel
    // déborde à l'identique de ce que le voisin y peint : sinon on aurait échangé un trait
    // sombre contre un décalage d'un pixel, ce qui est pire (mesuré une fois, jamais deux).
    const terrainAt = (tx: number, ty: number): number => ((tx * 7 + ty * 13) % 5 === 0 ? 17 : (tx + ty) % 3 === 0 ? 1 : 3)
    const monde = { terrainAt, couleurAt: (tx: number, ty: number) => 0x406080 + ((tx * 3 + ty) % 7), trameDe: () => null }
    const a = cuireChunk({ seed: 0, soleil: soleilDuPavement(0), cx: 0, cy: 0, ...monde }).sol
    const b = cuireChunk({ seed: 0, soleil: soleilDuPavement(0), cx: 1, cy: 0, ...monde }).sol
    expect(a.length).toBe(PAVE_COTE_BAVE * PAVE_COTE_BAVE * 4)
    // La colonne DÉBORDÉE de A (x = S, hors de son chunk) est la colonne 0 du chunk B.
    let compares = 0
    for (let y = 0; y < S; y++) {
      for (let d = 0; d < PAVE.BAVE; d++) {
        expect(px(a, PAVE_COTE + d, y), `débord droit de A en y=${y}`).toEqual(px(b, d, y))
        expect(px(b, -1 - d, y), `débord gauche de B en y=${y}`).toEqual(px(a, PAVE_COTE - 1 - d, y))
        compares += 2
      }
    }
    expect(compares).toBe(2 * S * PAVE.BAVE)
  })

  it('R10 — la falaise reste transparente dans le sol, et aucune frange ne déborde dessus', () => {
    // Moitié gauche herbe, moitié droite falaise.
    const cuit = cuireChunk({ seed: 0, soleil: soleilDuPavement(0), cx: 0, cy: 0, terrainAt: (tx) => (tx < N / 2 ? 1 : 23), couleurAt: () => 0x808080, trameDe: () => null })
    const img = cuit.sol
    let falaiseOpaque = 0
    let herbeTransparente = 0
    for (let y = 0; y < S; y++) {
      for (let x = (N / 2) * PAVE_PX; x < S; x++) if (px(img, x, y)[3] !== 0) falaiseOpaque++
      // Et l'herbe, elle, est opaque jusqu'à son bord.
      if (px(img, (N / 2) * PAVE_PX - 1, y)[3] !== 255) herbeTransparente++
    }
    expect(falaiseOpaque).toBe(0)
    expect(herbeTransparente).toBe(0)
    expect(cuit.surplomb).toBeNull() // pas d'eau : pas de surplomb
  })

  it('LA BERGE — la terre déborde sur l’eau dans le SURPLOMB, l’eau nue reste au shader', () => {
    // Haut : herbe. Bas : eau peu profonde. Bord à y = S/2.
    const bord = (N / 2) * PAVE_PX
    const cuit = cuireChunk({ seed: 0, soleil: soleilDuPavement(0), cx: 0, cy: 0, terrainAt: (_tx, ty) => (ty < N / 2 ? 1 : 4), couleurAt: () => 0x808080, trameDe: () => null })
    const sur = cuit.surplomb
    expect(sur).not.toBeNull()
    // Dans le SOL, l'eau est transparente partout (la frange n'y est pas : elle passe au-dessus du shader).
    let solSurEau = 0
    for (let y = bord; y < S; y++) for (let x = 0; x < S; x++) if (px(cuit.sol, x, y)[3] !== 0) solSurEau++
    expect(solSurEau).toBe(0)
    // Dans le SURPLOMB : rien sur la terre ; sur l'eau, une frange OPAQUE de 2-5 px (gris 0x80 ×
    // liseré/plat, donc un pixel GRIS, pas un voile), puis un voile d'ombre (noir, alpha < 255),
    // puis à 4 px le ressac (blanc, alpha < 255), puis plus rien.
    let surTerre = 0
    for (let y = 0; y < bord; y++) for (let x = 0; x < S; x++) if (px(sur!, x, y)[3] !== 0) surTerre++
    expect(surTerre).toBe(0)
    let frangeMin = 99, frangeMax = 0, ombres = 0, ressacs = 0, nus = 0
    for (let x = 0; x < S; x++) {
      let d = 0
      while (d < 8 && px(sur!, x, bord + d)[3] === 255) d++
      frangeMin = Math.min(frangeMin, d)
      frangeMax = Math.max(frangeMax, d)
      // Sous la frange : ombre (noir translucide) sur 3 px, ressac (blanc translucide) au 4e.
      const [r1, , , a1] = px(sur!, x, bord + d)
      if (a1 > 0 && a1 < 255 && r1 === 0) ombres++
      const [r4, , , a4] = px(sur!, x, bord + d + 3)
      if (a4 > 0 && a4 < 255 && r4 === 255) ressacs++
      if (px(sur!, x, bord + d + 6)[3] === 0) nus++
    }
    expect(frangeMin).toBeGreaterThanOrEqual(PAVE.FRANGE_MIN)
    expect(frangeMax).toBeLessThanOrEqual(PAVE.FRANGE_MAX)
    expect(ombres).toBe(S)
    expect(ressacs).toBe(S)
    expect(nus).toBe(S)
  })

  it('LE HAUT-FOND RESTE UNE SURFACE — rien ne déborde entre haut-fond et profond', () => {
    const cuit = cuireChunk({ seed: 0, soleil: soleilDuPavement(0), cx: 0, cy: 0, terrainAt: (_tx, ty) => (ty < N / 2 ? 4 : 6), couleurAt: () => 0x808080, trameDe: () => null })
    let marques = 0
    for (let i = 3; i < cuit.sol.length; i += 4) if (cuit.sol[i] !== 0) marques++
    if (cuit.surplomb) for (let i = 3; i < cuit.surplomb.length; i += 4) if (cuit.surplomb[i] !== 0) marques++
    expect(marques).toBe(0)
  })

  it('LE MARAIS EST UNE SURFACE — la prairie humide y est une berge : liseré, ombre, ressac ; le marais nu est plat', () => {
    // Haut : prairie humide. Bas : marais. Bord à y = S/2. Tout dans le SOL (le marais n'est pas
    // de l'eau : pas de surplomb).
    const bord = (N / 2) * PAVE_PX
    const cuit = cuireChunk({ seed: 0, soleil: soleilDuPavement(0), cx: 0, cy: 0, terrainAt: (_tx, ty) => (ty < N / 2 ? 25 : 8), couleurAt: () => 0x808080, trameDe: () => null })
    expect(cuit.surplomb).toBeNull()
    const img = cuit.sol
    const lum = (y: number): number => {
      let s = 0
      for (let x = 0; x < S; x++) s += px(img, x, y)[0]!
      return s / S
    }
    // Colonne par colonne : la frange (plat ou liseré), puis l'ombre (×0,72), la pénombre, puis
    // le ressac (×1,22 — PLUS CLAIR que le plat) au 4e px sous le bord bas, puis le plat.
    let ombres = 0, ressacs = 0
    for (let x = 0; x < S; x++) {
      let d = 0
      while (d < PAVE.FRANGE_MAX + 1 && px(img, x, bord + d)[0]! <= 0x80 * 0.6) d++ // le liseré, s'il tombe ici
      // Cherche dans les 8 px sous le bord : une ombre puis, plus bas, un pixel plus clair que 0x80.
      let ombreVue = false
      for (let y = bord; y < bord + 10; y++) {
        const r = px(img, x, y)[0]!
        if (r > 0 && r < 0x80 * 0.8) ombreVue = true
        else if (ombreVue && r > 0x80 * 1.1) { ressacs++; break }
      }
      if (ombreVue) ombres++
    }
    expect(ombres).toBe(S)
    expect(ressacs).toBe(S)
    // Le marais nu, loin du bord : plat, SANS brin — une surface n'a pas de brin.
    let marques = 0
    for (let y = bord + 16; y < S; y++) for (let x = 0; x < S; x++) if (px(img, x, y)[0] !== 0x80) marques++
    expect(marques).toBe(0)
    // La prairie humide, elle, porte ses brins.
    expect(lum(bord - 24)).not.toBe(0x80)
  })

  it('LE MARAIS EST UNE SURFACE — sur l’eau, il déborde d’une frange seule : ni liseré, ni ombre, ni ressac', () => {
    // Haut : marais. Bas : eau peu profonde. Bord à y = S/2.
    const bord = (N / 2) * PAVE_PX
    const cuit = cuireChunk({ seed: 0, soleil: soleilDuPavement(0), cx: 0, cy: 0, terrainAt: (_tx, ty) => (ty < N / 2 ? 8 : 4), couleurAt: () => 0x808080, trameDe: () => null })
    const sur = cuit.surplomb
    expect(sur).not.toBeNull()
    // Dans le sol, le marais est plat partout jusqu'au bord : aucun liseré (×0,55) sur sa dernière ligne.
    let liseres = 0
    for (let y = 0; y < bord; y++) for (let x = 0; x < S; x++) if (px(cuit.sol, x, y)[0]! < 0x80 * 0.9) liseres++
    expect(liseres).toBe(0)
    // Dans le surplomb : une frange OPAQUE de 2-5 px de marais, puis RIEN — pas de voile d'ombre,
    // pas de ressac (une surface ne porte pas d'ombre).
    let frangeMin = 99, frangeMax = 0, voiles = 0
    for (let x = 0; x < S; x++) {
      let d = 0
      while (d < 8 && px(sur!, x, bord + d)[3] === 255) d++
      frangeMin = Math.min(frangeMin, d)
      frangeMax = Math.max(frangeMax, d)
      for (let y = bord + d; y < bord + d + 8; y++) if (px(sur!, x, y)[3] !== 0) voiles++
    }
    expect(frangeMin).toBeGreaterThanOrEqual(PAVE.FRANGE_MIN)
    expect(frangeMax).toBeLessThanOrEqual(PAVE.FRANGE_MAX)
    expect(voiles).toBe(0)
  })

  it('R9 — le pavé du dessus déborde sur le dessous d’une frange de 2 à 5 px, jamais l’inverse', () => {
    // Gauche : fleuraie (dessus). Droite : herbe (dessous). Bord à x = S/2.
    const bord = (N / 2) * PAVE_PX
    const FLEUR = 0xff0000, HERBE = 0x00ff00
    const img = cuireChunk({ seed: 0, soleil: soleilDuPavement(0),
      cx: 0, cy: 0,
      terrainAt: (tx) => (tx < N / 2 ? 17 : 1),
      couleurAt: (tx) => (tx < N / 2 ? FLEUR : HERBE),
      trameDe: () => null,
    }).sol
    const rouge = (x: number, y: number): boolean => { const [r, g] = px(img, x, y); return r > g }
    let debordMin = 99, debordMax = 0
    let herbeSurFleuraie = 0
    for (let y = 0; y < S; y++) {
      // De ce côté-ci du bord, tout est fleuraie (rien ne déborde sur elle).
      for (let x = 0; x < bord; x++) if (!rouge(x, y)) herbeSurFleuraie++
      // De l'autre, la fleuraie avance de d px puis l'herbe reprend.
      let d = 0
      while (d < 8 && rouge(bord + d, y)) d++
      debordMin = Math.min(debordMin, d)
      debordMax = Math.max(debordMax, d)
      expect(rouge(bord + d, y)).toBe(false)
    }
    expect(herbeSurFleuraie).toBe(0)
    expect(debordMin).toBeGreaterThanOrEqual(PAVE.FRANGE_MIN)
    expect(debordMax).toBeLessThanOrEqual(PAVE.FRANGE_MAX)
    expect(debordMax).toBeGreaterThan(debordMin) // irrégulière : plusieurs profondeurs sur un bord
  })

  it('R9 — le bord bas d’un pavé porte un liseré sombre, et le terrain dessous une ombre', () => {
    // Haut : fleuraie (dessus). Bas : herbe. Bord horizontal à y = S/2.
    const bord = (N / 2) * PAVE_PX
    const img = cuire((_tx, ty) => (ty < N / 2 ? 17 : 1), 0x808080)
    // Ligne par ligne, la luminance moyenne : le liseré (×0,55) sur la dernière ligne du pavé
    // (frange comprise, donc entre bord et bord+5), puis l'ombre (×0,72) dessous, puis le plat.
    const lum = (y: number): number => {
      let s = 0
      for (let x = 0; x < S; x++) s += px(img, x, y)[0]!
      return s / S
    }
    const plat = lum(bord - 10)
    expect(plat).toBeGreaterThan(0x80 * 0.95) // loin des bords : à plat (brins mis à part)
    let sombreVu = false
    for (let y = bord; y < bord + PAVE.FRANGE_MAX + 1; y++) if (lum(y) < plat * 0.8) sombreVu = true
    expect(sombreVu, 'un liseré/une ombre sous le bord bas').toBe(true)
    expect(lum(bord + 12)).toBeGreaterThan(plat * 0.95) // douze px plus bas : le plat a repris
  })

  it('la cuisson est déterministe et indifférente au chunk voisin (pas de couture)', () => {
    // Un monde en damier de 8 tuiles ; le chunk (1,0) recuit → identique.
    const monde = (tx: number, ty: number): number => ((Math.floor(tx / 8) + Math.floor(ty / 8)) % 2 ? 17 : 1)
    const a = cuireChunk({ seed: 0, soleil: soleilDuPavement(0), cx: 1, cy: 0, terrainAt: monde, couleurAt: () => 0x808080, trameDe: () => null }).sol
    const b = cuireChunk({ seed: 0, soleil: soleilDuPavement(0), cx: 1, cy: 0, terrainAt: monde, couleurAt: () => 0x808080, trameDe: () => null }).sol
    let diff = 0
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++
    expect(diff).toBe(0)
  })
})

/**
 * ═══ LA MOUCHETURE DES BUTTES (spec `t0-exploration.md` §2sexies, R54) ═══
 *
 * *(Décision d'Alexis, 2026-08-27, sur planche : « 4 » — le gravier en croûte.)*
 *
 * Le second ton d'une butte se tirait PAR TUILE : écrit quand le sol se cuisait à 1 px/tuile, il
 * peignait depuis les pavés des carrés de 16 px. Il se sème maintenant à la cellule de 4 px. La
 * garde tient en une phrase : **la maille est celle du grain, jamais celle de la tuile** — et la
 * seconde moitié est celle qui aurait manqué, car un tirage par tuile passe le test de la part.
 */
describe('la moucheture des buttes', () => {
  const D = 0.38

  it('R54 — la maille est la CELLULE DE 4 px : uniforme dans la cellule, jamais dans la tuile', () => {
    // ① Dans une cellule de 4 px, les seize pixels disent la même chose.
    for (let cy = 0; cy < 24; cy++) {
      for (let cx = 0; cx < 24; cx++) {
        const attendu = mouchetureIci(cx * 4, cy * 4, D, 2026)
        for (let u = 0; u < 4; u++) {
          for (let v = 0; v < 4; v++) {
            expect(mouchetureIci(cx * 4 + u, cy * 4 + v, D, 2026), `cellule ${cx},${cy}`).toBe(attendu)
          }
        }
      }
    }
    // ② ⚠ ET LA TUILE N'EST PAS UNE UNITÉ — c'est exactement ce qui manquait : la plupart des
    //    tuiles portent les DEUX tons. Un tirage par tuile rendrait ce compte nul.
    let melangees = 0
    for (let ty = 0; ty < 16; ty++) {
      for (let tx = 0; tx < 16; tx++) {
        const vus = new Set<boolean>()
        for (let u = 0; u < PAVE_PX; u += 4) for (let v = 0; v < PAVE_PX; v += 4) {
          vus.add(mouchetureIci(tx * PAVE_PX + u, ty * PAVE_PX + v, D, 2026))
        }
        if (vus.size === 2) melangees++
      }
    }
    expect(melangees, 'tuiles portant les deux tons').toBeGreaterThan(0.6 * 16 * 16)
  })

  it('la part tirée suit la DENSITÉ demandée, et le champ d’amas la rassemble', () => {
    const part = (d: number): number => {
      let n = 0
      let tot = 0
      for (let y = 0; y < 512; y += 4) for (let x = 0; x < 512; x += 4) { tot++; if (mouchetureIci(x, y, d, 2026)) n++ }
      return n / tot
    }
    expect(part(0)).toBe(0) // une pente nulle ne tache rien
    expect(part(D)).toBeGreaterThan(D * 0.6)
    expect(part(D)).toBeLessThan(D * 1.4)
    expect(part(2 * D), 'deux fois plus dense en tache deux fois plus').toBeGreaterThan(part(D) * 1.6)
    // L’AMAS : les cellules prises se touchent plus qu’un tirage indépendant ne le ferait.
    let prises = 0
    let voisines = 0
    for (let y = 4; y < 400; y += 4) for (let x = 4; x < 400; x += 4) {
      if (!mouchetureIci(x, y, D, 2026)) continue
      prises++
      if (mouchetureIci(x - 4, y, D, 2026)) voisines++
    }
    // L'écart attendu est modeste et il se CALCULE : la conditionnelle vaut E[p²]/E[p], soit la
    // part × (1 + CV²) — quelques pour cent. Sans le champ d'amas, il vaudrait exactement 1.
    expect(voisines / prises, 'part de voisines prises').toBeGreaterThan(part(D) * 1.03)
  })

  it('le second ton ARRIVE dans l’image, et lui seul est semé', () => {
    const FOND = 0x808080, TACHE = 0x204060
    const img = cuireChunk({
      seed: 2026, soleil: soleilDuPavement(0), cx: 0, cy: 0,
      terrainAt: () => 9, couleurAt: () => FOND, trameDe: () => null,
      moucheture: () => ({ tache: TACHE, densite: D }),
    }).sol
    let tache = 0
    let autre = 0
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const [r, g, b] = px(img, x, y)
      const bleu = b! > r! + 20
      if (bleu) tache++
      else if (r! !== g! || g! !== b!) autre++ // ni le fond gris (ou son brin), ni la tache
    }
    expect(autre, 'aucune troisième teinte').toBe(0)
    expect(tache / (S * S)).toBeGreaterThan(D * 0.5)
    expect(tache / (S * S)).toBeLessThan(D * 1.5)
  })
})

/**
 * ═══ L'ENGRENAGE — LES BORDS DE MÊME RANG (spec `sol-dessine.md` R25) ═══
 *
 * *(Décision d'Alexis, 2026-08-27 : « go engrenage ».)*
 *
 * Entre deux terrains de même rang, personne ne dominait : pas une frange, et le bord restait
 * l'arête de tuile — 40,6 % des bords terre-terre de la vallée (MESURÉ, graine 2026). Les gardes
 * ci-dessous affirment les trois moitiés de la règle : la denture s'imbrique DES DEUX CÔTÉS, elle
 * n'invente AUCUNE épaisseur (R15), et elle laisse droit ce que R22 veut droit.
 *
 * Rangs en présence : éboulis 9, chaos de blocs 16 et roche 5 sont au rang 3 ; marais 8 et
 * tourbière 18 sont deux SURFACES au rang 1 ; fleuraie 17 (rang 9) domine l'herbe 1 (rang 7).
 */
describe('l’engrenage — les bords de MÊME RANG', () => {
  /** La colonne où le rouge cède au vert, sur la ligne `y` — cherchée autour du bord de tuile. */
  const couture = (img: Uint8ClampedArray, y: number, bord: number): number => {
    let x = bord - PAVE.FRANGE_MAX - 2
    while (x < bord + PAVE.FRANGE_MAX + 2) {
      const [r, g] = px(img, x, y)
      if (r! <= g!) return x
      x++
    }
    return x
  }
  /** Deux terrains côte à côte, bord vertical au milieu du chunk. Gauche ROUGE, droite VERT. */
  const cote = (gauche: number, droite: number): Uint8ClampedArray => cuireChunk({
    seed: 0, soleil: soleilDuPavement(0), cx: 0, cy: 0,
    terrainAt: (tx) => (tx < N / 2 ? gauche : droite),
    couleurAt: (tx) => (tx < N / 2 ? 0xff0000 : 0x00ff00),
    trameDe: () => null,
  }).sol

  it('R25 — deux terrains de même rang S’IMBRIQUENT : aucune ligne ne tombe sur l’arête de tuile', () => {
    const bord = (N / 2) * PAVE_PX
    const img = cote(9, 16) // éboulis | chaos de blocs — la paire qu’Alexis a citée
    let versLaDroite = 0
    let versLaGauche = 0
    for (let y = 0; y < S; y++) {
      const d = couture(img, y, bord) - bord
      // ⚠ LE CŒUR DE LA RÈGLE : la couture ne passe JAMAIS par l’arête (d ≠ 0), et son écart
      // reste celui d’une frange — c’est ce que la mesure de R20, à l’échelle de la tuile, ne
      // pouvait pas voir.
      expect(Math.abs(d), `ligne y=${y} : la couture est à ${d} px de l’arête`)
        .toBeGreaterThanOrEqual(PAVE.FRANGE_MIN)
      expect(Math.abs(d)).toBeLessThanOrEqual(PAVE.FRANGE_MAX)
      if (d > 0) versLaDroite++
      else versLaGauche++
    }
    // RÉCIPROQUE : les deux mordent. Un départage (un seul vainqueur) mettrait l’un des deux à 0.
    expect(versLaDroite, 'l’éboulis mord sur le chaos').toBeGreaterThan(S / 5)
    expect(versLaGauche, 'le chaos mord sur l’éboulis').toBeGreaterThan(S / 5)
  })

  it('R25/R15 — la frange est SEULE : ni liseré, ni ombre, là où un rang qui domine en pose', () => {
    // Bord HORIZONTAL : c’est lui qui porte le liseré (bord bas) et l’ombre portée.
    const gris = (haut: number, bas: number): Uint8ClampedArray =>
      cuire((_tx, ty) => (ty < N / 2 ? haut : bas), 0x808080)
    // Le plus sombre qu’un pavé sans épaisseur puisse produire, c’est son BRIN (×0,8).
    const plancher = 0x80 * PAVE.BRIN_SOMBRE - 1
    const sousLePlancher = (img: Uint8ClampedArray): number => {
      let n = 0
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (px(img, x, y)[0]! < plancher) n++
      return n
    }
    // ⚠ CE QUI FERAIT ROUGIR LA SONDE : la même mesure sur un bord qui DOMINE (fleuraie sur
    // herbe) doit trouver du sombre — sinon le test passerait au vert sans rien regarder.
    expect(sousLePlancher(gris(17, 1)), 'un rang qui domine POSE bien un liseré').toBeGreaterThan(0)
    expect(sousLePlancher(gris(13, 14)), 'pins | mélèzes : aucune épaisseur inventée').toBe(0)
    // ⚠ PAS éboulis | chaos ICI : le chaos de blocs porte ses FISSURES (R18-R19), qui creusent
    // sa propre dalle bien sous ce plancher — la sonde y mesurerait le lapiaz, pas un liseré.
    expect(sousLePlancher(gris(1, 11)), 'herbe | lande : aucune épaisseur inventée').toBe(0)
  })

  it('R22 — la ROCHE reste droite : elle partage le rang 3, mais elle EST une hauteur', () => {
    const bord = (N / 2) * PAVE_PX
    for (const [g, d] of [[5, 9], [16, 5]] as const) {
      const img = cote(g, d)
      for (let y = 0; y < S; y++) {
        expect(couture(img, y, bord), `roche ${g}|${d}, ligne y=${y}`).toBe(bord)
      }
    }
  })

  it('R15 — deux SURFACES à égalité ne s’engrènent pas : la vase ne mange pas la rive', () => {
    const bord = (N / 2) * PAVE_PX
    const img = cote(8, 18) // marais | tourbière — rang 1 toutes les deux, et c’est VOULU
    for (let y = 0; y < S; y++) expect(couture(img, y, bord), `ligne y=${y}`).toBe(bord)
  })

  it('est POSITIONNEL : la dent ne dépend ni du chunk ni de l’ordre de balayage', () => {
    // Un monde de même rang partout (éboulis / chaos), en taches à la tuile : chaque tuile a des
    // voisines de même rang des quatre côtés, donc les dents se disputent les coins.
    const monde = {
      terrainAt: (tx: number, ty: number) => ((tx * 5 + ty * 11) % 3 === 0 ? 9 : 16),
      couleurAt: (tx: number, ty: number) => 0x406080 + ((tx * 3 + ty) % 7),
      trameDe: () => null,
    }
    const a = cuireChunk({ seed: 0, soleil: soleilDuPavement(0), cx: 0, cy: 0, ...monde }).sol
    const b = cuireChunk({ seed: 0, soleil: soleilDuPavement(0), cx: 1, cy: 0, ...monde }).sol
    let compares = 0
    for (let y = 0; y < S; y++) {
      for (let d = 0; d < PAVE.BAVE; d++) {
        expect(px(a, PAVE_COTE + d, y), `débord droit de A en y=${y}`).toEqual(px(b, d, y))
        compares++
      }
    }
    expect(compares).toBe(S * PAVE.BAVE)
  })

  it('le tirage appartient à la COUTURE, pas à la tuile — les deux voisines lisent le même', () => {
    // La garde du point triple : pour un même bloc de couture, le côté qui gagne vu de l’ouest
    // est exactement celui qui perd vu de l’est. Sinon les deux dents mordraient au même endroit.
    let vus = 0
    for (let gx = 0; gx < 12; gx++) for (let gy = 0; gy < 12; gy++) for (let c = 0; c < 4; c++) {
      expect(engrenageGagne(gx, gy, COTE_E, c, 9, 16))
        .toBe(!engrenageGagne(gx + 1, gy, COTE_O, c, 16, 9))
      expect(engrenageGagne(gx, gy, COTE_S, c, 13, 14))
        .toBe(!engrenageGagne(gx, gy + 1, COTE_N, c, 14, 13))
      vus += 2
    }
    expect(vus).toBe(12 * 12 * 4 * 2)
  })
})

/**
 * LA GARDE EXHAUSTIVE DU PAVAGE — elle MANQUAIT, et elle a laissé passer un trou (2026-08-25).
 *
 * `PRIORITE_PAVE` est une table par terrain, tenue à la main. Un terrain neuf qu'on y oublie ne
 * fait rougir personne : `prioriteDe` retombe sur un défaut, et la tuile perd sa frange, son
 * liseré et son ombre portée — elle se pose au ras du sol voisin, sans bord dessiné. C'est
 * exactement l'image d'une découpe brute, or la clairière a été faite pour ne PAS en être une.
 *
 * On demande donc la liste au registre de `/sim`, qui est l'autorité, au lieu de choisir des cas.
 */
describe('le pavage couvre tout ce que la sim déclare', () => {
  it('chaque terrain de la sim a un rang de pavé, une surface, ou est structurel', () => {
    for (const id of Object.keys(TERRAINS).map(Number)) {
      const couvert = PRIORITE_PAVE[id] !== undefined || SURFACES[id] !== undefined || estStructurel(id)
      expect(couvert, `terrain ${id} (${TERRAINS[id]?.name}) n'a ni rang, ni surface, ni statut structurel`).toBe(true)
    }
  })
})

describe('le pavement du lapiaz', () => {
  /** Un chunk ENTIÈREMENT de chaos de blocs, gris uni, sans trame : ne reste que le pavement. */
  const chaos = (seed: number, cx = 0, cy = 0): Uint8ClampedArray =>
    cuireChunk({ seed, soleil: soleilDuPavement(0), cx, cy, terrainAt: () => TERRAIN_BOULDERS, couleurAt: () => 0x808080, trameDe: () => null }).sol

  it('TRACE deux traits et ne remplit rien : le fond garde sa valeur, et il domine', () => {
    const img = chaos(2026)
    const vues = new Map<number, number>()
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const [r] = px(img, x, y)
        vues.set(r, (vues.get(r) ?? 0) + 1)
      }
    }
    // NEUF niveaux au plus, et pas un de plus : trois d'albédo (fond · fissure fine · fissure
    // maîtresse) × trois de relief (lèvre au jour · rien · ombre). Le produit est BORNÉ par
    // construction — c'est ce qui distingue un sol postérisé d'un dégradé.
    expect(vues.size, `niveaux vus : ${[...vues.keys()].sort((a, b) => a - b).join(', ')}`).toBeLessThanOrEqual(9)
    expect(vues.size, 'un seul niveau = le pavement ne se dessine pas').toBeGreaterThanOrEqual(3)
    const base = 0x80
    const attendu = new Set<number>()
    for (const [fa, chaud] of [[1, 0], [LAPIAZ.F_FIN, 0.6], [LAPIAZ.F_MAITRESSE, 1]] as const) {
      for (const fr of [1, LAPIAZ.F_LEVRE, LAPIAZ.F_OMBRE]) {
        attendu.add(Math.round(Math.min(255, base * fa * fr * (1 + LAPIAZ.TEINTE_R * chaud))))
      }
    }
    for (const v of vues.keys()) expect([...attendu], `luminance ${v} inattendue`).toContain(v)
    // ⚠ **LE FOND DOIT DOMINER** — c'est toute la correction du 2026-08-27 (« les motifs sont
    // trop larges »). Un pavement qui REMPLIT couvrirait la moitié de la surface d'une seconde
    // valeur ; un pavement qui TRACE laisse le sol tranquille et n'y pose que des lignes.
    const fond = vues.get(base) ?? 0
    expect(fond / (S * S), 'les traits mangent le sol au lieu de le rayer').toBeGreaterThan(0.6)
  })

  it('la LÈVRE change de côté avec le soleil, et se tait quand il est figé', () => {
    // Le même chunk, à trois soleils : aube (est), midi (nord), couchant (ouest). L'albédo ne
    // bouge pas d'un pixel — c'est la MÊME géométrie — mais l'éclairement, si.
    const aube = cuireChunk({ seed: 2026, soleil: soleilDuPavement(1), cx: 0, cy: 0, terrainAt: () => TERRAIN_BOULDERS, couleurAt: () => 0x808080, trameDe: () => null }).sol
    const couchant = cuireChunk({ seed: 2026, soleil: soleilDuPavement(-1), cx: 0, cy: 0, terrainAt: () => TERRAIN_BOULDERS, couleurAt: () => 0x808080, trameDe: () => null }).sol
    let differents = 0
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (px(aube, x, y)[0] !== px(couchant, x, y)[0]) differents++
    // ⚠ LA PRÉMISSE D'ABORD : sans un écart réel, l'assertion de symétrie ci-dessous serait vide.
    expect(differents, 'le soleil ne change rien : le relief est inerte').toBeGreaterThan(0.02 * S * S)
    // Et la bascule est SYMÉTRIQUE : autant de pixels s'éclairent que s'assombrissent quand le
    // soleil passe d'un bord du ciel à l'autre — une fissure a deux bords, pas un.
    let monte = 0
    let descend = 0
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const d = px(couchant, x, y)[0] - px(aube, x, y)[0]
      if (d > 0) monte++
      else if (d < 0) descend++
    }
    expect(Math.abs(monte - descend) / (monte + descend), `montent ${monte}, descendent ${descend}`).toBeLessThan(0.25)
  })

  it('la fissure est plus SOMBRE et plus CHAUDE que le fond — jamais l’inverse', () => {
    const img = chaos(2026)
    let clair: [number, number, number, number] | null = null
    let sombre: [number, number, number, number] | null = null
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const p2 = px(img, x, y)
        if (!clair || p2[0] > clair[0]) clair = p2
        if (!sombre || p2[0] < sombre[0]) sombre = p2
      }
    }
    expect(clair![0]).toBeGreaterThan(sombre![0])
    // Le fond est gris (le gris d'entrée) ; la fissure penche vers le rouge et perd du bleu.
    expect(clair![0] - clair![2]).toBe(0)
    expect(sombre![0] - sombre![2]).toBeGreaterThan(0)
  })

  it('est POSITIONNEL : deux chunks voisins peignent le même pixel du monde', () => {
    const a = chaos(2026, 0, 0)
    const b = chaos(2026, 1, 0)
    let compares = 0
    for (let y = 0; y < S; y++) {
      for (let d = 0; d < PAVE.BAVE; d++) {
        expect(px(a, PAVE_COTE + d, y), `débord droit de A en y=${y}`).toEqual(px(b, d, y))
        compares++
      }
    }
    expect(compares).toBe(S * PAVE.BAVE)
  })

  it('ne se déclenche QUE sur le chaos de blocs — l’éboulis et le pré restent neutres', () => {
    for (const t of [9 /* scree */, 1 /* grass */, 3 /* forest */]) {
      const img = cuireChunk({ seed: 2026, soleil: soleilDuPavement(0), cx: 0, cy: 0, terrainAt: () => t, couleurAt: () => 0x808080, trameDe: () => null }).sol
      let teintes = 0
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const p2 = px(img, x, y); if (p2[0] !== p2[2]) teintes++ }
      expect(teintes, `terrain ${t} teinté par le pavement`).toBe(0)
    }
  })

  it('suit sa GRAINE — deux mondes ne portent pas le même dédale', () => {
    const a = chaos(2026)
    const b = chaos(7)
    let differents = 0
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (px(a, x, y)[0] !== px(b, x, y)[0]) differents++
    expect(differents / (S * S)).toBeGreaterThan(0.1)
  })
})
