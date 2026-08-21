/**
 * Événements de domaine — les faits discrets et signifiants de la simulation.
 *
 * Quatre systèmes du GDD consomment le même flux : l'alignement (§3 — « on ne
 * mesure que des événements discrets, vérifiables côté serveur »), la
 * chronique de saison (§2), le tableau du village et la réputation locale
 * (§5), et le replay-tribunal (§11). Ils se construisent tous comme des
 * consommateurs de ce flux — jamais en instrumentant la logique après coup.
 *
 * Règles :
 * - Un événement est un fait accompli, pas une intention. Il est émis à
 *   l'endroit où la logique l'exécute, dans le même tick.
 * - Le flux est déterministe : même seed + mêmes inputs = mêmes événements
 *   (contrat testé dans events.test.ts).
 * - Haute fréquence ≠ domaine : un déplacement n'est pas un événement (le
 *   replay log des inputs couvre ça) ; un premier sang, un don, un spawn, oui.
 */
import type { NodeType, RecipeId } from './balance'
import type { ItemId, SkillId, StructureType } from './items'
import type { SimState } from './sim'

export type SimEvent =
  | { type: 'entity_spawned'; tick: number; entityId: number; x: number; y: number }
  /**
   * UN AVATAR QUITTE LE MONDE (multi) : le joueur s'est déconnecté, son entité est
   * retirée. Distinct de `entity_died` (qui, pour un joueur, RESPAWN sans retirer
   * l'entité) : ici l'entité disparaît pour de bon, comme un PNJ mort. Symétrique
   * d'`entity_spawned` — le join mid-partie qu'il acquitte a le sien.
   */
  | { type: 'entity_despawned'; tick: number; entityId: number }
  | { type: 'day_started'; tick: number }
  | { type: 'night_started'; tick: number }
  | { type: 'season_day_started'; tick: number; day: number }
  /** L'acte est un ENTIER NON BORNÉ (saison-sans-fin R2 : il ne porte plus les chiffres, il
   *  NOMME) — le type `1 | 2 | 3` d'origine aurait figé dans le bus ce que la spec délie. */
  | { type: 'act_started'; tick: number; act: number }
  /**
   * LA CENDRE A AVANCÉ — et la vallée a reculé d'autant.
   *
   * UN par jour de saison, jamais un par nœud brûlé : la chronique veut savoir que le monde a
   * mangé un morceau de la vallée, pas qu'un buisson a grillé. Haute fréquence n'est pas domaine.
   */
  | { type: 'cendre_avance'; tick: number; jour: number; front: number; noeudsBrules: number }
  /**
   * LA CENDRE PREND (P5a, décision 2026-08-21 — la strate du joueur) : des ouvrages d'un
   * VILLAGE sont passés derrière le front aujourd'hui. Les nœuds meurent (`cendre_avance`),
   * les structures RESTENT — debout dans le brûlé : le jeu produit des ruines du joueur à
   * côté de celles d'avant, et cet événement est ce qui les empêche d'être muettes. Un
   * événement par village et par jour, jamais un par mur.
   */
  | { type: 'cendre_prend'; tick: number; jour: number; villageId: number; count: number }
  | { type: 'village_founded'; tick: number; villageId: number; chiefId: number; tx: number; ty: number }
  | {
      type: 'structure_built'
      tick: number
      structureId: number
      structure: StructureType
      villageId: number
      ownerId: number
      tx: number
      ty: number
    }
  | { type: 'structure_removed'; tick: number; structureId: number }
  /** LE FEU MONTE D'UN PALIER (spec construction R6) : le carré grandit, des composants se débloquent. */
  | { type: 'fire_upgraded'; tick: number; villageId: number; tier: number }
  /** On a nourri le Feu (upkeep R16) : `wood` bois donnés, `fuel` = stock après. */
  | { type: 'fire_fed'; tick: number; villageId: number; entityId: number; wood: number; fuel: number }
  /** Le Feu est tombé à SEC (upkeep R16) : ses murs vont commencer à céder. Émis UNE fois
   *  au passage à zéro — la chronique en fait « le Feu de X faiblit ». */
  | { type: 'fire_starved'; tick: number; villageId: number }
  // LE FEU LIBRE (spec feu-station S25) : ses flammes meurent (combustible à 0 → braises),
  // ou il se rallume quand on le nourrit. Portés par la STRUCTURE (pas un village).
  | { type: 'fire_extinguished'; tick: number; structureId: number }
  | { type: 'fire_relit'; tick: number; structureId: number }
  // LA CUISSON AU SLOT (spec feu-station S25) : un aliment est sorti cuit du slot d'une station.
  | { type: 'meat_cooked'; tick: number; structureId: number; item: import('./items').ItemId }
  /** LE VILLAGE EST TOMBÉ (V1-12/V2-20) : son Feu abattu (à sec), il devient une RUINE
   *  pillable. `name` pour la chronique (« X n'est plus que cendres »). */
  | { type: 'village_fell'; tick: number; villageId: number; name: string }
  /** UN MUR/PORTE PASSE AU MATÉRIAU SUIVANT (spec construction R8) : bois→pierre→métal. */
  | { type: 'structure_upgraded'; tick: number; structureId: number; material: import('./balance').WallMaterial }
  /**
   * UNE PORTE S'OUVRE OU SE FERME (spec construction R26). Fait de domaine à part entière, et pas
   * du bruit : c'est le geste qui décide si une base est ouverte ou close. Basse fréquence (un
   * appui, pas un déplacement), et il porte QUI l'a fait — ce dont une chronique de raid aura
   * besoin le jour où « quelqu'un a ouvert la porte » devient une accusation.
   */
  | { type: 'door_toggled'; tick: number; structureId: number; open: boolean; byEntityId: number }
  /**
   * UNE FONCTION ÉMERGENTE A CHANGÉ (spec construction R9-R10). Formée (nouveau
   * `tier`≥1), montée/descendue de palier, close/ouverte, ou PERDUE (`tier` 0). Ancrée
   * au composant primaire (tx,ty). Le tableau du village et l'overlay client en dérivent.
   */
  | {
      type: 'function_changed'
      tick: number
      functionId: import('./balance').FunctionId
      villageId: number
      tx: number
      ty: number
      tier: number
      enclosed: boolean
    }
  | { type: 'member_joined'; tick: number; villageId: number; entityId: number }
  | { type: 'member_banished'; tick: number; villageId: number; entityId: number }
  | { type: 'action_rejected'; tick: number; entityId: number; reason: string }
  // `clean` : le coup a porté DANS LE VERT (abattage à maîtrise, spec recolte-maitrise
  // A4) — l'événement porte l'info, la chronique et le retour de frappe la lisent
  // sans deviner. Absent/`false` = coup baseline (toute récolte instantanée l'est).
  | { type: 'resource_harvested'; tick: number; entityId: number; nodeId: number; item: ItemId; count: number; clean?: boolean }
  // IL DIT CE QUI MEURT, pas seulement QUE quelque chose meurt (2026-07-29). L'événement ne
  // portait que l'`id`, et ses consommateurs ne pouvaient donc rien en faire de MATÉRIEL :
  // un arbre qui s'abat, un filon qui s'effondre et un buisson qu'on vide ne sonnent pas
  // pareil, et sans le type il aurait fallu que le son aille lire l'état du monde — soit
  // exactement l'instrumentation après coup que CLAUDE.md interdit. Le fait de domaine porte
  // sa matière ; l'audio, la chronique et le reste n'ont plus qu'à la lire.
  | { type: 'node_depleted'; tick: number; nodeId: number; nodeType: NodeType }
  // Le craft a un DÉBUT et une FIN distincts depuis la file (spec craft-file) :
  // `craft_queued` est l'intention (les intrants partent), `item_crafted` reste
  // l'objet qui SORT — et il ne s'émet qu'à la livraison réelle, jamais quand la
  // file est bouchée par un sac plein (F10). L'événement suit l'objet, pas le clic.
  | { type: 'craft_queued'; tick: number; entityId: number; recipeId: RecipeId }
  | { type: 'craft_cancelled'; tick: number; entityId: number; recipeId: RecipeId; count: number }
  | { type: 'item_crafted'; tick: number; entityId: number; recipeId: RecipeId; item: ItemId }
  /**
   * UNE RECETTE SE DÉCOUVRE (D2, 2026-08-01) — en touchant sa matière, ou en approchant
   * la station qui la sert. Un fait de jeu discret, donc un événement : le bandeau qui
   * l'annonce et la chronique s'y branchent sans qu'on instrumente la découverte après
   * coup. Émis UNE fois par entité et par recette — ce qui est appris ne se reprend pas.
   */
  | { type: 'recipe_revealed'; tick: number; entityId: number; recipeId: RecipeId }
  | { type: 'meal_eaten'; tick: number; entityId: number; item: ItemId }
  | { type: 'skill_level_up'; tick: number; entityId: number; skill: SkillId; level: number }
  | { type: 'entity_damaged'; tick: number; entityId: number; byEntityId: number; amount: number }
  | { type: 'wound_inflicted'; tick: number; entityId: number; wound: 'leg' | 'arm' | 'bleeding' }
  | {
      type: 'entity_died'
      tick: number
      entityId: number
      byEntityId: number
      wasMonster: boolean
      cause?: 'cold' | 'hunger' | 'lightning'
    }
  | { type: 'entity_respawned'; tick: number; entityId: number }
  | { type: 'entity_bandaged'; tick: number; entityId: number; byEntityId: number }
  /** `clean` (spec chasse C6) : abattue d'un coup PROPRE — non alertée au départ du wind-up. */
  | { type: 'monster_slain'; tick: number; monsterType: import('./balance').MonsterType; byEntityId: number; clean: boolean }
  /** LA PROIE S'EN TIRE (spec chasse C16) : le lapin a regagné son terrier. La chasse est perdue. */
  | { type: 'prey_escaped'; tick: number; monsterType: import('./balance').MonsterType; x: number; y: number }
  /** JETÉ AU SOL (spec chasse C18) : l'appât posé, la viande lâchée à la meute, la charge larguée. */
  | { type: 'item_dropped'; tick: number; entityId: number; item: ItemId; x: number; y: number }
  /**
   * LE HURLEMENT (spec faune R13). Une meute vient de choisir un homme. C'est un
   * FAIT de jeu, pas un effet sonore : le GDD §9bis exige que tout événement se
   * signale (« annoncés, pas surprises »), et c'est le seul avertissement que le
   * joueur recevra avant de voir les loups se placer autour de lui. Émis une
   * seule fois par meute et par proie.
   */
  | { type: 'wolf_howl'; tick: number; targetEntityId: number; packSize: number; x: number; y: number }
  /**
   * ILS T'ONT SENTI (spec `cendreux.md` R11) — le pendant du hurlement pour les morts.
   *
   * La nuit bascule d'espèce avec les actes, et l'avertissement doit basculer avec elle :
   * un Cendreux ne hurle pas. Émettre `wolf_howl` pour lui aurait fait jouer un cor de meute
   * sur une chose qui traîne les pieds — le joueur aurait préparé la mauvaise parade.
   */
  | { type: 'cendreux_prowl'; tick: number; targetEntityId: number; count: number; x: number; y: number }
  | { type: 'cendreux_cri'; tick: number; entityId: number; x: number; y: number; count: number }
  | { type: 'corpse_looted'; tick: number; corpseId: number; byEntityId: number }
  | { type: 'structure_repaired'; tick: number; structureId: number; byEntityId: number }
  /** LE POTAGER (agriculture voie A) : semé, puis récolté quand mûr. */
  | { type: 'crop_planted'; tick: number; structureId: number; byEntityId: number }
  | { type: 'crop_harvested'; tick: number; structureId: number; byEntityId: number; yield: number }
  /** F5 — le gel a tué une culture à ciel ouvert (spec `flore-froid.md`). Sans auteur : c'est
   *  le monde qui frappe, pas quelqu'un. La chronique de saison a là son fait de Grand Froid. */
  | { type: 'crop_frozen'; tick: number; structureId: number }
  | {
      type: 'access_changed'
      tick: number
      structureId: number
      access: import('./items').AccessLevel
      byEntityId: number
    }
  | { type: 'structure_destroyed'; tick: number; structureId: number }
  | { type: 'alarm_raised'; tick: number; villageId: number }
  /**
   * LA HORDE SE LÈVE — et (tx, ty) dit OÙ, comme `convoy_spawned` et `brume_annonce` : la
   * tuile du champ de flux d'où le paquet part, celle autour de laquelle ses membres sont
   * posés. Sans elle, l'événement annonçait un fait qu'on ne pouvait pas aller VOIR : une
   * horde naît entre `HORDE_MIN_DIST` et une nuit de marche de sa cible, donc hors du rayon
   * d'intérêt du client — l'atelier de la vitrine devait l'attendre au feu du village, 481 s
   * de temps réel MESURÉES pour une seule prise. C'est le point de NAISSANCE, pas la position
   * courante : le paquet marche dès le tick suivant, et c'est le snapshot qui dit où il en est.
   */
  | {
      type: 'horde_spawned'
      tick: number
      hordeId: number
      size: number
      /** Le FEU visé (décision ⑬ — village ou camp) ; `villageId` s'il est un Foyer. */
      fireTx: number
      fireTy: number
      villageId?: number
      tx: number
      ty: number
    }
  /** LE PRÉSAGE DE LA VEILLE (décision ⑱) : à l'aube, le sol de l'origine travaille — la
   *  horde de ce soir s'annonce un jour entier à l'avance. */
  | { type: 'presage_horde'; tick: number; x: number; y: number }
  | { type: 'horde_dispersed'; tick: number; hordeId: number }
  | { type: 'convoy_spawned'; tick: number; tx: number; ty: number }
  /**
   * LA BRUME (spec `brume.md`) — le froid mobile qui sort de la Cendrière. L'ANNONCE est le
   * télégraphiage du GDD §9bis (« annoncés, pas surprises ») : le gibier se tait sur le
   * corridor, la chronique prévient — la nappe ne se lèvera qu'à l'aube suivante. (tx, ty)
   * porte le POINT PROFOND du corridor : là où ça se passera, et où naîtra le filon.
   */
  | { type: 'brume_annonce'; tick: number; tx: number; ty: number }
  | { type: 'brume_levee'; tick: number; tx: number; ty: number }
  | { type: 'brume_retiree'; tick: number; tx: number; ty: number }
  /** LA MENACE QUI PAIE CEUX QUI LA SUIVENT : au retrait, un filon riche et temporaire affleure. */
  | { type: 'filon_decouvert'; tick: number; nodeId: number; nodeType: NodeType; tx: number; ty: number }
  /** La fenêtre s'est refermée SANS coup de pioche final : filon périmé, remplacé, ou mangé par
   *  la Cendre. Le client matérialise le filon depuis `filon_decouvert` — sans ce fait, il lui
   *  resterait un nœud fantôme (le filon VIDÉ, lui, a déjà son `node_depleted`). */
  | { type: 'filon_retire'; tick: number; nodeId: number }
  /**
   * LA MÉTÉO (spec `meteo.md` R9) — seul le BLIZZARD fait événement : les quatre autres
   * fronts s'annoncent GÉOMÉTRIQUEMENT (le mur se voit venir — position fonction pure du
   * tick, rien à dire) ; lui est trop large pour être esquivé, la réponse est PRÉPARER.
   * L'ANNONCE tombe la veille au crépuscule (patron `brume_annonce`) et dit VRAI par
   * construction : elle lit la MÊME fonction pure d'élection (`meteoTypeDuCycle`) que
   * l'aube qui lèvera le front. `day` porte le jour de saison du front annoncé (« le
   * blizzard du jour N »). L'ENTRÉE marque le tick où la bande devient active
   * (`startTick`, pas l'élection), la SORTIE sa purge — du signal de HUD/rendu, hors
   * chronique (patron Brume : l'annonce se raconte, la levée et le retrait non).
   */
  | { type: 'blizzard_annonce'; tick: number; day: number }
  | { type: 'blizzard_entre'; tick: number; day: number }
  | { type: 'blizzard_passe'; tick: number; day: number }
  | { type: 'gift_given'; tick: number; byEntityId: number; toVillageId: number; item: ItemId; count: number }
  | { type: 'village_archetype_changed'; tick: number; villageId: number; archetype: 'foyer' | 'meute' | 'neutre' }
  | { type: 'evacuation_opened'; tick: number; tx: number; ty: number }
  /** L'ARCHE A LEVÉ L'ANCRE (V2-24) : `saved` = combien étaient à bord. */
  | { type: 'ark_departed'; tick: number; tx: number; ty: number; saved: number }
  // LES RÉFUGIÉS (V2-25, GDD §520) — l'événement d'alignement par excellence.
  | { type: 'refugees_arrived'; tick: number; groupId: number; tx: number; ty: number; count: number }
  | { type: 'refugees_recruited'; tick: number; groupId: number; villageId: number; byEntityId: number; count: number }
  | { type: 'refugees_fed'; tick: number; groupId: number; byEntityId: number }
  | { type: 'refugees_robbed'; tick: number; groupId: number; byEntityId: number }
  | { type: 'refugees_left'; tick: number; groupId: number }
  | { type: 'cendreux_risen'; tick: number; entityId: number; x: number; y: number }
  /**
   * LE FEU A ÉTOUFFÉ UN RÉVEIL (spec `cendreux.md` R21) — la parade de S4, enfin quotidienne.
   *
   * *« On veille ses morts au feu, ou ils reviennent »* ne servait jusqu'ici qu'un seul canal,
   * la levée d'un cadavre — et sur une saison Veillée entière, MESURÉ, il ne s'est déclenché
   * qu'UNE fois. Le réveil lui donne sa fréquence : le sol travaille à sept tuiles, le joueur
   * rallume, et le mort ne sort pas. C'est un fait de jeu discret et signifiant, donc il est
   * ici et pas déduit après coup.
   */
  | { type: 'reveil_etouffe'; tick: number; x: number; y: number }
  /** ON A BRÛLÉ LE LIEU (décision ⑧, 2026-08-21) : un charnier ou un repaire assaini au feu —
   *  la densité des morts tombe autour, pour un temps. */
  | { type: 'charnier_brule'; tick: number; zone: number; x: number; y: number }
  | {
      type: 'season_ended'
      tick: number
      verdicts: {
        villageId: number
        name: string
        archetype: 'foyer' | 'meute' | 'neutre'
        score: number
        outcome: string
      }[]
    }
  /**
   * L'ENVOL DE LA LISIÈRE (forêts-vivantes §3 R4) : un pas bruyant sur une lisière de bois
   * fait gicler les oiseaux — la forêt prévient AVANT que la bête entende. Le client rend
   * la nuée et le cri DEPUIS ce fait (jamais une information que la sim n'a pas émise) ;
   * l'alarme du gibier alentour, elle, est jouée côté sim au moment de l'émission.
   */
  | { type: 'bird_flush'; tick: number; x: number; y: number }
  | { type: 'poi_discovered'; tick: number; poiId: number; kind: string; byEntityId: number }
  /**
   * LA PREMIÈRE VISITE porte les faits d'annales du lieu (S-R16, vocabulaire : spec
   * `annales.md`), en TABLEAU et non en champs épars : le bus est STABLE — un type de fait
   * ajouté demain n'exige aucun changement de schéma, et chaque lecteur (chronique
   * aujourd'hui, stèles demain) choisit ce qu'il en dit. La sim TÉMOIGNE : elle recopie des
   * faits de la carte, dérivés et sans tirage (x/y/lieu omis — c'est le lieu de l'événement).
   * Le passé entre dans la chronique du joueur LE JOUR OÙ IL LE DÉTERRE : la date est celle
   * de la découverte, pas celle du fait.
   */
  | { type: 'poi_first_visit'; tick: number; poiId: number; kind: string; name: string; byEntityId: number; faits?: { ere: 0 | 1 | 2 | 3; type: string; cause?: string; saillant: boolean }[]; stele?: { lignes: string[] } }
  /**
   * LA RUMEUR DU RÉFUGIÉ (annales.md R12) : nourrir un groupe révèle au nourricier le lieu
   * porteur d'annales inconnu le plus proche DU GROUPE — leur route, leur mémoire. Le nom est
   * porté pour la chronique (« Pour un repas, des réfugiés ont dit où trouver X. »).
   */
  | { type: 'refugee_rumeur'; tick: number; groupId: number; byEntityId: number; poiId: number; kind: string; name: string }
  /**
   * LE VILLAGE PNJ MONTE DE PALIER DE BÂTI (spec `village-pnj-evolution.md` R6) :
   * campement → hameau de bois → bourg de pierre. Émis à l'aube, au surplus — jamais
   * à une date. La chronique en fait « X s'agrandit ».
   */
  | { type: 'village_stage_up'; tick: number; villageId: number; stage: number }
  /** LA PROSPÉRITÉ ATTIRE (R9) : un colon rejoint un village PNJ à l'aube. S'ajoute au
   *  `member_joined` du spawn — celui-ci dit POURQUOI (la prospérité, pas un recrutement). */
  | { type: 'settler_arrived'; tick: number; villageId: number; entityId: number }
// À venir avec les systèmes : pact_signed, cicatrices, …

/** Émet un événement dans le buffer de l'état. Usage interne à /sim. */
export function emitEvent(state: SimState, event: SimEvent): void {
  state.events.push(event)
}

/**
 * Vide et retourne le buffer d'événements. Appelé par l'hôte (Worker, serveur)
 * après chaque tick pour alimenter les consommateurs (alignement, chronique,
 * UI). Le buffer fait partie du SimState : deux runs comparés par snapshot
 * doivent être drainés au même rythme.
 */
export function drainEvents(state: SimState): SimEvent[] {
  const events = state.events
  state.events = []
  return events
}
