/**
 * LES GARDES DE LA CARTE-SAVOIR — modules purs (`carte-art`, `carte-savoir`), donc testables
 * sans navigateur : on peint dans un tampon et on lit des octets.
 */
import { describe, expect, it } from 'vitest'
import { CENDRE, type WorldMap } from '@ashes/sim'
import { creerBrouillard, estampilleCendre, revele } from './fog'
import { CARTE_ENCRE, peindreCarteArt, type CarteArt } from './carte-art'
import { peindreSavoirRegion } from './carte-savoir'

/** Une vallée jouet : de l'herbe partout, revendiquée par la fosse 0 à coût constant. */
function monde(cote: number, cout = 5): WorldMap {
  return {
    width: cote,
    height: cote,
    terrain: new Array<number>(cote * cote).fill(1),
    zones: [],
    cendreCout: new Array<number>(cote * cote).fill(cout * CENDRE.FOYERS_MAX + 0),
  } as unknown as WorldMap
}

function peindreTout(map: WorldMap, art: CarteArt, b: ReturnType<typeof creerBrouillard>, joueur: { x: number; y: number } | null): Uint8ClampedArray {
  const data = new Uint8ClampedArray(map.width * map.height * 4)
  peindreSavoirRegion(data, art, map, b, 2026, joueur, 22, 0, 0, b.cols - 1, b.rows - 1)
  return data
}

const px = (data: Uint8ClampedArray, map: WorldMap, tx: number, ty: number): string =>
  [0, 1, 2].map((c) => data[(ty * map.width + tx) * 4 + c]).join(',')

describe('la carte-savoir', () => {
  const ENCRE = [(CARTE_ENCRE >> 16) & 0xff, (CARTE_ENCRE >> 8) & 0xff, CARTE_ENCRE & 0xff].join(',')

  it('le jamais-vu est de l’ENCRE — on ne devine rien du pays derrière', () => {
    const map = monde(160)
    const art = peindreCarteArt(map, new Uint32Array(map.width * map.height).fill(0x3e7d3a))
    const b = creerBrouillard(160, 160) // rien n'est vu
    const data = peindreTout(map, art, b, { x: 80, y: 80 })
    expect(px(data, map, 80, 80)).toBe(ENCRE)
    expect(px(data, map, 20, 140)).toBe(ENCRE)
  })

  it('le disque de VUE est quantifié À LA CELLULE — exactement le motif de `revele`', () => {
    const map = monde(320)
    const art = peindreCarteArt(map, new Uint32Array(map.width * map.height).fill(0x3e7d3a))
    // Tout est déjà arpenté : seule la frontière vif/grisé reste à lire.
    const b = creerBrouillard(320, 320)
    revele(b, 160, 160, 9999)
    const joueur = { x: 161, y: 157 } // décentré dans sa cellule : le motif ne doit pas bouger
    const data = peindreTout(map, art, b, joueur)
    // Le TÉMOIN : les cellules qu'un `revele` de même centre et même rayon dévoilerait.
    const temoin = creerBrouillard(320, 320)
    revele(temoin, joueur.x, joueur.y, 22)
    for (let cy = 0; cy < b.rows; cy++) {
      for (let cx = 0; cx < b.cols; cx++) {
        const attendueVive = temoin.vu[cy * temoin.cols + cx] === 1
        // Chaque tuile de la cellule porte le même état, et c'est celui du témoin.
        const couleurCoin = px(data, map, cx * b.pas, cy * b.pas)
        const couleurFond = px(data, map, Math.min(319, cx * b.pas + b.pas - 1), Math.min(319, cy * b.pas + b.pas - 1))
        expect(couleurFond).toBe(couleurCoin)
        const coin = couleurCoin.split(',').map(Number)
        const vive = [0, 1, 2].map((c) => art.vive[(cy * b.pas * map.width + cx * b.pas) * 4 + c])
        expect(coin.join(',') === vive.join(',')).toBe(attendueVive)
      }
    }
  })

  it('l’arpenté hors de vue est GRISÉ — la matière `grise`, pas la vive', () => {
    const map = monde(160)
    const art = peindreCarteArt(map, new Uint32Array(map.width * map.height).fill(0x3e7d3a))
    const b = creerBrouillard(160, 160)
    revele(b, 40, 40, 30)
    const data = peindreTout(map, art, b, { x: 140, y: 140 }) // le joueur est loin
    const k = (40 * map.width + 40) * 4
    expect(px(data, map, 40, 40)).toBe([art.grise[k], art.grise[k + 1], art.grise[k + 2]].join(','))
    expect(px(data, map, 40, 40)).not.toBe([art.vive[k], art.vive[k + 1], art.vive[k + 2]].join(','))
  })

  it('la cendre se REDÉRIVE à l’avancée vue — estampillée elle se peint, vierge elle ne se peint pas', () => {
    const map = monde(160, 5)
    const art = peindreCarteArt(map, new Uint32Array(map.width * map.height).fill(0x3e7d3a))
    const b = creerBrouillard(160, 160)
    revele(b, 40, 40, 20)
    revele(b, 120, 120, 20)
    // Seul le coin (40,40) a VU le front : avancée large — tout son disque brûle (coût 5).
    estampilleCendre(b, map, 40, 40, 20, [50])
    const data = peindreTout(map, art, b, null)
    const kA = (40 * map.width + 40) * 4
    const kB = (120 * map.width + 120) * 4
    // Là où on a vu : plus la matière grise du sol — la cendre a pris (grisée, hors de vue).
    expect(px(data, map, 40, 40)).not.toBe([art.grise[kA], art.grise[kA + 1], art.grise[kA + 2]].join(','))
    // Là où on n'a RIEN vu du front : le sol d'origine, même si la sim y mettrait de la cendre.
    expect(px(data, map, 120, 120)).toBe([art.grise[kB], art.grise[kB + 1], art.grise[kB + 2]].join(','))
  })
})

describe('l’art de la carte', () => {
  it('le CADRE du monde (masse minérale connexe au bord) s’éteint vers l’encre', () => {
    const cote = 200
    const terrain = new Array<number>(cote * cote)
    for (let y = 0; y < cote; y++) {
      for (let x = 0; x < cote; x++) {
        const d = Math.min(x, y, cote - 1 - x, cote - 1 - y)
        terrain[y * cote + x] = d < 50 ? 5 : 1
      }
    }
    const map = { width: cote, height: cote, terrain, zones: [] } as unknown as WorldMap
    const art = peindreCarteArt(map, new Uint32Array(cote * cote).fill(0x3e7d3a))
    const luma = (k: number): number => 0.299 * art.vive[k]! + 0.587 * art.vive[k + 1]! + 0.114 * art.vive[k + 2]!
    // Au cœur du bandeau : presque l'encre. Au cœur de la vallée : nettement plus clair.
    expect(luma((25 * cote + 25) * 4)).toBeLessThan(45)
    expect(luma((100 * cote + 100) * 4)).toBeGreaterThan(80)
  })

  it('un massif minéral INTÉRIEUR n’est pas pris pour le cadre', () => {
    const cote = 200
    const terrain = new Array<number>(cote * cote).fill(1)
    // Un karst au centre, à des lieues du bord.
    for (let y = 90; y < 110; y++) for (let x = 90; x < 110; x++) terrain[y * cote + x] = 5
    const map = { width: cote, height: cote, terrain, zones: [] } as unknown as WorldMap
    const art = peindreCarteArt(map, new Uint32Array(cote * cote).fill(0x3e7d3a))
    const k = (100 * cote + 100) * 4
    const luma = 0.299 * art.vive[k]! + 0.587 * art.vive[k + 1]! + 0.114 * art.vive[k + 2]!
    expect(luma).toBeGreaterThan(60) // la roche assagie, pas l'encre du cadre
  })
})

describe('les parois de terrasse (spec `ascension.md` V-R8)', () => {
  /**
   * UN FLANC JOUET : de l'herbe partout, deux paliers séparés par une rupture est-ouest. Les
   * rangées au nord de `COUPE` sont au palier 1, celles au sud au palier 0 — exactement la
   * forme du versant joué, où l'on monte vers le nord.
   *
   * ⚠ `terrain` est UNIFORME : c'est tout l'enjeu. Si la carte dessine quelque chose ici, elle
   * ne peut le tenir que de `map.palier` — `TERRAIN_CLIFF` n'est écrit sur AUCUNE de ces tuiles,
   * et `terrasses.ts` n'en écrit nulle part dans le vrai monde non plus.
   */
  const COTE = 120
  const COUPE = 60
  const flanc = (connecteurs: unknown[] = [], avecPalier = true): WorldMap => {
    const palier = new Array<number>(COTE * COTE)
    for (let y = 0; y < COTE; y++) for (let x = 0; x < COTE; x++) palier[y * COTE + x] = y < COUPE ? 1 : 0
    return {
      width: COTE, height: COTE, terrain: new Array<number>(COTE * COTE).fill(1), zones: [],
      palier: avecPalier ? palier : undefined, connecteurs,
    } as unknown as WorldMap
  }
  const SOL = new Uint32Array(COTE * COTE).fill(0x3e7d3a)
  const luma = (art: CarteArt, x: number, y: number): number => {
    const k = (y * COTE + x) * 4
    return 0.299 * art.vive[k]! + 0.587 * art.vive[k + 1]! + 0.114 * art.vive[k + 2]!
  }
  /** L'encre de falaise est la matière la plus sombre de la palette carte hors eau et hors
   *  cadre : sur un flanc tout en herbe, un seuil de luminance la sépare sans ambiguïté. */
  const ENCRE_MAX = 55

  it('la CRÊTE porte le trait, le PIED porte l’ombre — `terrain` ne dit pourtant rien', () => {
    const art = peindreCarteArt(flanc(), SOL)
    // La crête (dernière rangée du palier haut) est de l'encre.
    expect(luma(art, 30, COUPE - 1)).toBeLessThan(ENCRE_MAX)
    // Le PIED n'a PAS de trait — un seul par rupture, sinon le mur ferait deux lignes.
    expect(luma(art, 30, COUPE)).toBeGreaterThan(ENCRE_MAX)
    // …mais il s'assombrit : l'ombre portée, l'idiome de la falaise appliqué à la terrasse.
    expect(luma(art, 30, COUPE)).toBeLessThan(luma(art, 30, COUPE + 5) - 3)
    // Et loin de la rupture, le sol est intact des deux côtés.
    expect(luma(art, 30, COUPE - 20)).toBeGreaterThan(ENCRE_MAX)
  })

  it('la RAMPE fait une trouée : le mur s’ouvre là où l’on monte, et LÀ SEULEMENT', () => {
    const art = peindreCarteArt(flanc([{ x: 30, y: COUPE, de: 0, vers: 1, type: 'rampe' }]), SOL)
    // La crête que la rampe rejoint n'est plus encrée…
    expect(luma(art, 30, COUPE - 1)).toBeGreaterThan(ENCRE_MAX)
    // …ni ombrée à son pied : une ombre refermerait visuellement le passage qu'on vient d'ouvrir.
    expect(luma(art, 30, COUPE)).toBeGreaterThan(luma(art, 40, COUPE))
    // …et le reste du mur est intact. (Le contrôle POSITIF de l'épreuve : sans lui, une passe
    // qui effacerait tout le trait passerait au vert.)
    expect(luma(art, 40, COUPE - 1)).toBeLessThan(ENCRE_MAX)
    expect(luma(art, 20, COUPE - 1)).toBeLessThan(ENCRE_MAX)
  })

  it('une rampe de MESA n’ouvre RIEN — le `vers` d’un connecteur est un étage, pas un palier', () => {
    // ⚠ LE PIÈGE MESURÉ : `vers === de + 1` sur 1 105/1 105 rampes du monde joué, POSÉ et jamais
    // relu — 163 d'entre elles (graine 2026) montent sur un dessus de mesa, sans aucune terrasse
    // au-dessus d'elles. La trouée se dérive donc du CHAMP `palier`, jamais du connecteur : ici
    // aucune voisine du pied n'est au palier 2, donc le mur reste fermé.
    const art = peindreCarteArt(flanc([{ x: 30, y: COUPE, de: 1, vers: 2, type: 'rampe' }]), SOL)
    expect(luma(art, 30, COUPE - 1)).toBeLessThan(ENCRE_MAX)
  })

  it('sans `map.palier`, la carte ne bouge pas d’un octet — la vallée reste elle-même (F-A6)', () => {
    const art = peindreCarteArt(flanc([], false), SOL)
    // Pas un trait, pas une ombre : la passe est un no-op strict sur une carte sans terrasses.
    for (let x = 0; x < COTE; x += 7) {
      expect(luma(art, x, COUPE - 1)).toBeGreaterThan(ENCRE_MAX)
      expect(luma(art, x, COUPE)).toBeCloseTo(luma(art, x, COUPE + 5), 6)
    }
  })
})
