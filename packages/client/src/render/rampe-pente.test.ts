/**
 * ═══ LA RAMPE EST UN PLAN INCLINÉ — la garde de CONTINUITÉ ═══
 *
 * *Alexis, 2026-09-01 : « quand je monte une rampe le personnage se téléporte en haut. »*
 *
 * L'étage de `/sim` est un ENTIER qui commute d'un tick à l'autre : le sprite sautait de
 * `LIFT_TUILES` tuiles — 32 px — en une image. `niveauDuCorps` remplace la marche par une pente,
 * et cette garde éprouve la seule propriété qui compte : **la hauteur dessinée ne fait aucun saut
 * que le pas ne justifie**, dans les deux sens de marche.
 *
 * ⚠ **ELLE LIT LE CODE DU JEU, PAS UNE COPIE** : la carte est une vraie `WorldMap` avec son étage
 * et son connecteur, l'étage à chaque tick vient du VRAI `step()` de la sim, la pente vient de la
 * VRAIE `EtageLayer.penteAt` (la couche qui peint la rampe), et la hauteur de la VRAIE
 * `niveauDuCorps` qu'appelle `syncActor`. Rien n'est reconstitué à côté.
 *
 * ⚠ **CE QUI LA FERAIT ROUGIR, énoncé avant d'accepter son vert** : remplacer `niveauDuCorps` par
 * `etage` (le code d'avant) — le témoin `LA MARCHE D'AVANT` le montre, 32 px en un tick pour un
 * pas de 0,1 tuile. Et un montage qui ne monterait pas rougirait aussi : on affirme d'abord que
 * la promenade a bien gravi tout le lift.
 */
import { describe, expect, it, vi } from 'vitest'
import type Phaser from 'phaser'

// Le moteur ne se charge pas sous Node (« window is not defined ») : `EtageLayer` n'en lit au
// chargement que des CONSTANTES (modes de fusion, filtre de texture). Le leurre les fournit ;
// rien d'autre n'est appelé — la couche de labo ne touche jamais la scène.
vi.mock('phaser', () => ({
  default: {
    BlendModes: { NORMAL: 0, ADD: 1, MULTIPLY: 2, SCREEN: 3 },
    Textures: { FilterMode: { NEAREST: 0 } },
  },
}))
import {
  BALANCE, createEmptyMap, createSim, spawnEntity, step,
  TERRAIN_GRASS, TERRAIN_ROCK, TERRAIN_SCREE,
  type EtageCreux, type WorldMap,
} from '@ashes/sim'
import { EtageLayer } from '../scenes/world/etage-layer'
import { decalageDEtage, LIFT_TUILES, TILE_PX } from './framing'
import { RAMPE_RANGEES } from './plateau-art'
import { creerRelief } from './relief'

const CAP_X0 = 10
const CAP_Y0 = 10
const CAP_N = 6
/** La rampe, juste au sud du chapeau — le montage de `etages.test.ts`, à l'identique. */
const RAMPE = { x: 12, y: CAP_Y0 + CAP_N }

function mesaDeLabo(): WorldMap {
  const map = createEmptyMap(24, 24, TERRAIN_GRASS)
  const tuiles: number[] = []
  for (let dy = 0; dy < CAP_N; dy++) {
    for (let dx = 0; dx < CAP_N; dx++) {
      const x = CAP_X0 + dx
      const y = CAP_Y0 + dy
      map.terrain[y * map.width + x] = TERRAIN_ROCK // le chapeau reste de la roche AU SOL
      tuiles.push(y * map.width + x)
    }
  }
  tuiles.push(RAMPE.y * map.width + RAMPE.x)
  tuiles.sort((a, b) => a - b)
  const etage: EtageCreux = {
    niveau: 1,
    idx: tuiles,
    terrain: tuiles.map(() => TERRAIN_SCREE),
    x0: CAP_X0, y0: CAP_Y0, x1: CAP_X0 + CAP_N, y1: RAMPE.y + 1,
  }
  map.etages = [etage]
  map.connecteurs = [{ x: RAMPE.x, y: RAMPE.y, de: 0, vers: 1, type: 'rampe' }]
  return map
}

/** La couche n'appelle la scène ni au constructeur ni dans `penteAt` : elle n'y indexe que la
 *  carte. C'est ce qui permet d'éprouver la VRAIE géométrie sans Phaser. */
function coucheDeLabo(map: WorldMap): EtageLayer {
  return new EtageLayer(undefined as unknown as Phaser.Scene, map, creerRelief(map))
}

/** Le pas EST-OUEST d'un tick, en tuiles, depuis ce point de départ — l'axe qui ne gravit rien. */
function promenadeX(map: WorldMap, depart: { x: number; y: number }): number {
  const sim = createSim(1, { map, worldEvents: false, faunaCap: 0, meteoActive: false })
  const id = spawnEntity(sim, depart.x, depart.y)
  const avant = sim.entities.find((k) => k.id === id)!.x
  step(sim, [{ entityId: id, dx: 1, dy: 0 }])
  return Math.abs(sim.entities.find((k) => k.id === id)!.x - avant)
}

/** La promenade : on marche dans `dy` pendant `ticks`, et on relève à chaque tick la position du
 *  corps ET la hauteur à laquelle le rendu le DESSINE. */
function promenade(
  map: WorldMap, depart: { x: number; y: number; etage?: number }, dy: -1 | 1, ticks: number,
) {
  const couche = coucheDeLabo(map)
  const sim = createSim(1, { map, worldEvents: false, faunaCap: 0, meteoActive: false })
  const id = spawnEntity(sim, depart.x, depart.y)
  // `spawnEntity` pose un corps AU SOL : celui qui part du plateau doit dire son plancher, sinon
  // il naît à l'étage 0 sur de la roche — bloqué, et sans jamais rien dessiner de haut.
  if (depart.etage !== undefined) sim.entities.find((k) => k.id === id)!.etage = depart.etage
  const releve: { y: number; px: number }[] = []
  for (let t = 0; t < ticks; t++) {
    step(sim, [{ entityId: id, dx: 0, dy }])
    const e = sim.entities.find((k) => k.id === id)!
    releve.push({ y: e.y, px: decalageDEtage(couche.niveauDuCorps(e.x, e.y, e.etage ?? 0)) })
  }
  return releve
}

/** Le saut d'écran qu'un pas de `dy` tuiles AUTORISE : la pente vaut `LIFT_TUILES` tuiles d'écran
 *  par tuile de monde, et rien dans le rendu n'a le droit d'aller plus vite qu'elle. */
const sautAutorise = (dy: number): number => LIFT_TUILES * TILE_PX * Math.abs(dy) + 1e-6

describe('la rampe se gravit en PENTE, jamais en marche', () => {
  it('EN MONTANT : la hauteur dessinée ne fait aucun saut que le pas ne justifie', () => {
    const map = mesaDeLabo()
    const releve = promenade(map, { x: RAMPE.x + 0.5, y: RAMPE.y + 2.5 }, -1, 120)
    // ① La garde ne peut pas passer à vide : la promenade a VRAIMENT gravi tout le lift.
    // ⚠ `toBeCloseTo` et non `toBe` : `decalageDEtage(0)` rend **−0**, que `Object.is` distingue.
    expect(releve[0]!.px, 'on part au sol').toBeCloseTo(0, 6)
    expect(releve[releve.length - 1]!.px, 'on finit sur le plateau')
      .toBeCloseTo(-LIFT_TUILES * TILE_PX, 6)
    // ② …et elle l'a gravi sans un seul saut.
    for (let i = 1; i < releve.length; i++) {
      const dPx = Math.abs(releve[i]!.px - releve[i - 1]!.px)
      const dy = releve[i]!.y - releve[i - 1]!.y
      expect(dPx, `tick ${i} : ${dPx.toFixed(2)} px pour un pas de ${dy.toFixed(3)} tuile`)
        .toBeLessThanOrEqual(sautAutorise(dy))
    }
  })

  it('EN DESCENDANT : la même pente, dans l’autre sens — aucune hystérésis', () => {
    // ⚠ LE SENS QUI PIÈGE. Sur la tuile de rampe, `/sim` dit ÉTAGE 1 en descendant (on garde son
    // plancher tant qu'il porte) et ÉTAGE 0 en montant : l'entier n'est pas symétrique. La
    // hauteur, elle, se prend sur la POSITION — elle l'est donc, et c'est ce qui interdit au
    // corps de flotter quand on redescend.
    const map = mesaDeLabo()
    const releve = promenade(map, { x: RAMPE.x + 0.5, y: CAP_Y0 + CAP_N - 1.5, etage: 1 }, 1, 120)
    expect(releve[0]!.px, 'on part du plateau').toBeCloseTo(-LIFT_TUILES * TILE_PX, 6)
    expect(releve[releve.length - 1]!.px, 'on finit au sol').toBeCloseTo(0, 6)
    for (let i = 1; i < releve.length; i++) {
      const dPx = Math.abs(releve[i]!.px - releve[i - 1]!.px)
      expect(dPx).toBeLessThanOrEqual(sautAutorise(releve[i]!.y - releve[i - 1]!.y))
    }
  })

  it('LA MARCHE D’AVANT — le témoin : sur l’ENTIER de la sim, le saut fait bien 32 px', () => {
    // Sans lui, les deux gardes ci-dessus pourraient être vertes parce qu'elles ne mesurent rien.
    const map = mesaDeLabo()
    const couche = coucheDeLabo(map)
    const sim = createSim(1, { map, worldEvents: false, faunaCap: 0, meteoActive: false })
    const id = spawnEntity(sim, RAMPE.x + 0.5, RAMPE.y + 2.5)
    let sautEntier = 0
    let sautPente = 0
    let avantEntier = 0
    let avantPente = 0
    for (let t = 0; t < 120; t++) {
      step(sim, [{ entityId: id, dx: 0, dy: -1 }])
      const e = sim.entities.find((k) => k.id === id)!
      const entier = decalageDEtage(e.etage ?? 0) // LE CODE D'AVANT
      const pente = decalageDEtage(couche.niveauDuCorps(e.x, e.y, e.etage ?? 0))
      if (t > 0) {
        sautEntier = Math.max(sautEntier, Math.abs(entier - avantEntier))
        sautPente = Math.max(sautPente, Math.abs(pente - avantPente))
      }
      avantEntier = entier
      avantPente = pente
    }
    expect(sautEntier, 'la marche d’avant : tout le lift en une image')
      .toBeCloseTo(LIFT_TUILES * TILE_PX, 6)
    // Et la pente, sur la même promenade, ne dépasse jamais ce qu'un pas parcourt.
    expect(sautPente).toBeLessThan(LIFT_TUILES * TILE_PX / 4)
  })

  it('LE RETARD DE L’AUTORITÉ NE FAIT PAS SAUTER LE CORPS (Alexis : « il y a un saut »)', () => {
    /**
     * ⚠ **LE DÉFAUT QUI RESTAIT APRÈS LA PENTE, et il ne se voit sur AUCUNE image fixe.**
     *
     * Le client dessine à la position PRÉDITE (`WorldScene` : `syncActor(…, render.x, render.y,
     * …, this.etageJoueur)`) mais avec l'étage de l'AUTORITÉ — `etageJoueur` n'est posé qu'à la
     * réconciliation (« la prédiction ne le calcule pas, elle le LIT »). Entre les deux il y a au
     * moins un tick.
     *
     * Conséquence exacte : à l'image où la position prédite quitte la tuile de rampe pour le
     * chapeau, la pente n'a plus lieu d'être (on n'est plus sur un connecteur) et l'étage vaut
     * encore 0 — le corps retombe de tout le lift, puis remonte quand l'autorité rattrape.
     * **Un plongeon de 32 px d'un aller-retour**, au moment précis du changement d'étage.
     *
     * On modélise donc le client honnêtement : la POSITION du tick `i`, l'ÉTAGE du tick `i − k`.
     * Ce qui ferait rougir : k = 0 (aucun retard) — le cas que les deux gardes du dessus
     * éprouvent déjà, et qui ne dit rien de celui-ci.
     */
    const map = mesaDeLabo()
    const couche = coucheDeLabo(map)
    const sim = createSim(1, { map, worldEvents: false, faunaCap: 0, meteoActive: false })
    const id = spawnEntity(sim, RAMPE.x + 0.5, RAMPE.y + 2.5)
    const trace: { y: number; etage: number }[] = []
    for (let t = 0; t < 120; t++) {
      step(sim, [{ entityId: id, dx: 0, dy: -1 }])
      const e = sim.entities.find((k) => k.id === id)!
      trace.push({ y: e.y, etage: e.etage ?? 0 })
    }
    // La garde ne peut pas passer à vide : la promenade a bien changé d'étage en chemin.
    expect(new Set(trace.map((p) => p.etage)).size, 'la marche traverse bien un changement d’étage').toBe(2)
    for (const retard of [1, 2, 3]) {
      let pire = 0
      let avant: number | null = null
      for (let i = 0; i < trace.length; i++) {
        const pos = trace[i]!
        const etageVu = trace[Math.max(0, i - retard)]!.etage // ce que l'autorité a eu le temps de dire
        const px = decalageDEtage(couche.niveauDuCorps(RAMPE.x + 0.5, pos.y, etageVu))
        if (avant !== null) {
          const dy = pos.y - trace[i - 1]!.y
          pire = Math.max(pire, Math.abs(px - avant) - sautAutorise(dy))
        }
        avant = px
      }
      expect(pire, `retard de ${retard} tick(s) : dépassement de ${pire.toFixed(1)} px`)
        .toBeLessThanOrEqual(0)
    }
  })

  it('AUCUN À-COUP : le corps parcourt le MÊME écran à chaque tick, du plat au plateau', () => {
    /**
     * ⚠ **LA GARDE QUI RÉPOND AUX TROIS GRIEFS D'ALEXIS À LA FOIS** (« il va trop vite »,
     * « il y a un petit bump en bas et en haut de la rampe »). Elle ne mesure ni la hauteur ni la
     * position : elle mesure **l'écran parcouru PAR TICK**, la seule grandeur que l'œil juge.
     *
     * MESURÉ avant correctifs, sur cette promenade exacte : croisière −3,20 px, **entrée de rampe
     * −6,39 px** (le double), **sortie −2,17 px** (les deux tiers). Ce qui la ferait rougir :
     * remettre `RAMPE_VITESSE` à 1 (la croisière de rampe passe à −9,59) ou rendre à `moveAvatar`
     * son allure lue à la seule tuile de départ (les deux à-coups de bordure reviennent).
     */
    const map = mesaDeLabo()
    const releve = promenade(map, { x: RAMPE.x + 0.5, y: RAMPE.y + 3.5 }, -1, 200)
    // L'écran d'un corps = la rangée de ses PIEDS, plus la hauteur à laquelle on le dessine.
    const ecranDe = (p: { y: number; px: number }): number => (p.y + 0.1875) * TILE_PX + p.px
    // ⚠ ON MESURE LA TRAVERSÉE, PAS LA BUTÉE. La promenade finit collée au mur nord du chapeau
    // (`y = 10,188`), et le dernier pas y est TRONQUÉ par la collision — 2,15 px au lieu de 3,20.
    // Ce n'est pas un à-coup, c'est un arrêt : un pas empêché n'est pas un pas. On borne donc la
    // fenêtre au trajet libre, du sol sous la rampe à deux tuiles sur le plateau.
    const pas: number[] = []
    for (let i = 1; i < releve.length; i++) {
      const y = releve[i]!.y
      if (y > RAMPE.y + 3 || y < CAP_Y0 + 2) continue
      pas.push(Math.abs(ecranDe(releve[i]!) - ecranDe(releve[i - 1]!)))
    }
    expect(pas.length, 'la garde ne peut pas passer à vide : la marche a bien traversé').toBeGreaterThan(30)
    // Elle a bien changé d'étage en chemin (sans quoi on mesurerait une promenade en plaine).
    expect(releve.some((p) => p.px !== 0) && releve.some((p) => p.px === 0)).toBe(true)
    const mini = Math.min(...pas)
    const maxi = Math.max(...pas)
    expect(maxi / mini, `écran par tick : de ${mini.toFixed(2)} à ${maxi.toFixed(2)} px`)
      .toBeLessThan(1.02)
  })

  it('LE RALENTISSEMENT NE VAUT QUE DANS LA DIRECTION DE LA RAMPE (Alexis, 2026-09-01)', () => {
    /**
     * *« le ralentissement ne doit avoir lieu que dans la direction de la rampe »* — et c'est la
     * géométrie qui le dit : une rampe monte vers le NORD. Se déplacer d'est en ouest ne gagne
     * pas un pouce de hauteur, donc ne coûte rien. Un facteur posé sur la vitesse ENTIÈRE faisait
     * patauger celui qui traverse la porte de biais.
     *
     * ⚠ ON MESURE SUR UNE PORTE LARGE, et il le faut : dans une entaille d'UNE tuile, l'est-ouest
     * est fermé par les joues (`brideDeLaJoue`) — il n'y aurait pas de pas à chronométrer. Sur
     * trois tuiles on passe librement d'une colonne à l'autre, et c'est là que la question se pose.
     *
     * Ce qui la ferait rougir : rendre le facteur à la vitesse entière (le pas d'une colonne à
     * l'autre tombe alors au tiers).
     */
    const map = mesaDeLabo()
    // La porte du monde joué : `CREUX.RAMPE_LARGEUR` colonnes, toutes montantes.
    const xs = [RAMPE.x - 1, RAMPE.x, RAMPE.x + 1]
    const tuiles = new Set(map.etages![0]!.idx)
    for (const x of xs) tuiles.add(RAMPE.y * map.width + x)
    const idx = [...tuiles].sort((a, b) => a - b)
    map.etages = [{ ...map.etages![0]!, idx, terrain: idx.map(() => TERRAIN_SCREE) }]
    map.connecteurs = xs.map((x) => ({ x, y: RAMPE.y, de: 0, vers: 1, type: 'rampe' as const }))
    // Depuis la colonne du MILIEU : le corps a la place de faire un pas entier sans toucher de joue.
    const surLaRampe = promenadeX(map, { x: RAMPE.x + 0.5, y: RAMPE.y + 0.5 })
    const aCote = promenadeX(map, { x: RAMPE.x + 0.5, y: RAMPE.y + 2.5 })
    expect(aCote, 'la garde ne peut pas passer à vide').toBeGreaterThan(0.05)
    expect(surLaRampe / aCote, `est-ouest : ${surLaRampe.toFixed(3)} sur la rampe, ${aCote.toFixed(3)} à côté`)
      .toBeCloseTo(1, 2)
  })

  it('LA VITESSE DU PAS ET LA HAUTEUR DU DESSIN SONT ATTACHÉES (Alexis : « il va trop vite »)', () => {
    /**
     * ⚠ **DEUX ÉCRITURES, UN SEUL NOMBRE.** `LIFT_TUILES` vit dans le rendu (une hauteur de
     * PIXELS, que `/sim` n'a pas le droit de connaître) et `RAMPE_VITESSE` dans `balance.ts` (il
     * se règle en JOUANT). Or le second N'EST QUE l'inverse du premier plus un : à l'écran une
     * tuile de rampe fait `1 + LIFT_TUILES` rangées, donc un pas à l'allure de la plaine y couvre
     * trois fois plus d'écran. Les laisser dériver, c'est retrouver le « trop vite » sans savoir
     * d'où il revient — cette garde est le lien qui manquerait.
     *
     * Ce qui la ferait rougir : changer l'un des deux sans l'autre.
     */
    expect(BALANCE.RAMPE_VITESSE).toBeCloseTo(1 / (1 + LIFT_TUILES), 10)
    // …et le dessin dit la même chose : l'entaille fait bien ce nombre de rangées.
    expect(RAMPE_RANGEES).toBe(1 + LIFT_TUILES)
  })

  it('UNE COLONNE DE FLANC N’INCLINE RIEN : elle ne mène pas sur le plateau', () => {
    // La rampe du monde joué fait trois tuiles, mais seule celle du milieu touche le chapeau.
    // Incliner un flanc referait la téléportation à l'envers — on monterait la pente pour
    // retomber d'un coup en la quittant par le nord.
    const map = mesaDeLabo()
    map.connecteurs = [
      { x: RAMPE.x - 1, y: RAMPE.y, de: 0, vers: 1, type: 'rampe' },
      ...map.connecteurs!,
    ]
    // Le voisin nord du flanc (11, 15) est bien du chapeau ici, donc on déplace le flanc HORS
    // de l'aplomb du chapeau pour éprouver le cas réel (celui de la mesa 577..579 de 2026).
    map.connecteurs = [{ x: CAP_X0 - 2, y: RAMPE.y, de: 0, vers: 1, type: 'rampe' }, ...map.connecteurs]
    const couche = coucheDeLabo(map)
    expect(couche.penteAt(CAP_X0 - 2, RAMPE.y), 'flanc sans chapeau au nord').toBeUndefined()
    expect(couche.penteAt(RAMPE.x, RAMPE.y), 'la tuile élue, elle, incline').toEqual({ bas: 0, haut: 1 })
  })
})
