import { describe, expect, it } from 'vitest'
import { BALANCE, FOOD_VALUES, ITEM_WEIGHT, SLOTS, SPOIL_CYCLES, TERRAINS, TERRAIN_SCREE, TERRAIN_SNOW } from './balance'
import { stackSize, type ItemId } from './items'

describe('les tailles de sac (spec inventaire R11)', () => {
  // Les `addItems` de la sim qui jettent leur reliquat le font À RAISON — parce que
  // le sac de destination est TOUJOURS assez grand pour la source. Deux familles :
  //
  // 1. Le sac de destination est plus GRAND (c'est ce que ce test garde) :
  //    - combat.ts `killEntity` : le cadavre (CORPSE) reçoit le sac du mort (NPC/PLAYER) ;
  //    - village.ts `applyStructureDamage` et `demolish` : un conteneur détruit ou
  //      démoli (CHEST) répand son contenu dans un tas au sol (CORPSE).
  //
  // 2. Le sac de destination est plus PETIT, et c'est sûr quand même —
  //    cendreux.ts : le Cendreux (NPC, 40) hérite d'un cadavre (CORPSE, 48). Ce
  //    n'est PAS `NPC ≥ CORPSE` (c'est faux) qui le sauve : le contenu de ce
  //    cadavre vient du sac d'une ENTITÉ (killEntity), et `toBag` le re-fusionne
  //    en piles pleines — il se re-range donc dans au plus autant de cases que la
  //    source. L'invariant qui compte est celui de la source : NPC ≥ PLAYER.
  //
  // Tourner ces boutons en playtest (ce à quoi balance.ts invite) sans respecter
  // la chaîne détruirait des items en silence. Ce test le transforme en échec de CI.
  it('CORPSE ≥ NPC ≥ PLAYER et CORPSE ≥ CHEST — sinon un transfert tronque en silence', () => {
    expect(SLOTS.CORPSE).toBeGreaterThanOrEqual(SLOTS.NPC)
    expect(SLOTS.NPC).toBeGreaterThanOrEqual(SLOTS.PLAYER)
    expect(SLOTS.CORPSE).toBeGreaterThanOrEqual(SLOTS.CHEST)
    // La ceinture est une RÉGION du sac du joueur, pas un sac à part (R7).
    expect(SLOTS.PLAYER).toBeGreaterThanOrEqual(SLOTS.BELT)
  })

  // Le stade « work » de la récolte PNJ (npc.ts) ne s'achève qu'à la CIBLE DE
  // PORTAGE. Si une case pleine du butin en contenait moins, un PNJ pourrait
  // saturer son sac avant d'atteindre la cible, et frapperait alors le buisson
  // pour l'éternité (chaque coup jetant sa récolte, faute de place) sans jamais
  // passer au rangement. Deux boutons de balance.ts, un seul livelock.
  it('une case pleine du butin porte au moins la cible de portage du PNJ', () => {
    for (const item of Object.keys(BALANCE.NPC_CARRY_TARGETS) as (keyof typeof BALANCE.NPC_CARRY_TARGETS)[]) {
      expect(stackSize(item)).toBeGreaterThanOrEqual(BALANCE.NPC_CARRY_TARGETS[item])
    }
  })
})

describe('terrains d\'altitude alpins', () => {
  it('scree est marchable et À PLEIN RÉGIME (éboulis)', () => {
    expect(TERRAIN_SCREE).toBe(9)
    // `speedFactor: 1` depuis le 2026-08-27 (décision d'Alexis : « pas de ralentissement dans
    // les biomes concernés ») — il valait 0,7. Le coût de la caillasse n'est plus une vitesse
    // de marche, c'est le DÉTOUR : le chaos porte des blocs pleine tuile qu'on contourne, et
    // rien n'y pousse. `cover: 1` : l'éboulis n'abrite personne (spec chasse C3).
    expect(TERRAINS[TERRAIN_SCREE]).toEqual({ name: 'scree', walkable: true, speedFactor: 1, cover: 1 })
  })
  /**
   * LA NEIGE EST PRATICABLE — décision d'Alexis, 2026-07-14. Ce test disait l'inverse.
   *
   * Elle bloquait, et c'était une faute qui se dénonçait elle-même : `TEMPERATURE.BIOME_OFFSET`
   * inflige **−10 sur la neige**, un malus pour qui S'Y TIENT — or on ne pouvait jamais s'y
   * tenir. **Cette ligne était du code mort**, et toute la conception « le froid, prix de la
   * verticalité » était inerte. Avec la roche et le glacier, ça faisait 24 % de la carte en
   * décor peint.
   *
   * Lente (0,5 : on s'enfonce) et mortellement froide — c'est ce qui rend le Névé Blanc possible.
   */
  it('snow est PRATICABLE — lente, et mortellement froide', () => {
    expect(TERRAIN_SNOW).toBe(10)
    expect(TERRAINS[TERRAIN_SNOW]!.walkable).toBe(true)
    expect(TERRAINS[TERRAIN_SNOW]!.speedFactor).toBeLessThan(1)
  })
})

/**
 * LES TABLES QUI DOIVENT SE RÉPONDRE.
 *
 * `balance.ts` est un fichier de DONNÉES, par décision de projet — et c'est très bien.
 * Mais plusieurs de ses tables sont des `Partial<Record<ItemId, …>>` : y oublier une
 * entrée ne casse rien, ne se voit pas, et retire silencieusement une règle du jeu.
 * C'est déjà arrivé une fois, et le défaut est LIVE (voir ci-dessous).
 *
 * Ces gardes ne fixent aucun nombre — l'équilibrage reste une décision d'Alexis. Elles
 * affirment seulement qu'une table ne peut pas oublier ce qu'une autre déclare.
 */
describe('les tables de balance se répondent (pas de trou silencieux)', () => {
  /**
   * TOUT ALIMENT DOIT POUVOIR POURRIR — sinon la promesse est cassée en silence.
   *
   * `SPOIL_CYCLES` le dit lui-même : « un objet absent de cette table ne pourrit pas ».
   * Et son en-tête dit POURQUOI elle existe : le GDD §8 veut « une économie de flux, pas
   * de stock ». Un aliment oublié ici est donc un aliment éternel — l'inverse exact de
   * l'intention, et il vide de son sens le Grenier, dont tout l'intérêt est de RALENTIR
   * la péremption.
   *
   * MESURÉ aujourd'hui : `legume` est le seul aliment absent de la table. C'est le plus
   * conséquent des sept — le potager est la seule nourriture qu'on PRODUISE à l'échelle,
   * et c'est aussi celle qui s'empile le plus (20 par case, contre 10 pour les baies).
   *
   * Le NOMBRE (en combien de cycles un légume s'avarie) est un arbitrage d'équilibrage,
   * donc une décision d'Alexis — un tubercule qui se garde plus longtemps que des baies
   * est parfaitement défendable, et ça change si la ferme est un stock viable. Je ne le
   * tranche pas : je le NOMME ici pour qu'il cesse d'être invisible. Retirer `legume` de
   * cette liste dès qu'il a sa valeur est le geste qui referme le trou.
   */
  // `legume` : la culture d'hiver, sèche et dure — elle se garde, c'est son métier.
  // `tubercule` (spec `saisons.md` S16) : **le seul des quatre à traverser le Grand Froid**, et
  // c'est tout son intérêt — ce qu'on sème aux Pluies est ce qu'on mangera en plein hiver. La
  // tension vient de là et de nulle part ailleurs : aucune règle de conservation n'a été écrite.
  const IMPERISSABLES_ASSUMES: readonly ItemId[] = ['legume', 'tubercule']

  it('tout aliment a une durée de péremption (hors exemption nommée)', () => {
    const sansPeremption = (Object.keys(FOOD_VALUES) as ItemId[]).filter((i) => SPOIL_CYCLES[i] === undefined)
    expect(sansPeremption.sort()).toEqual([...IMPERISSABLES_ASSUMES].sort())
  })

  it("l'exemption ne couvre que des aliments réels (garde de la garde)", () => {
    // Sinon on pourrait « refermer » le trou en exemptant un item qui n'existe plus.
    for (const i of IMPERISSABLES_ASSUMES) expect(FOOD_VALUES[i], `${i} n'est pas un aliment`).toBeDefined()
  })

  it('tout aliment a une valeur nutritive ET un poids', () => {
    for (const i of Object.keys(FOOD_VALUES) as ItemId[]) {
      expect(FOOD_VALUES[i], `${i} sans nutrition`).toBeGreaterThan(0)
      expect(ITEM_WEIGHT[i], `${i} sans poids`).toBeGreaterThan(0)
    }
  })

  it('rien ne périme sans être un aliment — sauf les exceptions NOMMÉES', () => {
    // LES VERS (forêts-vivantes §1) sont la première exception : un APPÂT périssable qui
    // n'est pas de la nourriture — c'est précisément son design (appâter cesse de coûter
    // des points de faim, et un appât se pose frais). Toute exception future se nomme ici.
    const APPATS_PERISSABLES: ItemId[] = ['worms']
    for (const i of Object.keys(SPOIL_CYCLES) as ItemId[]) {
      if (APPATS_PERISSABLES.includes(i)) continue
      expect(FOOD_VALUES[i], `${i} périme mais ne nourrit pas`).toBeDefined()
    }
  })
})
