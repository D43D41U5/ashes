/**
 * LA SÉLECTION DE L'ATELIER (spec `atelier-plans.md` P-B) — extraire, effacer, coller,
 * refléter, tourner, redimensionner : des opérations PURES sur le plan de travail, testées
 * à froid (`selection.test.ts`).
 *
 * ═══ LA GARDE QUI NE SE NÉGOCIE PAS ═══
 *
 * Les TRIPLETS D'ARÊTE (`x,y,D`) se transforment AVEC les cases : un miroir horizontal
 * échange E↔O, un vertical N↔S, un quart de tour suit la même convention que `poi-batis`
 * (`tournee` : N→E→S→O, (x,y) → (h−1−y, x)). Les oublier ferait le bug silencieux
 * classique — une brèche qui reste au nord d'un mur parti au sud, validée et morte.
 */

/** Le plan de travail minimal que ces opérations mutent — le Brouillon de l'Atelier. */
export interface PlanMutable {
  grille: string[]
  breches: string[]
  seuils: string[]
  passages: string[]
}

/** Un rectangle de sélection, en cases de plan (bornes incluses via w/h ≥ 1). */
export interface Zone { x0: number; y0: number; w: number; h: number }

/** Un fragment copié : des cases + ses triplets RELATIFS — le presse-papier et les tampons. */
export interface Fragment {
  w: number
  h: number
  grille: string[]
  breches: string[]
  seuils: string[]
  passages: string[]
}

const LISTES = ['breches', 'seuils', 'passages'] as const

function decoupe(t: string): { x: number; y: number; d: string } {
  const [x, y, d] = t.split(',')
  return { x: Number(x), y: Number(y), d: d! }
}

/** Borner une zone au plan (une sélection tirée hors grille se rogne, jamais d'erreur). */
export function bornerZone(z: Zone, cote: number): Zone {
  const x0 = Math.max(0, Math.min(z.x0, cote - 1))
  const y0 = Math.max(0, Math.min(z.y0, cote - 1))
  const x1 = Math.max(0, Math.min(z.x0 + z.w - 1, cote - 1))
  const y1 = Math.max(0, Math.min(z.y0 + z.h - 1, cote - 1))
  return { x0: Math.min(x0, x1), y0: Math.min(y0, y1), w: Math.abs(x1 - x0) + 1, h: Math.abs(y1 - y0) + 1 }
}

export function extraire(p: PlanMutable, z: Zone): Fragment {
  const f: Fragment = { w: z.w, h: z.h, grille: [], breches: [], seuils: [], passages: [] }
  for (let y = 0; y < z.h; y++) {
    f.grille.push([...(p.grille[z.y0 + y] ?? '')].slice(z.x0, z.x0 + z.w).join('').padEnd(z.w, '·'))
  }
  for (const liste of LISTES) {
    for (const t of p[liste]) {
      const { x, y, d } = decoupe(t)
      if (x >= z.x0 && x < z.x0 + z.w && y >= z.y0 && y < z.y0 + z.h) {
        f[liste].push(`${x - z.x0},${y - z.y0},${d}`)
      }
    }
  }
  return f
}

export function effacer(p: PlanMutable, z: Zone): void {
  for (let y = 0; y < z.h; y++) {
    const ligne = [...p.grille[z.y0 + y]!]
    for (let x = 0; x < z.w; x++) ligne[z.x0 + x] = '·'
    p.grille[z.y0 + y] = ligne.join('')
  }
  for (const liste of LISTES) {
    p[liste] = p[liste].filter((t) => {
      const { x, y } = decoupe(t)
      return !(x >= z.x0 && x < z.x0 + z.w && y >= z.y0 && y < z.y0 + z.h)
    })
  }
}

/** COLLER en (x0,y0) : les cases écrasent (le fragment est OPAQUE, `·` compris — coller un
 *  vide efface, c'est ce qu'on voit), les triplets du rectangle cible partent, ceux du
 *  fragment entrent — bornés au plan, jamais d'arête orpheline hors grille. */
export function coller(p: PlanMutable, f: Fragment, x0: number, y0: number): void {
  const cote = p.grille.length
  // L'INTERSECTION VRAIE, pas un clamp : un fragment ENTIÈREMENT hors grille ne touche à
  // RIEN — le clamp de `bornerZone` le rabattait sur la colonne de bord, que `effacer`
  // vidait sans que le collage ne pose une seule case (revue du 2026-08-10, mesuré).
  const ix0 = Math.max(0, x0)
  const iy0 = Math.max(0, y0)
  const ix1 = Math.min(cote - 1, x0 + f.w - 1)
  const iy1 = Math.min(cote - 1, y0 + f.h - 1)
  if (ix0 > ix1 || iy0 > iy1) return
  const zone: Zone = { x0: ix0, y0: iy0, w: ix1 - ix0 + 1, h: iy1 - iy0 + 1 }
  effacer(p, zone)
  for (let y = 0; y < f.h; y++) {
    const py = y0 + y
    if (py < 0 || py >= cote) continue
    const ligne = [...p.grille[py]!]
    for (let x = 0; x < f.w; x++) {
      const px = x0 + x
      if (px < 0 || px >= cote) continue
      ligne[px] = f.grille[y]![x]!
    }
    p.grille[py] = ligne.join('')
  }
  for (const liste of LISTES) {
    for (const t of f[liste]) {
      const { x, y, d } = decoupe(t)
      const px = x0 + x
      const py = y0 + y
      if (px < 0 || py < 0 || px >= cote || py >= cote) continue
      p[liste].push(`${px},${py},${d}`)
    }
  }
}

const MIROIR_H: Record<string, string> = { N: 'N', S: 'S', E: 'O', O: 'E' }
const MIROIR_V: Record<string, string> = { N: 'S', S: 'N', E: 'E', O: 'O' }
/** N→E→S→O — LA convention de `poi-batis` (`tournee`), pas une au choix. */
const QUART: Record<string, string> = { N: 'E', E: 'S', S: 'O', O: 'N' }

export function miroirH(f: Fragment): Fragment {
  const sortie: Fragment = { w: f.w, h: f.h, grille: f.grille.map((l) => [...l].reverse().join('')), breches: [], seuils: [], passages: [] }
  for (const liste of LISTES) {
    sortie[liste] = f[liste].map((t) => {
      const { x, y, d } = decoupe(t)
      return `${f.w - 1 - x},${y},${MIROIR_H[d]}`
    })
  }
  return sortie
}

export function miroirV(f: Fragment): Fragment {
  const sortie: Fragment = { w: f.w, h: f.h, grille: [...f.grille].reverse(), breches: [], seuils: [], passages: [] }
  for (const liste of LISTES) {
    sortie[liste] = f[liste].map((t) => {
      const { x, y, d } = decoupe(t)
      return `${x},${f.h - 1 - y},${MIROIR_V[d]}`
    })
  }
  return sortie
}

/** UN QUART DE TOUR HORAIRE : (x,y) → (h−1−y, x), les dimensions s'échangent. */
export function tournerFragment(f: Fragment): Fragment {
  const grille: string[] = []
  for (let ny = 0; ny < f.w; ny++) {
    const ligne: string[] = []
    for (let nx = 0; nx < f.h; nx++) ligne.push(f.grille[f.h - 1 - nx]![ny]!)
    grille.push(ligne.join(''))
  }
  const sortie: Fragment = { w: f.h, h: f.w, grille, breches: [], seuils: [], passages: [] }
  for (const liste of LISTES) {
    sortie[liste] = f[liste].map((t) => {
      const { x, y, d } = decoupe(t)
      return `${f.h - 1 - y},${x},${QUART[d]}`
    })
  }
  return sortie
}

/**
 * REDIMENSIONNER LE PLAN (P-E) : une rangée/colonne de plus ou de moins, par CÔTÉ.
 * Agrandir au nord/à l'ouest DÉCALE tout (cases et triplets) ; rétrécir rogne, et les
 * triplets de la tranche rognée partent avec elle. Le plan reste CARRÉ ailleurs — c'est
 * `verifierPlan` qui juge (empreinte, régions au bord), pas cette fonction.
 */
export function redimensionner(p: PlanMutable, cote: 'N' | 'S' | 'E' | 'O', delta: 1 | -1): void {
  const n = p.grille.length
  const large = p.grille[0]?.length ?? 0
  if (delta === -1 && ((cote === 'N' || cote === 'S') ? n <= 1 : large <= 1)) return
  const decale = (dx: number, dy: number): void => {
    for (const liste of LISTES) {
      p[liste] = p[liste]
        .map((t) => {
          const { x, y, d } = decoupe(t)
          return { x: x + dx, y: y + dy, d }
        })
        .filter(({ x, y }) => x >= 0 && y >= 0)
        .map(({ x, y, d }) => `${x},${y},${d}`)
    }
  }
  if (cote === 'N') {
    if (delta === 1) p.grille.unshift('·'.repeat(large))
    else p.grille.shift()
    decale(0, delta)
  } else if (cote === 'S') {
    if (delta === 1) p.grille.push('·'.repeat(large))
    else p.grille.pop()
  } else if (cote === 'O') {
    p.grille = p.grille.map((l) => (delta === 1 ? `·${l}` : l.slice(1)))
    decale(delta, 0)
  } else {
    p.grille = p.grille.map((l) => (delta === 1 ? `${l}·` : l.slice(0, -1)))
  }
  // Les triplets tombés HORS de la nouvelle grille partent avec la tranche.
  const nn = p.grille.length
  const nl = p.grille[0]?.length ?? 0
  for (const liste of LISTES) {
    p[liste] = p[liste].filter((t) => {
      const { x, y } = decoupe(t)
      return x < nl && y < nn
    })
  }
}
