/**
 * L'ART DU MONDE BÂTI — les gardes de ce qu'on ne verrait qu'en jeu, et trop tard.
 *
 * L'appareil de pierre et le mobilier se jugent à l'œil (captures
 * `pnpm smoke --dev --scenario lieux-batis`). Ce qui NE se juge pas à l'œil :
 *   • la COUTURE d'une crête ébréchée sur un bord accosté — elle n'apparaît que sur certaines
 *     seeds, à certaines orientations, et on passe six mois sans la voir ;
 *   • la COUVERTURE des seize masques de clôture — il suffit qu'un seul manque pour qu'un angle
 *     d'enclos affiche une texture manquante, quelque part, une fois.
 */
import { describe, expect, it } from 'vitest'
import { BALANCE } from '@ashes/sim'
import { BATI_KEYS, BATI_LIT_TYPES, COUPE_DE, EDGE_BARRIER_KEYS, ENCADREMENT_POST, PORTE_FRAMES, passageDePorte, passageDePorteDouble, piecesDePorte, piecesDePorteDouble, profilDeCrete } from './bati-art'

const N = 1, E = 2, S = 4, O = 8

describe('les clés', () => {
  it('couvrent les seize masques du mur ruiné ET de la clôture, en albédo et en `_lit`', () => {
    for (let m = 0; m < 16; m++) {
      for (const base of [`st-wall-ruine-${m}`, `st-cloture-${m}`]) {
        expect(BATI_KEYS, `${base} manque`).toContain(base)
        expect(BATI_KEYS, `${base}_lit manque`).toContain(`${base}_lit`)
      }
    }
  })

  it('donnent une `_lit` à CHAQUE pièce qui se dresse', () => {
    for (const type of BATI_LIT_TYPES) {
      expect(BATI_KEYS, `st-${type} manque`).toContain(`st-${type}`)
      expect(BATI_KEYS, `st-${type}_lit manque`).toContain(`st-${type}_lit`)
    }
    // Le mobilier au complet — la liste est ici pour qu'un oubli se VOIE, pas pour décorer.
    for (const t of ['table', 'banc', 'paillasse', 'etagere', 'tonneau', 'atre', 'abreuvoir', 'meule', 'poutre', 'mur_bas', 'cloture', 'encadrement']) {
      expect(BATI_LIT_TYPES.has(t), `${t} n'a pas de _lit`).toBe(true)
    }
  })

  it('laissent PLATES les pièces au ras du sol — une normale y ferait un coussin par tuile', () => {
    for (const plat of ['st-friche', 'st-friche-0', 'st-friche-3', 'st-terre', 'st-terre-2', 'st-floor-ruine', 'st-roof-ruine']) {
      expect(BATI_KEYS).toContain(plat)
      expect(BATI_KEYS, `${plat} ne doit PAS avoir de _lit`).not.toContain(`${plat}_lit`)
    }
    for (const plat of ['friche', 'terre', 'floor', 'roof']) expect(BATI_LIT_TYPES.has(plat)).toBe(false)
  })

  it('n’ont aucun doublon', () => {
    expect(new Set(BATI_KEYS).size).toBe(BATI_KEYS.length)
  })
})

describe("l'encadrement de porte", () => {
  /**
   * LE PASSAGE LIBRE DOIT LAISSER ENTRER L'AVATAR — et ce n'est pas une évidence : mes premiers
   * jambages (5 px sur 16) ne laissaient que 6 px, soit MOINS que la hitbox de 9,6. Le bonhomme
   * traversait la pierre. La faute ne se voyait pas à l'œil parce que l'encadrement ne bloque
   * pas : rien ne cognait, ça avait juste l'air faux.
   */
  it('laisse un passage au moins aussi large que la hitbox de l’avatar', () => {
    const libre = (16 - 2 * ENCADREMENT_POST) / 16
    expect(libre, `passage ${libre} tuile pour une hitbox de ${BALANCE.AVATAR_HITBOX_TILES}`)
      .toBeGreaterThanOrEqual(BALANCE.AVATAR_HITBOX_TILES)
  })

  it('garde des jambages VISIBLES — sans eux, ce n’est plus un encadrement mais un trou', () => {
    expect(ENCADREMENT_POST).toBeGreaterThanOrEqual(2)
  })
})

/**
 * LA PORTE DU JOUEUR — et la faute qu'Alexis a vue avant tout test (2026-07-30).
 *
 * « visuellement toute la case est prise et on ne peut pas faire passer un sprite de joueur. »
 * Elle était peinte comme une BARRIÈRE puis décorée d'un vantail : une face pleine sur toute la
 * largeur, avec une refente dessinée par-dessus. Le moteur laissait passer les siens
 * (`structureBlocks` : une `door` ne bloque que l'étranger) — c'était le DESSIN qui mentait, sur
 * la seule chose qu'une porte ait à dire.
 *
 * CE QUE CETTE GARDE AFFIRME, ET POURQUOI ELLE LIT LE PLAN : `piecesDePorte` rend les rectangles
 * que `dessinerPorte` peint, et `passageDePorte` le rectangle qui doit rester vide. On compare
 * les deux. Une garde écrite sur la CONSTANTE (`ENCADREMENT_POST ≥ 2`) était déjà là et est
 * restée verte pendant que la porte était un panneau plein : elle gardait le seuil, pas la porte,
 * et surtout elle gardait un chiffre au lieu d'un dessin.
 */
describe('la porte du joueur, sur arête', () => {
  const BITS = [N, E, S, O]
  const NOM: Record<number, string> = { 1: 'nord', 2: 'est', 4: 'sud', 8: 'ouest' }
  const OUVERTE = PORTE_FRAMES.length - 1
  /** Deux rectangles se recouvrent-ils, sur une surface non nulle ? */
  const recouvre = (
    a: { x: number; y: number; w: number; h: number },
    b: { x: number; y: number; w: number; h: number },
  ): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

  /**
   * QUELLE PART DU PASSAGE RESTE COUVERTE, en sous-pixels. C'est la seule mesure dont toutes les
   * gardes de cette section ont besoin : fermée elle vaut 1, ouverte 0, et entre les deux elle
   * doit DÉCROÎTRE — ce qui prouve qu'il y a un mouvement, sans comparer une image à une image.
   */
  const couverture = (bit: number, frame: number): number => {
    const p = passageDePorte(bit)
    const pieces = piecesDePorte(bit, PORTE_FRAMES[frame]!)
    let dedans = 0
    let total = 0
    for (let y = p.y + 0.5; y < p.y + p.h; y += 1) {
      for (let x = p.x + 0.5; x < p.x + p.w; x += 1) {
        total += 1
        if (pieces.some((q) => x >= q.x && x <= q.x + q.w && y >= q.y && y <= q.y + q.h)) dedans += 1
      }
    }
    return total === 0 ? 0 : dedans / total
  }

  it('CINQ frames, échantillonnées d’une géométrie CONTINUE', () => {
    // Les frames ne sont pas cinq dessins : ce sont cinq valeurs d'un paramètre réel. La garde le
    // dit, parce que c'est ce qui rendra une porte à huit frames gratuite.
    expect(PORTE_FRAMES).toHaveLength(5)
    expect(PORTE_FRAMES[0]).toBe(0)
    expect(PORTE_FRAMES[OUVERTE]).toBe(1)
    for (let i = 1; i < PORTE_FRAMES.length; i++) {
      expect(PORTE_FRAMES[i]!, `frame ${i}`).toBeGreaterThan(PORTE_FRAMES[i - 1]!)
    }
  })

  it('FERMÉE (frame 0), elle BOUCHE : chaque point du passage est couvert', () => {
    // Une porte close ne laisse plus passer personne (`structureBlocks`, R26) : si le dessin
    // gardait son trou, il promettrait un passage que le moteur refuse — et ce mensonge-là se
    // paie en coups d'épaule dans le vide.
    for (const bit of BITS) expect(couverture(bit, 0), `arête ${NOM[bit]}`).toBe(1)
  })

  it('OUVERTE (dernière frame), elle LAISSE UN TROU : aucune pièce ne mord le passage', () => {
    for (const bit of BITS) {
      const passage = passageDePorte(bit)
      expect(passage.w, `arête ${NOM[bit]} : le passage a une largeur`).toBeGreaterThan(0)
      expect(passage.h, `arête ${NOM[bit]} : le passage a une hauteur`).toBeGreaterThan(0)
      for (const p of piecesDePorte(bit, PORTE_FRAMES[OUVERTE]!)) {
        expect(recouvre(p, passage), `arête ${NOM[bit]} : ${p.x},${p.y} ${p.w}×${p.h} mord le passage`).toBe(false)
      }
    }
  })

  it('ÇA S’ANIME VRAIMENT : le battant BOUGE à chaque frame, et il DÉGAGE en s’ouvrant', () => {
    // LA GARDE QUI COMPTE. Sans elle, cinq copies du même dessin passeraient les deux précédentes
    // du moment que la première et la dernière sont bonnes — et le joueur verrait une porte qui
    // saute d'un état à l'autre en cinq fois plus de temps.
    //
    // ELLE A DÛ CHANGER DE MESURE, ET C'EST INSTRUCTIF. Elle exigeait d'abord que la couverture
    // du passage décroisse STRICTEMENT à chaque pas ; depuis que le battant pivote sur un axe
    // OBLIQUE, il se range hors de l'ouverture AVANT d'avoir fini sa course — la couverture
    // atteint zéro à la frame 3 et n'a plus rien à décroître, alors que le panneau bouge encore.
    // La garde mesurait donc la bonne propriété sur une portée trop courte. On affirme les deux :
    // la SILHOUETTE change à chaque pas (c'est ça, « ça bouge »), et le passage se dégage tant
    // qu'il reste quelque chose à dégager (c'est ça, « ça s'ouvre »).
    const silhouette = (bit: number, f: number): string =>
      piecesDePorte(bit, PORTE_FRAMES[f]!)
        .map((q) => `${q.x},${q.y},${q.w},${q.h},${q.ton}`)
        .sort()
        .join('|')
    for (const bit of BITS) {
      const parts = PORTE_FRAMES.map((_, f) => couverture(bit, f))
      for (let f = 1; f < PORTE_FRAMES.length; f++) {
        expect(silhouette(bit, f), `arête ${NOM[bit]} : la frame ${f} est identique à la ${f - 1}`)
          .not.toBe(silhouette(bit, f - 1))
        expect(parts[f]!, `arête ${NOM[bit]} : le passage se rebouche (${parts.join(' → ')})`)
          .toBeLessThanOrEqual(parts[f - 1]!)
        if (parts[f - 1]! > 0) {
          expect(parts[f]!, `arête ${NOM[bit]} : frame ${f} ne dégage rien (${parts.join(' → ')})`)
            .toBeLessThan(parts[f - 1]!)
        }
      }
    }
  })

  it('le passage laisse entrer l’avatar — dérivé de sa hitbox, jamais choisi', () => {
    // Sur une arête HORIZONTALE le passage se mesure en largeur, sur une VERTICALE en hauteur :
    // le ruban d'un mur nord-sud porte sa longueur sur l'axe Y (voir `dessinerBarriere`).
    const mini = BALANCE.AVATAR_HITBOX_TILES * 16
    for (const bit of BITS) {
      const p = passageDePorte(bit)
      const leLong = bit === N || bit === S ? p.w : p.h
      expect(leLong, `arête ${NOM[bit]} : ${leLong} px pour un corps de ${mini} px`).toBeGreaterThanOrEqual(mini)
    }
  })

  it('une arête HORIZONTALE garde une crête au-dessus du trou — sinon c’est une brèche', () => {
    // Le haut d'un mur ne s'interrompt pas au-dessus d'une porte : c'est un linteau. Un trou qui
    // monte jusqu'au ciel, c'est un mur qui MANQUE — et l'œil y lit une ruine, pas une entrée.
    //
    // SEULEMENT L'HORIZONTALE, et ce n'est pas une exemption de confort : sur une arête verticale
    // le mur est un ruban vu du dessus, sa hauteur et sa longueur tombent sur le MÊME axe, et
    // toute pièce qui enjamberait l'ouverture la boucherait. « Au-dessus » n'y existe pas.
    for (const bit of [N, S]) {
      const passage = passageDePorte(bit)
      const enjambe = piecesDePorte(bit, 1).some(
        (p) => p.x <= passage.x && p.x + p.w >= passage.x + passage.w && p.y + p.h <= passage.y,
      )
      expect(enjambe, `arête ${NOM[bit]} : rien n’enjambe l’ouverture`).toBe(true)
    }
  })

  it('une arête VERTICALE est tenue par deux dormants, un de chaque côté du vide', () => {
    for (const bit of [E, O]) {
      const passage = passageDePorte(bit)
      const pieces = piecesDePorte(bit, 1)
      const avant = pieces.some((p) => p.y + p.h <= passage.y && p.h >= ENCADREMENT_POST)
      const apres = pieces.some((p) => p.y >= passage.y + passage.h && p.h >= ENCADREMENT_POST)
      expect(avant, `arête ${NOM[bit]} : pas de dormant avant l’ouverture`).toBe(true)
      expect(apres, `arête ${NOM[bit]} : pas de dormant après l’ouverture`).toBe(true)
    }
  })

  it('les jambages restent visibles — un trou nu n’est pas une porte', () => {
    for (const bit of BITS) expect(piecesDePorte(bit, 1).length, `arête ${NOM[bit]}`).toBeGreaterThanOrEqual(4)
  })

  it('CHAQUE frame est POSÉE — debout et éclairée', () => {
    // Une frame manquante ne lève pas : Phaser rend un damier magenta, et il n'apparaîtrait qu'à
    // la troisième image d'une animation, sur une seule des quatre arêtes.
    for (const bit of BITS) {
      for (let f = 0; f < PORTE_FRAMES.length; f++) {
        for (const cle of [`st-door-e${bit}-f${f}`, `st-door-e${bit}-f${f}_lit`]) {
          expect(EDGE_BARRIER_KEYS, `${cle} manque`).toContain(cle)
        }
      }
    }
  })

  it('AUCUN masque composite : une porte ne porte qu’une arête (R25)', () => {
    for (let m = 0; m < 16; m++) {
      if (m === N || m === E || m === S || m === O) continue
      expect(EDGE_BARRIER_KEYS.some((k) => k.startsWith(`st-door-e${m}-`)), `masque ${m} posé pour rien`).toBe(false)
    }
  })
})

/**
 * LA PORTE DOUBLE (spec construction R27, demande d'Alexis 2026-08-01) — « un seul cadre,
 * 2 battants se rejoignant au centre ».
 *
 * Les gardes relisent celles de la porte simple, sur les DEUX moitiés : le plan est pur
 * (`piecesDePorteDouble`), le passage est une définition (`passageDePorteDouble` — du jambage
 * extérieur à la LIMITE de tuile, là où les battants se rejoignent), et c'est leur confrontation
 * qui s'affirme, jamais une image. Ce que la porte simple ne pouvait pas dire et qui se dit ici :
 * le cadre est UN — chaque moitié n'a qu'un montant, et il est du côté extérieur.
 */
describe('la porte double — deux moitiés, un seul cadre (R27)', () => {
  const BITS = [N, E, S, O]
  const NOM: Record<number, string> = { 1: 'nord', 2: 'est', 4: 'sud', 8: 'ouest' }
  const MOITIES: readonly { premiere: boolean; nom: string }[] = [
    { premiere: true, nom: 'moitié a (ouest/nord)' },
    { premiere: false, nom: 'moitié b (est/sud)' },
  ]
  const OUVERTE = PORTE_FRAMES.length - 1

  const couverture = (bit: number, frame: number, premiere: boolean): number => {
    const p = passageDePorteDouble(bit, premiere)
    const pieces = piecesDePorteDouble(bit, PORTE_FRAMES[frame]!, premiere)
    let dedans = 0
    let total = 0
    for (let y = p.y + 0.5; y < p.y + p.h; y += 1) {
      for (let x = p.x + 0.5; x < p.x + p.w; x += 1) {
        total += 1
        if (pieces.some((q) => x >= q.x && x <= q.x + q.w && y >= q.y && y <= q.y + q.h)) dedans += 1
      }
    }
    return total === 0 ? 0 : dedans / total
  }
  const recouvre = (
    a: { x: number; y: number; w: number; h: number },
    b: { x: number; y: number; w: number; h: number },
  ): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

  it('le passage d’une moitié gagne exactement UN montant sur la porte simple', () => {
    // C'est la définition du cadre unique : là où la porte simple retranche deux jambages de sa
    // tuile, une moitié n'en retranche qu'un — l'autre bout est la limite de tuile, le centre.
    for (const bit of BITS) {
      const simple = passageDePorte(bit)
      for (const { premiere, nom } of MOITIES) {
        const p = passageDePorteDouble(bit, premiere)
        const leLong = bit === N || bit === S ? p.w : p.h
        const simpleLeLong = bit === N || bit === S ? simple.w : simple.h
        expect(leLong, `arête ${NOM[bit]}, ${nom}`).toBe(simpleLeLong + ENCADREMENT_POST)
      }
    }
  })

  it('FERMÉE, chaque moitié BOUCHE jusqu’au CENTRE : tout le passage est couvert', () => {
    // Le battant va jusqu'à la limite de tuile — c'est « se rejoignant au centre » : côté centre,
    // c'est LUI qui couvre, puisqu'aucun montant n'y existe (garde suivante).
    for (const bit of BITS) {
      for (const { premiere, nom } of MOITIES) {
        expect(couverture(bit, 0, premiere), `arête ${NOM[bit]}, ${nom}`).toBe(1)
      }
    }
  })

  it('OUVERTE, le passage ENTIER est libre — donc AUCUN montant au centre', () => {
    // La garde du cadre unique : le passage inclut la bande où une porte simple dresse son
    // second jambage. S'il en restait un — deux montants dos à dos au milieu du cadre, le
    // défaut des deux portes simples mitoyennes — cette assertion le verrait mordre.
    for (const bit of BITS) {
      for (const { premiere, nom } of MOITIES) {
        const passage = passageDePorteDouble(bit, premiere)
        expect(passage.w, `arête ${NOM[bit]}, ${nom} : le passage a une largeur`).toBeGreaterThan(0)
        expect(passage.h, `arête ${NOM[bit]}, ${nom} : le passage a une hauteur`).toBeGreaterThan(0)
        for (const p of piecesDePorteDouble(bit, PORTE_FRAMES[OUVERTE]!, premiere)) {
          expect(recouvre(p, passage), `arête ${NOM[bit]}, ${nom} : ${p.x},${p.y} ${p.w}×${p.h} mord le passage`).toBe(false)
        }
      }
    }
  })

  it('UN SEUL support vertical par moitié — et les deux moitiés ont chacune le leur', () => {
    // Sur une arête horizontale, le jambage se reconnaît à sa signature (largeur `POST`, toute
    // la hauteur sous le linteau) ; la porte simple en dresse DEUX, une moitié UN seul.
    for (const bit of [N, S]) {
      const jambages = (pieces: readonly { w: number; h: number }[]): number =>
        pieces.filter((p) => p.w === ENCADREMENT_POST && p.h > 8).length
      expect(jambages(piecesDePorte(bit, 0)), `arête ${NOM[bit]} : la simple a deux jambages`).toBe(2)
      for (const { premiere, nom } of MOITIES) {
        expect(jambages(piecesDePorteDouble(bit, 0, premiere)), `arête ${NOM[bit]}, ${nom}`).toBe(1)
      }
    }
    // Sur une verticale, même chose avec les dormants du ruban. Leur signature au repos : plus
    // d'un pixel de haut — la feuillure et les tranches du battant à plat font 1 px chacune, et
    // les DEUX dormants n'ont pas la même hauteur (le nord porte l'élévation du mur, le sud le
    // seul débord de bande) : un plancher plus haut raterait le sud.
    for (const bit of [E, O]) {
      const dormants = (pieces: readonly { w: number; h: number }[]): number =>
        pieces.filter((p) => p.h > 1).length
      expect(dormants(piecesDePorte(bit, 0)), `arête ${NOM[bit]} : la simple a deux dormants`).toBe(2)
      for (const { premiere, nom } of MOITIES) {
        expect(dormants(piecesDePorteDouble(bit, 0, premiere)), `arête ${NOM[bit]}, ${nom}`).toBe(1)
      }
    }
  })

  it('le montant restant est du côté EXTÉRIEUR — jamais au centre', () => {
    // La moitié `a` (ouest/nord) garde son support AVANT le passage, la `b` APRÈS — dans l'axe
    // de l'arête. Un montant qui glisserait au centre inverserait ces positions.
    for (const bit of BITS) {
      const horizontal = bit === N || bit === S
      for (const { premiere, nom } of MOITIES) {
        const passage = passageDePorteDouble(bit, premiere)
        const support = horizontal
          ? piecesDePorteDouble(bit, 0, premiere).find((p) => p.w === ENCADREMENT_POST && p.h > 8)!
          : piecesDePorteDouble(bit, 0, premiere).find((p) => p.h > 1)!
        const avant = horizontal ? support.x + support.w <= passage.x : support.y + support.h <= passage.y
        const apres = horizontal ? support.x >= passage.x + passage.w : support.y >= passage.y + passage.h
        expect(premiere ? avant : apres, `arête ${NOM[bit]}, ${nom} : montant côté extérieur`).toBe(true)
      }
    }
  })

  it('ÇA S’ANIME VRAIMENT, en miroir : chaque moitié bouge à chaque frame et dégage en s’ouvrant', () => {
    const silhouette = (bit: number, f: number, premiere: boolean): string =>
      piecesDePorteDouble(bit, PORTE_FRAMES[f]!, premiere)
        .map((q) => `${q.x},${q.y},${q.w},${q.h},${q.ton}`)
        .sort()
        .join('|')
    for (const bit of BITS) {
      for (const { premiere, nom } of MOITIES) {
        const parts = PORTE_FRAMES.map((_, f) => couverture(bit, f, premiere))
        for (let f = 1; f < PORTE_FRAMES.length; f++) {
          expect(silhouette(bit, f, premiere), `arête ${NOM[bit]}, ${nom} : la frame ${f} est identique à la ${f - 1}`)
            .not.toBe(silhouette(bit, f - 1, premiere))
          expect(parts[f]!, `arête ${NOM[bit]}, ${nom} : le passage se rebouche (${parts.join(' → ')})`)
            .toBeLessThanOrEqual(parts[f - 1]!)
          if (parts[f - 1]! > 0) {
            expect(parts[f]!, `arête ${NOM[bit]}, ${nom} : frame ${f} ne dégage rien (${parts.join(' → ')})`)
              .toBeLessThan(parts[f - 1]!)
          }
        }
      }
    }
  })

  it('les deux battants sont de vrais MIROIRS : jamais la même silhouette sur une frame ouverte', () => {
    // Deux moitiés identiques (un copier-coller de la `a`) passeraient toutes les gardes
    // précédentes — et à l'écran les deux battants pivoteraient du MÊME côté, l'un à travers
    // l'ouverture de l'autre. Le miroir se prouve par la différence.
    for (const bit of BITS) {
      for (let f = 1; f < PORTE_FRAMES.length; f++) {
        const a = piecesDePorteDouble(bit, PORTE_FRAMES[f]!, true).map((q) => `${q.x},${q.y},${q.w},${q.h}`).sort().join('|')
        const b = piecesDePorteDouble(bit, PORTE_FRAMES[f]!, false).map((q) => `${q.x},${q.y},${q.w},${q.h}`).sort().join('|')
        expect(a, `arête ${NOM[bit]}, frame ${f}`).not.toBe(b)
      }
    }
  })

  it('CHAQUE frame des DEUX familles est POSÉE — debout et éclairée, sans masque composite', () => {
    for (const fam of ['door2a', 'door2b']) {
      for (const bit of BITS) {
        for (let f = 0; f < PORTE_FRAMES.length; f++) {
          for (const cle of [`st-${fam}-e${bit}-f${f}`, `st-${fam}-e${bit}-f${f}_lit`]) {
            expect(EDGE_BARRIER_KEYS, `${cle} manque`).toContain(cle)
          }
        }
      }
      for (let m = 0; m < 16; m++) {
        if (m === N || m === E || m === S || m === O) continue
        expect(EDGE_BARRIER_KEYS.some((k) => k.startsWith(`st-${fam}-e${m}-`)), `masque ${m} posé pour rien`).toBe(false)
      }
    }
  })

  it('une moitié de porte double ne se TRANCHE pas non plus (R26/R27)', () => {
    expect(COUPE_DE.door2a, 'la moitié a resterait un battant invisible').toBeUndefined()
    expect(COUPE_DE.door2b, 'la moitié b resterait un battant invisible').toBeUndefined()
  })
})

describe('l’empreinte d’un pan tombé', () => {
  /**
   * CHAQUE FAMILLE DEBOUT A SON EMPREINTE, ET ELLE EXISTE VRAIMENT.
   *
   * Le défaut qu'on ferme : `snapshot-view` choisissait l'empreinte dans une cascade à défaut, et
   * une famille qu'aucune branche ne nommait retombait sur celle du MUR. La porte OUVERTE y est
   * passée — elle affichait la barre pleine d'un mur au moment précis où le joueur la franchit.
   * Rien ne levait, et la seule garde qu'on avait affirmait que la texture CHANGE, pas qu'elle
   * reste une porte : une assertion trop faible vaut un test absent.
   */
  it('nomme une empreinte pour chaque famille, et chacune est POSÉE', () => {
    for (const [debout, coupe] of Object.entries(COUPE_DE)) {
      const cle = `st-${coupe}-e1`
      expect(EDGE_BARRIER_KEYS, `${debout} : l’empreinte ${cle} n’est pas posée`).toContain(cle)
    }
  })

  /**
   * CE QUI RESTE DEBOUT SE DIT PAR L'ABSENCE — et l'absence, ça se garde.
   *
   * Décision d'Alexis (2026-07-30) : « contrairement aux murs, il faudrait que les portes soient
   * toujours visibles », étendue au seuil du bâti généré (« idem pour un encadrement de porte
   * sans porte »). `snapshot-view` ne tranche que ce que `COUPE_DE` nomme : une famille qui n'y
   * figure pas garde son sprite debout, quel que soit son pan.
   *
   * Sans cette garde, la règle ressemblerait à un OUBLI — la table dit « chaque famille a son
   * empreinte » deux tests plus haut, et le premier lecteur venu recollerait `door: 'door-coupe'`
   * en croyant réparer un trou. On affirme donc les deux moitiés : ce qui tombe, et ce qui non.
   */
  it('la PORTE et le SEUIL n’ont AUCUNE empreinte — ils restent debout', () => {
    expect(COUPE_DE.door, 'une porte qui se tranche : son battant ne se voit plus pivoter').toBeUndefined()
    expect(COUPE_DE.encadrement, 'un seuil qui se tranche : l’entrée disparaît avec le mur').toBeUndefined()
    // Et aucune texture d'empreinte ne traîne derrière elles : ce qui n'est plus choisi n'est
    // plus dessiné (sinon la liste des clés promet un art que personne ne verra jamais).
    expect(EDGE_BARRIER_KEYS.some((k) => k.startsWith('st-door-coupe')), 'st-door-coupe-* survit').toBe(false)
    expect(BATI_KEYS.some((k) => k.startsWith('st-encadrement-coupe')), 'st-encadrement-coupe-* survit').toBe(false)
  })

  it('le mur RUINÉ partage l’empreinte du neuf — collapse VOULU, donc écrit', () => {
    // Une empreinte au sol n'a ni appareil ni usure : les deux se valent, et c'est une décision.
    expect(COUPE_DE['wall-ruine']).toBe(COUPE_DE.wall)
  })
})

describe('la crête ébréchée', () => {
  it('ne mord JAMAIS le bord qui a un voisin — sinon la grille des tuiles se voit', () => {
    for (let mask = 0; mask < 16; mask++) {
      for (let graine = 0; graine < 40; graine++) {
        const p = profilDeCrete(mask, graine)
        // Le premier pixel d'un bord accosté doit être intact ; le second peut mordre d'un
        // seul pixel (l'entaille rentre en pente, elle ne se coupe pas net).
        if (mask & O) {
          expect(p[0], `masque ${mask} graine ${graine} : entaille au bord ouest`).toBe(0)
          expect(p[1]!).toBeLessThanOrEqual(1)
        }
        if (mask & E) {
          expect(p[15], `masque ${mask} graine ${graine} : entaille au bord est`).toBe(0)
          expect(p[14]!).toBeLessThanOrEqual(1)
        }
      }
    }
  })

  it('reste bornée : une ruine, pas un tas', () => {
    for (let mask = 0; mask < 16; mask++) {
      for (const d of profilDeCrete(mask, mask * 13 + 5)) {
        expect(d).toBeGreaterThanOrEqual(0)
        expect(d).toBeLessThanOrEqual(4)
      }
    }
  })

  it('ébrèche VRAIMENT : un mur droit lirait « entretenu »', () => {
    const p = profilDeCrete(N | S, 5) // ni voisin est, ni voisin ouest : crête entièrement libre
    expect(Math.max(...p)).toBeGreaterThanOrEqual(2)
    expect(new Set(p).size).toBeGreaterThan(1) // et un profil, pas un plateau
  })

  it('est déterministe : deux boots donnent la même ruine', () => {
    expect(profilDeCrete(9, 122)).toEqual(profilDeCrete(9, 122))
  })
})
