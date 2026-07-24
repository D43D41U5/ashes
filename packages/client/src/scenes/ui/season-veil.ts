/**
 * LE VOILE DE FIN DE SAISON — le climax enfin rendu (finition GATE 1, 2026-07-23).
 *
 * Au jour 61, `season_ended` portait ses verdicts… et le client les JETAIT : il ouvrait
 * de force le panneau chronique Phaser (26 lignes de texte brut). Le climax du jeu — « une
 * vallée de 60 jours qu'on perd » — n'avait aucune cérémonie, là où la MORT en a une superbe
 * (`death-veil.ts`). Ce voile lui en donne une, SŒUR du voile de mort et issue d'un vote de
 * design multi-agents (« stèle » / « aube » / « verdict »), dont on retient :
 *  - une cérémonie TERMINALE (pas de retrait auto : on ne quitte pas avant d'avoir lu le
 *    verdict — contrairement au voile de mort, temporisé) ;
 *  - un fond CHAUD, pas gris : le voile de mort DRAINE la couleur (deuil d'une personne) ;
 *    ici on VEILLE un monde — cendres chaudes, la braise du dernier Feu en bas ;
 *  - le verdict DU JOUEUR couronné (archétype nommé + le `outcome` que le /sim écrit déjà),
 *    les voisins en contrepoint sobre ;
 *  - la couleur DIÉGÉTIQUE de l'alignement (`warmthColor` : Foyer bleu ↔ neutre blanc ↔
 *    Meute rouge — la teinte qu'a brûlée SON Feu tout l'hiver), jamais le gel (=froid) ni
 *    l'alerte (=erreur) ;
 *  - AUCUN serif (le jeu est en mono, `typography.test` l'exige) : la gravité vient de la
 *    braise dorée, de la taille et de l'interlettrage — comme le voile de mort ;
 *  - la chronique (le vrai trophée, GDD §2 « seules passent les Mémoires ») tenue DANS la
 *    stèle, dépliable, rendue à ses trois poids (battement/récit/intime) ;
 *  - une révélation par battements en CSS pur (délais, jamais de timer JS), les gestes
 *    dévoilés en DERNIER — on lit avant de pouvoir partir.
 *
 * Rendu en DOM sur `document.body` (comme le voile de mort) — PAS sur la planche du HUD,
 * qui est `transform`-scalée. Purement présentationnel : la sim a fini la saison.
 */
import type { ChronicleEntry } from '@braises/sim'
import type { SeasonVerdict } from '../../hud-state'
import { warmthColor } from '../../render/lighting'
import { reopenFreshVeillee } from './reopen-veillee'
import { ensureGameFont, GAME_FONT } from './game-font'

/** `0xrrggbb` (Phaser) → `#rrggbb` (CSS). */
function hex(col: number): string {
  return '#' + col.toString(16).padStart(6, '0')
}

/** La teinte DIÉGÉTIQUE d'un archétype = la couleur qu'a brûlée son Feu (warmthColor) :
 *  Foyer chaud → bleu ; Meute prédatrice → rouge ; neutre → blanc. La langue que le joueur
 *  a lue à l'horizon tout l'hiver (« a viré au bleu / au rouge »), pas un accent neuf. */
function archetypeColor(a: SeasonVerdict['archetype']): string {
  return hex(warmthColor(a === 'foyer' ? 100 : a === 'meute' ? -100 : 0))
}

/** Le label possessif du verdict couronné, résolu de l'archétype (registre VOUS, comme le voile de mort). */
const CROWN_LABEL: Record<SeasonVerdict['archetype'], string> = {
  foyer: 'VOTRE FOYER',
  meute: 'VOTRE MEUTE',
  neutre: 'VOTRE VILLAGE',
}

export interface SeasonVeil {
  /** La saison est finie : lève la stèle avec les verdicts, le mien (couronné) et la chronique.
   *  Terminale — elle reste jusqu'à ce que le joueur ROUVRE la vallée. */
  show(verdicts: SeasonVerdict[], myVillageId: number | null, chronicle: readonly ChronicleEntry[]): void
  destroy(): void
}

export function createSeasonVeil(): SeasonVeil {
  // La police du jeu, POSÉE et pas héritée : ce voile monte sur `document.body`, qui n'en
  // déclare aucune — un `inherit` y récupérait la serif par défaut du navigateur.
  ensureGameFont()
  // Idempotent (rebuild de scène / HMR) : un voile résiduel est retiré avant d'en poser un neuf.
  document.querySelectorAll('.season-veil').forEach((n) => n.remove())
  const root = document.createElement('div')
  root.className = 'season-veil'
  root.innerHTML = `
  <style>
    .season-veil{position:fixed;inset:0;z-index:80;display:none;align-items:center;justify-content:center;
      opacity:0;transition:opacity .7s ease;pointer-events:auto;overflow-y:auto;padding:40px 0;
      background:rgba(20,16,12,.94);
      -webkit-backdrop-filter:sepia(.18) saturate(.5) brightness(.66);
      backdrop-filter:sepia(.18) saturate(.5) brightness(.66);font-family:${GAME_FONT};}
    .season-veil.sv-on{opacity:1;}
    /* La dernière chaleur : la braise du Feu qui a tenu, en bas. */
    .sv-glow{position:fixed;left:50%;bottom:0;transform:translateX(-50%);width:1000px;height:460px;
      pointer-events:none;background:radial-gradient(ellipse at bottom,rgba(201,139,58,.20),transparent 68%);
      animation:sv-breath 5s ease-in-out infinite;}
    @keyframes sv-breath{0%,100%{opacity:.82;}50%{opacity:1;}}
    .sv-card{position:relative;text-align:center;max-width:720px;margin:auto;padding:0 44px;}
    .sv-eyebrow{font-size:12px;color:#c98b3a;letter-spacing:4px;}
    .sv-title{font-size:30px;font-weight:700;color:#c98b3a;letter-spacing:6px;margin-top:16px;line-height:1.3;
      text-shadow:0 2px 0 #14141a,0 0 18px rgba(201,139,58,.25);}
    .sv-div{width:80px;height:1px;background:#6b5a3a;margin:26px auto;}
    .sv-body{font-size:15px;color:#e8e0c8;line-height:1.7;max-width:520px;margin:0 auto;}
    /* Le couronnement du joueur : une plaque, plinthe braise au-dessus et en-dessous. */
    .sv-you{margin:36px auto 0;max-width:560px;padding:22px 0;border-top:2px solid #c98b3a;border-bottom:1px solid #6b5a3a;}
    .sv-you-label{font-size:12px;color:#c98b3a;letter-spacing:4px;}
    .sv-you-name{font-size:26px;font-weight:700;letter-spacing:1px;margin-top:8px;}
    .sv-you-outcome{font-size:15px;color:#e8e0c8;line-height:1.6;margin-top:10px;}
    .sv-nb-head{font-size:12px;color:#c98b3a;letter-spacing:4px;margin:34px 0 14px;}
    .sv-nb{font-size:14px;color:#9a8f78;line-height:1.95;letter-spacing:.3px;}
    .sv-nb .sv-dot{display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:10px;vertical-align:middle;}
    /* La chronique — le trophée, dépliable, à ses trois poids. */
    .sv-chronicle{display:none;margin:26px auto 0;max-width:560px;max-height:38vh;overflow-y:auto;text-align:left;
      padding:18px 20px;background:rgba(20,16,12,.6);border:1px solid #2a2a34;}
    .sv-cl{font-size:13px;line-height:1.7;display:flex;gap:12px;}
    .sv-cl-day{flex:0 0 42px;color:#8b8474;text-align:right;}
    .sv-cl-text{flex:1;color:#e8e0c8;}
    .sv-cl.sv-battement .sv-cl-text{color:#f2ead0;border-left:2px solid #c98b3a;padding-left:10px;margin-left:-12px;}
    .sv-cl.sv-intime .sv-cl-text{font-style:italic;color:#9a8f78;}
    .sv-row{display:flex;gap:14px;justify-content:center;margin-top:34px;flex-wrap:wrap;}
    .sv-btn{background:rgba(201,139,58,.14);border:2px solid #c98b3a;color:#e8c66a;font-size:15px;font-weight:700;
      letter-spacing:2px;padding:14px 30px;transition:background .12s ease,color .12s ease;}
    .sv-btn:hover{background:rgba(232,198,106,.24);color:#f2ead0;}
    .sv-btn.sv-ghost{background:transparent;border-color:#6b5a3a;color:#9a8f78;letter-spacing:1px;font-weight:400;}
    .sv-btn.sv-ghost:hover{color:#e8e0c8;border-color:#8a7a52;background:rgba(40,34,26,.4);}
    .sv-fine{font-size:11px;color:#8b8474;letter-spacing:1px;margin-top:20px;}
    /* Révélation par battements — délais CSS, aucun timer. Les gestes en DERNIER. */
    .sv-eyebrow,.sv-title,.sv-div,.sv-body,.sv-you,.sv-neighbors,.sv-row,.sv-fine{
      opacity:0;transform:translateY(8px);transition:opacity .6s ease,transform .6s ease;}
    .season-veil.sv-on .sv-eyebrow{opacity:1;transform:none;transition-delay:.3s;}
    .season-veil.sv-on .sv-title{opacity:1;transform:none;transition-delay:.7s;}
    .season-veil.sv-on .sv-div{opacity:1;transform:none;transition-delay:1.1s;}
    .season-veil.sv-on .sv-body{opacity:1;transform:none;transition-delay:1.4s;}
    .season-veil.sv-on .sv-you{opacity:1;transform:none;transition-delay:1.8s;}
    .season-veil.sv-on .sv-neighbors{opacity:1;transform:none;transition-delay:2.3s;}
    .season-veil.sv-on .sv-row{opacity:1;transform:none;transition-delay:3s;}
    .season-veil.sv-on .sv-fine{opacity:1;transform:none;transition-delay:3.2s;}
    .sv-row{pointer-events:none;} .season-veil.sv-on .sv-row{pointer-events:auto;}
    /* Accessibilité (et horloge headless du smoke) : tout visible d'emblée, sans mouvement. */
    @media (prefers-reduced-motion: reduce){
      .sv-eyebrow,.sv-title,.sv-div,.sv-body,.sv-you,.sv-neighbors,.sv-row,.sv-fine{
        opacity:1;transform:none;transition:none;}
      .sv-row{pointer-events:auto;} .sv-glow{animation:none;}
    }
  </style>
  <div class="sv-glow"></div>
  <div class="sv-card">
    <div class="sv-eyebrow">SOIXANTE JOURS ONT PASSÉ</div>
    <div class="sv-title">LA VALLÉE S'ÉTEINT</div>
    <div class="sv-div"></div>
    <div class="sv-body">On savait la fin venue. Reste ce qu'on a tenu debout jusqu'au bout.</div>
    <div class="sv-you">
      <div class="sv-you-label"></div>
      <div class="sv-you-name"></div>
      <div class="sv-you-outcome"></div>
    </div>
    <div class="sv-neighbors">
      <div class="sv-nb-head">AILLEURS DANS LA VALLÉE</div>
      <div class="sv-nb-list"></div>
    </div>
    <div class="sv-chronicle"></div>
    <div class="sv-row">
      <button class="sv-btn sv-reopen">ROUVRIR LA VALLÉE</button>
      <button class="sv-btn sv-ghost sv-chron-toggle">relire la chronique</button>
    </div>
    <div class="sv-fine">La chronique garde le détail de ces soixante jours.</div>
  </div>`
  document.body.appendChild(root)

  const q = <T extends HTMLElement>(sel: string): T => root.querySelector<T>(sel)!
  const youLabel = q('.sv-you-label')
  const youName = q<HTMLElement>('.sv-you-name')
  const youOutcome = q('.sv-you-outcome')
  const neighbors = q('.sv-neighbors')
  const nbList = q('.sv-nb-list')
  const chronicleEl = q('.sv-chronicle')
  const chronToggle = q('.sv-chron-toggle')

  // ROUVRIR : une Veillée neuve — on efface la sauvegarde (?fresh) et on relance solo. La seed
  // étant fixe (VEILLEE_SEED), c'est la MÊME vallée qui se réveille du froid, vidée de nos marques
  // — d'où « ROUVRIR », pas « nouvelle vallée » (le libellé honnête tant que la seed ne varie pas).
  q('.sv-reopen').addEventListener('click', reopenFreshVeillee)
  // RELIRE : la chronique se déplie DANS la stèle (pas un panneau concurrent).
  chronToggle.addEventListener('click', () => {
    const open = chronicleEl.style.display === 'block'
    chronicleEl.style.display = open ? 'none' : 'block'
    chronToggle.textContent = open ? 'relire la chronique' : 'refermer la chronique'
    if (!open) chronicleEl.scrollTop = 0
  })

  return {
    show(verdicts, myVillageId, chronicle) {
      // VISIBILITÉ D'ABORD (elle ne dépend d'aucun enfant), puis on remplit — patron du voile
      // de mort. Reflow forcé avant d'armer la transition (display:none→flex avale le fondu sinon).
      root.style.display = 'flex'
      void root.offsetWidth
      root.classList.add('sv-on')

      const mine = verdicts.find((v) => v.villageId === myVillageId) ?? null
      const others = verdicts.filter((v) => v.villageId !== myVillageId)

      if (mine) {
        youLabel.textContent = CROWN_LABEL[mine.archetype]
        youName.textContent = mine.name
        youName.style.color = archetypeColor(mine.archetype)
        // On NE réécrit PAS l'outcome : le /sim l'a déjà en voix du jeu. On le grave, une majuscule.
        youOutcome.textContent = mine.outcome.charAt(0).toUpperCase() + mine.outcome.slice(1) + '.'
      } else {
        // Le joueur n'a jamais fondé de Feu : pas de verdict pour lui — on compose l'épitaphe nomade.
        youLabel.textContent = 'SEUL, SANS FEU'
        youName.textContent = ''
        youName.style.display = 'none'
        youOutcome.textContent = 'Vous avez traversé la vallée sans jamais y planter de Feu.'
      }

      // Les voisins, en contrepoint sobre : un point de leur couleur de Feu, leur outcome tel quel.
      nbList.innerHTML = ''
      for (const v of others) {
        const line = document.createElement('div')
        line.className = 'sv-nb'
        const dot = document.createElement('i')
        dot.className = 'sv-dot'
        dot.style.background = archetypeColor(v.archetype)
        line.append(dot, document.createTextNode(`${v.name} ${v.outcome}.`))
        nbList.appendChild(line)
      }
      neighbors.style.display = others.length > 0 ? '' : 'none'

      // La chronique, à ses trois poids (le jour à gauche, le texte à droite, le poids dans le style).
      chronicleEl.innerHTML = ''
      for (const e of chronicle) {
        const row = document.createElement('div')
        row.className = `sv-cl sv-${e.weight}`
        const day = document.createElement('span')
        day.className = 'sv-cl-day'
        day.textContent = `J${e.day}`
        const text = document.createElement('span')
        text.className = 'sv-cl-text'
        text.textContent = e.text
        row.append(day, text)
        chronicleEl.appendChild(row)
      }
    },
    destroy() {
      root.remove()
    },
  }
}
