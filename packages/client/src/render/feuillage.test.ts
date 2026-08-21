import { describe, expect, it } from 'vitest'
import { assiseDe, CIMES_PAR_ARBRE, houppierLargeur, houppierOpaqueDe, TOUTES_VARIANTES } from './arbre-art'
import { champDeFeuillage, feuillageDe, FEUILLAGES } from './feuillage'

/**
 * DEUX TESTS DE CE FICHIER ONT UN BUDGET EXPLICITE (30 s), et ce n'est pas une rustine.
 *
 * Ils balaient TOUTES les variantes d'arbre × TOUTES les cimes — c'est leur valeur, et c'est
 * ce que le dépôt demande (« garde exhaustive plutôt que cas choisis »). Ils coûtent ~3,3 s
 * chacun sur cette machine, pour un budget vitest par défaut de 5 s : une marge d'un facteur
 * 1,5 sur un banc sans GPU, partagé avec trois autres suites. Le 2026-08-20, douze tests
 * neufs ont suffi à le faire basculer — `Test timed out in 5000ms`, sur un feuillage
 * parfaitement correct, dans un fichier qui n'importe RIEN et que rien n'avait touché.
 *
 * Un instrument qui rougit pour une raison étrangère à ce qu'il garde cesse d'être lu, et la
 * vraie panne s'y noie — c'est le constat P3 de l'audit UX, et on ne l'ajoute pas au compte.
 * On ne touche à aucune assertion : on donne au balayage le temps qu'il prend.
 */

/**
 * TOUTES les cimes de toutes les variantes — 11 × 5 depuis le 2026-07-30.
 *
 * Les gardes balaient ce produit et non la seule cime par défaut : c'est LA leçon du chantier.
 * Chaque contrat (une seule masse, la cime tient au tronc, elle garde sa matière) a été violé
 * par un cas particulier — le hêtre pour la découpe, l'arbre pour les îlots, le vieux pin pour
 * le feston. Une cinquième graine est une cinquième occasion de retomber dessus, et une garde
 * qui n'en éprouve qu'une sur cinq laisserait passer quatre cimes cassées.
 *
 * La graine suit `lit-trees` : `11 + cime × 7919`. Deux écritures d'une même formule finiraient
 * par diverger — mais la recopier ici EST le test : si `lit-trees` change de graines sans le
 * dire, ces gardes n'éprouvent plus ce que le jeu affiche. Un seul endroit à corriger, et il
 * est nommé.
 */
const CIMES = Array.from({ length: CIMES_PAR_ARBRE }, (_, i) => i)

function champDe(v: (typeof TOUTES_VARIANTES)[number], cime = 0) {
  const W = houppierLargeur(v.mesures)
  const H = v.mesures.houppierS
  return {
    W,
    H,
    dedans: houppierOpaqueDe(v),
    assise: assiseDe(v),
    grain: champDeFeuillage(
      feuillageDe(v.slug), W, H, houppierOpaqueDe(v), assiseDe(v),
      v.tons.corps, v.tons.lumiere, 11 + cime * 7919,
    ),
  }
}

/** Aire du masque, et périmètre rapporté à celui de sa boîte englobante. */
function forme(W: number, H: number, op: (x: number, y: number) => boolean) {
  let aire = 0
  let per = 0
  let minX = W, maxX = -1, minY = H, maxY = -1
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!op(x, y)) continue
      aire++
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        if (!op(x + dx, y + dy)) per++
      }
    }
  }
  const bw = maxX - minX + 1
  const bh = maxY - minY + 1
  return { aire, decoupe: per / (2 * (bw + bh)) }
}

describe('le feuillage donne une forme, sans défaire la cime', () => {
  /**
   * LA CANOPÉE DOIT FERMER LE CIEL. Premier échec MESURÉ : un seuil de découpe appliqué
   * PARTOUT faisait tomber les cimes à 0,48 de remplissage — la moitié de la masse envolée.
   * Une canopée trouée de part en part ne joue plus son rôle, et le voile de canopée du client
   * n'aurait plus rien à estomper.
   */
  it('garde au moins les trois quarts de la masse d\'origine', () => {
    for (const v of TOUTES_VARIANTES) for (const c of CIMES) {
      const { W, H, dedans, grain } = champDe(v, c)
      const avant = forme(W, H, dedans).aire
      const apres = forme(W, H, grain.opaque).aire
      expect(apres / avant, `${v.slug}#${c} : la cime a perdu trop de masse`).toBeGreaterThan(0.75)
    }
  })

  /**
   * ET ELLE NE DOIT PLUS ÊTRE UNE BOÎTE. Second échec MESURÉ : des touffes qui se recouvrent
   * rendent la masse mais remplissent aussi le bord — la découpe retombait à 1,10, c'est-à-dire
   * un rectangle. C'est la rampe de seuil (exigeante au contour, nulle vers l'intérieur) qui
   * tient les deux ; si elle disparaît, cette garde le dit.
   */
  it('découpe le contour — l\'union des rects d\'origine valait EXACTEMENT sa boîte', () => {
    for (const v of TOUTES_VARIANTES) for (const c of CIMES) {
      const { W, H, dedans, grain } = champDe(v, c)
      const avant = forme(W, H, dedans).decoupe
      const apres = forme(W, H, grain.opaque).decoupe
      // La garde interdit LA BOÎTE, elle ne fixe pas une quantité : le degré de découpe est un
      // réglage de DA (`echancrure`), et il a déjà bougé une fois sur constat d'Alexis. Le seuil
      // reste donc au plus près de l'égalité stricte — c'est « ce n'est plus un rectangle » qui
      // est un invariant, pas « c'est très déchiqueté ». Le vieux pin (56×23, la cime la plus
      // plate) est celui qui en a le moins : sa bande de bord n'a que 5 px pour festonner.
      expect(apres, `${v.slug}#${c} : le bord est resté une boîte`).toBeGreaterThan(avant + 0.02)
    }
  })

  /**
   * LA CIME REPOSE SUR LE FÛT. Sans cette protection, une découpe peut ajourer la zone
   * d'assise et le houppier se met à FLOTTER — la panne exacte que `assiseHouppier` garde
   * depuis le 2026-07-28, et qu'une découpe pourrait rouvrir par la bande.
   */
  it('ne creuse JAMAIS l\'assise', () => {
    for (const v of TOUTES_VARIANTES) for (const c of CIMES) {
      const { W, H, dedans, assise, grain } = champDe(v, c)
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (!assise(x, y) || !dedans(x, y)) continue
          expect(grain.opaque(x, y), `${v.slug}#${c} : assise ajourée en (${x}, ${y})`).toBe(true)
        }
      }
    }
  })

  /**
   * UNE SEULE MASSE, TOUJOURS. Constat d'Alexis, 2026-07-30 : « certains houppiers ont des
   * feuilles détachées du gros du houppier ». MESURÉ — 3 variantes sur 11 portaient un îlot
   * flottant (0,7 à 2,6 % de la cime), la découpe ayant emporté le pixel par lequel un lobe
   * tenait. Aucun réglage d'`echancrure` ne peut garantir la connexité : elle se POSE, par
   * propagation depuis l'assise. Cette garde est ce qui empêche de la reperdre.
   *
   * 4-voisinage : dans un art blocky, un pixel qui ne tient que par un coin se lit détaché.
   */
  it('ne laisse AUCUNE feuille détachée — la cime est d\'un seul tenant', () => {
    for (const v of TOUTES_VARIANTES) for (const c of CIMES) {
      const { W, H, grain } = champDe(v, c)
      const vu = new Uint8Array(W * H)
      let morceaux = 0
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (!grain.opaque(x, y) || vu[y * W + x]) continue
          morceaux++
          const pile = [[x, y]]
          vu[y * W + x] = 1
          while (pile.length) {
            const [cx, cy] = pile.pop()!
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
              const nx = cx! + dx
              const ny = cy! + dy
              if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
              if (!grain.opaque(nx, ny) || vu[ny * W + nx]) continue
              vu[ny * W + nx] = 1
              pile.push([nx, ny])
            }
          }
        }
      }
      expect(morceaux, `${v.slug}#${c} : ${morceaux} morceaux, des feuilles flottent`).toBe(1)
    }
  })

  it('ne déborde jamais la silhouette d\'origine', () => {
    // Le houppier ne grandit pas : `houppierS`, `hauteurPx` et le compte entier de tuiles (E1)
    // en dépendent. La découpe soustrait, elle n'ajoute pas.
    for (const v of TOUTES_VARIANTES) for (const c of CIMES) {
      const { W, H, dedans, grain } = champDe(v, c)
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (grain.opaque(x, y)) expect(dedans(x, y), `${v.slug}#${c} : débord en (${x}, ${y})`).toBe(true)
        }
      }
    }
  }, 30000)
})

describe('le feuillage porte de la MATIÈRE, pas de l\'ombrage', () => {
  /**
   * L'albédo `_lit` est aplati EXPRÈS pour que la lumière calculée le sculpte. Ce qu'on y pose
   * doit donc être un matériau — une masse de feuilles profonde n'a pas le ton d'une feuille de
   * plein soleil — et jamais un ombrage. La borne : on reste entre `corps` et `lumiere`, et on
   * ne touche pas à `ombre`, qui EST un ombrage.
   */
  it('les tons restent entre corps et lumière', () => {
    for (const v of TOUTES_VARIANTES) for (const c of CIMES) {
      const { grain } = champDe(v, c)
      const lum = (hex: string): number => {
        const n = parseInt(hex.slice(1), 16)
        return 0.2126 * ((n >> 16) & 0xff) + 0.7152 * ((n >> 8) & 0xff) + 0.0722 * (n & 0xff)
      }
      const bas = Math.min(lum(v.tons.corps), lum(v.tons.lumiere)) - 1
      const haut = Math.max(lum(v.tons.corps), lum(v.tons.lumiere)) + 1
      for (const t of grain.ton) {
        if (t === null) continue
        const m = /rgb\((\d+),(\d+),(\d+)\)/.exec(t)!
        const l = 0.2126 * Number(m[1]) + 0.7152 * Number(m[2]) + 0.0722 * Number(m[3])
        expect(l, `${v.slug}#${c} : ton hors de la fourchette de matière`).toBeGreaterThanOrEqual(bas)
        expect(l, `${v.slug}#${c} : ton hors de la fourchette de matière`).toBeLessThanOrEqual(haut)
      }
    }
  }, 30000)

  it('l\'albédo n\'est plus UNIFORME — c\'était tout le défaut', () => {
    // MESURÉ le 2026-07-30 : l'écart entre deux pixels voisins valait 0,00 sur les onze
    // variantes. Une garde qui n'affirmerait que « ça tient dans la fourchette » passerait au
    // vert sur un aplat ; celle-ci exige que la matière EXISTE.
    for (const v of TOUTES_VARIANTES) for (const c of CIMES) {
      const { grain } = champDe(v, c)
      const tons = new Set(grain.ton.filter((t) => t !== null))
      // TROIS crans, pas plus : c'est la construction du grain du sol, et c'est délibéré depuis
      // qu'Alexis a jugé la première version trop tranchée. La garde dit « pas un aplat », elle
      // n'exige pas une palette — un seuil à « > 3 » a fait rougir la suite pour la bonne
      // raison inverse : le grain venait d'être accordé au sol.
      expect(tons.size, `${v.slug}#${c} : la cime est encore d'un seul ton`).toBeGreaterThanOrEqual(3)
    }
  })

  it('le relief existe et varie — sinon la carte de normales n\'a rien à sculpter', () => {
    for (const v of TOUTES_VARIANTES) for (const c of CIMES) {
      const { grain } = champDe(v, c)
      const vus = grain.relief.filter((r) => r > 0)
      expect(vus.length, `${v.slug}#${c} : aucun relief`).toBeGreaterThan(0)
      // Le relief est VOLONTAIREMENT très doux (0,86 → 1,00) : c'est un canal par lequel la
      // cime se remettrait à crier, la carte de normales le convertissant en lumière. La garde
      // affirme qu'il EXISTE et varie, pas qu'il est fort.
      expect(Math.max(...vus) - Math.min(...vus), `${v.slug}#${c} : relief plat`).toBeGreaterThan(0.05)
    }
  })
})

describe('le feuillage est stable', () => {
  it('même variante, même champ — deux appels ne peuvent pas diverger', () => {
    const v = TOUTES_VARIANTES[0]!
    const a = champDe(v).grain
    const b = champDe(v).grain
    expect(Array.from(a.relief)).toEqual(Array.from(b.relief))
    expect(a.ton).toEqual(b.ton)
  })

  it('chaque port d\'arbre a son feuillage, et les quatre diffèrent', () => {
    const cles = Object.keys(FEUILLAGES)
    expect(cles.length).toBeGreaterThanOrEqual(4)
    const signatures = new Set(cles.map((k) => JSON.stringify(FEUILLAGES[k])))
    expect(signatures.size, 'deux feuillages identiques : l\'un des deux ne sert à rien').toBe(cles.length)
  })
})
