/**
 * LE SON — le premier échafaudage audio (l'audit : 0 son, « fatal au chef-d'œuvre »).
 *
 * WebAudio PROCÉDURAL, zéro asset externe (CSP : rien à charger). On sépare deux choses :
 *  - le CÂBLAGE (quel événement → quel son) : une table PURE, testable — `soundForEvent`.
 *  - la SYNTHÈSE (comment un son sonne) : `buildSound`, qui monte un petit graphe WebAudio.
 *
 * ⚠ ESTHÉTIQUE À VALIDER — je ne peux pas ENTENDRE le résultat. Les sons sont volontairement
 * SOBRES et BAS (gains ~0,04-0,12), coupables au besoin (mute) : un pis-aller qui ne doit pas
 * gêner le playtest, pas un design sonore final. À régler à l'oreille par Alexis (l'audit le
 * classe « oreilles »). Le SYSTÈME, lui, est vérifiable (routage + niveaux/durées des buffers).
 */
import type { SimEvent } from '@ashes/sim'
import { PORTE_ANIM_MS } from '../render/porte-anim'
import { PORTEE, type Placement } from './spatial'

export type Waveform = 'sine' | 'triangle' | 'square' | 'sawtooth' | 'noise'

/** Un son procédural : une forme, une enveloppe, un glissando optionnel, un filtre optionnel. */
export interface SoundSpec {
  wave: Waveform
  /** Fréquence de départ (Hz) ; ignorée pour `noise`. */
  freq: number
  /** Glissando vers cette fréquence sur la durée (Hz). Absent = tenue. */
  freqEnd?: number
  /** Durée totale (s). */
  dur: number
  /** Gain crête (0..1) — GARDÉ BAS : le monde n'est pas un jeu d'arcade. */
  gain: number
  /** Coupe-bas (Hz) — surtout pour le bruit (impacts feutrés). */
  lowpass?: number
  /**
   * LA PUISSANCE, en crans de `PORTEE` (défaut `FAIT` = 1) — jusqu'où ce son PORTE.
   *
   * Quatrième axe de la grammaire ci-dessous, à côté du sens, de la matière et du poids : le
   * `gain` dit ce qu'on entend au tympan, la portée dit à quelle distance on l'entend encore.
   * Un gond de porte et un hurlement de loup avaient la même (26,7 tuiles) jusqu'au 2026-08-27.
   *
   * ⚠ PLAFOND À 64 TUILES POUR LES FAITS ANCRÉS SUR UNE ENTITÉ, UNE STRUCTURE OU UN VILLAGE :
   * le client les résout par le snapshot, rogné au rayon d'intérêt. Un son qui porte au-delà
   * doit se poser sur un fait AUTO-LOCALISANT (`xy`, `tuile`, `noeud`, `monde`) — invariant
   * tenu par une garde de `spatial.test.ts`, qui croise cette table avec `inventaire.ts`.
   */
  portee?: number
}

/**
 * LA TABLE DE ROUTAGE (pure) : un événement de domaine → un son, ou `null` (silencieux).
 * `onMe` distingue « ça m'arrive » de « ça arrive à un autre ».
 *
 * ── LA GRAMMAIRE ────────────────────────────────────────────────────────────────────────
 * Elle n'a pas été inventée : elle se LISAIT déjà dans les dix sons de l'échafaudage, et les
 * vingt-quatre voix ajoutées le 2026-07-28 s'y rangent. L'écrire, c'est ce qui empêche le
 * prochain son d'être un son de plus au lieu d'un mot de la même langue.
 *
 *  LE SENS — une hauteur qui MONTE ouvre (arrivée, don, palier, découverte) ; une hauteur qui
 *  DESCEND ferme (mort, chute, feu à sec, acte qui serre). C'est la règle la plus forte : le
 *  joueur apprend le sens d'un son avant d'en apprendre le mot.
 *
 *  LA MATIÈRE — `sine` : le monde et la cérémonie (la nuit, la saison, un village qui tombe).
 *  `triangle` : un fait sur un corps ou une chose. `square` : un signal, une confirmation
 *  d'interface (l'alarme, la récolte, l'objet fini). `noise` : la matière et la chair (le
 *  choc, la plaie, la cendre, ce qui s'effondre). `sawtooth` était INEMPLOYÉ : il devient
 *  la voix du PRÉDATEUR — dépouiller, bannir, la horde qui marche. Le verbe froid a son
 *  timbre, et l'axe d'alignement s'entend.
 *
 *  LE POIDS — gain et durée disent l'échelle, jamais le volume seul : 0,05 / 0,1 s pour un
 *  geste, 0,08 / 0,5 s pour un fait de village, 0,11 / 1,4 s pour ce qui ne revient pas.
 *  Plafond 0,15 tenu par test — le son reste un DÉCOR (`MASTER_GAIN` le repasse à 0,6).
 *
 * ⚠ ESTHÉTIQUE : ces valeurs sont des PROPOSITIONS posées sans les entendre (voir l'en-tête
 * du fichier). Elles se rejugent et se retouchent au banc d'écoute (`banc-son.html`), qui
 * rend la ligne à coller ici. Ce qui est arrêté, c'est QUI a une voix ; pas encore laquelle.
 */
export function soundForEvent(event: SimEvent, onMe: boolean): SoundSpec | null {
  switch (event.type) {
    // ── LE CORPS ET LA BÊTE ──────────────────────────────────────────────────────────────
    case 'entity_damaged':
      // Encaisser (sur moi) : un choc mat et grave. Toucher (un autre) : un « tac » plus clair.
      return onMe
        ? { wave: 'noise', freq: 0, dur: 0.16, gain: 0.12, lowpass: 700 }
        : { wave: 'triangle', freq: 320, freqEnd: 220, dur: 0.08, gain: 0.06 }
    case 'entity_died':
      return { wave: 'sine', freq: 160, freqEnd: 70, dur: 1.1, gain: 0.11, portee: PORTEE.LOIN }
    case 'monster_slain':
      return { wave: 'triangle', freq: 180, freqEnd: 90, dur: 0.22, gain: 0.1 }
    case 'wolf_howl':
      return { wave: 'sine', freq: 520, freqEnd: 240, dur: 0.7, gain: 0.09, portee: PORTEE.CRI }
    // L'ENVOL (forêts-vivantes §3) : un battement aigu qui MONTE — la nuée qui gicle. Un
    // signal (square) court : la forêt vous a dénoncé, et tout le monde l'a entendu.
    case 'bird_flush':
      return { wave: 'square', freq: 1400, freqEnd: 2200, dur: 0.28, gain: 0.05 }
    // LES MORTS N'ONT PAS DE VOIX. Là où le loup lance une note qui PORTE (sinus haut, longue),
    // le Cendreux racle : du bruit filtré bas, sourd, sans hauteur. Deux dangers, deux signes —
    // le joueur doit savoir laquelle des deux parades il prépare sans regarder l'écran.
    case 'cendreux_prowl':
      return { wave: 'noise', freq: 0, dur: 0.9, gain: 0.08, lowpass: 420, portee: PORTEE.CRI }
    // LE CRI DE FUREUR (décisions ④⑤, 2026-08-21) : le seul moment où un mort a une VOIX —
    // et elle est fausse. Plus long, plus grave et plus fort que le raclement : ce n'est pas
    // un avertissement, c'est un appel — le sol va se lever tout autour.
    case 'cendreux_cri':
      return { wave: 'noise', freq: 0, dur: 1.6, gain: 0.11, lowpass: 300, portee: PORTEE.CRI }

    // ── LA PLAIE ─────────────────────────────────────────────────────────────────────────
    case 'entity_bandaged':
      return { wave: 'noise', freq: 0, dur: 0.14, gain: 0.05, lowpass: 1400, portee: PORTEE.GESTE }
    // Une plaie qui s'OUVRE. Elle sonne aussi pour les autres, et c'est tout son objet :
    // rien à l'écran ne dit qu'un PNJ saigne, or on peut désormais le panser. Plus claire
    // (coupe à 1100) et plus longue que le choc d'`entity_damaged` : une déchirure, pas un coup.
    case 'wound_inflicted':
      return { wave: 'noise', freq: 0, dur: 0.22, gain: 0.085, lowpass: 1100 }

    // ── LE GESTE MANQUÉ ET LE GESTE TENU ────────────────────────────────────────────────
    // LE VIDE : du bruit qui S'OUVRE vers l'aigu et meurt — un souffle, pas un choc. Il ne
    // doit surtout pas se confondre avec `entity_damaged` (grave, mat, filtré bas) : c'est
    // très exactement l'information « rien n'a touché », et c'est l'inverse d'un impact. La
    // coupe haute (4000) le rend fin ; le gain bas le laisse sous le choc d'un vrai coup —
    // un raté se remarque, il ne domine pas.
    case 'attack_whiffed':
      return event.charged
        ? { wave: 'noise', freq: 0, dur: 0.34, gain: 0.075, lowpass: 3000 } // le lourd brasse plus d'air
        : { wave: 'noise', freq: 0, dur: 0.18, gain: 0.05, lowpass: 4000 }
    // LA GARDE : un choc DUR et court — ce qui s'arrête net contre quelque chose. La parade
    // À TEMPS sonne plus HAUT et plus claire, et c'est le seul retour qui existe sur elle :
    // le joueur doit pouvoir apprendre le geste à l'oreille, sans quitter le loup des yeux
    // (le patron de `reveil_etouffe` — une parade muette ne s'apprend pas).
    case 'attack_blocked':
      return event.parried
        ? { wave: 'triangle', freq: 900, freqEnd: 1500, dur: 0.14, gain: 0.09 }
        : { wave: 'noise', freq: 0, dur: 0.1, gain: 0.07, lowpass: 2200 }

    // ── LE FEU — l'organe vital ──────────────────────────────────────────────────────────
    // À SEC : le fait qui condamne les murs, et qui se produisait sans un bruit. Grave,
    // étouffé (coupe 900), long : quelque chose s'affaisse vers l'intérieur.
    case 'fire_starved':
      return { wave: 'triangle', freq: 190, freqEnd: 96, dur: 0.8, gain: 0.1, lowpass: 900, portee: PORTEE.LOIN }
    case 'fire_extinguished':
      return { wave: 'noise', freq: 0, dur: 0.34, gain: 0.055, lowpass: 620 } // le souffle qui meurt
    case 'fire_relit':
      return { wave: 'triangle', freq: 220, freqEnd: 330, dur: 0.26, gain: 0.07, lowpass: 1800 } // ça reprend
    case 'fire_upgraded':
      return { wave: 'sine', freq: 262, freqEnd: 392, dur: 0.55, gain: 0.085 } // une quinte : le village grandit
    // LE PALIER DE BÂTI d'un village PNJ (spec village-pnj-evolution R6) : le jumeau de
    // `fire_upgraded`, une octave sous lui et plus long — c'est le VILLAGE qui monte, pas
    // un feu qu'on paie ; plus rare, plus large, même famille de sens (ça grandit).
    case 'village_stage_up':
      return { wave: 'sine', freq: 131, freqEnd: 196, dur: 0.9, gain: 0.09, portee: PORTEE.LOIN }
    // LA TORCHE MEURT (spec `torche.md`) : le souffle qui s'éteint, comme `fire_extinguished` —
    // mais PLUS COURT et plus haut (un fagot, pas un foyer). C'est un des rares sons qui
    // annoncent un danger sans le nommer : la nuit vient de se refermer, loin de chez soi.
    case 'torche_eteinte':
      return { wave: 'noise', freq: 0, dur: 0.2, gain: 0.05, lowpass: 900 }
    // `fire_fed` et `torche_allumee` restent MUETS : gestes répétés (bûche après bûche, torche
    // après torche), et ce qu'on voit le dit déjà — la flamme qui monte, la lumière qui naît.

    // ── LE SOCIAL — l'axe d'alignement, rendu audible ────────────────────────────────────
    // Les verbes CHAUDS montent (triangle/sine), les verbes FROIDS descendent (sawtooth).
    case 'gift_given':
      return { wave: 'triangle', freq: 330, freqEnd: 494, dur: 0.28, gain: 0.065 }
    case 'refugees_arrived':
      return { wave: 'triangle', freq: 392, freqEnd: 523, dur: 0.3, gain: 0.06 }
    case 'refugees_fed':
      return { wave: 'triangle', freq: 294, freqEnd: 392, dur: 0.26, gain: 0.06 }
    case 'refugees_recruited':
      return { wave: 'sine', freq: 262, freqEnd: 440, dur: 0.5, gain: 0.075 } // le plus large des chauds : ils entrent
    case 'refugees_robbed':
      return { wave: 'sawtooth', freq: 330, freqEnd: 165, dur: 0.34, gain: 0.075, lowpass: 1600 }
    case 'member_banished':
      return { wave: 'sawtooth', freq: 262, freqEnd: 131, dur: 0.4, gain: 0.07, lowpass: 1200 }
    // LA CHUTE D'UN VILLAGE : plus lourde et plus longue qu'une mort d'homme — c'est plus
    // qu'une personne qui s'éteint, et le son doit le dire sans qu'on l'explique.
    case 'village_fell':
      return { wave: 'sine', freq: 130, freqEnd: 58, dur: 1.4, gain: 0.12, portee: PORTEE.LOIN }
    // UN FEU VIRE (Foyer/Meute) : ni gain ni perte — une bascule. La hauteur fléchit à peine.
    case 'village_archetype_changed':
      return { wave: 'sine', freq: 330, freqEnd: 294, dur: 0.7, gain: 0.07 }
    // MUETS ici, et par décision : `village_founded` (la fondation a déjà sa cérémonie à
    // l'écran), `member_joined` (discret par nature), `refugees_left` (il ne s'est RIEN passé
    // — c'est l'absence de geste, et une absence ne se sonne pas).

    // ── LES BATTEMENTS DE LA SAISON ──────────────────────────────────────────────────────
    case 'night_started':
      return { wave: 'sine', freq: 130, freqEnd: 98, dur: 0.9, gain: 0.07 }
    // L'ACTE : plus bas et plus long que la nuit — la nuit revient, l'acte jamais.
    case 'act_started':
      return { wave: 'sine', freq: 98, freqEnd: 65, dur: 1.6, gain: 0.1 }
    case 'cendre_avance':
      return { wave: 'noise', freq: 0, dur: 0.6, gain: 0.05, lowpass: 420 } // la cendre est du bruit sourd
    // UN CENDREUX SE LÈVE. Gain et durée BAS À DESSEIN : il s'émet par cadavre, et après une
    // bataille plusieurs mûrissent ensemble — c'est le seul son de la table qui risque le mur.
    case 'cendreux_risen':
      return { wave: 'triangle', freq: 98, freqEnd: 147, dur: 0.3, gain: 0.05, lowpass: 800, portee: PORTEE.LOIN }
    // LE FEU A ÉTOUFFÉ UN RÉVEIL — l'exact CONTRAIRE du précédent, et il doit s'entendre comme
    // tel : `cendreux_risen` monte (98 → 147), celui-ci DESCEND (147 → 98). Même timbre, même
    // filtre, chemin inverse — le joueur n'a pas un second son à apprendre, il entend le même
    // fait joué à l'envers. C'est la récompense de la parade : le sol se tait.
    case 'reveil_etouffe':
      return { wave: 'triangle', freq: 147, freqEnd: 98, dur: 0.35, gain: 0.05, lowpass: 800, portee: PORTEE.LOIN }
    case 'horde_spawned':
      return { wave: 'sawtooth', freq: 147, freqEnd: 110, dur: 0.8, gain: 0.085, lowpass: 900 }
    // LE PRÉSAGE (décision ⑱) : le grondement de la horde, UN JOUR À L'AVANCE et de loin —
    // même timbre que `horde_spawned`, plus sourd et plus bas : la même chose, pas encore là.
    case 'presage_horde':
      return { wave: 'sawtooth', freq: 98, freqEnd: 73, dur: 1.1, gain: 0.06, lowpass: 500 }
    // LE LIEU BRÛLE (décision ⑧) : la confirmation du GESTE — un souffle de flamme qui monte,
    // clair, presque une victoire : le joueur vient d'acheter des nuits plus calmes.
    case 'charnier_brule':
      return { wave: 'noise', freq: 0, dur: 0.7, gain: 0.07, lowpass: 2400, portee: PORTEE.LOIN }
    case 'alarm_raised':
      return { wave: 'square', freq: 660, freqEnd: 660, dur: 0.18, gain: 0.1, lowpass: 2600, portee: PORTEE.LOIN }
    case 'evacuation_opened':
      return { wave: 'sine', freq: 294, freqEnd: 440, dur: 0.5, gain: 0.08 }
    case 'ark_departed':
      return { wave: 'sine', freq: 196, freqEnd: 294, dur: 1.5, gain: 0.095 } // le seul vrai départ
    case 'season_ended':
      return { wave: 'sine', freq: 147, freqEnd: 49, dur: 2.2, gain: 0.11 } // la plus longue descente du jeu
    // ── LA BRUME (spec brume.md) — le froid qui vient, la matière qui couvre, l'ouverture ──
    // L'ANNONCE : le monde en cérémonie (sine) qui DESCEND — le froid s'annonce, comme la
    // nuit mais d'ailleurs. Tant que la nappe n'a pas son rendu, c'est LE préavis (§9bis).
    case 'brume_annonce':
      return { wave: 'sine', freq: 294, freqEnd: 147, dur: 1.0, gain: 0.08 }
    // LE BLIZZARD S'ANNONCE LA VEILLE (meteo.md R9) : le jumeau grave du préavis de Brume —
    // même grammaire (une cérémonie du monde qui SE FERME : sine, hauteur qui descend), une
    // octave plus bas et plus long : ce qui vient est plus grand. C'est la moitié sonore du
    // bandeau « rentrez le bois » ; l'ENTRÉE et le PASSAGE, eux, restent muets — la nappe du
    // vent (`meteo-audio.ts`) les porte mieux qu'un one-shot.
    case 'blizzard_annonce':
      return { wave: 'sine', freq: 147, freqEnd: 65, dur: 1.6, gain: 0.09 }
    // LA LEVÉE : la nappe est de la MATIÈRE (noise sourd, la voix de la cendre) — plus long
    // que `cendre_avance`, car celle-ci passe et repart.
    case 'brume_levee':
      return { wave: 'noise', freq: 0, dur: 1.2, gain: 0.07, lowpass: 400 }
    // LE FILON : une hauteur qui MONTE ouvre — c'est un don du monde, le jumeau minier
    // d'`evacuation_opened`. (`brume_retiree` reste muet : une menace qui s'en va ne sonne
    // pas — c'est le filon qui parle pour elle.)
    case 'filon_decouvert':
      return { wave: 'triangle', freq: 220, freqEnd: 440, dur: 0.5, gain: 0.08 }
    // LE GEL A TUÉ UNE CULTURE (spec `flore-froid.md` F5) — la seule PERTE que le froid
    // inflige. Triangle qui DESCEND, comme `reveil_etouffe`, mais plus haut et plus court :
    // ce n'est pas une menace qui tombe, c'est quelque chose qui casse. Bas et bref — une
    // rangée de parcelles gèle d'un coup, et cinq d'affilée ne doivent pas faire un mur.
    case 'crop_frozen':
      return { wave: 'triangle', freq: 392, freqEnd: 196, dur: 0.35, gain: 0.055, lowpass: 1400 }
    // MUETS : `day_started` et `season_day_started` (c'est chaque jour, et le HUD le dit),
    // `horde_dispersed`, `convoy_spawned` et `brume_retiree` (une menace qui s'en va n'est pas un fait sonore).

    // ── BÂTIR, CRAFTER, MANGER ───────────────────────────────────────────────────────────
    /**
     * ═══ LE COUP DE RÉCOLTE A AUTANT DE VOIX QUE LE MONDE A DE MATIÈRES ═══
     * (demande d'Alexis, 2026-08-27 : « un son différent à la récolte de chaque ressource —
     * bruit de pioche pour la pierre, bruit de hache pour le bois ».)
     *
     * C'ÉTAIT UN BIP D'INTERFACE, ET ÇA DEVIENT DE LA MATIÈRE. Le geste le plus répété du jeu
     * (un coup par seconde, `GATHER_COOLDOWN_TICKS`) rendait un `square` 440→520 — dans la
     * grammaire de la maison, « un signal, une confirmation d'interface » : le son de l'objet
     * qui entre au sac, pas celui de l'outil qui frappe. On passe donc en `noise`, LA VOIX DE
     * LA MATIÈRE — la même que `node_depleted`, dont ces voix sont les petites sœurs. Le coup
     * et l'épuisement disent alors la même matière dans la même langue, à deux échelles.
     *
     * ⚠ LA DISCRIMINANTE EST `nodeType`, PAS `item` — et c'est ce cas qui a fait ajouter le
     * champ au fait de domaine (voir `events.ts`). `branche_au_sol` rend `wood` et
     * `pierre_au_sol` rend `stone` : router sur l'objet ferait sonner la hache et la pioche sur
     * un GLANAGE, où l'on se baisse sans rien frapper — pendant très exactement les dix minutes
     * qui amorcent la rampe d'outils.
     *
     * ── L'ENVELOPPE EST LA CONTRAINTE, PAS LE TIMBRE ────────────────────────────────────
     * Un arbre, c'est DIX coups à la seconde. Tout ce qui se frappe reste donc ≤ 80 ms et
     * ≤ 0,06 de gain, sans traîne : une hache « épaisse » de 200 ms serait insupportable au
     * troisième coup, et aucun test ne l'attraperait. C'est le même raisonnement qui donne à
     * `node_depleted` le droit de durer 0,5 s — lui n'arrive qu'une fois sur dix.
     * DEUX DÉROGATIONS, et elles se justifient par la CADENCE, pas par l'importance : la
     * prise de pêche (une par cycle de touche, jamais en rafale) et les gestes d'UN SEUL COUP
     * (`stock: 1`, le glanage) peuvent respirer un peu.
     *
     * ── LES DEUX AXES DU BRUIT ─────────────────────────────────────────────────────────
     * `buildSound` ignore `freq`/`freqEnd` pour le bruit : il ne reste que LA COUPURE et LA
     * DURÉE (le même constat qu'à `node_depleted`). La lecture s'organise donc sur un seul
     * contraste, franc et apprenable sans qu'on l'explique :
     *   LA HACHE est BASSE et PLEINE (coupe ≤ 1200, 70-80 ms) — du bois qui encaisse.
     *   LA PIOCHE est HAUTE et SÈCHE (coupe ≥ 1800, 50-60 ms) — de la pierre qui éclate.
     *   LA MAIN est CLAIRE et MINUSCULE (coupe ≥ 4200, gain ≤ 0,04) — à peine un froissement.
     * Le seul nœud qui QUITTE le bruit est le filon de fer : un métal SONNE, il a une hauteur,
     * et c'est la seule matière du jeu dont ce soit vrai (`triangle`, « un fait sur une chose »).
     *
     * ⚠ POSÉ SANS L'ENTENDRE, comme tout ce fichier — à juger au banc (`atelier.html#son`),
     * qui sait désormais jouer CHAQUE variante de nœud et rend la ligne à coller ici.
     * LA LIMITE CONNUE : un coup de pioche réel est DEUX sons (l'attaque métallique, puis la
     * masse). Un `SoundSpec` par fait n'en exprime qu'un — on a choisi le corps. Le filon est
     * celui qui en souffre le plus ; si le banc le trouve maigre, c'est là qu'un routage rendant
     * une SÉQUENCE se justifierait, et pas avant (ce n'est pas le contrat d'aujourd'hui).
     */
    case 'resource_harvested':
      if (!onMe) return null // la récolte des PNJ ferait un vacarme de fond — inchangé
      switch (event.nodeType) {
        // ── LA HACHE ─────────────────────────────────────────────────────────────────────
        // Le bois vert : un « tok » plein, le grain sec de la fibre qui cède sous le fer.
        case 'tree':
          return { wave: 'noise', freq: 0, dur: 0.07, gain: 0.055, lowpass: 1200 }
        // LE GROS BOIS répond plus BAS et plus long : un fût de trois cents ans encaisse. C'est
        // la seule marche de matière qui se paie à l'oreille — l'outil, lui, ne change pas de son.
        case 'old_tree':
          return { wave: 'noise', freq: 0, dur: 0.08, gain: 0.06, lowpass: 800 }

        // ── LA PIOCHE ────────────────────────────────────────────────────────────────────
        // La pierre : COURT et HAUT, l'exact opposé de la hache — un éclat, pas une entaille.
        // C'est ce contraste-là qui rend les deux gestes reconnaissables les yeux fermés.
        case 'rock':
        case 'bloc':
        case 'pierre_au_sol':
          return { wave: 'noise', freq: 0, dur: 0.05, gain: 0.055, lowpass: 3800 }
        // LA CARRIÈRE — la même pioche, mais dans un banc de pierre à bâtir : un peu plus de
        // corps et un peu moins d'éclat qu'un caillou qu'on casse.
        case 'quarry':
          return { wave: 'noise', freq: 0, dur: 0.06, gain: 0.06, lowpass: 2800 }
        // LE FILON DE FER — LA SEULE MATIÈRE QUI SONNE. Le métal a une HAUTEUR : c'est le seul
        // nœud à quitter le bruit pour un timbre pitché, et le seul coup de récolte qui tinte.
        // Il DESCEND (la règle du sens) et il est bref : une cloche, pas un carillon.
        case 'iron_vein':
          return { wave: 'triangle', freq: 1760, freqEnd: 1245, dur: 0.06, gain: 0.05 }
        // LE CHARBON ne tinte pas, il S'ÉMIETTE : la houille est friable. Entre la pierre et le
        // bois — plus sourd que l'éclat de roche, sans le corps du tronc.
        case 'coal_seam':
          return { wave: 'noise', freq: 0, dur: 0.06, gain: 0.05, lowpass: 1800 }
        // LES GRAVATS — le seul « minage » qui n'est pas une frappe : on FOUILLE. Plus long et
        // sans attaque, un raclement de matière mêlée ; ce qu'on en tire est ce que d'autres ont
        // fait, et le geste doit s'entendre comme une recherche, pas comme un coup.
        case 'rubble':
          return { wave: 'noise', freq: 0, dur: 0.08, gain: 0.05, lowpass: 2600 }

        // ── LA MAIN ──────────────────────────────────────────────────────────────────────
        // LE VÉGÉTAL — un froissement, et rien de plus. Le plus discret de la famille : on
        // cueille des dizaines de fois par jour, et ce geste ne doit JAMAIS se faire remarquer.
        // Plus bref et plus clair que le végétal qui s'épuise (`node_depleted`, 0,16 s / 3200) :
        // on prend une poignée, on ne vide pas le buisson.
        case 'fiber_plant':
        case 'berry_bush':
        case 'champignon':
        case 'leaf_pile':
          return { wave: 'noise', freq: 0, dur: 0.05, gain: 0.035, lowpass: 4200 }
        // LE SEL DE LA FUMEROLLE — une croûte CRISTALLINE qu'on détache : le son le plus haut
        // et le plus court du jeu. Il dit la matière rare autant que le geste.
        case 'fumerolle':
          return { wave: 'noise', freq: 0, dur: 0.04, gain: 0.04, lowpass: 5200 }
        // LA TOURBE — de l'eau noire et de la fibre gorgée : la coupure la plus BASSE de tout le
        // fichier, et pas d'attaque. Ça ne casse pas, ça se descelle. Lourd, mou, mouillé.
        case 'peat_cut':
          return { wave: 'noise', freq: 0, dur: 0.08, gain: 0.045, lowpass: 500 }
        // LE FÛT CALCINÉ (R25) — du bois qui a perdu sa fibre : il ne cède pas, il S'ÉMIETTE. On
        // le pose entre le bois (le corps) et la cendre (le silence) : plus grave que le sel,
        // plus mat que la houille, sans l'entaille du tronc. C'est un objet CREUX qu'on casse.
        case 'charbonniere':
          return { wave: 'noise', freq: 0, dur: 0.07, gain: 0.045, lowpass: 1400 }
        // LA CENDRE — la matière qui n'oppose RIEN. Presque pas un son : un souffle gris. C'est
        // le seul geste de récolte dont le silence relatif est le message.
        case 'ash_heap':
          return { wave: 'noise', freq: 0, dur: 0.07, gain: 0.035, lowpass: 2200 }

        // ── LE GLANAGE (`glanage.md`) — ON SE BAISSE, ON NE FRAPPE PAS ────────────────────
        // La raison d'être de tout ce chantier : `branche_au_sol` rend `wood` comme le tronc,
        // et il ne doit surtout pas sonner comme lui. Un petit claquement de bois MORT, sec et
        // creux — pas d'entaille, pas de fibre qui cède. (La pierre au sol, elle, partage la
        // voix du rocher plus haut : un caillou qu'on ramasse claque comme un caillou.)
        case 'branche_au_sol':
          return { wave: 'noise', freq: 0, dur: 0.045, gain: 0.035, lowpass: 1600 }

        // ── L'EAU ────────────────────────────────────────────────────────────────────────
        // LA PRISE. `fish_caught` est MUET par décision, « il tombe sur `resource_harvested`,
        // qui parle déjà au même tick » — c'est donc CETTE voix qui est le son de la prise, et
        // elle doit sonner comme un poisson qui sort de l'eau : un « flop » mouillé, bas. Elle
        // s'autorise 120 ms parce qu'une prise n'arrive JAMAIS en rafale (une par cycle de
        // touche) : la règle des 80 ms borne la cadence, pas l'importance.
        case 'fishing_spot_river':
        case 'fishing_spot_lake':
          return { wave: 'noise', freq: 0, dur: 0.12, gain: 0.05, lowpass: 900 }

        // ── SANS MATIÈRE ─────────────────────────────────────────────────────────────────
        // `nodeType` absent : la TROUVAILLE FERRÉE (`landTrouvaille` — on remonte un caillou
        // d'une eau sans coin, `nodeId: -1`), et tout fait futur qui n'aurait pas de nœud. Le
        // vieux `square` de l'échafaudage garde ici sa vraie place, et seulement ici : la
        // confirmation d'interface « quelque chose est entré au sac ». Faute de matière, on ne
        // fait PAS semblant d'en avoir une.
        default:
          return { wave: 'square', freq: 440, freqEnd: 520, dur: 0.06, gain: 0.05, lowpass: 2200 }
      }
    // LA COUPE (depecage.md G2) : la sœur du coup de récolte, plus BASSE et plus MATE — une lame
    // dans la chair, pas une hache dans le bois. Le seul retour du maintien : il doit se
    // distinguer du « +1 bois » à l'oreille.
    // ⚠ SA PARENTÉ A CHANGÉ DE BRANCHE le 2026-08-27 : elle se calait sur un coup de récolte
    // qui était un `square` d'interface ; celui-ci est devenu de la MATIÈRE (voir ci-dessus).
    // Elle reste `triangle` — le couteau qui entre dans la chair n'est ni du bois qui cède ni
    // de la pierre qui éclate, et la garder pitchée est ce qui la tient distincte des deux.
    case 'carcass_cut':
      return onMe ? { wave: 'triangle', freq: 300, freqEnd: 240, dur: 0.07, gain: 0.06, lowpass: 1600 } : null
    // LA TOUCHE (peche.md R3) : un son SEC, court, qui DESCEND — le flotteur qui plonge. C'est le
    // télégraphe d'une fenêtre de 250 à 600 ms : il doit partir avant que l'œil ait lu l'eau.
    // `triangle` (un fait sur une chose), pas de traîne.
    case 'fish_bite':
      return onMe ? { wave: 'triangle', freq: 880, freqEnd: 330, dur: 0.07, gain: 0.07, lowpass: 2600 } : null
    // LA FUITE (peche.md R4) : un plouf MOU — plus bas, plus long, plus sourd que la touche. Il dit
    // « trop tard » sans punir : le raté ne coûte que l'appât. Posé sans l'entendre — au banc.
    case 'fish_escaped':
      return onMe ? { wave: 'triangle', freq: 260, freqEnd: 140, dur: 0.18, gain: 0.05, lowpass: 900 } : null
    // ÇA MORDILLE (peche.md D11/R10) : un clapotis MINUSCULE — la moitié du gain de la touche,
    // deux fois plus court, et il MONTE à peine au lieu de tomber. Il doit dire « il y a
    // quelque chose, mais ce n'est pas ça » sans jamais se confondre avec le télégraphe : si
    // l'oreille les mélange, le joueur ferre dans le vide et D11 est perdue.
    case 'fish_nibble':
      return onMe ? { wave: 'triangle', freq: 520, freqEnd: 600, dur: 0.04, gain: 0.035, lowpass: 2200 } : null
    // LA LIGNE RENTRE FAUTE D'EAU (E4) : un raclement bas et court — l'eau s'est retirée, a
    // pris, ou ne donne rien. Le bandeau dit la raison ; le son dit qu'il s'est passé quelque
    // chose, sinon la ligne disparaîtrait sans un mot.
    case 'fishing_cancelled':
      return onMe ? { wave: 'triangle', freq: 200, freqEnd: 160, dur: 0.12, gain: 0.045, lowpass: 800 } : null
    // UN RECORD (B6) : la seule voix qui MONTE de la pêche, et la seule qui s'entend de loin
    // (pas `onMe`) — la plus grosse prise de sa vie est un fait de village, pas un secret.
    case 'fish_record':
      return { wave: 'triangle', freq: 440, freqEnd: 880, dur: 0.22, gain: 0.06, lowpass: 3200 }

    /**
     * LE NŒUD MEURT — ET IL A TROIS VOIX, PAS UNE (demande d'Alexis, 2026-07-29 :
     * « un petit son de craquement lorsque l'arbre tombe comme irl »).
     *
     * Il était `muet`, et son inventaire le justifiait ainsi : « le nœud disparaît à
     * l'écran ». Cette raison est PÉRIMÉE — depuis G15 il ne disparaît plus, il TOMBE ou
     * il ÉCLATE, et un fait qui dure une seconde et demie à l'image mérite sa seconde à
     * l'oreille. C'est aussi le fait le plus RARE de la boucle de récolte (une fois tous
     * les dix coups) : le budget d'attention est disponible, à la différence du coup lui-
     * même, qui reste un `square` de 60 ms.
     *
     * LA GRAMMAIRE DE LA MAISON DONNE LE TIMBRE : `noise` est la voix de LA MATIÈRE ET DE
     * CE QUI S'EFFONDRE — c'est déjà celle de `structure_destroyed`, et un nœud qui meurt
     * est de cette famille-là. En revanche **la règle « une hauteur qui descend ferme » ne
     * s'applique PAS ici, et il ne faut pas faire semblant** : `buildSound` ignore
     * `freq`/`freqEnd` pour le bruit, et pose le coupe-bas à une fréquence FIXE. Un bruit
     * n'a pas de hauteur à faire descendre. Ce qui reste pour dire la matière, ce sont les
     * deux seules dimensions que le bruit offre — LA COUPURE et LA DURÉE :
     *
     *   L'ARBRE — le plus long et le plus PLEIN (0,5 s, coupure 1100 Hz). Assez large pour
     *     garder le grain sec du bois qui cède, assez long pour tenir sous la chute (0,76 s
     *     d'animation). C'est le seul épuisement qui a le droit de s'entendre de loin.
     *   LA PIERRE — plus court et plus SOURD (0,3 s, coupure 620 Hz) : un éboulis qui
     *     retombe, pas une explosion.
     *   LE VÉGÉTAL — bref et CLAIR (0,16 s, coupure 3200 Hz), le froissement de ce qui n'a
     *     pas de masse. À peine un son : on vide un buisson, on n'abat rien.
     *
     * CE QUE LA TABLE NE SAIT PAS DIRE, et c'est une vraie limite : un craquement réel est
     * DEUX sons — la fibre qui claque, puis la masse qui touche. Un `SoundSpec` par
     * événement n'en exprime qu'un ; on a choisi le corps de la chute. Le doubler
     * demanderait que le routage rende une SÉQUENCE, ce qui n'est pas le contrat d'aujourd'hui.
     *
     * Gains sous le plafond de 0,15 tenu par test. ⚠ Comme tout le fichier : posé SANS
     * L'ENTENDRE, à rejuger au banc d'écoute (`banc-son`), qui rend la ligne à coller ici.
     */
    case 'node_depleted':
      // ET LES TROIS VOIX PORTENT À TROIS DISTANCES — c'est ce cas qui a décidé que la puissance
      // vivait sur le SON et non sur le fait : « le seul épuisement qui a le droit de s'entendre
      // de loin » (ci-dessus) devient enfin vrai, sans que la brassée de baies en profite.
      switch (event.nodeType) {
        case 'tree':
        case 'old_tree':
          return { wave: 'noise', freq: 0, dur: 0.5, gain: 0.11, lowpass: 1100, portee: PORTEE.CRI }
        // `bloc` ET `pierre_au_sol` MANQUAIENT À L'APPEL, et personne ne pouvait l'entendre
        // (2026-08-27) : ils tombaient sur le `default` végétal — un cube de roche qu'on finit
        // de percer rendait un FROISSEMENT DE BUISSON. Le trou date de la naissance des deux
        // nœuds, après cette liste ; il est resté invisible parce que le banc, faute de savoir
        // poser un `nodeType`, ne jouait jamais que cette branche par défaut. C'est en donnant
        // enfin des oreilles au banc qu'on l'a vu — la garde qui manquait n'était pas un test,
        // c'était l'écoute. (`pierre_au_sol` s'épuise au premier ramassage, `stock: 1` : son
        // éboulis se superpose au geste, comme le veut la matière — ce n'est pas du végétal.)
        case 'rock':
        case 'bloc':
        case 'pierre_au_sol':
        case 'quarry':
        case 'iron_vein':
        case 'coal_seam':
        case 'rubble':
          return { wave: 'noise', freq: 0, dur: 0.3, gain: 0.08, lowpass: 620, portee: PORTEE.MASSE }
        default:
          return { wave: 'noise', freq: 0, dur: 0.16, gain: 0.05, lowpass: 3200, portee: PORTEE.GESTE }
      }
    case 'structure_built':
      return { wave: 'noise', freq: 0, dur: 0.12, gain: 0.06, lowpass: 800, portee: PORTEE.GESTE } // ça se pose
    case 'door_toggled':
      // ═══ LA PORTE — et pourquoi ce n'est PAS du `noise` ═══
      //
      // L'instinct dit « une porte, c'est du bois, donc de la matière, donc `noise` ». Mais la
      // grammaire de ce fichier pose le SENS comme la règle la plus forte : une hauteur qui MONTE
      // ouvre, une hauteur qui DESCEND ferme. Or c'est très exactement l'information qu'une porte
      // a à donner, et le bruit blanc ne sait pas la porter (il n'a pas de hauteur). `triangle`,
      // « un fait sur un corps ou une chose », est le timbre juste — et le passe-bas lui rend son
      // grain de bois. Le sens de la rampe n'est pas un ornement : c'est le message.
      //
      // LA DURÉE SUIT LE BATTANT (`PORTE_ANIM_MS`) — elle n'est pas écrite ici. Un grincement plus
      // court ou plus long que le geste se remarque immédiatement, et deux constantes jumelles
      // finissent toujours par se désaccorder à la première retouche.
      //
      // Le TIMBRE, lui, reste à juger d'oreille au banc (`banc-son.html`) : c'est la limite
      // assumée de tout ce fichier. Ce qui est arrêté ici, c'est la grammaire et l'accord des
      // durées ; pas la couleur exacte du grincement.
      return event.open
        ? { wave: 'triangle', freq: 165, freqEnd: 300, dur: PORTE_ANIM_MS / 1000, gain: 0.055, lowpass: 1500, portee: PORTEE.GESTE }
        : { wave: 'triangle', freq: 300, freqEnd: 120, dur: PORTE_ANIM_MS / 1000, gain: 0.075, lowpass: 620, portee: PORTEE.GESTE }
    case 'structure_destroyed':
      return { wave: 'noise', freq: 0, dur: 0.42, gain: 0.1, lowpass: 520, portee: PORTEE.LOIN } // ça s'effondre
    case 'item_crafted':
      return { wave: 'square', freq: 523, freqEnd: 659, dur: 0.1, gain: 0.05, lowpass: 2600, portee: PORTEE.GESTE }
    case 'meat_cooked':
      return { wave: 'triangle', freq: 392, freqEnd: 466, dur: 0.16, gain: 0.05, portee: PORTEE.GESTE }
    // MUETS : monter/réparer/démonter un mur, manger, semer, récolter le potager — le geste
    // est déjà sous la main et sous les yeux. On garde le budget d'attention de l'oreille.

    // ── PROGRESSION ET DÉCOUVERTE ────────────────────────────────────────────────────────
    case 'skill_level_up':
      return { wave: 'triangle', freq: 440, freqEnd: 659, dur: 0.42, gain: 0.08 }
    case 'poi_first_visit':
      return { wave: 'sine', freq: 392, freqEnd: 587, dur: 0.9, gain: 0.075 } // le monde s'ouvre
    // `poi_discovered` reste muet : redondant avec la première visite, qui, elle, se mérite.

    // ── ET LE SILENCE DÉCIDÉ ─────────────────────────────────────────────────────────────
    // Tout le reste se tait par CHOIX, pas par omission : haute fréquence (spawns, nœud vidé,
    // objet jeté), ou pure plomberie d'interface (refus — il a déjà son toast, accès d'un
    // coffre, file d'artisanat, fonction émergente). L'inventaire complet, avec ce que chaque
    // fait raconte, vit dans `inventaire.ts` et se réécoute au banc.
    default:
      return null
  }
}

/**
 * ═══ UN MÊME FAIT, DEUX FOIS DANS LE MÊME TICK : UNE SEULE VOIX ═══
 *
 * Deux faits se dédoublent légitimement dans la sim, et les superposer ne fait pas deux
 * choses — ça fait la même chose DEUX FOIS TROP FORT :
 *   `door_toggled` — un cadre apparié émet un fait PAR VANTAIL qui change (construction R27).
 *   `resource_harvested` — le butin de maîtrise émet pour la poignée PUIS pour la graine
 *     (`economy.ts`). Inaudible tant que la récolte était un bip ; depuis qu'elle est de la
 *     MATIÈRE, deux froissements superposés s'entendent — et seulement sur les meilleurs
 *     coins, c'est-à-dire là où on n'a pas envie que le jeu ait l'air cassé.
 */
export const VOIX_UNIQUE_PAR_TICK: ReadonlySet<SimEvent['type']> = new Set<SimEvent['type']>([
  'door_toggled',
  'resource_harvested',
])

/**
 * Le filtre à état qui applique la règle ci-dessus — une fonction par passage d'événements.
 * Rend `true` si ce fait doit sonner, `false` s'il double une voix DÉJÀ JOUÉE au même tick.
 *
 * ⚠ IL PREND `aUnSon`, ET C'EST TOUT L'INTÉRÊT DE L'AVOIR SORTI DE `WorldScene`. La première
 * écriture réservait le tick pour tout fait du bon type, SONORE OU NON — or les PNJ émettent
 * `resource_harvested` sans arrêt, le snapshot verse tous les faits sans les filtrer, et leur
 * récolte est muette (`onMe`). Un bûcheron du village frappant au même tick que moi avalait
 * donc MON coup de hache, par intermittence, sous forme de SILENCE. Le patron est celui que
 * tout ce fichier répète : une garde qui dégrade cache son défaut. Seul un fait qui SONNE
 * VRAIMENT consomme le tour.
 */
export function filtreDeDoublons(): (type: SimEvent['type'], tick: number, aUnSon: boolean) => boolean {
  const dernier = new Map<SimEvent['type'], number>()
  return (type, tick, aUnSon) => {
    if (!aUnSon) return false
    if (!VOIX_UNIQUE_PAR_TICK.has(type)) return true
    if (dernier.get(type) === tick) return false
    dernier.set(type, tick)
    return true
  }
}

/**
 * Monte le graphe WebAudio d'un `SoundSpec` sur `dest`, démarré à `when` (s). Enveloppe
 * attack-court / release-linéaire vers 0 (pas de clic). Réutilisable en OfflineAudioContext
 * (test) comme en live. `noise` : un buffer de bruit blanc court, filtré. Retourne les nœuds
 * pour test/cleanup ; ils s'arrêtent seuls à `when + dur`.
 */
export function buildSound(
  ctx: BaseAudioContext,
  dest: AudioNode,
  spec: SoundSpec,
  when = 0,
  place?: Placement,
): void {
  const g = ctx.createGain()
  const atk = Math.min(0.01, spec.dur * 0.2)
  // LE GAIN CRÊTE PORTE LA DISTANCE — pas un second nœud de gain en cascade : l'enveloppe
  // est déjà une rampe, la multiplier à la source garde UN seul endroit où le niveau se lit.
  const crete = spec.gain * (place?.gain ?? 1)
  g.gain.setValueAtTime(0, when)
  g.gain.linearRampToValueAtTime(crete, when + atk)
  g.gain.linearRampToValueAtTime(0, when + spec.dur)

  let src: AudioScheduledSourceNode
  if (spec.wave === 'noise') {
    const frames = Math.max(1, Math.floor(ctx.sampleRate * spec.dur))
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    // Bruit blanc déterministe (LCG) — pas de Math.random : reproductible, testable.
    let s = 0x2545f491
    for (let i = 0; i < frames; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff
      data[i] = (s / 0x40000000 - 1) * 0.9
    }
    const node = ctx.createBufferSource()
    node.buffer = buffer
    src = node
  } else {
    const osc = ctx.createOscillator()
    osc.type = spec.wave
    osc.frequency.setValueAtTime(spec.freq, when)
    if (spec.freqEnd !== undefined) osc.frequency.linearRampToValueAtTime(spec.freqEnd, when + spec.dur)
    src = osc
  }

  // LE VOILE DE DISTANCE ET CELUI DU TIMBRE NE SE CASCADENT PAS : on garde la coupure la
  // PLUS BASSE, dans le filtre unique qui existait déjà. Deux passe-bas en série donneraient
  // une pente de 24 dB/octave là où `sound.ts` en a écrit une de 12 — le timbre de près
  // cesserait d'être celui qu'on cale au banc, et ce n'est pas ce qu'on cherche à changer.
  const coupe = Math.min(spec.lowpass ?? Infinity, place?.lowpass ?? Infinity)
  if (Number.isFinite(coupe)) {
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = coupe
    src.connect(filter)
    filter.connect(g)
  } else {
    src.connect(g)
  }

  // LE PANORAMIQUE EN BOUT DE CHAÎNE, et seulement s'il y a un lieu : sans `place`, le graphe
  // est EXACTEMENT celui d'avant (un son de monde — la nuit, la saison — n'a pas de côté).
  let tail: AudioNode = g
  if (place && typeof (ctx as { createStereoPanner?: unknown }).createStereoPanner === 'function') {
    const panner = ctx.createStereoPanner()
    panner.pan.value = place.pan
    g.connect(panner)
    tail = panner
  }
  tail.connect(dest)
  src.start(when)
  src.stop(when + spec.dur)
}
