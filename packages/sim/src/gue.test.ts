/**
 * LES PIERRES DU GUÉ — spec `t0-exploration.md` (le gué), demande d'Alexis du 2026-08-28 :
 * *« des nœuds de pierres, la même collision, immergés en partie »*.
 *
 * ═══ CE QUI RENDRAIT CE FICHIER ROUGE ═══
 *
 *   G1 — LA PRÉMISSE. Une carte jouée porte des gués. Sans elle, les quatre gardes suivantes
 *        passeraient au vert sur zéro pierre, et c'est très exactement le piège que
 *        « une sonde qui ne peut pas échouer » a déjà coûté au projet.
 *   G2 — CHAQUE GUÉ EST PIERRÉ, au compte réglé. Un jour où la passe s'évapore (une clause de
 *        terrain qui bouge, un `occupees` qui la mange), le gué redevient un carré d'eau claire
 *        et personne ne le voit : le compte est donc AFFIRMÉ, pas seulement borné.
 *   G3 — ELLES SONT DANS L'EAU QU'ON FOULE. Une pierre sur la rive ou sur le cœur profond n'est
 *        pas une pierre de gué — et le client l'immergerait à tort (il lit le terrain, lui).
 *   G4 — UNE TUILE, UNE PIERRE. Deux blocs superposés rendent quatre pierres pour cinq posées.
 *   G5 — ON PASSE TOUJOURS. La collision est réelle (`blockHalfSub: 4`, pleine tuile) : c'est
 *        ce qui fait louvoyer. Un gué muré serait une rivière infranchissable, en silence.
 *   G6 — ET LA COLLISION EST BIEN LÀ. Le contraire — des pierres décoratives — est l'état
 *        d'AVANT (des dalles peintes côté client), donc l'exact défaut qu'on répare.
 */
import { describe, expect, it } from 'vitest'
import { TERRAIN_SHALLOW_WATER } from './balance'
import { isBlockedAt } from './collision'
import { CONTENU, placeZoneNodes } from './zone-content'
import { carteDeTest } from '../../../tools/carte-cache'
import { MONDE } from './zonegraph'
import type { ResourceNode } from './economy'
import type { CarteZonee } from './zonegen'

const SEEDS = [2026, 7, 3]
const mondes = SEEDS.map((s) => {
  const c = carteDeTest(s, MONDE.JOUEURS_CIBLE, 'racine')
  return { s, c, nodes: placeZoneNodes(c) }
})

type Emprise = { x: number; y: number; w: number; h: number }
const guesDe = (c: CarteZonee): Emprise[] =>
  c.map.zones.filter((z) => z.kind === undefined && z.name === 'le Gué')

const dedans = (z: Emprise, n: { tx: number; ty: number }): boolean =>
  n.tx >= z.x && n.tx < z.x + z.w && n.ty >= z.y && n.ty < z.y + z.h

/**
 * LES PIERRES DU GUÉ, IDENTIFIÉES PAR CONSTRUCTION — pas « tout rocher dans l'emprise ».
 *
 * La première écriture prenait tout `rock` de l'emprise pour une pierre de gué, et c'est un
 * rocher de RIVE qui l'a fait rougir (N3, graine 3 : la nappe de pierrier a posé un rocher sur
 * une saulaie de la bordure du gué — six « pierres », dont une « hors de l'eau »). Or l'emprise
 * est 7×7 autour du passage, ses bords sont de la berge, et la berge a le droit d'être
 * pierreuse. La passe `pierresDuGue` émet ses pierres D'UN BLOC, après le glanage (qui ne pose
 * que des `*_au_sol`) et juste avant la pêche (P5 : ses ids en queue) : le dernier run de `rock`
 * contigu avant le premier coin de pêche, c'est ELLE, et rien d'autre. G3 garde ainsi son sens —
 * une pierre DE GUÉ sur la rive rougit ; un caillou de berge dans l'emprise, non.
 */
const pierresDuGueDe = (nodes: readonly ResourceNode[]): ResourceNode[] => {
  let fin = nodes.findIndex((n) => n.type === 'fishing_spot_river' || n.type === 'fishing_spot_lake')
  if (fin < 0) fin = nodes.length
  let debut = fin
  // AU SOL SEULEMENT : la pierre des grottes (`grottes.md` G-R5) est aussi un run de `rock`, mais
  // ESTAMPILLÉ de son étage — et la passe des gués vient après elle, juste avant la pêche.
  while (debut > 0 && nodes[debut - 1]!.type === 'rock' && nodes[debut - 1]!.etage === undefined) debut--
  return nodes.slice(debut, fin)
}

const pierresDe = (m: (typeof mondes)[number], z: Emprise): ResourceNode[] =>
  pierresDuGueDe(m.nodes).filter((n) => dedans(z, n))

/**
 * LE BORD DE HAUT-FOND DU GUÉ EST-IL D'UN SEUL TENANT, une fois `murees` murées ?
 *
 * Plus fort que « un chemin existe entre deux rives choisies », et surtout INDÉPENDANT DE
 * L'AXE : on ne sait pas si ce gué se traverse d'est en ouest ou du nord au sud (les deux
 * existent, mesuré). Demander que TOUTES les tuiles d'eau du pourtour se joignent couvre les
 * deux sens d'un coup — et refuse aussi le gué coupé en deux dans le mauvais sens.
 */
function bordDUnSeulTenant(c: CarteZonee, z: Emprise, murees: ReadonlySet<number>): boolean {
  const { width, terrain } = c.map
  const libre = (tx: number, ty: number): boolean =>
    tx >= z.x && ty >= z.y && tx < z.x + z.w && ty < z.y + z.h
    && terrain[ty * width + tx] === TERRAIN_SHALLOW_WATER && !murees.has(ty * width + tx)

  const bords: number[] = []
  for (let ty = z.y; ty < z.y + z.h; ty++) {
    for (let tx = z.x; tx < z.x + z.w; tx++) {
      if (tx !== z.x && ty !== z.y && tx !== z.x + z.w - 1 && ty !== z.y + z.h - 1) continue
      if (libre(tx, ty)) bords.push(ty * width + tx)
    }
  }
  const depart = bords[0]
  if (depart === undefined) return false
  const vus = new Set<number>([depart])
  const pile = [depart]
  while (pile.length > 0) {
    const i = pile.pop()!
    const tx = i % width
    const ty = (i - tx) / width
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const j = (ty + dy) * width + (tx + dx)
      if (!vus.has(j) && libre(tx + dx, ty + dy)) { vus.add(j); pile.push(j) }
    }
  }
  return bords.every((i) => vus.has(i))
}

describe('les pierres du gué — un passage qu’on lit parce qu’on le contourne', () => {
  it('G1 : la prémisse — le monde joué porte des gués, sinon tout ce qui suit est vide', () => {
    for (const m of mondes) {
      expect(guesDe(m.c).length, `seed ${m.s} : aucun gué, les gardes suivantes ne prouveraient rien`).toBeGreaterThan(0)
    }
  })

  it('G2 : chaque gué porte CINQ pierres — une passe qui s’évapore doit ROUGIR', () => {
    // ⚠ **CINQ, ÉCRIT EN TOUTES LETTRES.** La première écriture affirmait `CONTENU.GUE_PIERRES`,
    // et c'est la leçon d'`etalon-d-un-rayon-est-le-cadre` reprise une fois de plus : mis à 0,
    // le réglage a laissé cette garde AU VERT (mesuré) — elle comparait la passe à elle-même.
    // Le cadran vit dans le code, l'étalon vit ici ; changer l'un doit obliger à toucher l'autre.
    expect(CONTENU.GUE_PIERRES, 'le cadran a bougé : relire la garde avant de la suivre').toBe(5)
    for (const m of mondes) {
      for (const z of guesDe(m.c)) {
        expect(pierresDe(m, z).length, `seed ${m.s}, gué (${z.x},${z.y})`).toBe(5)
      }
    }
  })

  it('G3 + G4 : toutes dans le haut-fond, et jamais deux sur la même tuile', () => {
    const { width, terrain } = mondes[0]!.c.map
    for (const m of mondes) {
      const w = m.c.map.width
      for (const z of guesDe(m.c)) {
        const pierres = pierresDe(m, z)
        // LA PRÉMISSE : sans pierre, les deux propriétés ci-dessous sont vraies pour rien.
        expect(pierres.length, `seed ${m.s}, gué (${z.x},${z.y}) : rien à éprouver`).toBeGreaterThan(0)
        const tuiles = new Set(pierres.map((n) => n.ty * w + n.tx))
        expect(tuiles.size, `seed ${m.s}, gué (${z.x},${z.y}) : des pierres superposées`).toBe(pierres.length)
        for (const p of pierres) {
          expect(
            m.c.map.terrain[p.ty * w + p.tx],
            `seed ${m.s} : la pierre (${p.tx},${p.ty}) n’est pas dans l’eau qu’on foule`,
          ).toBe(TERRAIN_SHALLOW_WATER)
        }
      }
    }
    expect(terrain.length).toBe(width * mondes[0]!.c.map.height) // la carte est bien celle qu'on lit
  })

  it('G5 : la traversée ne se ferme JAMAIS — le bord d’eau du gué reste d’un seul tenant', () => {
    for (const m of mondes) {
      const w = m.c.map.width
      for (const z of guesDe(m.c)) {
        const murees = new Set(pierresDe(m, z).map((n) => n.ty * w + n.tx))
        // LA GARDE PROUVE SA PRÉMISSE : il y a bien de la pierre à contourner ici.
        expect(murees.size, `seed ${m.s}, gué (${z.x},${z.y})`).toBeGreaterThan(0)
        expect(
          bordDUnSeulTenant(m.c, z, murees),
          `seed ${m.s} : le gué (${z.x},${z.y}) est coupé en deux`,
        ).toBe(true)
      }
    }
  })

  it('G6 : elles BLOQUENT leur tuile pleine — et la libèrent une fois taillées', () => {
    const m = mondes[0]!
    const z = guesDe(m.c)[0]!
    const pierres = pierresDe(m, z)
    expect(pierres.length, 'aucune pierre : la garde de collision ne prouverait rien').toBeGreaterThan(0)
    const world = { map: m.c.map, nodes: m.nodes }
    for (const p of pierres) {
      expect(isBlockedAt(world, p.tx, p.ty), `la pierre (${p.tx},${p.ty}) se traverse`).toBe(true)
    }
    // ÉPUISÉE, elle cesse de bloquer : dégager son gué est un chantier qui SE TERMINE.
    const vides = m.nodes.map((n) => (pierres.includes(n) ? { ...n, stock: 0 } : n))
    for (const p of pierres) {
      expect(isBlockedAt({ map: m.c.map, nodes: vides }, p.tx, p.ty)).toBe(false)
    }
  })
})
