/**
 * LE MANTEAU — gardes du module pur (spec `sol-dessine.md` R16).
 *
 * Un petit monde bâti à la main : une moitié sous la neige, une moitié nue, un lac gelé. La
 * propriété affirmée est une propriété de l'image cuite — balayée sur tout un bord, jamais un
 * pixel choisi.
 */
import { describe, expect, it } from 'vitest'
import { PAVE, PAVE_COTE_BAVE, PAVE_PX, prioriteDe } from './paves'
import { hash2 } from '@ashes/sim'
import { GRAIN_CELLS } from './grain-sol'
import {
  EAU_PAVE, NEIGE_PAVE, TUILE_ASSEC, TUILE_CRUE, TUILE_EAU_LIBRE, TUILE_GLACE_GUE, TUILE_GLACE_LAC,
  TUILE_GUE_FERME, TUILE_NEIGE, TUILE_NEIGE_PROFONDE, TUILE_NUE, TUILE_STRUCTURELLE,
  couleurDuManteau, couleurVase, cuireManteau, terrainDuManteau,
  trameDeCrue, trameDeGlace, trameDeVase, tuileDeNiveau, type EtatTuile,
} from './manteau'
import { ASSEC, CRUE, DESSOUS, DESSOUS_EAU, GLACE_GUE, GLACE_LAC, GUE_FERME, MANTEAU, MANTEAU_PROFOND } from './paves'

const N = PAVE.CHUNK
const S = N * PAVE_PX
const P = PAVE_PX

function cuire(etatAt: (tx: number, ty: number) => EtatTuile) {
  return cuireManteau({
    cx: 0, cy: 0, etatAt,
    trameNeige: null, trameGlace: trameDeGlace(),
    trameVase: trameDeVase(), trameCrue: trameDeCrue(),
  })
}
/** Le pixel (x, y) DU CHUNK : le tampon porte le débord (`PAVE.BAVE`) tout autour — les gardes
 *  se lisent en coordonnées de chunk, le débord est une affaire de pose. */
const px = (img: Uint8ClampedArray | null, x: number, y: number): [number, number, number, number] => {
  if (!img) return [0, 0, 0, 0]
  const o = ((y + PAVE.BAVE) * PAVE_COTE_BAVE + (x + PAVE.BAVE)) * 4
  return [img[o]!, img[o + 1]!, img[o + 2]!, img[o + 3]!]
}
const R = (c: number) => (c >> 16) & 0xff

/** Combien de cellules de la trame vérifient `marque`. */
function compter(marque: (i: number) => boolean): number {
  let n = 0
  for (let i = 0; i < GRAIN_CELLS * GRAIN_CELLS; i++) if (marque(i)) n++
  return n
}

/**
 * LES COMPOSANTES CONNEXES (4-voisins) d'un ensemble de cellules de la trame, SUR LE TORE —
 * la trame se pave, donc le bord droit touche le bord gauche. Rend le total, le nombre d'îlots
 * et la taille du plus grand : c'est la différence entre un réseau et un tramage.
 */
function composantes(marque: (i: number) => boolean): { total: number; nb: number; max: number } {
  const G = GRAIN_CELLS
  const vu = new Uint8Array(G * G)
  let total = 0
  let nb = 0
  let max = 0
  for (let i = 0; i < G * G; i++) if (marque(i)) total++
  for (let i = 0; i < G * G; i++) {
    if (vu[i] || !marque(i)) continue
    nb++
    let taille = 0
    const pile = [i]
    vu[i] = 1
    while (pile.length) {
      const k = pile.pop()!
      taille++
      const x = k % G
      const y = (k - x) / G
      const voisins = [((x + 1) % G) + y * G, ((x + G - 1) % G) + y * G, x + ((y + 1) % G) * G, x + ((y + G - 1) % G) * G]
      for (const j of voisins) if (!vu[j] && marque(j)) { vu[j] = 1; pile.push(j) }
    }
    if (taille > max) max = taille
  }
  return { total, nb, max }
}

/**
 * BALAYER TOUT L'ESPACE, N'AFFIRMER QU'UNE FOIS.
 *
 * La règle de la maison est la garde EXHAUSTIVE : on balaie toute l'image, jamais des pixels
 * choisis. Mais `expect` par pixel se paie — un aplat de 256×256 en fait 65 000, et deux de ces
 * gardes ont dépassé les 5 s de vitest **sous charge** le 2026-08-24, sans qu'une seule assertion
 * soit fausse. Le balayage reste entier ; il rend le PREMIER pixel fautif, et l'appelant l'affirme
 * une fois. Même propriété, même couverture, un `expect` au lieu de soixante-cinq mille.
 */
function premierDefaut(w: number, h: number, ok: (x: number, y: number) => boolean): string | null {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!ok(x, y)) return `(${x}, ${y})`
  return null
}

describe('les terrains virtuels', () => {
  it('la neige domine tout, la profonde domine la poudreuse, et l’EAU LIBRE est le seul rang 0', () => {
    expect(prioriteDe(MANTEAU)).toBeGreaterThan(prioriteDe(17)) // plus haut que la fleuraie
    expect(prioriteDe(MANTEAU_PROFOND)).toBeGreaterThan(prioriteDe(MANTEAU))
    expect(tuileDeNiveau(0)).toBe(TUILE_NUE)
    expect(tuileDeNiveau(1)).toBe(TUILE_NEIGE)
    expect(tuileDeNiveau(2)).toBe(TUILE_NEIGE_PROFONDE)
    // L'eau libre est le PLANCHER de la couche : c'est elle, et elle seule, qui reçoit les
    // franges. La terre nue et ce qui couvre l'eau sont un cran au-dessus, À ÉGALITÉ — leur
    // bord commun est déjà tracé par la berge du sol (R13).
    expect(prioriteDe(DESSOUS_EAU)).toBe(0)
    expect(prioriteDe(DESSOUS)).toBeGreaterThan(prioriteDe(DESSOUS_EAU))
    expect(prioriteDe(GLACE_GUE)).toBe(prioriteDe(DESSOUS))
    expect(prioriteDe(GLACE_LAC)).toBe(prioriteDe(DESSOUS))
  })

  it('l’état EAU LIBRE se range SOUS le sol nu — le portillon de cuisson et l’immersion en dépendent', () => {
    // Deux lectures ailleurs tiennent à cet ORDRE, et elles sont silencieuses si on le casse :
    // `gel-layer` tient un chunk pour vide quand tous ses états sont `<= TUILE_NUE` (un lac
    // entier ne doit pas coûter une texture), et `WorldScene.glaceAt` marche sur tout état
    // `>= TUILE_GLACE_GUE` (sur l'eau libre, on ne marche pas — on s'y enfonce).
    expect(TUILE_EAU_LIBRE).toBeLessThanOrEqual(TUILE_NUE)
    expect(TUILE_EAU_LIBRE).toBeLessThan(TUILE_GLACE_GUE)
    expect(terrainDuManteau(TUILE_EAU_LIBRE)).toBe(DESSOUS_EAU)
    expect(couleurDuManteau(DESSOUS_EAU)).toBe(0) // transparente : le shader est dessous
  })
})

describe('le manteau cuit', () => {
  // La moitié haute (ty < 8) sous la neige, la moitié basse nue.
  const neigeEnHaut = (_tx: number, ty: number): EtatTuile => (ty < 8 ? TUILE_NEIGE : TUILE_NUE)

  it('la neige est OPAQUE sur tout son corps ; le sol nu est transparent', () => {
    const { sol } = cuire(neigeEnHaut)
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const a = px(sol, x, y)[3]
        if (y < 8 * P) expect(a, `neige opaque en (${x},${y})`).toBe(255)
        else expect(a, `sol nu transparent en (${x},${y})`).toBe(0)
      }
    }
  })

  it('sur le sol nu, le surplomb porte une frange de neige opaque de 2-5 px, puis un voile d’ombre, puis rien — jamais de ressac', () => {
    const { surplomb } = cuire(neigeEnHaut)
    expect(surplomb).not.toBeNull()
    const bord = 8 * P
    for (let x = 0; x < S; x++) {
      let y = bord
      let frange = 0
      while (y < S && px(surplomb, x, y)[3] === 255) { frange++; y++ }
      expect(frange, `frange en x=${x}`).toBeGreaterThanOrEqual(PAVE.FRANGE_MIN)
      expect(frange, `frange en x=${x}`).toBeLessThanOrEqual(PAVE.FRANGE_MAX)
      // Le bas de la frange est le bord du pavé : il porte le LISERÉ (l'épaisseur de la neige).
      expect(px(surplomb, x, y - 1)[0], `liseré en x=${x}`).toBeLessThan(R(NEIGE_PAVE.NEIGE) * 0.7)
      // Et le corps de la frange, au-dessus, est de la neige claire.
      if (frange > 2) expect(px(surplomb, x, bord)[0]).toBeGreaterThan(R(NEIGE_PAVE.NEIGE) * 0.9) // sous 3 px : liseré + tranche seuls
      // L'ombre : un voile NOIR translucide.
      let ombre = 0
      while (y < S && px(surplomb, x, y)[3] > 0 && px(surplomb, x, y)[0] === 0) { ombre++; y++ }
      expect(ombre, `ombre en x=${x}`).toBeGreaterThanOrEqual(2)
      // Puis plus rien : pas de ressac (un pixel BLANC translucide), pas de seconde marque.
      for (; y < S; y++) expect(px(surplomb, x, y)[3], `rien sous l'ombre en (${x},${y})`).toBe(0)
    }
  })

  it('la glace est une surface opaque dans le sol, plate, sans frange sur le sol nu', () => {
    const glaceAGauche = (tx: number): EtatTuile => (tx < 8 ? TUILE_GLACE_LAC : TUILE_NUE)
    const { sol, surplomb } = cuire(glaceAGauche)
    expect(premierDefaut(S, S, (x, y) => px(sol, x, y)[3] === (x < 8 * P ? 255 : 0)),
      'la glace est opaque sur son corps, le sol nu est transparent').toBeNull()
    // Aucun débordement : le surplomb, s'il existe, est vide.
    if (surplomb) expect(premierDefaut(S, S, (x, y) => px(surplomb, x, y)[3] === 0), 'surplomb vide').toBeNull()
    // Le givre : des cellules plus claires, mais la glace reste bleue (R < B).
    let claires = 0
    expect(premierDefaut(8 * P, 8 * P, (x, y) => px(sol, x, y)[2] > px(sol, x, y)[0]), 'la glace reste bleue').toBeNull()
    for (let y = 0; y < 8 * P; y++) for (let x = 0; x < 8 * P; x++) {
      if (px(sol, x, y)[0] > R(NEIGE_PAVE.GLACE_LAC) + 4) claires++
    }
    expect(claires / (64 * P * P)).toBeGreaterThan(0.1)
    expect(claires / (64 * P * P)).toBeLessThan(0.35)
  })

  it('la neige déborde sur la glace : frange opaque et ombre dans le surplomb, glace opaque dessous', () => {
    const neigeSurLac = (_tx: number, ty: number): EtatTuile => (ty < 8 ? TUILE_NEIGE : TUILE_GLACE_GUE)
    const { sol, surplomb } = cuire(neigeSurLac)
    expect(surplomb).not.toBeNull()
    const bord = 8 * P
    for (let x = 0; x < S; x++) {
      let y = bord
      let frange = 0
      while (y < S && px(surplomb, x, y)[3] === 255) { frange++; y++ }
      expect(frange).toBeGreaterThanOrEqual(PAVE.FRANGE_MIN)
      expect(frange).toBeLessThanOrEqual(PAVE.FRANGE_MAX)
      // Sous la frange, la glace est là, opaque, et OMBRÉE (plus sombre que la glace nue).
      const ombree = px(sol, x, y)
      const nue = px(sol, x, S - 1)
      expect(ombree[3]).toBe(255)
      expect(nue[3]).toBe(255)
      expect(ombree[2]).toBeLessThan(nue[2] * 0.95)
    }
  })

  it('la neige ne déborde pas sur une falaise et garde son liseré contre elle', () => {
    const falaiseEnBas = (_tx: number, ty: number): EtatTuile => (ty < 8 ? TUILE_NEIGE : TUILE_STRUCTURELLE)
    const { sol, surplomb } = cuire(falaiseEnBas)
    expect(surplomb).toBeNull()
    for (let x = 0; x < S; x++) {
      expect(px(sol, x, 8 * P - 1)[0]).toBeLessThan(R(NEIGE_PAVE.NEIGE) * 0.7)
      for (let y = 8 * P; y < S; y++) expect(px(sol, x, y)[3]).toBe(0)
    }
  })

  it('la profonde est un pavé SUR la poudreuse : frange, liseré et ombre dans le sol de la couche (gel.md G9)', () => {
    const profondeEnHaut = (_tx: number, ty: number): EtatTuile => (ty < 8 ? TUILE_NEIGE_PROFONDE : TUILE_NEIGE)
    const { sol, surplomb } = cuire(profondeEnHaut)
    expect(surplomb).toBeNull() // rien n'est surplombé : tout est dans le sol de la couche
    const bord = 8 * P
    for (let x = 0; x < S; x++) {
      // Tout est opaque (deux neiges).
      for (let y = 0; y < S; y++) expect(px(sol, x, y)[3]).toBe(255)
      // Sous le bord de la tuile, la frange de la profonde, qui finit par un liseré sombre…
      let y = bord
      while (y < S && px(sol, x, y)[0] > R(NEIGE_PAVE.NEIGE) * 0.7) y++
      const lisere = y
      expect(lisere - bord, `frange en x=${x}`).toBeGreaterThanOrEqual(PAVE.FRANGE_MIN - 1)
      expect(lisere - bord, `frange en x=${x}`).toBeLessThanOrEqual(PAVE.FRANGE_MAX)
      expect(px(sol, x, lisere)[0]).toBeLessThan(R(NEIGE_PAVE.NEIGE) * 0.7)
      // … puis l'ombre portée sur la poudreuse : plus sombre que la poudreuse nue du bas.
      const ombre = px(sol, x, lisere + 1)
      const nue = px(sol, x, S - 1)
      expect(ombre[0]).toBeLessThan(nue[0] * 0.9)
    }
  })

  // ═══════════════ LE NIVEAU D'EAU (spec `saisons.md` S10) ═══════════════

  it('les trois régimes d’eau ont un terrain ET une couleur — la table est exhaustive par construction', () => {
    // La garde qui compte : un état de plus dans `EtatTuile` sans peinture est un état
    // INVISIBLE, et c'est exactement la panne qu'on vient de réparer (le niveau d'eau vivait
    // dans /sim depuis le 2026-08-23 sans qu'un pixel en dépende). On énumère donc TOUS les
    // états — le compilateur tient la liste, pas moi.
    const TOUS: EtatTuile[] = [
      TUILE_EAU_LIBRE, TUILE_STRUCTURELLE, TUILE_NUE, TUILE_NEIGE, TUILE_NEIGE_PROFONDE,
      TUILE_GLACE_GUE, TUILE_GLACE_LAC, TUILE_ASSEC, TUILE_GUE_FERME, TUILE_CRUE,
    ]
    for (const e of TOUS) {
      const t = terrainDuManteau(e)
      // Seuls les deux DESSOUS (transparents) et le structurel (le bake reste maître) n'ont
      // pas de couleur.
      if (e === TUILE_NUE || e === TUILE_EAU_LIBRE || e === TUILE_STRUCTURELLE) continue
      expect(t, `l'état ${e} a un terrain virtuel`).not.toBe(DESSOUS)
      expect(couleurDuManteau(t), `l'état ${e} a une couleur`).toBeGreaterThan(0)
    }
    expect(terrainDuManteau(TUILE_ASSEC)).toBe(ASSEC)
    expect(terrainDuManteau(TUILE_GUE_FERME)).toBe(GUE_FERME)
    expect(terrainDuManteau(TUILE_CRUE)).toBe(CRUE)
  })

  it('les régimes d’eau cèdent à la TERRE nue (la berge du sol borde déjà) et débordent sur l’EAU LIBRE', () => {
    // La ligne de partage est GÉOMÉTRIQUE, pas esthétique, et elle a DEUX côtés :
    //   • côté TERRE — l'assec, le gué fermé et la glace tombent sur des tuiles qui SONT de
    //     l'eau à la carte, donc la berge du sol a déjà tracé ce contour : égalité, sinon
    //     double trait (et la vase mangerait la rive, par-dessus le surplomb de la berge) ;
    //   • côté EAU — rien ne le traçait, l'eau libre est un cran EN DESSOUS : la vase y glisse
    //     d'une frange, comme le marais glisse dans le haut-fond. Une égalité ici, c'est la
    //     couture nue — le défaut qu'a connu le marais, et qu'avait la mare partie.
    // La crue, elle, tombe sur du MARCHABLE : elle passe au-dessus de la terre nue.
    expect(prioriteDe(ASSEC)).toBe(prioriteDe(DESSOUS))
    expect(prioriteDe(GUE_FERME)).toBe(prioriteDe(DESSOUS))
    expect(prioriteDe(GLACE_GUE)).toBe(prioriteDe(DESSOUS))
    expect(prioriteDe(ASSEC)).toBeGreaterThan(prioriteDe(DESSOUS_EAU))
    expect(prioriteDe(CRUE)).toBeGreaterThan(prioriteDe(DESSOUS))
  })

  it('LE GUÉ FERMÉ SE VOIT (contrat G5) : il est franchement plus sombre que tout ce qui se traverse', () => {
    // « On ne s'engage jamais sur la glace par surprise » vaut à l'identique pour un gué que la
    // crue a fermé — c'est le SEUL des trois régimes qui bloque le pas. La garde est un écart
    // MESURÉ sur la luminance, pas un avis sur la teinte : il doit se distinguer du gué GELÉ
    // (qu'on traverse) et de la crue (qu'on patauge).
    const lum = (c: number) => 0.2126 * ((c >> 16) & 0xff) + 0.7152 * ((c >> 8) & 0xff) + 0.0722 * (c & 0xff)
    expect(lum(EAU_PAVE.GUE_FERME)).toBeLessThan(lum(NEIGE_PAVE.GLACE_GUE) - 40)
    expect(lum(EAU_PAVE.GUE_FERME)).toBeLessThan(lum(EAU_PAVE.CRUE) - 25)
    // Et l'assec part dans l'autre sens : le sec est CHAUD (R > B), l'eau est froide (B > R).
    expect((EAU_PAVE.ASSEC >> 16) & 0xff).toBeGreaterThan(EAU_PAVE.ASSEC & 0xff)
    expect(EAU_PAVE.GUE_FERME & 0xff).toBeGreaterThan((EAU_PAVE.GUE_FERME >> 16) & 0xff)
  })

  it('la vase NE DÉBORDE PAS sur la rive : côté terre, la berge du sol l’encadre déjà', () => {
    // ⚠ CETTE GARDE EST L'AUTRE MOITIÉ DE CELLE D'APRÈS, et elle dit l'inverse : contre la
    // TERRE (`TUILE_NUE`), la vase s'arrête net au bord de sa tuile. Un débord ici serait de
    // la boue peinte PAR-DESSUS l'herbe de la berge — le surplomb du manteau se pose au-dessus
    // de celui du sol. Contre l'EAU LIBRE, au contraire, elle DOIT déborder.
    const assecAGauche = (tx: number): EtatTuile => (tx < 8 ? TUILE_ASSEC : TUILE_NUE)
    const { sol, surplomb } = cuire(assecAGauche)
    expect(premierDefaut(S, S, (x, y) => px(sol, x, y)[3] === (x < 8 * P ? 255 : 0)),
      'la vase est opaque sur son corps, le sol nu est transparent').toBeNull()
    // ET RIEN DANS LE SURPLOMB : pas un pixel de boue sur la rive.
    if (surplomb) expect(premierDefaut(S, S, (x, y) => px(surplomb, x, y)[3] === 0), 'aucun débord sur la rive').toBeNull()
    // LA CRAQUELURE assombrit (l'inverse du givre), et la vase reste chaude sur tout son corps.
    expect(premierDefaut(8 * P, 8 * P, (x, y) => px(sol, x, y)[0] > px(sol, x, y)[2]), 'la vase reste chaude').toBeNull()
    let sombres = 0
    for (let y = 0; y < 8 * P; y++) for (let x = 0; x < 8 * P; x++) {
      if (px(sol, x, y)[0] < R(EAU_PAVE.ASSEC) - 4) sombres++
    }
    expect(sombres / (64 * P * P)).toBeGreaterThan(0.2)
    expect(sombres / (64 * P * P)).toBeLessThan(0.7)
  })

  /**
   * ═══ LA CRAQUELURE EST UN RÉSEAU, PAS UN MOUCHETÉ (Alexis, 2026-08-25) ═══
   *
   * C'est LA propriété qui distingue une fente d'un tramage, et c'est celle qui manquait : la
   * vase portait le remède du givre — une part de cellules tirées INDÉPENDAMMENT les unes des
   * autres. Aucune part ne fait un réseau avec ça : sous le seuil de percolation, des cellules
   * tirées à 27 % se cassent en centaines d'îlots.
   *
   * On mesure donc la CONNEXITÉ sur le tore (la trame se pave), et on la compare au témoin
   * exact — un moucheté de MÊME part. MESURÉ le 2026-08-25 : le réseau cellulaire rend 89
   * composantes dont la plus grande porte 37,6 % des cellules fendues ; le moucheté de même
   * part en rend 525 dont la plus grande porte 1,7 %. Vingt-deux fois moins. Les seuils sont
   * posés entre les deux, avec de la marge des deux côtés — et le témoin est CALCULÉ ici, pas
   * recopié : c'est lui qui dit ce qui ferait rougir.
   */
  it('la craquelure de la vase est un RÉSEAU connexe — un moucheté de même part ne peut pas l’être', () => {
    const trame = trameDeVase()
    const fendue = (i: number): boolean => trame[i]! < EAU_PAVE.PLAQUE_MIN
    const part = compter(fendue) / (GRAIN_CELLS * GRAIN_CELLS)
    // La part elle-même : assez pour se voir, pas au point de manger la plaque.
    expect(part, 'la part fendue').toBeGreaterThan(0.15)
    expect(part, 'la part fendue').toBeLessThan(0.4)

    const reseau = composantes(fendue)
    // LE TÉMOIN : le moucheté d'avant, à la même part — c'est lui, l'étalon.
    const moucheteAMemePart = (i: number): boolean =>
      hash2((i % GRAIN_CELLS) + 7919, Math.floor(i / GRAIN_CELLS) + 104_729, 0xea0) < part
    const temoin = composantes(moucheteAMemePart)

    expect(reseau.max / reseau.total, `la plus grande fente porte ${(100 * reseau.max / reseau.total).toFixed(1)} % des cellules fendues`)
      .toBeGreaterThan(5 * (temoin.max / temoin.total))
    expect(reseau.max / reseau.total).toBeGreaterThan(0.15)
    expect(reseau.nb, 'le réseau est en bien moins de morceaux que le moucheté').toBeLessThan(temoin.nb / 3)
  })

  /**
   * LA TRAME SE PAVE SANS COUTURE — le treillis des germes BOUCLE sur les 64 cellules.
   *
   * `cuireChunk` indexe la trame en `& (GRAIN_CELLS − 1)` : elle se répète tous les 256 px de
   * monde. Un Voronoï calculé sans refermer son treillis y poserait un TRAIT droit tous les 16
   * tuiles — le défaut même qu'on vient de corriger, en pire (mémoire `bord-nu-est-une-couture`).
   * On l'affirme par ce qu'une couture INTERDIT : qu'une fente traverse le raccord.
   */
  it('la craquelure se pave sans couture : une fente traverse le raccord', () => {
    const trame = trameDeVase()
    const fendue = (i: number): boolean => trame[i]! < EAU_PAVE.PLAQUE_MIN
    const G = GRAIN_CELLS
    // ① Une fente enjambe VRAIMENT le raccord (les deux cellules qui se toucheront au pavage).
    let traversees = 0
    for (let y = 0; y < G; y++) if (fendue(y * G + G - 1) && fendue(y * G)) traversees++
    expect(traversees, 'des fentes passent d’un bord à l’autre').toBeGreaterThan(0)
    // ② Et le raccord n'est pas un ARTEFACT : la colonne du bord n'est ni toute fendue (un
    //    trait) ni toute lisse (un liseré) — elle a la densité du reste.
    const part = compter(fendue) / (G * G)
    let bord = 0
    for (let y = 0; y < G; y++) if (fendue(y * G)) bord++
    expect(bord / G, 'la colonne du raccord a la densité du reste').toBeGreaterThan(part / 3)
    expect(bord / G, 'la colonne du raccord a la densité du reste').toBeLessThan(Math.min(1, part * 3))
  })

  /**
   * LA VASE RESPIRE À LA TUILE — l'autre moitié de « ça n'a rien à voir avec le reste du sol ».
   *
   * Chaque tuile de terre porte un damier de famille et une seconde échelle de bruit (~10
   * tuiles) : la vase, elle, était UN entier, le même d'un bout à l'autre de la carte. Un
   * chenal de trois cents tuiles en une seule couleur, à côté d'un pré qui module.
   */
  it('la vase varie à la tuile et prend la teinte du PAYS, sans jamais devenir froide', () => {
    const lum = (c: number) => 0.2126 * ((c >> 16) & 0xff) + 0.7152 * ((c >> 8) & 0xff) + 0.0722 * (c & 0xff)
    const vues = new Set<number>()
    let min = Infinity
    let max = -Infinity
    for (let ty = 0; ty < 64; ty++) {
      for (let tx = 0; tx < 64; tx++) {
        const c = couleurVase(tx, ty)
        vues.add(c)
        min = Math.min(min, lum(c))
        max = Math.max(max, lum(c))
        // ⚠ LE CONTRAT DE LECTURE, sur CHAQUE tuile : le sec est CHAUD (R > B), l'eau est
        // froide. Deux verdicts du smoke en dépendent (`vase` cherche la frange sur R − B > 6,
        // `crue` demande +8 de chaleur en s'asséchant) : une variation qui refroidirait une
        // tuile les ferait accuser du code sain.
        expect(((c >> 16) & 0xff) - (c & 0xff), `la vase en (${tx}, ${ty}) reste chaude`).toBeGreaterThan(20)
      }
    }
    expect(vues.size, 'la vase ne peut plus être un aplat').toBeGreaterThan(20)
    // Elle varie, mais elle reste calibrée : ±10 % autour de sa référence, pas un patchwork.
    const ref = lum(EAU_PAVE.ASSEC)
    expect(max - min, 'l’amplitude de la respiration').toBeGreaterThan(ref * 0.05)
    expect(max - min, 'l’amplitude de la respiration').toBeLessThan(ref * 0.3)

    // ET LA TEINTE DU PAYS la déplace : deux modulations différentes, deux vases différentes.
    const froide = couleurVase(3, 3, [0.9, 0.95, 1.05])
    const chaude = couleurVase(3, 3, [1.08, 1.0, 0.9])
    expect(chaude, 'le pays module la vase').not.toBe(froide)
    expect((chaude >> 16) & 0xff).toBeGreaterThan((froide >> 16) & 0xff)
  })

  it('la vase glisse dans l’EAU PROFONDE d’une frange SEULE — la même frontière que marais / haut-fond', () => {
    // Alexis, 2026-08-24 : « une frontière propre entre la vase et l'eau profonde, la même que
    // celle entre les marécages et l'eau peu profonde ». Cette frontière-là, c'est une SURFACE
    // qui déborde : une frange irrégulière de 2 à 5 px, et RIEN d'autre — ni liseré (0,55), ni
    // ombre portée (0,72), qu'une surface ne porte pas. Elle vit dans le SURPLOMB, au-dessus du
    // shader d'eau, comme la frange de la berge.
    const assecAGauche = (tx: number): EtatTuile => (tx < 8 ? TUILE_ASSEC : TUILE_EAU_LIBRE)
    const { sol, surplomb } = cuire(assecAGauche)
    expect(surplomb).not.toBeNull()
    const bord = 8 * P
    // Le corps de la vase est opaque dans le SOL de la couche ; l'eau libre n'y est PAS peinte
    // (le shader garde sa surface).
    expect(premierDefaut(S, S, (x, y) => px(sol, x, y)[3] === (x < bord ? 255 : 0)),
      'vase opaque, eau libre nue').toBeNull()
    // Et sur TOUTE la hauteur, la vase entre dans l'eau d'une frange bornée, puis PLUS RIEN :
    // ni liseré, ni ombre — une surface ne pèse pas sur l'eau.
    const franges: number[] = []
    expect(premierDefaut(1, S, (_i, y) => {
      let x = bord
      while (x < S && px(surplomb, x, y)[3] === 255) x++
      const frange = x - bord
      franges.push(frange)
      if (frange < PAVE.FRANGE_MIN || frange > PAVE.FRANGE_MAX) return false
      for (; x < S; x++) if (px(surplomb, x, y)[3] !== 0) return false
      return true
    }), `frange bornée à ${PAVE.FRANGE_MIN}-${PAVE.FRANGE_MAX} px, et rien au large — première ligne fautive`).toBeNull()
    // ELLE EST IRRÉGULIÈRE, pas un ourlet : c'est ce qui la distingue d'un bord droit.
    expect(new Set(franges).size, 'la frange varie sur la hauteur').toBeGreaterThan(1)
    // Et c'est de la VASE, pas un voile : elle garde sa teinte chaude (R > B).
    expect(premierDefaut(1, S, (_i, y) => px(surplomb, bord, y)[0] > px(surplomb, bord, y)[2]),
      'frange chaude').toBeNull()
  })

  it('la crue déborde sur la terre d’une frange SEULE : pas de liseré, pas d’ombre — une nappe n’a pas d’épaisseur', () => {
    const crueEnHaut = (_tx: number, ty: number): EtatTuile => (ty < 8 ? TUILE_CRUE : TUILE_NUE)
    const { sol, surplomb } = cuire(crueEnHaut)
    expect(surplomb).not.toBeNull()
    const bord = 8 * P
    for (let x = 0; x < S; x++) {
      // Le corps de la nappe est opaque…
      for (let y = 0; y < bord; y++) expect(px(sol, x, y)[3], `nappe opaque en (${x},${y})`).toBe(255)
      // … et elle déborde d'une frange d'eau, dans le SURPLOMB (la terre du dessous est peinte
      // par le sol, pas par nous — on passe au-dessus, comme la neige sur le sol nu).
      let y = bord
      let frange = 0
      while (y < S && px(surplomb, x, y)[3] === 255) { frange++; y++ }
      expect(frange, `frange de crue en x=${x}`).toBeGreaterThanOrEqual(PAVE.FRANGE_MIN)
      expect(frange, `frange de crue en x=${x}`).toBeLessThanOrEqual(PAVE.FRANGE_MAX)
      // ET RIEN SOUS ELLE : ni liseré sombre, ni ombre portée. Une surface ne pèse pas.
      for (; y < S; y++) expect(px(surplomb, x, y)[3], `rien sous la nappe en (${x},${y})`).toBe(0)
    }
  })

  // DEUX CUISSONS PLEINES d'un chunk de 16 × 16 tuiles : 3,5 s sur une machine au repos
  // (mesuré le 2026-08-24, après l'ajout des trois régimes d'eau), et le défaut par
  // vitest est de 5 s — assez pour tomber dès que le reste de la suite tourne à côté.
  // On donne la marge : ce test affirme le DÉTERMINISME, pas une vitesse.
  it('la cuisson est déterministe', () => {
    const a = cuire(neigeEnHaut)
    const b = cuire(neigeEnHaut)
    expect(a.sol).toEqual(b.sol)
    expect(a.surplomb).toEqual(b.surplomb)
  }, 60_000)
})
