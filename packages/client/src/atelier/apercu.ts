/**
 * LE COMPOSEUR DE L'ATELIER — des structures du VRAI moteur vers un canvas (spec
 * `atelier-plans.md` A7).
 *
 * Ce module ne dérive RIEN : les structures qu'il peint sortent de `batirLieu` (murs du
 * pourtour, sort, rotation — la même loi que le jeu). Il ne fait que COMPOSER, avec les
 * albédos réels de `bati-art` (`albedosAtelier`) — et c'est sa limite assumée, documentée
 * dans la spec : ni lumière ni normales, et un tri en Y approché. Le juge du rendu reste
 * le jeu (`pnpm smoke --scenario lieux-batis`).
 *
 * Ce qui n'a PAS d'albédo hors-Phaser (les tuiles simples de BootScene : sol et toit neufs,
 * et les nœuds) se peint en TUILE NEUTRE + glyphe, et se DÉCLARE (`manquantes`) — jamais un
 * silence (A6).
 */
import { EDGE_ORIGIN_Y, MUR_HT, RUINE_SEUIL, albedosAtelier } from '../render/bati-art'
import { STRUCTURE_HP, WALL_TIERS } from '@ashes/sim'
import type { ResourceNode, Structure } from '@ashes/sim'
import { HEX } from '../scenes/ui/palette'

const T = 16

/** Les albédos, dessinés UNE fois par page — le composeur repeint à chaque édition. */
const ALBEDOS = albedosAtelier()

export interface Apercu {
  /** Les clés demandées sans albédo (peintes en tuile neutre + glyphe), dédoublonnées. */
  manquantes: readonly string[]
}

/** L'albédo d'une clé, ou `null` — le composeur peindra le repli et le déclarera. */
function albedo(cle: string): HTMLCanvasElement | null {
  return ALBEDOS.get(cle) ?? null
}

function repli(g: CanvasRenderingContext2D, x: number, y: number, glyphe: string): void {
  g.fillStyle = HEX.bordSombre
  g.fillRect(x + 1, y + 1, T - 2, T - 2)
  g.fillStyle = '#cfcfe0'
  g.font = '10px monospace'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(glyphe, x + T / 2, y + T / 2 + 1)
}

/** La famille de texture d'un mur d'arête — le MIROIR (documenté) de `snapshot-view`, à
 *  l'expression près : mêmes replis (`STRUCTURE_HP[s.type]` sans matériau), même seuil
 *  (`RUINE_SEUIL` vit dans `bati-art`, une seule lecture). Le bâti des lieux est en pierre. */
function famMur(s: Structure): string {
  const maxHp = s.material ? WALL_TIERS[s.material].wall.hp : STRUCTURE_HP.wall
  if (s.villageId === 0 && s.hp < maxHp * RUINE_SEUIL) return 'wall-ruine'
  return (s.material ?? 'wood') === 'wood' ? 'wall-bois' : 'wall'
}

/**
 * COMPOSER L'APERÇU sur `canvas` (redimensionné ici) : sols au ras, contenu trié en Y
 * (approché — les pieds d'une bande d'arête valent le bas de sa tuile quand elle porte un
 * bit E/S/O, le haut sinon), toits LEVÉS de `MUR_HT` en dernier (le calage du jeu), ou
 * cachés (`montrerToits: false` = la vue « dedans »).
 */
export function composerApercu(
  canvas: HTMLCanvasElement,
  structures: readonly Structure[],
  nodes: readonly ResourceNode[],
  cote: number,
  montrerToits: boolean,
): Apercu {
  const px = cote * T
  canvas.width = px
  canvas.height = px
  const g = canvas.getContext('2d')!
  g.imageSmoothingEnabled = false
  const manquantes = new Set<string>()
  // Le fond : un damier discret — l'herbe n'est pas notre sujet, la grille doit se lire.
  for (let y = 0; y < cote; y++) {
    for (let x = 0; x < cote; x++) {
      g.fillStyle = (x + y) % 2 ? '#232820' : '#20241d'
      g.fillRect(x * T, y * T, T, T)
    }
  }

  const peindreCle = (cle: string, tx: number, ty: number, glyphe: string): void => {
    const c = albedo(cle)
    if (c) g.drawImage(c, tx * T, ty * T)
    else {
      manquantes.add(cle)
      repli(g, tx * T, ty * T, glyphe)
    }
  }

  // ── 1. LES SOLS, au ras — la variante suit la POSITION, la formule du jeu recopiée à
  //       l'identique (snapshot-view : un champ de vingt tuiles ne porte pas vingt fois le
  //       même carré). ──
  for (const s of structures) {
    if (s.type === 'floor') {
      if (s.villageId === 0 && s.hp < STRUCTURE_HP.floor * RUINE_SEUIL) peindreCle('st-floor-ruine', s.tx, s.ty, '.')
      else peindreCle('st-floor', s.tx, s.ty, '.')
    } else if (s.type === 'terre' || s.type === 'friche') {
      peindreCle(`st-${s.type}-${(((s.tx * 7 + s.ty * 13) % 4) + 4) % 4}`, s.tx, s.ty, s.type === 'terre' ? ',' : 'x')
    }
  }
  // ── 2. LES NŒUDS (la fouille) — pas d'albédo hors-Phaser : tuile neutre déclarée. ──
  for (const nd of nodes) peindreCle(`nd-${nd.type}`, nd.tx, nd.ty, 'G')

  // ── 3. LE CONTENU ET LES BARRIÈRES, triés en Y (approché, cf. en-tête). ──
  const seuilTiles = new Set(structures.filter((s) => s.type === 'encadrement').map((s) => `${s.tx},${s.ty}`))
  const corps = structures
    .filter((s) => s.type !== 'floor' && s.type !== 'roof' && s.type !== 'terre' && s.type !== 'friche')
    .map((s) => {
      const arete = s.edges !== undefined && s.edges > 0
      const pieds = arete ? s.ty * T + ((s.edges! & 0b1110) ? T : 1) : (s.ty + 1) * T
      return { s, arete, pieds }
    })
    .sort((a, b) => a.pieds - b.pieds)
  for (const { s, arete } of corps) {
    if (arete) {
      // UNE BARRIÈRE D'ARÊTE : la clé porte ses bits (`st-<fam>-e<bits>`), l'ancre est le bas
      // de sa TUILE (le sprite déborde d'une demi-bande dessous — EDGE_ORIGIN_Y, la table du jeu).
      const fam = s.type === 'wall' ? famMur(s) : s.type === 'encadrement' ? 'encadrement' : s.type
      const cle = s.type === 'encadrement'
        // Le seuil se raccorde à son voisin de seuil — les DEUX lignes du jeu, recopiées.
        ? `st-encadrement-${(seuilTiles.has(`${s.tx - 1},${s.ty}`) ? 1 : 0) | (seuilTiles.has(`${s.tx + 1},${s.ty}`) ? 2 : 0)}`
        : `st-${fam}-e${s.edges}`
      const c = albedo(cle)
      if (!c) {
        manquantes.add(cle)
        repli(g, s.tx * T, s.ty * T, s.type[0]!.toUpperCase())
        continue
      }
      const origine = EDGE_ORIGIN_Y[fam] ?? 1
      g.drawImage(c, s.tx * T + T / 2 - c.width / 2, (s.ty + 1) * T - origine * c.height)
    } else {
      // UNE PIÈCE (mobilier, charrette, autel, âtre…) : ancrée au bas de sa tuile.
      const c = albedo(`st-${s.type}`)
      if (!c) {
        manquantes.add(`st-${s.type}`)
        repli(g, s.tx * T, s.ty * T, s.type[0]!.toUpperCase())
        continue
      }
      g.drawImage(c, s.tx * T + T / 2 - c.width / 2, (s.ty + 1) * T - c.height)
    }
  }

  // ── 4. LES TOITS, LEVÉS de `MUR_HT` — le calage du jeu (décision du 2026-08-10) : le plan
  //       de toit coiffe le volume. Cachés en vue « dedans » (le jeu les efface, alpha 0). ──
  if (montrerToits) {
    for (const s of structures) {
      if (s.type !== 'roof') continue
      if (s.villageId === 0 && s.hp < STRUCTURE_HP.roof * RUINE_SEUIL) {
        const c = albedo('st-roof-ruine')
        if (c) { g.drawImage(c, s.tx * T, s.ty * T - MUR_HT); continue }
      }
      const c = albedo('st-roof')
      if (c) g.drawImage(c, s.tx * T, s.ty * T - MUR_HT)
      else {
        manquantes.add('st-roof')
        repli(g, s.tx * T, s.ty * T - MUR_HT, ':')
      }
    }
  }
  return { manquantes: [...manquantes].sort() }
}

/** La vignette d'un caractère de palette : l'albédo de sa pièce s'il en a un, la teinte de
 *  sa région sinon — la palette montre ce que la case DONNERA, pas un aplat arbitraire. */
export function vignette(piece: string | undefined, region: string | undefined): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = T
  c.height = T
  const g = c.getContext('2d')!
  g.imageSmoothingEnabled = false
  g.fillStyle = region === 'salle' ? '#4a3a28' : region === 'cour' ? '#54452e' : '#2a2e26'
  g.fillRect(0, 0, T, T)
  if (piece) {
    const a = albedo(`st-${piece}`)
    if (a) {
      // La vignette écrase la pièce dans 16×16 : c'est un ICONE, pas l'aperçu.
      const k = Math.min(T / a.width, T / a.height)
      g.drawImage(a, (T - a.width * k) / 2, T - a.height * k, a.width * k, a.height * k)
    }
  }
  return c
}
