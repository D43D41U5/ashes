/**
 * L'INVENTAIRE DU SILENCE — les 61 faits de domaine, ce qu'ils veulent dire, et qui sonne.
 *
 * Cette table vivait dans `sound.test.ts` : elle était donc invisible au runtime, alors que
 * c'est précisément ce qu'il faut donner à ENTENDRE. Elle monte ici pour que le banc d'écoute
 * (`banc-son.html`) et le test lisent la MÊME source — deux copies auraient divergé au premier
 * arbitrage (leçon `node-baseline` / `node-shadow` : ce qui sert deux consommateurs vit en un
 * seul endroit).
 *
 * `Record<SimEvent['type'], Fait>` : ajouter une variante à `SimEvent` rend ce fichier ROUGE
 * tant que personne n'a dit ce qu'elle fait entendre, à quelle famille elle appartient, et ce
 * qu'elle raconte. Le compilateur tient la liste — le grep a déjà menti sur ce dépôt (37
 * variantes comptées contre 43 réelles).
 *
 * ⚠ `voix`/`muet` décrit l'ÉTAT RÉEL du routage (`soundForEvent`), jamais un souhait : un test
 * le vérifie dans les deux sens (un `voix` qui ne sonne pas est une promesse non tenue, un
 * `muet` qui sonne est un son que personne n'a voulu).
 *
 * ÉTAT AU 2026-07-28 : les 51 silences ont été tranchés sur mandat d'Alexis (« tu fais tout »).
 * **34 faits ont une voix, 27 un silence DÉCIDÉ.** Ce qui est arrêté, c'est QUI parle ; le
 * TIMBRE de chacun reste une proposition posée sans l'entendre — il se rejuge et se retouche
 * au banc d'écoute (`banc-son.html`), qui rend la ligne à coller dans `sound.ts`.
 */
import type { SimEvent } from '@ashes/sim'

/** L'état actuel d'un fait : le routage lui donne un son, ou pas. */
export type Voix = 'voix' | 'muet'

/** Les familles — l'ordre de cette union est l'ordre de l'ordre du jour. */
export type FamilleId = 'registre' | 'feu' | 'social' | 'saison' | 'batir' | 'progres' | 'plaie' | 'plomberie'

export interface Fait {
  /** L'état ACTUEL du routage (vérifié contre `soundForEvent` par le test). */
  voix: Voix
  famille: FamilleId
  /** Ce que le fait raconte, en français — on tranche des faits de jeu, pas des identifiants. */
  quoi: string
}

/**
 * LES 61 FAITS. Exhaustif par le compilateur ; l'ordre d'écriture suit les familles pour
 * qu'une relecture à l'œil reste possible.
 */
export const INVENTAIRE: Record<SimEvent['type'], Fait> = {
  // ── LE CORPS ET LA BÊTE — le registre d'origine, inchangé ─────────────────────────
  entity_damaged: { voix: 'voix', famille: 'registre', quoi: 'un coup porte — sur moi, ou sur un autre' },
  entity_died: { voix: 'voix', famille: 'registre', quoi: 'quelqu’un tombe (le froid et la faim tuent aussi)' },
  monster_slain: { voix: 'voix', famille: 'registre', quoi: 'une bête est abattue' },
  wolf_howl: { voix: 'voix', famille: 'registre', quoi: 'une meute a choisi un homme — le seul avertissement' },

  // ── LE FEU — l'organe vital : 4 voix sur 5, seul le geste répété se tait ─────────
  fire_fed: { voix: 'muet', famille: 'feu', quoi: 'on donne du bois au Feu' },
  fire_relit: { voix: 'voix', famille: 'feu', quoi: 'les flammes repartent d’un feu éteint' },
  fire_starved: { voix: 'voix', famille: 'feu', quoi: 'le Feu du village tombe à SEC — les murs vont céder' },
  fire_extinguished: { voix: 'voix', famille: 'feu', quoi: 'un feu meurt, il ne reste que les braises' },
  fire_upgraded: { voix: 'voix', famille: 'feu', quoi: 'le Feu monte d’un palier — le village s’agrandit' },

  // ── LE SOCIAL — l'axe d'alignement : les verbes chauds montent, les froids tombent ─
  gift_given: { voix: 'voix', famille: 'social', quoi: 'on DONNE à un voisin (le verbe chaud du Foyer)' },
  refugees_arrived: { voix: 'voix', famille: 'social', quoi: 'un groupe de réfugiés se pose près de chez vous' },
  refugees_fed: { voix: 'voix', famille: 'social', quoi: 'on nourrit les réfugiés' },
  refugees_recruited: { voix: 'voix', famille: 'social', quoi: 'on accueille les réfugiés au village' },
  refugees_robbed: { voix: 'voix', famille: 'social', quoi: 'on DÉPOUILLE les réfugiés (le verbe froid)' },
  refugees_left: { voix: 'muet', famille: 'social', quoi: 'les réfugiés repartent — on n’a rien fait' },
  village_founded: { voix: 'muet', famille: 'social', quoi: 'un village naît autour d’un Feu' },
  village_fell: { voix: 'voix', famille: 'social', quoi: 'un village TOMBE — il n’est plus qu’une ruine pillable' },
  village_archetype_changed: { voix: 'voix', famille: 'social', quoi: 'un Feu vire au bleu ou au rouge — Foyer, Meute' },
  member_joined: { voix: 'muet', famille: 'social', quoi: 'quelqu’un rejoint le village' },
  member_banished: { voix: 'voix', famille: 'social', quoi: 'quelqu’un est BANNI du village' },

  // ── LES BATTEMENTS DE LA SAISON — le temps qui serre, et la menace ────────────────
  night_started: { voix: 'voix', famille: 'saison', quoi: 'la nuit tombe' },
  alarm_raised: { voix: 'voix', famille: 'saison', quoi: 'l’alarme du village — la milice se lève' },
  evacuation_opened: { voix: 'voix', famille: 'saison', quoi: 'le point d’évacuation s’ouvre sur la route' },
  day_started: { voix: 'muet', famille: 'saison', quoi: 'le jour se lève' },
  season_day_started: { voix: 'muet', famille: 'saison', quoi: 'un jour de saison de plus (sur 60)' },
  act_started: { voix: 'voix', famille: 'saison', quoi: 'un ACTE commence — la pression change de cran' },
  season_ended: { voix: 'voix', famille: 'saison', quoi: 'la saison s’achève, les verdicts tombent' },
  cendre_avance: { voix: 'voix', famille: 'saison', quoi: 'la Cendre a mangé un morceau de la vallée' },
  cendreux_risen: { voix: 'voix', famille: 'saison', quoi: 'un cendreux se relève' },
  horde_spawned: { voix: 'voix', famille: 'saison', quoi: 'une horde se forme et marche sur un village' },
  horde_dispersed: { voix: 'muet', famille: 'saison', quoi: 'la horde se dissipe à l’aube' },
  convoy_spawned: { voix: 'muet', famille: 'saison', quoi: 'une carcasse de convoi apparaît sur la route' },
  ark_departed: { voix: 'voix', famille: 'saison', quoi: 'l’Arche lève l’ancre — avec ceux qui étaient à bord' },

  // ── BÂTIR, CRAFTER, MANGER — 4 voix : poser, perdre, finir, cuire ────────────────
  resource_harvested: { voix: 'voix', famille: 'batir', quoi: 'un coup de récolte rapporte (moi seul)' },
  structure_built: { voix: 'voix', famille: 'batir', quoi: 'une pièce est posée' },
  structure_upgraded: { voix: 'muet', famille: 'batir', quoi: 'un mur passe au matériau suivant' },
  structure_repaired: { voix: 'muet', famille: 'batir', quoi: 'on répare une structure abîmée' },
  structure_removed: { voix: 'muet', famille: 'batir', quoi: 'on démonte une pièce' },
  structure_destroyed: { voix: 'voix', famille: 'batir', quoi: 'une structure est DÉTRUITE (une horde l’a eue)' },
  item_crafted: { voix: 'voix', famille: 'batir', quoi: 'un objet sort de la file d’artisanat' },
  meat_cooked: { voix: 'voix', famille: 'batir', quoi: 'un aliment sort cuit du feu' },
  meal_eaten: { voix: 'muet', famille: 'batir', quoi: 'on mange' },
  crop_planted: { voix: 'muet', famille: 'batir', quoi: 'on sème au potager' },
  crop_harvested: { voix: 'muet', famille: 'batir', quoi: 'on récolte le potager' },

  // ── PROGRESSION ET DÉCOUVERTE ─────────────────────────────────────────────────────
  skill_level_up: { voix: 'voix', famille: 'progres', quoi: 'un métier monte d’un niveau' },
  poi_first_visit: { voix: 'voix', famille: 'progres', quoi: 'on FOULE un lieu pour la première fois' },
  poi_discovered: { voix: 'muet', famille: 'progres', quoi: 'un lieu entre dans la carte' },

  // ── LA PLAIE — refermée : on entend désormais qu'une plaie s'ouvre, pas seulement ─
  entity_bandaged: { voix: 'voix', famille: 'plaie', quoi: 'une plaie est pansée' },
  wound_inflicted: { voix: 'voix', famille: 'plaie', quoi: 'une BLESSURE s’ouvre — jambe, bras, saignement' },

  // ── MUET PAR NATURE — haute fréquence, ou pure plomberie d'interface ──────────────
  action_rejected: { voix: 'muet', famille: 'plomberie', quoi: 'la sim refuse une action (déjà un toast)' },
  entity_spawned: { voix: 'muet', famille: 'plomberie', quoi: 'une entité entre dans le monde' },
  entity_despawned: { voix: 'muet', famille: 'plomberie', quoi: 'une entité quitte le monde (déconnexion)' },
  entity_respawned: { voix: 'muet', famille: 'plomberie', quoi: 'on se réveille au Feu (le voile le dit déjà)' },
  node_depleted: { voix: 'muet', famille: 'plomberie', quoi: 'un nœud est vidé (le nœud disparaît à l’écran)' },
  item_dropped: { voix: 'muet', famille: 'plomberie', quoi: 'un objet est jeté au sol' },
  corpse_looted: { voix: 'muet', famille: 'plomberie', quoi: 'une dépouille est fouillée' },
  prey_escaped: { voix: 'muet', famille: 'plomberie', quoi: 'la proie regagne son terrier' },
  craft_queued: { voix: 'muet', famille: 'plomberie', quoi: 'un craft entre dans la file (l’objet a sa voix)' },
  craft_cancelled: { voix: 'muet', famille: 'plomberie', quoi: 'un craft est annulé' },
  access_changed: { voix: 'muet', famille: 'plomberie', quoi: 'le niveau d’accès d’un coffre change' },
  function_changed: { voix: 'muet', famille: 'plomberie', quoi: 'une fonction émergente se forme ou se perd' },
}

export interface Famille {
  id: FamilleId
  titre: string
  /** Ce qui était en jeu — pourquoi cette famille se tranchait ensemble. */
  propos: string
  /** Ce qui a été TRANCHÉ, et le principe qui l'a décidé. Le timbre, lui, reste à l'oreille. */
  reco: string
}

/**
 * L'ORDRE DU JOUR devenu ORDRE DE RELECTURE : le registre d'origine d'abord (l'étalon), puis
 * les familles dans l'ordre où elles ont été tranchées. Chaque `reco` dit ce qui a été décidé
 * ET le principe qui l'a décidé — c'est le principe qu'on attaque si le résultat déplaît, pas
 * les lignes une à une.
 */
export const FAMILLES: Famille[] = [
  {
    id: 'registre',
    titre: 'LE CORPS ET LA BÊTE',
    propos: 'Ce que le jeu sonnait déjà. L’étalon : les vingt-quatre voix neuves ont dû tenir à côté.',
    reco: 'Inchangé — c’est la référence.',
  },
  {
    id: 'feu',
    titre: 'LE FEU',
    propos:
      'L’organe vital du village, et pas un de ses cinq états ne s’entendait. Un Feu qui tombe à sec condamne les murs — on l’apprenait en voyant une structure céder, plusieurs minutes trop tard.',
    reco:
      '4 voix sur 5. « on le nourrit » reste MUET — geste répété bûche après bûche, et la flamme qui monte le dit déjà à l’écran.',
  },
  {
    id: 'social',
    titre: 'LE SOCIAL ET L’ALIGNEMENT',
    propos:
      'Le pilier n°1 du jeu, et un seul fait y sonnait (l’arrivée des réfugiés). Le don, la chute d’un village, le virage d’un Feu, les trois autres verbes réfugiés : muets.',
    reco:
      '7 voix neuves, et un PRINCIPE : les verbes chauds MONTENT (triangle, sine), les verbes froids TOMBENT (sawtooth, un timbre qui n’était employé nulle part). L’axe d’alignement s’entend. MUETS : la fondation (elle a déjà sa cérémonie à l’écran), l’arrivée d’un membre, et le départ des réfugiés — il ne s’est rien passé, et une absence ne se sonne pas.',
  },
  {
    id: 'saison',
    titre: 'LES BATTEMENTS DE LA SAISON',
    propos: 'Le temps qui serre : l’acte, la Cendre qui avance, la horde qui se forme, l’Arche qui part.',
    reco:
      '6 voix neuves. L’acte descend plus bas et plus long que la nuit — la nuit revient, l’acte jamais. MUETS : le jour et le jour-de-saison (c’est chaque jour, et le HUD le dit), la horde qui se dissipe et le convoi (une menace qui s’en va n’est pas un fait sonore).',
  },
  {
    id: 'batir',
    titre: 'BÂTIR, CRAFTER, MANGER',
    propos:
      'Du feedback de geste, pas des faits de monde — sauf quand une horde casse un mur. C’est ici qu’on dépense, ou qu’on préserve, le budget d’attention de l’oreille.',
    reco:
      '4 voix seulement : poser, DÉTRUIT, objet fini, viande cuite. Tout le reste muet — monter un mur, réparer, démonter, manger, semer, récolter sont déjà sous la main ET sous les yeux.',
  },
  {
    id: 'progres',
    titre: 'PROGRESSION ET DÉCOUVERTE',
    propos: 'Ce qu’on gagne. Une montée de métier et une première fois ne se célébraient d’aucune façon.',
    reco: '2 voix. « entre dans la carte » reste muet : redondant avec la première visite, qui, elle, se mérite.',
  },
  {
    id: 'plaie',
    titre: 'LA PLAIE',
    propos:
      'On ENTENDAIT qu’une plaie est pansée, jamais qu’une plaie s’ouvre — alors que panser un tiers vient d’être branché. Le fait était invisible ET inaudible.',
    reco:
      'La blessure a sa voix, et elle sonne AUSSI pour les autres : c’est tout son objet. RESTE OUVERT : l’affordance à l’écran (rien ne montre encore qu’un PNJ saigne).',
  },
  {
    id: 'plomberie',
    titre: 'MUET PAR NATURE',
    propos: 'Haute fréquence ou pure interface. Douze faits tranchés d’un bloc.',
    reco: 'Muets, tous les douze. Chacun est soit déjà visible, soit trop fréquent pour valoir une voix.',
  },
]

/** L'état actuel seul — la forme qu'attendait `sound.test.ts`. Dérivée, jamais tenue à la main. */
export const VOIX: Record<SimEvent['type'], Voix> = Object.fromEntries(
  Object.entries(INVENTAIRE).map(([type, fait]) => [type, fait.voix]),
) as Record<SimEvent['type'], Voix>

/** Les types qui sonnent aujourd'hui, dans l'ordre de la table. */
export const SONORES = Object.entries(INVENTAIRE)
  .filter(([, f]) => f.voix === 'voix')
  .map(([t]) => t as SimEvent['type'])

/** Les faits d'une famille, dans l'ordre de la table. */
export function faitsDeFamille(id: FamilleId): { type: SimEvent['type']; fait: Fait }[] {
  return Object.entries(INVENTAIRE)
    .filter(([, f]) => f.famille === id)
    .map(([type, fait]) => ({ type: type as SimEvent['type'], fait }))
}
