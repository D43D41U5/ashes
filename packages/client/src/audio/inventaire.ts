/**
 * L'INVENTAIRE DU SILENCE — les 66 faits de domaine, ce qu'ils veulent dire, et qui sonne.
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
import type { NodeType, SimEvent } from '@ashes/sim'
import type { AncrageDe } from './spatial'

/** L'état actuel d'un fait : le routage lui donne un son, ou pas. */
export type Voix = 'voix' | 'muet'

/** Les familles — l'ordre de cette union est l'ordre de l'ordre du jour. */
export type FamilleId = 'registre' | 'feu' | 'social' | 'saison' | 'batir' | 'progres' | 'plaie' | 'plomberie'

interface FaitBase {
  famille: FamilleId
  /** Ce que le fait raconte, en français — on tranche des faits de jeu, pas des identifiants. */
  quoi: string
}

/**
 * UN FAIT QUI SONNE DOIT DIRE OÙ IL S'ENTEND. `ou` n'est pas facultatif ici, et c'est tout
 * l'objet de cette union : le jour où un `muet` prend une voix, le fichier passe au ROUGE tant
 * que personne n'a dit d'où le son vient. La même garantie que `Record<SimEvent['type'], Fait>`
 * donne déjà sur la voix elle-même — appliquée à la géographie.
 *
 * Sans elle, il aurait fallu SONDER les champs de l'événement au runtime (« il a un `x` ? un
 * `entityId` ? »), et une sonde qui ne trouve rien rend `null` en silence : le fait sonnerait
 * alors au centre et plein, exactement comme le défaut qu'on est en train de corriger. Une
 * garde qui dégrade cache son défaut.
 */
export interface FaitSonore<T = SimEvent> extends FaitBase {
  voix: 'voix'
  ou: AncrageDe<T>
}

/** Un fait qui se tait n'a pas de lieu à déclarer — il en gagnera un en gagnant sa voix. */
export interface FaitMuet<T = SimEvent> extends FaitBase {
  voix: 'muet'
  ou?: AncrageDe<T>
}

export type Fait<T = SimEvent> = FaitSonore<T> | FaitMuet<T>

/**
 * La table, indexée par type — et chaque case est PARAMÉTRÉE par SON fait, pas par l'union.
 * C'est ce qui donne à `AncrageDe` de quoi mordre : `door_toggled` ne peut se déclarer que
 * `'monde' | 'auteur' | 'structure'`, et rien d'autre ne compile.
 */
export type Inventaire = { [K in SimEvent['type']]: Fait<Extract<SimEvent, { type: K }>> }

/**
 * LES 66 FAITS. Exhaustif par le compilateur ; l'ordre d'écriture suit les familles pour
 * qu'une relecture à l'œil reste possible.
 */
export const INVENTAIRE: Inventaire = {
  // ── LE CORPS ET LA BÊTE — le registre d'origine, inchangé ─────────────────────────
  entity_damaged: { voix: 'voix', ou: 'entite', famille: 'registre', quoi: 'un coup porte — sur moi, ou sur un autre' },
  entity_died: { voix: 'voix', ou: 'entite', famille: 'registre', quoi: 'quelqu’un tombe (le froid et la faim tuent aussi)' },
  monster_slain: { voix: 'voix', ou: 'auteur', famille: 'registre', quoi: 'une bête est abattue' },
  wolf_howl: { voix: 'voix', ou: 'xy', famille: 'registre', quoi: 'une meute a choisi un homme — le seul avertissement' },
  bird_flush: { voix: 'voix', ou: 'xy', famille: 'registre', quoi: 'la nuée gicle de la lisière — la forêt dénonce un pas bruyant' },
  cendreux_prowl: { voix: 'voix', ou: 'xy', famille: 'registre', quoi: 'les morts ont senti un homme — l’avertissement des actes II-III' },
  cendreux_cri: { voix: 'voix', ou: 'xy', famille: 'registre', quoi: 'un cri qui n’a rien d’humain — la fureur du froid appelle le sol (décision ④⑤)' },
  // Le coin vivant (faune R24/R27) : des faits de CARTE — la pastille parle à l'écran,
  // pas à l'oreille. Une voix viendrait avec un vrai langage de découverte, pas avant.
  coin_eteint: { voix: 'muet', famille: 'registre', quoi: 'un coin de chasse meurt (cendre, occupation) — plus une naissance' },
  coin_seme: { voix: 'muet', famille: 'registre', quoi: 'un coin de chasse renaît ailleurs — le monde se répare' },
  coin_decouvert: { voix: 'muet', famille: 'registre', quoi: 'ce joueur a trouvé un coin de chasse — sa pastille se pose' },
  coin_disparu: { voix: 'muet', famille: 'registre', quoi: 'il constate un coin mort — sa pastille s’éteint' },

  // ── LE FEU — l'organe vital : 4 voix sur 5, seul le geste répété se tait ─────────
  fire_fed: { voix: 'muet', famille: 'feu', quoi: 'on donne du bois au Feu' },
  fire_relit: { voix: 'voix', ou: 'structure', famille: 'feu', quoi: 'les flammes repartent d’un feu éteint' },
  fire_starved: { voix: 'voix', ou: 'village', famille: 'feu', quoi: 'le Feu du village tombe à SEC — les murs vont céder' },
  fire_extinguished: { voix: 'voix', ou: 'structure', famille: 'feu', quoi: 'un feu meurt, il ne reste que les braises' },
  fire_upgraded: { voix: 'voix', ou: 'village', famille: 'feu', quoi: 'le Feu monte d’un palier — le village s’agrandit' },
  // LA TORCHE (spec `torche.md`) : elle prend au foyer, elle meurt en chemin. L'allumage est
  // un geste qu'on répète — MUET, comme nourrir le Feu. L'EXTINCTION, elle, PARLE : c'est
  // l'instant où la nuit se referme, et le joueur ne regarde pas sa ceinture à ce moment-là.
  torche_allumee: { voix: 'muet', famille: 'feu', quoi: 'on prend le feu au foyer, la torche s’allume' },
  torche_eteinte: { voix: 'voix', ou: 'entite', famille: 'feu', quoi: 'la torche meurt — la nuit se referme, loin de chez soi' },

  // ── LE SOCIAL — l'axe d'alignement : les verbes chauds montent, les froids tombent ─
  gift_given: { voix: 'voix', ou: 'auteur', famille: 'social', quoi: 'on DONNE à un voisin (le verbe chaud du Foyer)' },
  refugees_arrived: { voix: 'voix', ou: 'tuile', famille: 'social', quoi: 'un groupe de réfugiés se pose près de chez vous' },
  refugees_fed: { voix: 'voix', ou: 'auteur', famille: 'social', quoi: 'on nourrit les réfugiés' },
  refugee_rumeur: { voix: 'muet', famille: 'social', quoi: 'les réfugiés nourris disent où trouver un lieu — muet : le geste de nourrir parle déjà, le renseignement se lit dans la chronique' },
  refugees_recruited: { voix: 'voix', ou: 'village', famille: 'social', quoi: 'on accueille les réfugiés au village' },
  refugees_robbed: { voix: 'voix', ou: 'auteur', famille: 'social', quoi: 'on DÉPOUILLE les réfugiés (le verbe froid)' },
  refugees_left: { voix: 'muet', famille: 'social', quoi: 'les réfugiés repartent — on n’a rien fait' },
  village_founded: { voix: 'muet', famille: 'social', quoi: 'un village naît autour d’un Feu' },
  village_fell: { voix: 'voix', ou: 'village', famille: 'social', quoi: 'un village TOMBE — il n’est plus qu’une ruine pillable' },
  village_archetype_changed: { voix: 'voix', ou: 'village', famille: 'social', quoi: 'un Feu vire au bleu ou au rouge — Foyer, Meute' },
  member_joined: { voix: 'muet', famille: 'social', quoi: 'quelqu’un rejoint le village' },
  // Muet comme `member_joined`, qu'il accompagne toujours : l'arrivée du colon se VOIT
  // (il entre au village à l'aube, sa paillasse apparaît) — un son la redirait.
  settler_arrived: { voix: 'muet', famille: 'social', quoi: 'la prospérité attire un colon (village PNJ)' },
  member_banished: { voix: 'voix', ou: 'entite', famille: 'social', quoi: 'quelqu’un est BANNI du village' },

  // ── LES BATTEMENTS DE LA SAISON — le temps qui serre, et la menace ────────────────
  night_started: { voix: 'voix', ou: 'monde', famille: 'saison', quoi: 'la nuit tombe' },
  alarm_raised: { voix: 'voix', ou: 'village', famille: 'saison', quoi: 'l’alarme du village — la milice se lève' },
  evacuation_opened: { voix: 'voix', ou: 'monde', famille: 'saison', quoi: 'le point d’évacuation s’ouvre sur la route' },
  day_started: { voix: 'muet', famille: 'saison', quoi: 'le jour se lève' },
  season_day_started: { voix: 'muet', famille: 'saison', quoi: 'un jour de saison de plus (sur 60)' },
  act_started: { voix: 'voix', ou: 'monde', famille: 'saison', quoi: 'un ACTE commence — la pression change de cran' },
  season_ended: { voix: 'voix', ou: 'monde', famille: 'saison', quoi: 'la saison s’achève, les verdicts tombent' },
  cendre_avance: { voix: 'voix', ou: 'monde', famille: 'saison', quoi: 'la Cendre a mangé un morceau de la vallée' },
  cendre_prend: { voix: 'muet', famille: 'registre', quoi: 'le front passe les ouvrages d’un village — muet : souvent lointain (les villages PNJ du sud tombent d’abord), la perte se lit dans la chronique et se voit au cortège ; une voix viendra avec le chantier audio de la Cendre si le playtest la réclame' },
  cendreux_risen: { voix: 'voix', ou: 'xy', famille: 'saison', quoi: 'un cendreux se relève' },
  reveil_etouffe: { voix: 'voix', ou: 'xy', famille: 'saison', quoi: 'le feu a étouffé un réveil — le sol se tait' },
  horde_spawned: { voix: 'voix', ou: 'monde', famille: 'saison', quoi: 'une horde se forme et marche sur un feu — village ou camp (décision ⑬)' },
  presage_horde: { voix: 'voix', ou: 'monde', famille: 'saison', quoi: 'le préavis de la veille — au loin, le sol travaille, la faune se tait (décision ⑱)' },
  charnier_brule: { voix: 'voix', ou: 'xy', famille: 'saison', quoi: 'un charnier ou un repaire assaini au feu — la densité des morts tombe autour (décision ⑧)' },
  horde_dispersed: { voix: 'muet', famille: 'saison', quoi: 'la horde se dissipe à l’aube' },
  convoy_spawned: { voix: 'muet', famille: 'saison', quoi: 'une carcasse de convoi apparaît sur la route' },
  // LA BRUME (spec brume.md, 2026-08-18). L'annonce et la levée SONNENT : le §9bis exige que
  // tout se signale, et tant que la nappe n'a pas son rendu, l'oreille est le seul préavis.
  // Le retrait est MUET par le principe des menaces qui s'en vont (`horde_dispersed`) — c'est
  // le filon qu'il découvre qui a la voix : l'ouverture qui MONTE.
  brume_annonce: { voix: 'voix', ou: 'monde', famille: 'saison', quoi: 'le gibier se tait — une brume froide descendra à l’aube (le préavis)' },
  brume_levee: { voix: 'voix', ou: 'tuile', famille: 'saison', quoi: 'la nappe se lève : sa zone est déniée à qui n’a pas de tenue' },
  brume_retiree: { voix: 'muet', famille: 'saison', quoi: 'la Brume se retire (le filon qu’elle découvre a sa voix)' },
  filon_decouvert: { voix: 'voix', ou: 'tuile', famille: 'saison', quoi: 'un filon affleure au retrait de la Brume — la menace qui paie' },
  filon_retire: { voix: 'muet', famille: 'saison', quoi: 'le filon se referme sans coup de pioche final (périmé, remplacé, ou mangé)' },
  // LE BLIZZARD (spec meteo.md R9, chantier audio météo 2026-08-28) : l'ANNONCE sonne — la
  // veille est le seul télégraphe que le ciel lui-même ne peut pas donner, et c'est le
  // jumeau grave du préavis de Brume. L'ENTRÉE et le PASSAGE restent muets PAR CHOIX : la
  // nappe du vent (`meteo-audio.ts`) monte et retombe avec la bande — un one-shot par-dessus
  // dirait deux fois la même chose.
  blizzard_annonce: { voix: 'voix', ou: 'monde', famille: 'saison', quoi: 'le vent du nord se lève — un blizzard arrivera demain (le préavis de la veille)' },
  blizzard_entre: { voix: 'muet', famille: 'saison', quoi: 'le blizzard entre sur la vallée — la nappe du vent le porte' },
  blizzard_passe: { voix: 'muet', famille: 'saison', quoi: 'le blizzard est passé — la nappe retombe avec lui' },
  ark_departed: { voix: 'voix', ou: 'monde', famille: 'saison', quoi: 'l’Arche lève l’ancre — avec ceux qui étaient à bord' },

  // ── BÂTIR, CRAFTER, MANGER — 4 voix : poser, perdre, finir, cuire ────────────────
  // ⚠ TREIZE VOIX DE MATIÈRE, PAS UNE (2026-08-27) — le geste le plus répété du jeu parle LA
  // MATIÈRE : la hache dans le bois, la pioche dans la pierre, le froissement de la main. La
  // discriminante est `nodeType`, pas l'objet (`variantesDe` plus bas, et `sound.ts` pour le
  // pourquoi). Le banc joue chacune séparément — sans quoi rien de tout ça ne se calerait.
  resource_harvested: { voix: 'voix', ou: 'entite', famille: 'batir', quoi: 'un coup de récolte rapporte — hache, pioche ou main selon la matière (moi seul)' },
  // LA PÊCHE (spec peche.md R3/R4) : la TOUCHE sonne — c'est LE télégraphe, il doit se lire en un
  // dixième de seconde, et l'oreille est plus vite que l'œil sur un flotteur ; la FUITE sonne —
  // un plouf mou, le raté qui se voit doit s'entendre ; la PRISE est MUETTE parce qu'elle tombe
  // sur `resource_harvested`, qui parle déjà au même tick (le patron de `refugee_rumeur`).
  fish_bite: { voix: 'voix', ou: 'tuile', famille: 'batir', quoi: 'ça mord — le flotteur plonge (moi seul)' },
  fish_caught: { voix: 'muet', famille: 'batir', quoi: 'le poisson sort de l’eau (la récolte parle déjà)' },
  fish_escaped: { voix: 'voix', ou: 'tuile', famille: 'batir', quoi: 'le poisson file — ferré trop tard (moi seul)' },
  // ── LES QUATRE FAITS DU 2026-08-24 (peche.md D9-D12) ──
  // LE MORDILLAGE a une voix, et il la faut : c'est le SIGNAL d'une eau pauvre (« ça mordille
  // sans jamais mordre, va voir ailleurs »). Muet, D11 n'aurait aucun retour d'information.
  fish_nibble: { voix: 'voix', ou: 'tuile', famille: 'batir', quoi: 'ça mordille — l’eau est pauvre, ça ne mordra pas ici (moi seul)' },
  fishing_cancelled: { voix: 'voix', ou: 'entite', famille: 'batir', quoi: 'la ligne rentre : l’eau s’est retirée, a pris, ou ne donne rien' },
  fishing_junk: { voix: 'muet', famille: 'batir', quoi: 'on remonte un caillou — la récolte parle déjà' },
  fish_record: { voix: 'voix', ou: 'entite', famille: 'progres', quoi: 'la plus grosse prise de cette espèce — le bestiaire s’écrit' },
  structure_built: { voix: 'voix', ou: 'tuile', famille: 'batir', quoi: 'une pièce est posée' },
  structure_upgraded: { voix: 'muet', famille: 'batir', quoi: 'un mur passe au matériau suivant' },
  // LE PALIER DE BÂTI d'un village PNJ (spec village-pnj-evolution R6) : rare, et c'est LE
  // fait saillant du chantier — un hameau devient un bourg. Le jumeau grave de `fire_upgraded`.
  village_stage_up: { voix: 'voix', ou: 'village', famille: 'batir', quoi: 'un village PNJ monte de palier — le bâti suit' },
  // LA PORTE : le seul geste de bâtisseur qu'on refait dix fois par jour, et le SEUL retour qu'on
  // en ait — rien ne bouge à l'écran d'une porte close à une porte ouverte de plus d'un liseré.
  // C'est donc un son qui PORTE l'information, pas qui l'accompagne.
  door_toggled: { voix: 'voix', ou: 'structure', famille: 'batir', quoi: 'une porte s’ouvre ou se referme' },
  structure_repaired: { voix: 'muet', famille: 'batir', quoi: 'on répare une structure abîmée' },
  structure_removed: { voix: 'muet', famille: 'batir', quoi: 'on démonte une pièce' },
  structure_destroyed: { voix: 'voix', ou: 'structure', famille: 'batir', quoi: 'une structure est DÉTRUITE (une horde l’a eue)' },
  item_crafted: { voix: 'voix', ou: 'entite', famille: 'batir', quoi: 'un objet sort de la file d’artisanat' },
  meat_cooked: { voix: 'voix', ou: 'structure', famille: 'batir', quoi: 'un aliment sort cuit du feu' },
  meal_eaten: { voix: 'muet', famille: 'batir', quoi: 'on mange' },
  crop_planted: { voix: 'muet', famille: 'batir', quoi: 'on sème au potager' },
  crop_harvested: { voix: 'muet', famille: 'batir', quoi: 'on récolte le potager' },
  // Le monde frappe, personne ne l'a fait : c'est un fait de SAISON, pas de bâtisseur.
  crop_frozen: { voix: 'voix', ou: 'structure', famille: 'saison', quoi: 'le gel a TUÉ une culture de plein air' },

  // ── PROGRESSION ET DÉCOUVERTE ─────────────────────────────────────────────────────
  skill_level_up: { voix: 'voix', ou: 'entite', famille: 'progres', quoi: 'un métier monte d’un niveau' },
  poi_first_visit: { voix: 'voix', ou: 'auteur', famille: 'progres', quoi: 'on FOULE un lieu pour la première fois' },
  poi_discovered: { voix: 'muet', famille: 'progres', quoi: 'un lieu entre dans la carte' },
  /**
   * MUET, et c'est un choix : une matière ramassée ouvre souvent PLUSIEURS recettes d'un
   * coup (un lingot de fer en annonce trois), et poser une station en révèle une poignée
   * dans le même tick. Un son par recette ferait une rafale à chaque ramassage — le
   * contraire de ce que la découverte doit être. Si elle doit s'entendre un jour, c'est
   * d'UNE voix par salve, pas par ligne : une décision à part entière.
   */
  recipe_revealed: { voix: 'muet', famille: 'progres', quoi: 'une recette se découvre — sa matière, ou sa station' },

  // ── LA PLAIE — refermée : on entend désormais qu'une plaie s'ouvre, pas seulement ─
  entity_bandaged: { voix: 'voix', ou: 'entite', famille: 'plaie', quoi: 'une plaie est pansée' },
  wound_inflicted: { voix: 'voix', ou: 'entite', famille: 'plaie', quoi: 'une BLESSURE s’ouvre — jambe, bras, saignement' },

  // ── LE GESTE MANQUÉ ET LE GESTE TENU ─────────────────────────────────────────────
  // Les deux moments les plus informatifs d'un combat de coût, et les deux seuls qui se
  // produisaient sans un son : le raté qui cloue sur place (jusqu'à 1,6 s de récupération)
  // et la parade qui a MARCHÉ. On les ancre sur l'ENTITÉ — c'est un fait de corps, il
  // s'entend d'où il a lieu, et la distance dit s'il me concerne.
  attack_whiffed: { voix: 'voix', ou: 'entite', famille: 'registre', quoi: 'un coup fend l’air — et cloue son porteur sur place' },
  attack_blocked: { voix: 'voix', ou: 'entite', famille: 'registre', quoi: 'la garde a tenu (et si elle était posée à temps, elle fut gratuite)' },

  // ── MUET PAR NATURE — haute fréquence, ou pure plomberie d'interface ──────────────
  // Le silence tient — mais sa RAISON était fausse jusqu'au 2026-08-20. « Déjà un toast »
  // supposait que le joueur VOIT le refus : le bandeau était peint sur le canvas, donc SOUS
  // les écrans DOM opaques d'où partent justement les gestes qui se font refuser. Sac ouvert,
  // une action refusée ne produisait ni son ni image. Le bandeau est passé en DOM au-dessus
  // des panneaux (audit UX P0.2) : la justification est enfin vraie.
  action_rejected: { voix: 'muet', famille: 'plomberie', quoi: 'la sim refuse une action (le bandeau le dit, et il se voit)' },
  entity_spawned: { voix: 'muet', famille: 'plomberie', quoi: 'une entité entre dans le monde' },
  entity_despawned: { voix: 'muet', famille: 'plomberie', quoi: 'une entité quitte le monde (déconnexion)' },
  entity_respawned: { voix: 'muet', famille: 'plomberie', quoi: 'on se réveille au Feu (le voile le dit déjà)' },
  // Il était muet, au motif que « le nœud disparaît à l'écran ». PÉRIMÉ depuis G15 : il ne
  // disparaît plus, il TOMBE ou il ÉCLATE. Trois voix selon la matière — voir `sound.ts`.
  node_depleted: { voix: 'voix', ou: 'noeud', famille: 'batir', quoi: 'un nœud meurt : l’arbre craque et tombe, la pierre s’éboule, le végétal froisse' },
  item_dropped: { voix: 'muet', famille: 'plomberie', quoi: 'un objet est jeté au sol' },
  corpse_looted: { voix: 'muet', famille: 'plomberie', quoi: 'une dépouille est fouillée' },
  // LE DÉPEÇAGE (spec depecage.md G2) : la coupe qui porte SONNE, comme le coup de récolte dont
  // elle est la sœur — c'est le seul retour du maintien (pas de jauge), l'oreille confirme le geste.
  carcass_cut: { voix: 'voix', ou: 'entite', famille: 'batir', quoi: 'une part sort de la carcasse (moi seul)' },
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

// ── LES VARIANTES D'UN MÊME FAIT ────────────────────────────────────────────────────────────

/**
 * ═══ UN FAIT, PLUSIEURS VOIX — ET IL FALLAIT POUVOIR LES ENTENDRE ═══
 *
 * `soundForEvent` ne route pas que sur le TYPE : trois faits se dédoublent sur un champ de
 * leur charge utile — la porte sur `open`, le nœud qui meurt et le coup de récolte sur
 * `nodeType`. Or le banc comme les tests fabriquent leurs faits synthétiques SANS ces champs :
 * tout tombait donc sur la branche `default`, et les autres voix n'étaient ni auditionnables
 * ni gardées. Les trois voix de `node_depleted` vivaient ainsi INAUDIBLES depuis le 2026-07-29,
 * dans un fichier dont l'en-tête dit que personne ne peut les entendre autrement.
 *
 * C'est une garde qui dégrade en silence : les 21 voix de la récolte auraient passé le plafond
 * de gain et le relevé de portée sur la seule qui ne s'entend jamais en jeu.
 *
 * ⚠ `Record<NodeType, string>` : une matière neuve rend ce fichier ROUGE tant que personne n'a
 * dit comment on la nomme au banc — la même discipline que `Record<SimEvent['type'], Fait>`
 * plus haut. Ce que la table NE garantit pas, c'est que `sound.ts` lui ait donné une voix
 * distincte : ça, c'est un choix de design, et le banc est là pour l'entendre.
 *
 * ⚠ UN LIBELLÉ NOMME LA MATIÈRE, PAS LE GESTE — la table sert DEUX faits (le coup de récolte
 * et le nœud qui meurt), et un nom de geste se retourne contre l'un des deux : « la prise sort
 * de l'eau » sous le bouton d'un coin de pêche ÉPUISÉ raconte le contraire de ce qui se joue.
 * Ce qui suit la parenthèse dit donc la matière ou l'outil, jamais l'action.
 */
export const MATIERES: Record<NodeType, string> = {
  tree: 'l’arbre — le bois vert, à la hache',
  old_tree: 'le gros bois — trois cents ans de fût',
  rock: 'le rocher — la pioche dans la pierre',
  bloc: 'le bloc d’affleurement — un cube de roche pleine',
  quarry: 'la carrière — la pierre à bâtir',
  iron_vein: 'le filon de fer — la seule matière qui TINTE',
  coal_seam: 'la veine de charbon — ça s’émiette',
  charbonniere: 'le fût calciné — du charbon de bois qui s’effrite',
  rubble: 'les gravats — de la matière mêlée, qu’on fouille',
  fiber_plant: 'la fibre — un froissement',
  berry_bush: 'le buisson de baies',
  champignon: 'le patch de champignons',
  leaf_pile: 'le tas de feuilles — les vers',
  fumerolle: 'la fumerolle — la croûte de sel',
  peat_cut: 'la tourbe — l’eau noire',
  ash_heap: 'le tas de cendre — la matière qui n’oppose rien',
  branche_au_sol: 'la branche au sol — du bois mort, ramassé à la main',
  pierre_au_sol: 'la pierre au sol — un caillou, ramassé à la main',
  fishing_spot_river: 'le coin de rivière — l’eau vive',
  fishing_spot_lake: 'le coin de lac — l’eau dormante',
}

/** Une façon de jouer un fait : le libellé du bouton, et les champs à poser sur l'événement. */
export interface Variante {
  cle: string
  libelle: string
  champs: Record<string, unknown>
}

const MATIERE_VARIANTES: Variante[] = Object.entries(MATIERES).map(([cle, libelle]) => ({
  cle,
  libelle,
  champs: { nodeType: cle },
}))

/**
 * Les façons de jouer un fait — vide pour les 89 faits qui n'en ont qu'une.
 *
 * `resource_harvested` en a une DE PLUS que les matières : la trouvaille ferrée arrive sans
 * nœud (`nodeId: -1`), et ce régime a sa propre voix côté `sound.ts`. Un banc qui ne la
 * jouerait pas laisserait non gardée la seule branche que le jeu emprunte vraiment quand il
 * ne sait pas de quoi il parle.
 */
export function variantesDe(type: SimEvent['type']): Variante[] {
  switch (type) {
    case 'resource_harvested':
      return [...MATIERE_VARIANTES, { cle: 'sans-matiere', libelle: 'sans matière — la trouvaille ferrée', champs: {} }]
    case 'node_depleted':
      return MATIERE_VARIANTES
    case 'door_toggled':
      return [
        { cle: 'ouvre', libelle: 'la porte s’OUVRE', champs: { open: true } },
        { cle: 'ferme', libelle: 'la porte se FERME', champs: { open: false } },
      ]
    default:
      return []
  }
}

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
