/**
 * ═══ LE PLATEAU — les gardes du dessin (spec `etages.md` §5) ═══
 *
 * Tout ce fichier tient dans une phrase, et c'est celle que la première écriture a ratée :
 * **une hauteur se lit à la VALEUR, pas à la forme.** Le premier jet posait sur le chapeau de
 * mesa un gravier de la famille de l'éboulis (`0x8e8a81`) — or une butte nue est CEINTE
 * d'éboulis (`TERRAIN_COLORS[9] = 0x96928a`). À l'écran, le plateau et sa jupe faisaient la même
 * nappe : la butte ne se soulevait pas d'un pouce. Rien dans le code ne pouvait le dire ; il a
 * fallu une capture.
 *
 * Ces gardes rendent ce refus REJOUABLE. Elles n'affirment pas « c'est joli » — elles affirment
 * l'ORDRE des valeurs, qui est la seule chose qui décide si une masse monte ou creuse.
 */
import { describe, expect, it } from 'vitest'
import { PAROI_RANGEES, dessinDeParoi, dessinDuDessus, type RectArt } from './cliff-art'
import {
  PERIODE_DALLE, RAMPE_RANGEES, TERRAINS_DE_PLATEAU, VARIANTES_SOL,
  dessinDeRampe, dessinDuSolDePlateau, souLeCiel,
} from './plateau-art'
import { TERRAIN_BOULDERS, TERRAIN_JUNIPER_HEATH, TERRAIN_SCREE } from '@ashes/sim'
import { LIFT_TUILES } from './framing'
import { TERRAIN_COLORS } from './terrain-colors'

/** La luminance perçue d'une couleur 0xRRGGBB — la seule mesure qui décide « clair » ou « sombre ». */
function lum(c: number): number {
  return 0.2126 * ((c >> 16) & 255) + 0.7152 * ((c >> 8) & 255) + 0.0722 * (c & 255)
}

/** La couleur du pixel (x, y) : le DERNIER rectangle qui le recouvre, comme le fait le Graphics. */
function pixel(rects: readonly RectArt[], x: number, y: number): number {
  let c = -1
  for (const r of rects) {
    if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) c = r.c
  }
  return c
}

/** La luminance MOYENNE d'une figure de 16×16 — sa valeur, telle que l'œil la somme de loin. */
function valeur(rects: readonly RectArt[]): number {
  let s = 0
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) s += lum(pixel(rects, x, y))
  return s / 256
}

const SOL_PLEIN = dessinDuSolDePlateau(0, TERRAIN_SCREE)
/** TOUTES les figures du sol — c'est sur elles qu'on mesure, pas sur une tuile choisie : le grain
 *  qu'un œil somme sur un plateau est celui de la SURFACE, et il varie d'une phase à l'autre. */
const SOL_TOUTES = Array.from({ length: VARIANTES_SOL }, (_, v) => dessinDuSolDePlateau(v, TERRAIN_SCREE))

/** La luminance moyenne et l'écart-type d'un jeu de figures — la mesure du GRAIN. */
function grain(figures: readonly RectArt[][]): { moy: number; ec: number; relatif: number } {
  const v: number[] = []
  for (const f of figures) for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) v.push(lum(pixel(f, x, y)))
  const moy = v.reduce((a, b) => a + b, 0) / v.length
  const ec = Math.sqrt(v.reduce((a, b) => a + (b - moy) ** 2, 0) / v.length)
  return { moy, ec, relatif: ec / moy }
}

/** L'éboulis du terrain — la JUPE qui ceint toute butte nue. C'est CONTRE elle qu'on se détache. */
const EBOULIS = TERRAIN_COLORS[9]!

describe('le sol du plateau — la valeur dit la hauteur', () => {
  it('LE REFUS DU 2026-09-01 : le dessus est plus CLAIR que sa paroi ET que la jupe qui l’entoure', () => {
    const v = grain(SOL_TOUTES).moy
    // Contre la PAROI (l'ardoise de `cliff-art`, toutes phases confondues) : elle est le flanc,
    // elle n'a pas le ciel. Sans cet écart, la mesa se lit comme un trou.
    for (let variant = 0; variant < 8; variant++) {
      expect(v, `paroi variante ${variant}`).toBeGreaterThan(valeur(dessinDeParoi(0, variant)) + 30)
    }
    // Contre le DESSUS D'ARDOISE qu'il recouvre : sinon on n'aurait rien changé.
    expect(v).toBeGreaterThan(valeur(dessinDuDessus(0, 0)) + 40)
    // ⚠ **ET CONTRE LA JUPE D'ÉBOULIS** — c'est CELLE-CI qui a manqué, et elle seule pouvait
    // attraper le premier jet : il était plus sombre que l'éboulis, donc noyé dedans.
    expect(v, 'le dessus doit dominer la jupe de pierrier').toBeGreaterThan(lum(EBOULIS) + 10)
  })

  it('LE REFUS DU MÉTAL : le grain se mesure en RELATIF, et la surface n’est pas neutre', () => {
    /**
     * ⚠ Alexis, 2026-09-01 : *« pourquoi la butte semble métallique ? »*. MESURÉ à ce moment-là :
     * **2,9 % de contraste relatif** (écart-type 4,8 sur une luminance de 167) quand l'ardoise
     * qu'elle remplace en fait **5,4 %**. La faute n'était pas le grain — il n'avait pas bougé —
     * c'était la VALEUR : en passant de 73 à 167 sans monter le grain, j'avais divisé par deux
     * la texture perçue. L'œil lit le grain en RELATIF ; un aplat clair, lisse et neutre, bordé
     * d'un liseré net, c'est la signature d'une tôle.
     *
     * Les deux moitiés du défaut sont gardées séparément : le grain, et la SATURATION (j'avais
     * éclairci en tirant vers le blanc, ce qui désature — 8,4 %, la valeur la plus basse du cadre).
     */
    const g = grain(SOL_TOUTES)
    const ardoise = grain([dessinDuDessus(0, 0), dessinDuDessus(0, 1)])
    expect(g.relatif, 'le grain PERÇU tient celui de l’ardoise qu’il remplace')
      .toBeGreaterThanOrEqual(ardoise.relatif)
    expect(g.relatif, '…sans virer à la paroi : un dessus n’est pas un mur').toBeLessThan(0.15)
    /**
     * ⚠ **LA MOITIÉ « SATURATION » A DÛ ÊTRE REFORMULÉE le 2026-09-01**, quand la palette de la
     * roche est passée de l'ardoise inventée à la PIERRE du jeu (`TERRAIN_COLORS[TERRAIN_ROCK]`).
     * Elle comparait la teinte du plateau à celle du dessus de falaise — un étalon qui a bougé :
     * la pierre est **quasi neutre par nature** (2,7 % de saturation), et exiger « plus tinté
     * qu'elle » ne veut plus dire grand-chose. C'est le GRAIN, mesuré juste au-dessus, qui porte
     * désormais tout le refus du métal.
     *
     * Ce qui reste vrai et VÉRIFIABLE, c'est que la dérivation ne NEUTRALISE pas la pierre : le
     * dessus de plateau garde exactement le rapport de canaux de la roche dont il sort. Un jour
     * où quelqu'un « éclaircirait vers le blanc » (la faute d'origine, qui désature), ce rapport
     * s'écraserait vers 1 et la garde rougirait.
     */
    const pierre = TERRAIN_COLORS[5]!
    const base = souLeCiel(TERRAIN_SCREE)
    const rapport = (c: number): number => ((c & 255) === 0 ? 1 : ((c >> 16) & 255) / (c & 255))
    expect(rapport(base), 'le plateau garde le rapport de canaux de sa pierre')
      .toBeCloseTo(rapport(pierre), 2)
  })

  it('LA STRUCTURE TRAVERSE LES TUILES : la période de dalle marche, elle ne se referme pas', () => {
    // La leçon des colonnes de paroi, reprise : un motif qui se referme sur la tuile se lit comme
    // un joint de maçonnerie — et un aplat répété à l'identique sur 96 tuiles fait une PLAQUE.
    // Deux phases voisines doivent donc différer AILLEURS qu'au bord.
    const cœur = (v: number): string => {
      const d = dessinDuSolDePlateau(v, TERRAIN_SCREE)
      let s2 = ''
      for (let y = 2; y < 14; y++) for (let x = 2; x < 14; x++) s2 += pixel(d, x, y).toString(16)
      return s2
    }
    const vues = new Set<string>()
    for (let phase = 0; phase < PERIODE_DALLE * PERIODE_DALLE; phase++) vues.add(cœur(phase))
    expect(vues.size, 'chaque phase de la période a son propre cœur').toBe(PERIODE_DALLE * PERIODE_DALLE)
  })

  it('elle est FROIDE là où la jupe est chaude : deux teintes, pas seulement deux valeurs', () => {
    // La roche du plateau est la MÊME que celle de la paroi (violette) ; l'éboulis du sol est
    // ocre. Le bleu au-dessus du rouge d'un côté, l'inverse de l'autre — un œil ne peut pas les
    // confondre même à valeur égale, et c'est ce qui tient si l'on reteinte un jour la saison.
    const c = pixel(SOL_PLEIN, 8, 8)
    expect(c & 255, 'le plateau : bleu > rouge').toBeGreaterThan((c >> 16) & 255)
    expect(EBOULIS & 255, 'l’éboulis : bleu < rouge').toBeLessThan((EBOULIS >> 16) & 255)
  })

  it('chaque tuile est PLEINE : pas un pixel transparent, sinon le plateau serait troué', () => {
    for (const t of TERRAINS_DE_PLATEAU) {
      for (let v = 0; v < VARIANTES_SOL; v++) {
        const d = dessinDuSolDePlateau(v, t)
        for (let y = 0; y < 16; y++) {
          for (let x = 0; x < 16; x++) expect(pixel(d, x, y), `terrain ${t} phase ${v} (${x},${y})`).toBeGreaterThanOrEqual(0)
        }
      }
    }
  })

  it('LE TERRAIN SE VOIT : trois terrains, trois teintes distinctes — à valeur ÉGALE', () => {
    /**
     * ⚠ *« on doit appliquer le terrain… comme le reste de la map »* (Alexis, 2026-09-01).
     * Premier essai : mêler la couleur du terrain à la lumière de la roche puis ramener la valeur.
     * Résultat mesuré — `#a8a2ab`, `#aaa2a9`, `#a9a496` : **trois gris qu'on ne distingue pas**.
     * Normaliser la valeur écrase la différence quand celle-ci EST une différence de valeur, ce
     * qui est le cas de deux roches. On prend donc la CHROMA (la couleur à luminance égale) et on
     * l'amplifie, PUIS on ramène la valeur.
     */
    const trois = TERRAINS_DE_PLATEAU.map(souLeCiel)
    // ① Même valeur : c'est elle qui dit « en haut », aucun terrain n'a le droit d'y toucher.
    for (const c of trois) expect(Math.abs(lum(c) - lum(trois[0]!)), 'même bande de valeur').toBeLessThan(2)
    // ② Teintes SÉPARÉES : on compare le canal bleu, celui qui porte froid/chaud dans ce jeu.
    const bleus = trois.map((c) => c & 255)
    for (let i = 0; i < bleus.length; i++) {
      for (let j = i + 1; j < bleus.length; j++) {
        expect(Math.abs(bleus[i]! - bleus[j]!), `terrains ${i} et ${j} discernables`).toBeGreaterThan(8)
      }
    }
    // ③ LE DESSIN S'EN SERT VRAIMENT — sans quoi la loi serait juste et la tuile fausse. On le
    //    lit sur une figure SANS tache ni gravier à cet endroit : le coin d'une phase neutre.
    const surLeSol = new Set<number>()
    for (const t of TERRAINS_DE_PLATEAU) {
      for (let v = 0; v < VARIANTES_SOL; v++) surLeSol.add(pixel(dessinDuSolDePlateau(v, t), 8, 8))
    }
    expect(surLeSol.size, 'les trois terrains produisent des pixels différents').toBeGreaterThan(2)
    // ④ Le genévrier est le plus CHAUD des trois (c'est du végétal), les blocs restent minéraux.
    expect(souLeCiel(TERRAIN_JUNIPER_HEATH) & 255, 'le genévrier tire vers l’ocre')
      .toBeLessThan(souLeCiel(TERRAIN_BOULDERS) & 255)
  })
})

describe('la rampe — une entaille qui monte', () => {
  it('elle gravit le LIFT d’un étage, et pose son tablier au sol : une rangée de plus', () => {
    // ⚠ Depuis le lift (2026-09-01), la rampe ne coupe plus un mur : elle GRAVIT la hauteur dont
    // la surface est décalée. Sa hauteur en dérive — écrite à part, elle laisserait une marche
    // dans le vide le jour où le lift changerait.
    expect(RAMPE_RANGEES).toBe(LIFT_TUILES + 1)
    // ⚠ ÉGAL, plus « +1 » (Alexis, 2026-09-01) : une mesa peignait TROIS rangées de paroi quand
    // une falaise ordinaire n'en peint que `PAROI_RANGEES` — les deux falaises du jeu n'avaient
    // pas la même hauteur. C'est aussi le PLANCHER du lift : au-dessus, il resterait un trou
    // entre le sol du bas et le dessus du haut.
    expect(LIFT_TUILES, 'le lift vaut la hauteur qu’une paroi sait dessiner').toBe(PAROI_RANGEES)
  })

  /** Les 48 pixels de la rampe, du haut (contre le plateau) au pied, dans l'ordre. */
  function colonne(cotes = 0): number[] {
    const v: number[] = []
    for (let rang = 0; rang < RAMPE_RANGEES; rang++) {
      const d = dessinDeRampe(rang, cotes)
      for (let y = 0; y < 16; y++) v.push(lum(pixel(d, 8, y)))
    }
    return v
  }

  it('LA CHUTE EST CONTINUE SUR TOUTE LA HAUTEUR — la limite de tuile n’annonce rien', () => {
    /**
     * La leçon que la paroi a payée sur planche : dès qu'un motif se referme sur la tuile, la
     * couture se lit comme un joint de maçonnerie — « deux rangées à tons plats font une assise
     * de grosses briques ». Ici la pente EST la chute ; si elle se répétait par rangée, la rampe
     * rendrait trois marches identiques, c'est-à-dire rien.
     *
     * On l'affirme là où ça se joue : le saut de valeur À LA COUTURE ne doit pas dépasser le plus
     * gros saut qui vit à l'INTÉRIEUR d'une rangée (la contremarche). Une rampe périodique à la
     * tuile ferait à la couture un bond bien plus grand que tous les autres.
     */
    const v = colonne()
    let sautMax = 0
    for (let i = 1; i < v.length; i++) {
      if (i % 16 === 0) continue // les coutures, jugées à part
      sautMax = Math.max(sautMax, Math.abs(v[i]! - v[i - 1]!))
    }
    for (let rang = 1; rang < RAMPE_RANGEES; rang++) {
      const i = rang * 16
      expect(Math.abs(v[i]! - v[i - 1]!), `couture après la rangée ${rang - 1}`).toBeLessThanOrEqual(sautMax)
    }
  })

  it('elle DESCEND : le pied est franchement plus sombre que le haut, et le haut rejoint le plateau', () => {
    const v = colonne()
    // ⚠ LA CHUTE SE MESURE EN RELATIF depuis que la rampe gravit QUATRE rangées et non trois :
    // le facteur total (0,38) est le même, il se répartit sur une hauteur plus grande — l'écart
    // absolu entre deux pixels voisins baisse donc, mais la pente, elle, ne bouge pas.
    expect(v[0]! - v[v.length - 1]!, 'du haut au pied').toBeGreaterThan(v[0]! * 0.2)
    // Et son sommet est du plateau : la rampe ne se détache pas du sol qu'elle sert.
    expect(Math.abs(v[0]! - lum(pixel(SOL_PLEIN, 8, 8)))).toBeLessThan(22)
  })

  it('LES MARCHES ONT UN NEZ : une contremarche sombre PRÉCÉDÉE d’un nez clair (sinon c’est un grillage)', () => {
    /**
     * ⚠ Le deuxième refus à l'œil. Une simple ligne sombre tous les sept pixels rendait un
     * GRILLAGE : à plat, une rayure n'a pas de sens de montée. Une marche se lit par une PAIRE —
     * l'ombre de la contremarche, et juste au-dessus le nez qui prend le jour. C'est ce couple
     * qui dit d'où vient la lumière, donc quel côté est le haut.
     */
    const v = colonne()
    let paires = 0
    for (let i = 1; i < v.length; i++) {
      // une contremarche : nettement sous ses deux voisines
      if (v[i]! < v[i - 1]! - 12 && (i + 1 >= v.length || v[i]! < v[i + 1]!)) {
        expect(v[i - 1]!, `le nez au-dessus de la contremarche ${i}`).toBeGreaterThan(v[i - 2] ?? 0)
        paires += 1
      }
    }
    expect(paires, 'plusieurs marches sur la hauteur — jamais une par tuile').toBeGreaterThanOrEqual(4)
  })

  it('les JOUES ne se posent qu’aux bords déclarés : entre deux colonnes, l’entaille reste ouverte', () => {
    const nu = dessinDeRampe(0, 0)
    for (const cotes of [0, 2, 4, 6]) {
      const d = dessinDeRampe(0, cotes)
      expect(pixel(d, 0, 8) !== pixel(nu, 0, 8), `joue ouest, côtés ${cotes}`).toBe((cotes & 4) !== 0)
      expect(pixel(d, 15, 8) !== pixel(nu, 15, 8), `joue est, côtés ${cotes}`).toBe((cotes & 2) !== 0)
    }
    // Et la joue est de la ROCHE : plus sombre que le passage qu'elle borde, sinon elle ne creuse rien.
    // ⚠ **SUR LA MOYENNE DE LA COLONNE, et plus sur une rangée choisie.** La rangée 8 est
    // devenue une CONTREMARCHE quand la rampe est passée de trois à quatre rangées (le lift) :
    // on y comparait la joue au pixel le plus sombre du passage, et l'écart de 40 ne tenait plus
    // à un cheveu près. La propriété, elle, n'a pas bougé — la joue est de la ROCHE, elle est
    // franchement plus sombre que le passage qu'elle borde.
    const avec = dessinDeRampe(0, 6)
    const colonne = (x: number): number => {
      let s2 = 0
      for (let y = 0; y < 16; y++) s2 += lum(pixel(avec, x, y))
      return s2 / 16
    }
    expect(colonne(0), 'joue ouest').toBeLessThan(colonne(8) - 40)
    expect(colonne(15), 'joue est').toBeLessThan(colonne(8) - 40)
  })
})
