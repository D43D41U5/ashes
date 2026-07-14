/**
 * LES GARDES DU GRAPHE DE ZONES — spec `worldgen.md` A1, A3, A4, A6, A8, A12, A20.
 *
 * ELLES TOURNENT SUR 12 SEEDS, ET UN SEUL ÉCHEC EST UN ÉCHEC. Ce n'est pas de la rigueur
 * gratuite : **une saison = une carte = une seed, pendant des semaines** (décision d'Alexis).
 * Une seed ratée ne gâche pas une partie, elle gâche un SERVEUR. Il ne faut donc pas une
 * garantie « en moyenne » — il faut une garantie PAR CONSTRUCTION.
 *
 * Le graphe se teste SEUL, avant qu'une tuile de terrain n'existe : c'est tout l'intérêt du
 * renversement. Si l'ossature est fausse, aucun bruit de Perlin ne la sauvera.
 */
import { describe, expect, it } from 'vitest'
import { distSq } from './geometry'
import {
  deriveGrapheZones,
  echantillonAt,
  MONDE,
  RACINE_SLUG,
  tailleCarte,
  VRAIES_ZONES,
  ZONES,
  type GrapheZones,
} from './zonegraph'

const SEEDS = [2026, 7, 42, 1, 99, 1234, 5, 777, 31337, 8, 60, 2718]
const graphes = SEEDS.map((s) => deriveGrapheZones(s))

/** Le degré d'une zone = son nombre de seuils (deux passages sur la même frontière comptent
 *  pour deux : ce sont deux portes distinctes, et c'est bien le sens de la règle). */
const degre = (g: GrapheZones, id: number) => g.seuils.filter((s) => s.a === id || s.b === id).length

/**
 * LES VRAIES ZONES D'UN GRAPHE — le Névé n'en est pas une.
 *
 * C'est un SEUIL GÉANT : on le traverse, on n'y vit pas, **aucun village ne peut le tenir**. Les
 * gardes qui protègent le joueur d'un village hostile (A21 : aucun goulot ; A4 : deux portes
 * écartées de 250) l'excluent donc, et c'est la seule exception du modèle. Une règle qui existe
 * pour qu'on ne puisse pas tenir une porte n'a rien à dire d'une porte qu'on ne peut pas tenir.
 */
const vraies = (g: GrapheZones) => g.zones.filter((z) => !z.def.traverse)
const REGIONS = 13

/** Les zones atteignables depuis la racine, EN NE PASSANT QUE PAR LES SEUILS. */
function atteignables(g: GrapheZones, seuilsBouches: ReadonlySet<number> = new Set()): Set<number> {
  const vu = new Set([g.racine])
  const file = [g.racine]
  for (let h = 0; h < file.length; h++) {
    for (const s of g.seuils) {
      if (seuilsBouches.has(s.id)) continue
      const autre = s.a === file[h] ? s.b : s.b === file[h] ? s.a : -1
      if (autre < 0 || vu.has(autre)) continue
      vu.add(autre)
      file.push(autre)
    }
  }
  return vu
}

describe('la table des zones', () => {
  it('A1 — 12 ZONES (1 racine, 6 T1, 5 T2) + LE NÉVÉ, qui n\'en est pas une', () => {
    // Le Névé Blanc est une RÉGION, pas une zone : un SEUIL GÉANT qu'on traverse et où l'on ne vit
    // pas (spec §3). Il compte dans la carte, jamais dans les douze pays.
    expect(VRAIES_ZONES).toHaveLength(12)
    expect(VRAIES_ZONES.filter((z) => z.tier === 0)).toHaveLength(1)
    expect(VRAIES_ZONES.filter((z) => z.tier === 1)).toHaveLength(6)
    expect(VRAIES_ZONES.filter((z) => z.tier === 2)).toHaveLength(5)
    expect(ZONES.filter((z) => z.traverse)).toHaveLength(1)
    expect(VRAIES_ZONES[0]!.slug).toBe(RACINE_SLUG)
    // Les slugs sont uniques : ils indexeront les tables de ressources, de faune et d'art.
    expect(new Set(ZONES.map((z) => z.slug)).size).toBe(ZONES.length)
  })

  it('R9 — toute ressource STRUCTURANTE est exclusive à sa zone ; les LIAISONS sont déclarées', () => {
    const vues = new Map<string, string[]>()
    for (const z of VRAIES_ZONES) {
      if (!z.structurante) continue
      vues.set(z.structurante, [...(vues.get(z.structurante) ?? []), z.slug])
    }
    for (const [res, zones] of vues) {
      expect(zones, `« ${res} » est structurante et naît dans ${zones.length} zones`).toHaveLength(1)
    }
    // Le charbon est la SEULE liaison, et il naît dans exactement deux zones (décision
    // d'Alexis : au Karst et au Versant Brûlé — une couture, pas un relâchement).
    const charbon = ZONES.filter((z) => z.liaison?.includes('coal')).map((z) => z.slug)
    expect(charbon.sort()).toEqual(['brule', 'karst'])
  })
})

describe('le graphe, sur 12 seeds', () => {
  it('A1 — 12 zones + le Névé, toutes distinctes, toutes dans la carte', () => {
    for (const g of graphes) {
      expect(g.zones).toHaveLength(REGIONS)
      expect(vraies(g)).toHaveLength(12)
      expect(new Set(g.zones.map((z) => z.def.slug)).size).toBe(REGIONS)
      for (const z of g.zones) {
        expect(z.x).toBeGreaterThan(0)
        expect(z.y).toBeGreaterThan(0)
        expect(z.x).toBeLessThan(g.width)
        expect(z.y).toBeLessThan(g.height)
      }
    }
  })

  it('la racine est les Prés Bas, et elle est au SUD (la bouche de la vallée)', () => {
    for (const g of graphes) {
      expect(g.zones[g.racine]!.def.slug).toBe(RACINE_SLUG)
      // Dans la moitié sud : on entre dans une vallée alpine par sa bouche.
      expect(g.zones[g.racine]!.y).toBeGreaterThan(g.height / 2)
    }
  })

  it('A3 — la racine touche ≥ 2 zones T1 : la première décision du joueur est un CHOIX', () => {
    for (const g of graphes) {
      const t1 = g.voisins[g.racine]!.filter((v) => g.zones[v]!.def.tier === 1)
      expect(t1.length, `seed ${g.seed} : la racine ne touche que ${t1.length} zone(s) T1`)
        .toBeGreaterThanOrEqual(2)
    }
  })

  it('A6 — une zone T2 touche la RACINE : de ton pas de porte, tu vois l\'enfer', () => {
    for (const g of graphes) {
      const t2 = g.voisins[g.racine]!.filter((v) => g.zones[v]!.def.tier === 2)
      expect(t2.length, `seed ${g.seed} : aucune T2 au pas de la porte`).toBeGreaterThanOrEqual(1)
    }
  })

  /**
   * A25 — LA CENDRIÈRE EST LA T2 DU PAS DE LA PORTE. Elle sera le FRONT.
   *
   * *Décision d'Alexis : « on a une zone T2 à côté de la zone de départ — est-ce qu'on n'en ferait
   * pas notre zone de propagation de la difficulté ? »*
   *
   * R13 posait cette T2 pour le frisson. Elle devient le **moteur de la saison** : l'enfer qu'on
   * voit depuis son jardin est celui qui viendra le brûler. Le troisième acte du GDD s'appelle
   * déjà « Cendre » — il n'était qu'un multiplicateur de faim ; il a désormais un LIEU.
   *
   * Cette garde est donc structurante, pas cosmétique : si la Cendrière n'est pas voisine des Prés
   * Bas, la saison n'a plus de front, et toute la migration s'effondre.
   */
  it('A25 — la CENDRIÈRE est voisine des Prés Bas : la saison a son front', () => {
    for (const g of graphes) {
      const cendriere = g.zones.find((z) => z.def.slug === 'cendriere')!
      expect(
        g.voisins[g.racine],
        `seed ${g.seed} : la Cendrière ne touche pas les Prés Bas — la saison n'a pas de front`,
      ).toContain(cendriere.id)
      // ELLE EST UNE IMPASSE, ET C'EST VOULU (croquis d'Alexis, 2026-07-14) : elle est plein sud,
      // SOUS le jardin, et n'ouvre que sur lui. Le front n'avance pas dans le GRAPHE — il avance
      // dans la GÉOGRAPHIE, vers le nord, à travers les Prés Bas (spec R28). Un cul-de-sac en bas de
      // la carte est exactement ce qu'il faut pour ça : on ne le traverse pas, on le FUIT.
      expect(g.impasses, `seed ${g.seed} : la Cendrière doit être le cul-de-sac du sud`).toContain(cendriere.id)
    }
  })

  it('A2 — toute zone est atteignable depuis la racine EN NE PASSANT QUE PAR LES SEUILS', () => {
    for (const g of graphes) {
      expect(atteignables(g).size, `seed ${g.seed}`).toBe(REGIONS)
    }
  })

  it('A4 — toute zone a ≥ 2 seuils : aucune ne se bloque avec un seul village', () => {
    for (const g of graphes) {
      for (const z of g.zones) {
        expect(degre(g, z.id), `seed ${g.seed} : ${z.def.nom} n'a que ${degre(g, z.id)} seuil(s)`)
          .toBeGreaterThanOrEqual(2)
      }
    }
  })

  it('A4 — les seuils d\'une même zone sont à ≥ 250 tuiles : aucun village ne tient les deux', () => {
    const min = MONDE.ECART_SEUILS * MONDE.ECART_SEUILS
    for (const g of graphes) {
      for (const z of vraies(g)) { // le Névé est exempté : on ne bâtit pas dedans (voir `vraies`)
        const mes = g.seuils.filter((s) => s.a === z.id || s.b === z.id)
        for (let i = 0; i < mes.length; i++) {
          for (let j = i + 1; j < mes.length; j++) {
            const d2 = distSq(mes[i]!.x, mes[i]!.y, mes[j]!.x, mes[j]!.y)
            expect(
              d2,
              `seed ${g.seed} : deux seuils de ${z.def.nom} sont à ${Math.round(Math.sqrt(d2))} tuiles`,
            ).toBeGreaterThanOrEqual(min)
          }
        }
      }
    }
  })

  /**
   * A21 — AUCUN GOULOT D'ÉTRANGLEMENT. Le graphe est 2-CONNEXE PAR LES SOMMETS.
   *
   * TROUVÉ PAR ALEXIS, SUR LA CARTE RENDUE (« la seed 909 force le passage par une seule zone
   * pour accéder au T2 »). Et **aucune garde ne le voyait** : je garantissais deux PORTES par
   * zone, ce qui empêche de bloquer une porte — mais rien n'empêchait une ZONE ENTIÈRE d'être le
   * seul chemin vers tout un pan de la carte. Un village qui tient cette zone-là tient tout ce
   * qui est derrière : c'est le grief qu'on voulait mitiger, un cran plus haut, et il avait
   * traversé toutes les mailles du filet.
   *
   * LEÇON, à ranger à côté de celle des 60 seeds : **une garantie LOCALE (deux portes par zone)
   * ne fait pas une garantie GLOBALE (aucun goulot sur la carte).** Il a fallu regarder la carte
   * pour la voir. On ne teste pas qu'une carte est belle, on teste qu'elle se joue — et **on la
   * REGARDE**.
   */
  it('A21 — AUCUN GOULOT POUR NAVIGUER : retirer une zone ne coupe QUE son éventuelle impasse', () => {
    for (const g of graphes) {
      const impasses = new Set(g.impasses)
      for (const bloquee of vraies(g)) { // on ne TIENT pas un Névé : il n'y a pas de village dedans
        // On retire la zone ENTIÈRE — pas ses portes : la zone. Comme si on ne pouvait plus la
        // traverser du tout. Qui reste joignable ?
        const restantes = g.zones.filter((z) => z.id !== bloquee.id).map((z) => z.id)
        const depart = restantes.find((id) => !impasses.has(id))!
        const vu = new Set([depart])
        const file = [depart]
        for (let h = 0; h < file.length; h++) {
          for (const s of g.seuils) {
            const v = file[h]!
            const autre = s.a === v ? s.b : s.b === v ? s.a : -1
            if (autre < 0 || autre === bloquee.id || vu.has(autre)) continue
            vu.add(autre)
            file.push(autre)
          }
        }
        // LES SEULES ZONES QU'ON A LE DROIT DE COUPER sont les IMPASSES dont `bloquee` est la
        // gardienne. Une impasse est un cul-de-sac : sa gardienne est forcément un point
        // d'articulation, c'est la définition. Mais ce qu'elle coupe est un TROPHÉE, jamais une
        // route — et jamais deux à la fois (les gardiennes sont distinctes).
        const perdues = restantes.filter((id) => !vu.has(id))
        for (const p of perdues) {
          expect(
            impasses.has(p),
            `seed ${g.seed} : si l'on ne peut plus traverser ${bloquee.def.nom}, ` +
              `${g.zones[p]!.def.nom} devient inaccessible — et ce n'est PAS une impasse. GOULOT.`,
          ).toBe(true)
        }
        expect(
          perdues.length,
          `seed ${g.seed} : ${bloquee.def.nom} garde ${perdues.length} impasses à elle seule`,
        ).toBeLessThanOrEqual(1)
      }
    }
  })

  it('A22 — LES IMPASSES : de vrais culs-de-sac, mais qu\'AUCUN VILLAGE ne bloque', () => {
    for (const g of graphes) {
      // 0 est PERMIS, et c'est honnête : une gardienne a structurellement ≥ 4 portes (deux pour
      // son impasse, deux pour que le cœur reste 2-connexe), et quatre portes toutes à 250 tuiles
      // ne rentrent pas toujours sur le périmètre d'une cellule. **On ne relâche pas la règle, on
      // renonce au cul-de-sac.** Mesuré sur 40 seeds : 10 cartes en ont deux, 28 en ont un, 2
      // n'en ont aucun — 95 % des vallées ont leur fond.
      expect(g.impasses.length).toBeLessThanOrEqual(MONDE.MAX_IMPASSES)
      expect(g.impasses.length).toBe(g.gardiennes.length)

      const gardiennes = new Set<number>()
      for (const z of g.impasses) {
        const zone = g.zones[z]!
        // Une impasse est une T2 — un trophée, pas un passage de milieu de partie.
        expect(zone.def.tier, `seed ${g.seed} : ${zone.def.nom} est une impasse de palier ${zone.def.tier}`).toBe(2)
        // ELLE PEUT ÊTRE CELLE DU PAS DE LA PORTE, et c'est même le cas : la Cendrière est plein
        // sud, sous le jardin, et n'ouvre que sur lui (croquis d'Alexis, 2026-07-14). La règle
        // d'origine — « la T2 du pas de la porte doit rester un PASSAGE » — visait à ce qu'elle ne
        // soit pas un trophée qu'on va chercher, mais un voisinage qu'on subit. Elle le reste : **le
        // front n'a pas besoin d'être traversé pour avancer**, il avance dans la géographie (R28).

        // UNE seule voisine par les seuils : c'est un cul-de-sac. On en revient par où on est entré.
        const mes = g.seuils.filter((s) => s.a === z || s.b === z)
        const voisines = new Set(mes.map((s) => (s.a === z ? s.b : s.a)))
        expect(voisines.size, `seed ${g.seed} : ${zone.def.nom} a ${voisines.size} voisines — ce n'est pas un cul-de-sac`).toBe(1)

        // MAIS DEUX PORTES, à ≥ 250 tuiles : aucun village ne tient les deux. Sa gardienne est un
        // point d'articulation (inévitable) — mais on ne bloque pas une ZONE, on bloque une PORTE.
        expect(mes.length, `seed ${g.seed} : ${zone.def.nom} n'a que ${mes.length} porte(s)`).toBe(2)
        const d2 = distSq(mes[0]!.x, mes[0]!.y, mes[1]!.x, mes[1]!.y)
        expect(
          d2,
          `seed ${g.seed} : les deux portes de ${zone.def.nom} sont à ${Math.round(Math.sqrt(d2))} tuiles`,
        ).toBeGreaterThanOrEqual(MONDE.ECART_SEUILS * MONDE.ECART_SEUILS)

        // GARDIENNES DISTINCTES : personne ne coupe deux trophées d'un coup.
        const gardienne = [...voisines][0]!
        expect(gardiennes.has(gardienne), `seed ${g.seed} : une même zone garde deux impasses`).toBe(false)
        gardiennes.add(gardienne)
      }
    }
  })

  /**
   * A23 — UNE PORTE EST PURE : elle n'est jamais dans un COIN TRIPLE.
   *
   * TROUVÉ PAR ALEXIS, À L'ŒIL, sur la carte rendue : *« les portes semblent souvent à
   * l'intersection de plusieurs zones. »* La cause était mécanique et c'était mon optimiseur qui
   * la produisait : il ÉCARTE les portes les unes des autres au maximum — or les points d'une
   * frontière les plus éloignés des autres portes sont **ses deux extrémités**, c'est-à-dire les
   * coins triples. Il les y poussait systématiquement.
   *
   * Une porte dans un coin triple est une mauvaise porte : trois frontières s'y croisent, donc
   * aucune n'a d'épaisseur, donc **le seuil y est court** (or un seuil doit avoir une longueur —
   * R10.4). Et le point tombe visuellement dans une zone qui n'est pas la sienne.
   */
  it('A23 — toute porte est PURE : loin de toute troisième zone', () => {
    for (const g of graphes) {
      for (const s of g.seuils) {
        const e = echantillonAt(g, s.x, s.y)
        expect(
          e.purete,
          `seed ${g.seed} : le seuil ${s.id} est à ${Math.round(e.purete)} tuiles d'une TROISIÈME ` +
            `zone — c'est un coin triple, pas une porte.`,
        ).toBeGreaterThanOrEqual(MONDE.PURETE_MIN)
      }
    }
  })

  it('A24 — les portes NATURELLES forment un arbre couvrant : onze, pas deux', () => {
    // Le drapeau `secours` était FAUX : il marquait une porte comme secours dès que l'une de ses
    // deux zones avait déjà été vue — donc, au bout de trois portes, tout devenait secours.
    // Alexis l'a vu sur la carte (« je n'ai que 2 portes principales »). La faute était
    // conceptuelle : « secours » n'est pas une propriété d'une porte dans l'absolu, c'est le point
    // de vue du JOUEUR qui part des Prés Bas. Les portes par lesquelles on DÉCOUVRE chaque zone
    // sont les naturelles — elles forment un arbre couvrant, donc il y en a exactement onze.
    for (const g of graphes) {
      const naturelles = g.seuils.filter((s) => !s.secours)
      expect(naturelles.length, `seed ${g.seed} : ${naturelles.length} portes naturelles`).toBe(REGIONS - 1)
      // Et elles relient bien les douze zones (c'est un arbre, pas un tas).
      const vu = new Set([g.racine])
      const file = [g.racine]
      for (let h = 0; h < file.length; h++) {
        for (const s of naturelles) {
          const v = file[h]!
          const autre = s.a === v ? s.b : s.b === v ? s.a : -1
          if (autre < 0 || vu.has(autre)) continue
          vu.add(autre)
          file.push(autre)
        }
      }
      expect(vu.size, `seed ${g.seed} : les portes naturelles ne joignent que ${vu.size} régions`).toBe(REGIONS)
    }
  })

  it('A5 — LE TEST DESTRUCTIF : on bouche les seuils d\'une zone, elle est ISOLÉE', () => {
    // C'est le seul test qui prouve qu'une porte en est une. L'ancienne carte perdait 0,2 %
    // de son marchable quand on bouchait ses onze « verrous » : les portes n'en étaient pas,
    // et personne ne s'en était aperçu.
    for (const g of graphes) {
      for (const z of g.zones) {
        if (z.id === g.racine) continue
        const siens = new Set(g.seuils.filter((s) => s.a === z.id || s.b === z.id).map((s) => s.id))
        const reste = atteignables(g, siens)
        expect(reste.has(z.id), `seed ${g.seed} : ${z.def.nom} reste jointe malgré ses seuils bouchés`)
          .toBe(false)
      }
    }
  })

  it('A6bis — un seuil relie toujours DEUX zones distinctes, et ses bouts sont dans la carte', () => {
    for (const g of graphes) {
      expect(g.seuils.length).toBeGreaterThan(0)
      for (const s of g.seuils) {
        expect(s.a).not.toBe(s.b)
        expect(s.a).toBeLessThan(s.b) // paire canonique
        expect(s.x).toBeGreaterThanOrEqual(0)
        expect(s.y).toBeGreaterThanOrEqual(0)
        expect(s.x).toBeLessThan(g.width)
        expect(s.y).toBeLessThan(g.height)
        // ═══ IL SÉPARE VRAIMENT `a` DE `b` — et on le VÉRIFIE, on ne le mesure plus ═══
        //
        // L'ancienne garde exigeait que la MARGE au point du seuil soit petite (« il est sur la
        // frontière »). Elle ne veut plus rien dire : depuis que les rectangles se chevauchent
        // (spec R40), la marge se mesure contre le rectangle NOMINAL d'une région, alors que sa
        // forme visible peut être bien plus petite — une voisine lui a mangé un morceau. Un seuil
        // parfaitement posé sur la frontière VISIBLE se retrouvait « à 55 tuiles de la frontière ».
        //
        // On teste donc ce que la règle VEUT DIRE, et non un chiffre qui l'approchait : de part et
        // d'autre du point, dans l'axe de traversée, on doit trouver `a` d'un côté et `b` de l'autre.
        // C'est la définition d'une porte.
        const R = MONDE.BLOC
        const avant = echantillonAt(g, s.x - s.ax * R, s.y - s.ay * R)
        const apres = echantillonAt(g, s.x + s.ax * R, s.y + s.ay * R)
        expect(
          [avant.zone, apres.zone].sort((p, q) => p - q),
          `seed ${g.seed} : le seuil ${s.id} devait séparer ${g.zones[s.a]!.def.nom} de ` +
            `${g.zones[s.b]!.def.nom}, il sépare ${g.zones[avant.zone]!.def.nom} de ` +
            `${g.zones[apres.zone]!.def.nom}`,
        ).toEqual([s.a, s.b])
      }
    }
  })

  it('A8 — deux seeds donnent deux GRAPHES différents : la rejouabilité inter-saisons', () => {
    // Une saison = une carte. Si deux saisons donnent le même plan, on n'a rien à explorer la
    // seconde fois. On compare la SIGNATURE du graphe : qui est voisin de qui, par identité.
    const signature = (g: GrapheZones) =>
      g.seuils
        .map((s) => [g.zones[s.a]!.def.slug, g.zones[s.b]!.def.slug].sort().join('-'))
        .sort()
        .join('|')
    const vues = new Set(graphes.map(signature))
    // On tolère une collision (12 seeds, un espace fini), pas une famille.
    expect(vues.size, 'les seeds produisent le même plan').toBeGreaterThanOrEqual(SEEDS.length - 1)
  })

  it('A12 — le graphe est DÉTERMINISTE : même seed, même plan, au bit près', { timeout: 60_000 }, () => {
    for (const seed of SEEDS) {
      const a = deriveGrapheZones(seed)
      const b = deriveGrapheZones(seed)
      expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    }
  })
})

/**
 * LE BALAYAGE LARGE — et c'est LUI qui a trouvé ce que douze seeds cachaient.
 *
 * À poids de racine fixe, **7 seeds sur 60 ne généraient pas du tout** : la racine gonflée
 * écrasait une voisine au point qu'il ne lui restait plus deux frontières. Les douze seeds de
 * garde n'en voyaient AUCUNE — elles avaient eu de la chance. Sur un jeu où une saison = une
 * seed, 12 % de cartes mort-nées, c'est un serveur ruiné une fois sur huit.
 *
 * LA LEÇON, à consigner : **une garde sur douze seeds ne mesure pas un taux d'échec de 12 %.**
 * Ce qui protège un serveur, ce n'est pas la profondeur des vérifications sur quelques cartes,
 * c'est le NOMBRE de cartes. Cette garde est lente (~25 s) ; elle s'assume, elle ne se rogne
 * pas.
 */
describe('le balayage large — 60 seeds, et un seul échec est un échec', () => {
  it('aucune seed ne fait exploser la génération, et toutes les portes tiennent', { timeout: 90_000 }, () => {
    const echecs: string[] = []
    let pireEcart = Infinity
    for (let k = 1; k <= 60; k++) {
      const seed = k * 7919
      let g: GrapheZones
      try {
        g = deriveGrapheZones(seed)
      } catch (e) {
        echecs.push(`seed ${seed} — la génération ÉCHOUE : ${(e as Error).message.slice(0, 70)}`)
        continue
      }
      if (g.zones.length !== REGIONS) echecs.push(`seed ${seed} — ${g.zones.length} régions`)
      if (atteignables(g).size !== REGIONS) echecs.push(`seed ${seed} — une région est injoignable`)
      for (const z of g.zones) {
        const m = g.seuils.filter((s) => s.a === z.id || s.b === z.id)
        if (m.length < 2) echecs.push(`seed ${seed} — ${z.def.nom} n'a que ${m.length} porte(s)`)
        // LE PLAFOND DE PORTES A SAUTÉ, et c'est le croquis qui l'a fait sauter. Il existait pour
        // qu'une cellule tirée au sort ne se retrouve pas criblée de frontières minuscules. La carte
        // est désormais DESSINÉE : le jardin ouvre sur quatre pays plus la Cendrière (cinq portes),
        // le Névé sur cinq. Ce ne sont pas des accidents à borner — ce sont les carrefours du plan.
        //
        // LE NÉVÉ EST EXEMPTÉ DE L'ÉCARTEMENT (voir `vraies`) : on ne bâtit pas dedans, donc aucun
        // village ne peut y tenir deux portes, donc la règle des 250 tuiles n'a rien à y dire.
        if (z.def.traverse) continue
        for (let i = 0; i < m.length; i++) {
          for (let j = i + 1; j < m.length; j++) {
            const d = Math.sqrt(distSq(m[i]!.x, m[i]!.y, m[j]!.x, m[j]!.y))
            pireEcart = Math.min(pireEcart, d)
            if (d < MONDE.ECART_SEUILS) {
              echecs.push(`seed ${seed} — deux portes de ${z.def.nom} à ${Math.round(d)} tuiles`)
            }
          }
        }
      }
    }
    expect(echecs.slice(0, 8)).toEqual([])
    expect(pireEcart).toBeGreaterThanOrEqual(MONDE.ECART_SEUILS)
  })
})

describe('le dimensionnement — UN SEUL bouton (A20)', () => {
  it('la carte se DÉDUIT du nombre de joueurs, elle ne se règle pas à la main', () => {
    const { width, height } = tailleCarte(50)
    // LA CARTE A GRANDI, et c'est le prix du non-pavage (spec R39) : ~15 % d'elle est du VIDE, où
    // l'on ne joue pas. Pour garder la même surface JOUABLE qu'un pavage de 2,5 M de tuiles, il en
    // faut ~3,75 M au total. La garde borne l'ordre de grandeur, pas le chiffre.
    expect(width * height).toBeGreaterThan(3_000_000)
    expect(width * height).toBeLessThan(4_500_000)
    // Portrait : une vallée alpine, la bouche au sud.
    expect(height).toBeGreaterThan(width)
  })

  it('doubler les joueurs double la surface', () => {
    const a = tailleCarte(50)
    const b = tailleCarte(100)
    const ratio = (b.width * b.height) / (a.width * a.height)
    expect(ratio).toBeGreaterThan(1.95)
    expect(ratio).toBeLessThan(2.05)
  })

  /**
   * A17 — LA RACINE PORTE LES VILLAGES, et c'est une AIRE, pas une intention.
   *
   * Le seuil se remonte : `JOUEURS_CIBLE / JOUEURS_PAR_VILLAGE` villages, chacun réclamant un
   * territoire d'`ESPACEMENT_VILLAGES²`. Une carte qui ne le tient pas est une cohue — et on
   * ne s'en apercevrait qu'au lancement du serveur, c'est-à-dire trop tard.
   *
   * La racine a été AGRANDIE le 2026-07-14 sur retour d'Alexis (« la racine est trop petite »),
   * alors même que le calcul disait qu'elle suffisait. Cette garde protège donc un chiffre
   * qu'un œil a tranché contre un tableur : elle vaut la peine d'exister.
   */
  it('A17 — la racine porte ses villages, sur toute seed', { timeout: 60_000 }, () => {
    const { width, height } = tailleCarte()
    const villages = Math.ceil(MONDE.JOUEURS_CIBLE / MONDE.JOUEURS_PAR_VILLAGE)
    const requis = villages * MONDE.ESPACEMENT_VILLAGES * MONDE.ESPACEMENT_VILLAGES
    const PAS = 8
    for (const g of graphes) {
      let aire = 0
      for (let y = 0; y < height; y += PAS) {
        for (let x = 0; x < width; x += PAS) {
          const e = echantillonAt(g, x, y)
          if (!e.vide && e.zone === g.racine) aire += PAS * PAS // le VIDE ne porte pas de village
        }
      }
      expect(
        aire,
        `seed ${g.seed} : la racine fait ${aire} tuiles pour ${villages} villages (${requis} requis)`,
      ).toBeGreaterThanOrEqual(requis)
    }
  })
})
