/**
 * ═══ LA PASSE DES CORPS, EN GLSL — L'ADDITION DE SHADER (spec `lumiere-globale.md` LG-R7) ═══
 *
 * *« UN CORPS A LE RELIEF DE LA GI : LA LUMIÈRE DU SOL, LUE SOUS CHACUN DE SES PIXELS, RÉPARTIE
 * ENTRE SES SOURCES, CHAQUE PART DIRECTIONNELLE PASSÉE PAR SA NORMAL MAP. »*
 *
 * Ce module est le MIROIR GPU de `passe-corps.ts`, terme pour terme. La garde LG-A8 compare les deux
 * sur le même champ ; tout ce qui diverge ici est un défaut, jamais une variante.
 *
 * ═══ POURQUOI UNE « ADDITION » ET PAS UN PIPELINE ═══
 * Phaser 4.2 n'a plus de `setPipeline` : l'éclairage est un jeu d'ADDITIONS de shader nommées,
 * injectées dans les `#pragma phaserTemplate(...)` de `Multi-vert.js` / `Multi-frag.js`
 * (`BatchHandlerQuad.js:127-139`). `MakeApplyLighting` en est une :
 *
 *     { name: 'ApplyLighting',
 *       additions: { fragmentHeader: <le GLSL>, fragmentProcess: 'fragColor = applyLighting(…);' },
 *       tags: ['LIGHTING'], disable: !!disable }
 *
 * On SUBSTITUE la nôtre à la sienne dans la liste d'un nœud de rendu à nous, et on désigne ce nœud
 * par sprite (`setRenderNodeRole`) depuis `snapshot-view.ts`. Le corps ne quitte donc NI son tri en
 * profondeur, NI son lot, NI sa normal map : seule la math de la lumière change.
 *
 * ⚠ **LA LISTE NE DOIT PAS PORTER LES DEUX.** `MakeApplyLighting(true)` naît DÉSACTIVÉE et le nœud
 * l'active quand des options d'éclairage arrivent. Deux additions actives multiplieraient les deux
 * termes, et le défaut serait un corps deux fois trop clair — pas un corps noir, donc discret.
 *
 * ═══ CE QUE PHASER FAIT, ET LES TROIS TERMES QUI NOUS EN SÉPARENT ═══
 * `DefineLights-glsl.js`, `getLighting(fragColor, normal)` :
 *   · `attenuation = clamp(1 − d²/r², 0, 1)`  → **SUPPRIMÉE.** LG-R7 : « sans atténuation avec la
 *     distance (la GI la porte déjà) ». C'est `g` qui prend sa place.
 *   · `max(dot(normal, normalize(lightDir)), 0)` → **LE MÊME n·ℓ.** Et `g × n·ℓ` se réduit à
 *     `max(0, n·d)/z` avec `d` NON normalisé : aucune racine carrée, un produit scalaire, une division.
 *   · `uAmbientLightColor`, un plat pour la scène → **les TROIS PARTS**, lues au pixel dans le champ.
 *
 * ═══ LA CONVENTION DE NORMALE — UN SIGNE, NOMMÉ ═══
 * `normal-map.ts:25` pose `FLIP_G = true` (« Phaser attend le vert Y vers le haut ; notre espace a Y
 * vers le bas ») et stocke `enc(−ny)` : le vert enregistré est **Y-HAUT**. `GetNormalFromMap-glsl.js`
 * décode sans retourner quoi que ce soit. Or notre `Normale` (`sol-du-corps.ts`) est `+y` **SUD**.
 * Donc `n_loi.y = −n_phaser.y`, et c'est `SIGNE_Y_NORMALE` ci-dessous.
 *
 * ⚠ C'est une DÉDUCTION de deux lectures, pas une mesure. Sa signature d'erreur est distinctive et
 * vaut d'être écrite ici : si le signe est faux, **les faces nord et sud échangent leur clarté
 * pendant que les dessus restent exacts** — un dessus plat a `n.y = 0`, le signe ne peut pas s'y
 * voir. Une garde qui ne compare que des dessus ne verrait rien (cf. `estNonTrivial`).
 */

/** `n_loi.y = −n_phaser.y` — voir l'en-tête. Un seul endroit, et il porte sa raison. */
export const SIGNE_Y_NORMALE = -1

/**
 * ═══ LES UNIFORMES, ET CE QUI EST PAR IMAGE OU PAR SPRITE ═══
 *
 * PAR IMAGE (posés une fois) : le cadre du champ, les trois samplers, le ciel, les deux sources.
 * PAR SPRITE (posés au draw, depuis `renderNodeData`) : `uGiPied`, `uGiAncreX`, `uGiCrete`, `uGiSeuil`,
 * `uGiDresse`, `uGiExpo`.
 *
 * ⚠ **LE PAR-SPRITE EXIGE UN DRAW PAR SPRITE.** `renderNodeData` ne va PAS au fragment — mesuré :
 * un grep sur tout `phaser/src/` ne lui trouve qu'un lecteur, et c'est une initialisation à `{}`.
 * Le nœud le relit en JS et pose les uniformes ; il doit donc VIDER SON LOT entre deux corps, sinon
 * le second prend l'`arete` du premier. La garde est dans le nœud, pas ici.
 *
 * ⚠ **ET RIEN N'EST EMPAQUETÉ.** `arete·64 + crête` aurait tenu dans un flottant et coûté un
 * `floor`/`mod` au décodage, plus une erreur de bord le jour où une crête vaudrait 64. Trois
 * `uniform1f` ne pèsent rien à côté du draw qu'on paie déjà.
 */
export const UNIFORMES_CORPS = {
  /** Le champ : `L`, `directFace`, et l'ombre `S` (dans `.g`, comme `FRAG_SOMME` la lit). */
  lumiere: 'uGiL',
  faceDirecte: 'uGiF',
  ombre: 'uGiS',
  /** `vec4(x, y, gw, gh)` — l'origine du raster en px MONDE, sa taille en TEXELS (`ChampGpu.cadre`). */
  cadre: 'uGiCadre',
  /** Le pas du raster, en px monde par texel (`PX_PAR_TEXEL` = 4). */
  pas: 'uGiPas',
  /** Le ciel de l'heure : `Mn` (LG-R5), `a` (LG-R8), la luminance de l'ambiante (J). */
  mn: 'uGiMn',
  a: 'uGiA',
  ambiante: 'uGiAmbiante',
  /** Les deux sources en px MONDE, `w` = 1 si présente. `z` est la hauteur au-dessus du sol. */
  astre: 'uGiAstre',
  feu: 'uGiFeu',
  /** PAR SPRITE — `ligneDuPied(c)`, en px monde. */
  pied: 'uGiPied',
  /** PAR SPRITE — `c.x` : le feu se lit au pied À L'ANCRE, pas à l'abscisse du pixel. */
  ancreX: 'uGiAncreX',
  /** PAR SPRITE — `hauteurDeCrete(c)` : 32 / 24 / 8 (`reglages.ts:77-89`). */
  crete: 'uGiCrete',
  /** PAR SPRITE — `seuilDuDessus(c)`, en px monde : un pixel de bande nord/sud ou de socle dont le
   *  `y` est plus petit est un DESSUS. `SANS_DESSUS` pour un fût. La géométrie est calculée là-bas,
   *  jamais recomposée ici depuis `pied`, `crete` et une demi-bande. */
  seuil: 'uGiSeuil',
  /** PAR SPRITE — 1 si `suitLaRegleDesFaces(c)`, sinon 0. */
  dresse: 'uGiDresse',
  /** PAR SPRITE — 1 si `estRuban(c)` : il est dessus sur TOUTES ses rangées, sans condition de crête. */
  ruban: 'uGiRuban',
  /** PAR SPRITE — `expositionAuFeu(c, feu)`, ou **−1** pour son `null` (« sous le pixel »). */
  expo: 'uGiExpo',
  /**
   * PAR IMAGE — l'inverse de `camera.matrixCombined`, les six coefficients de `getWorldPoint`
   * (`BaseCamera.js:876-914`) : `invA = (ima, imb, imc, imd)`, `invB = (ime, imf)`.
   * Le nœud les calcule dans `setupUniforms(drawingContext)`, au même endroit et depuis les mêmes
   * entrées que Phaser pour ses `uLights[].position` (`Utils.js:221-245`).
   */
  invA: 'uGiInvA',
  invB: 'uGiInvB',
} as const

/**
 * ═══ LE FRAGMENT — `appliquerGi(fragColor, normal)` ═══
 *
 * L'ORDRE EST CELUI DE `pixelDuCorps`, et chaque bloc renvoie à son pas :
 *   ① `pointAuSol` — le plat et l'astre se lisent SOUS LE PIXEL (E) ; sur un dessus, une hauteur de
 *      crête plus bas. La crête est sous le BAS DE LA BANDE, pas sous la ligne (`auDessusDeLaCrete`).
 *   ② `partsDuCorps` en ce point — la répartition, avec le `S` et le champ de CE point.
 *   ③ `lectureDuFeu` — nulle sur un dessus (LG-R16) ; au pied fois l'exposition sur une face
 *      dressée (O) ; sous le pixel partout ailleurs (E).
 *   ④ les deux facteurs de normale, puis la composition et son écrêtage à deux niveaux.
 */
const APPLIQUER_GI = `
uniform sampler2D uGiL;
uniform sampler2D uGiF;
uniform sampler2D uGiS;
uniform vec4 uGiCadre;
uniform float uGiPas;
uniform vec3 uGiMn;
uniform float uGiA;
uniform float uGiAmbiante;
uniform vec4 uGiAstre;
uniform vec4 uGiFeu;
uniform float uGiPied;
uniform float uGiAncreX;
uniform float uGiCrete;
uniform float uGiSeuil;
uniform float uGiDresse;
uniform float uGiRuban;
uniform float uGiExpo;
uniform vec4 uGiInvA;
uniform vec2 uGiInvB;

// ⚠ NI \`uCamera\` NI \`uNormSampler\` NE SE DÉCLARENT ICI — \`MakeDefineLights\` les déclare déjà, et
// le nœud DOIT le garder : c'est de lui que \`getNormalFromMap\` tire son \`uNormSampler\`. Seule
// \`MakeApplyLighting\` se désarme. Une redéclaration serait une erreur de compilation de SHADER,
// que \`tsc\` ne peut pas voir — relevé en relisant, pas par la chaîne.
// \`uResolution\`, lui, vaut \`[drawingContext.width, drawingContext.height]\` — posé par
// \`BatchHandlerQuad.js:283\`, donc EXACTEMENT le \`height\` qu'\`Utils.js:183\` prend sur le même
// contexte, et il suit la cible réellement liée.

// ─── LE MONDE SOUS LE FRAGMENT ───
//
// ⚠ **CETTE FONCTION A ÉTÉ FAUSSE, ET DE LA PIRE MANIÈRE.** Je l'avais écrite
// \`uCamera.x + gl_FragCoord.x / zoom\`, en lisant \`uCamera.xy\` comme « le coin monde » d'après son
// commentaire \`/* x, y, rotation, zoom */\`. Deux mesures l'abattent :
//   · \`DefineLights.glsl\` — le SEUL consommateur de cet uniforme dans tout Phaser — ne lit jamais
//     \`.xy\` : ses quatre occurrences portent sur \`.w\`, le zoom.
//   · \`camera.x\` est le VIEWPORT, pas le scroll (\`BaseCamera.js:200-201\` : « To adjust the
//     position the camera is looking at in the game world, see the \`scrollX\` value »). Il vaut 0.
// Le scroll manquait donc EN ENTIER : pas une couture d'un texel, le champ lu à des centaines de
// pixels du corps dès que la caméra bouge — et « presque juste » à la caméra centrée sur le spawn.
//
// La vraie conversion vit dans \`Utils.js:221-245\` : \`matrixCombined\` appliquée au point monde,
// puis \`height - y\`. On en prend l'INVERSE, transcrit de \`getWorldPoint\` (\`BaseCamera.js:876\`)
// et non réinventé — exact sous zoom, sous scroll ET sous rotation, ce qu'aucune des trois
// n'était. Les six coefficients arrivent tout inversés du nœud : le fragment ne divise rien.
//
// Et le facteur de scroll ne corrige rien ici : \`copyWithScrollFactorFrom\`
// (\`TransformMatrix.js:709-713\`) pose \`sx = scrollX × (1 − scrollFactorX)\`, nul au facteur **1**
// qui est celui de tout objet du monde, donc de tout corps. La matrice est \`matrixCombined\` nue.
//
// \`gl_FragCoord\` tombe au CENTRE du pixel ; \`uResolution.y - gl_FragCoord.y\` rend le centre du
// même pixel en Y-bas, la convention de \`getWorldPoint\`. Aucun demi-pixel à rattraper.
vec2 mondeDuFragment() {
  float x = gl_FragCoord.x;
  float y = uResolution.y - gl_FragCoord.y;
  return vec2(x * uGiInvA.x + y * uGiInvA.z + uGiInvB.x,
              x * uGiInvA.y + y * uGiInvA.w + uGiInvB.y);
}

// ─── UNE PRISE DE TEXEL DANS LE CHAMP ───
// Le champ est en TEXELS (un texel = \`uGiPas\` px monde, LG-R2) et sa rangée 0 est au NORD —
// la même convention que \`uvCible\` de \`champ-gpu\`, et pour la même raison.
//
// ⚠ **\`floor\` D'ABORD — ET C'EST LA GARDE LG-A8 QUI L'A VU (2026-09-18).** Le texel \`i\` couvre
// \`[cadre.x + i·pas, cadre.x + (i+1)·pas)\` : c'est ce que dessine le quad de sol (\`champ-gpu\`,
// \`setPosition(ox·pas, oy·pas)\` puis \`setDisplaySize(gw·pas, gh·pas)\`) et ce que lit l'oracle.
// \`uvCible\` reçoit un INDEX entier et le centre d'un \`+0.5\` ; ici \`t\` est FRACTIONNAIRE, et
// \`(t + 0.5) / taille\` lu en NEAREST rendait \`round(t)\` — le champ lu un demi-texel (2 px) au
// sud-est du sol sous le corps. Invisible en plein champ, franc à la LISIÈRE d'une ombre : au pied
// d'une face dressée, le fragment lisait la bande d'ombre du mur (S = 1, lumière nulle) là où le sol
// sous lui était éclairé — \`st-wall-ruine-e4\`, 126 niveaux au pire, et l'avatar près du feu
// uniformément plus sombre de 7 niveaux (smoke \`gi\`, avant correction).
vec2 uvDuChamp(vec2 monde) {
  vec2 t = floor((monde - uGiCadre.xy) / uGiPas);
  return vec2((t.x + 0.5) / uGiCadre.z, 1.0 - (t.y + 0.5) / uGiCadre.w);
}

// ─── ② LA RÉPARTITION EN TROIS PARTS (LG-R7) ───
// Décalque de \`partsDuCorps\` (\`corps-ref.ts:141\`). Le \`continue\` de la boucle par canal devient
// un ternaire : ici les trois canaux se calculent ensemble, et un \`somme <= 0\` doit rendre zéro
// SUR CE CANAL, pas sortir de la fonction.
void partsDuCorps(vec3 light, vec3 directFace, float s,
                  out vec3 pAstre, out vec3 pFeu, out vec3 pPlat) {
  vec3 platDuCiel = uGiMn * (1.0 - uGiA);
  float lumPlat = dot(platDuCiel, vec3(0.299, 0.587, 0.114));
  // LE RABAT SUR L'AMBIANTE — en luminance, à la couleur du voile (LG-R7, J). Elle RABAT le
  // plancher, jamais ne le lève.
  if (lumPlat > 0.0 && uGiAmbiante < lumPlat) platDuCiel *= uGiAmbiante / lumPlat;

  vec3 l = clamp(light, 0.0, 1.0);
  // \`directFace\` ne peut pas dépasser \`light\` : c'en est une PART. Les deux viennent de deux
  // cibles distinctes, donc l'arrondi peut les croiser d'un niveau — on le referme ici.
  vec3 df = clamp(directFace, vec3(0.0), l);
  vec3 x = uGiMn * (1.0 - uGiA * s);
  vec3 somme = x + l;
  vec3 m = min(vec3(1.0), 1.0 - (1.0 - x) * (1.0 - l));
  vec3 sigma = mix(vec3(0.0), m / max(somme, vec3(1.0e-6)), step(vec3(1.0e-6), somme));

  pAstre = sigma * uGiMn * uGiA * (1.0 - s);
  pFeu   = sigma * df;
  pPlat  = sigma * (platDuCiel + l - df);
}

// ─── ④ LE FACTEUR DE NORMALE, ET SA PORTÉE \`g\` (LG-R7) ───
// \`g × n·ℓ = (|d|/z)(n·d/|d|) = max(0, n·d)/z\`, \`d\` NON normalisé. Vaut EXACTEMENT 1 sur un
// dessus plat — « de sorte qu'un dessus plat reçoit exactement sa part ».
float facteurDeNormale(vec3 n, vec2 p, vec4 src) {
  if (src.w < 0.5 || src.z <= 0.0) return 0.0;
  float d = n.x * (src.x - p.x) + n.y * (src.y - p.y) + n.z * src.z;
  return max(d, 0.0) / src.z;
}

vec4 appliquerGi(vec4 fragColor, vec3 normalPhaser) {
  // ⚠ **PAS DE CHAMP, PAS DE GI — ET LA GARDE EST ICI, VISIBLE DU SHADER.**
  // Un corps peut être armé AVANT que \`WorldScene\` n'ait poussé le champ de la première image.
  // Sans cette ligne, le défaut serait odieux : les trois samplers garderaient leur valeur par
  // défaut **0** — c'est-à-dire l'unité 0, LA TEXTURE DU SPRITE LUI-MÊME — pendant que \`uGiCadre\`
  // nul ferait diviser \`uvDuChamp\` par zéro. Le corps s'échantillonnerait donc lui-même à travers
  // un UV NaN, et la signature se lirait « le shader de GI est cassé » au lieu de « le champ n'a pas
  // été poussé ». C'est exactement la forme auto-dissimulante attrapée sur le ruban.
  // \`uGiCadre.z\` est la LARGEUR du raster en texels : strictement positive dès qu'un champ existe.
  if (uGiCadre.z <= 0.0) return fragColor;

  // La normale, dans LE REPÈRE DE LA LOI : +x est, +y SUD, +z haut (voir l'en-tête).
  vec3 n = vec3(normalPhaser.x, ${SIGNE_Y_NORMALE}.0 * normalPhaser.y, normalPhaser.z);

  vec2 monde = mondeDuFragment();

  // ① LE POINT AU SOL. Le seuil du dessus arrive CALCULÉ (\`seuilDuDessus\`, \`uGiSeuil\`) : pour une
  // bande, la crête sous le BAS DE LA BANDE ; pour un socle, sa couronne ; jamais pour un fût.
  // Le prédicat est NOMMÉ là-bas parce que le relire sur le résultat est faux d'un rang par bande
  // (rang 2 au nord, 18 au sud ; \`sol-du-corps.ts\`, \`auDessusDeLaCrete\`).
  //
  // ⚠ **LE RUBAN EST DESSUS SUR TOUTES SES RANGÉES** (\`estDessus\` : \`estRuban(c) ? true : …\`).
  // Je l'avais perdu, et le défaut était SOURNOIS : \`expositionAuFeu\` rend \`null\` sur un ruban,
  // donc \`uGiExpo\` vaut −1 et la branche du feu se saute — LE FEU SORTAIT JUSTE PAR ACCIDENT.
  // Mais \`p\` tombait sur le point de FACE, et le plat et l'astre lisaient le mauvais texel du
  // champ. Qui « réparerait » ça en touchant au feu déplacerait le défaut au lieu de le corriger.
  bool dessus = uGiDresse > 0.5 && (uGiRuban > 0.5 || monde.y < uGiSeuil);
  vec2 p = dessus ? vec2(monde.x, monde.y + uGiCrete) : vec2(monde.x, uGiPied);

  // ② LA RÉPARTITION, au point lu.
  vec2 uvP = uvDuChamp(p);
  vec3 pAstre, pFeu, pPlat;
  partsDuCorps(texture2D(uGiL, uvP).rgb, texture2D(uGiF, uvP).rgb, texture2D(uGiS, uvP).g,
               pAstre, pFeu, pPlat);

  // ③ LA PART DIRECTE DU FEU — les trois branches de \`lectureDuFeu\`, dans leur ordre.
  // Un DESSUS l'emporte sur l'orientation (LG-R16) : rien de direct n'y monte. Une face dressée
  // lit AU PIED, à l'ANCRE du sprite — \`uGiAncreX\`, jamais \`monde.x\` : un facteur par sprite et
  // par source, pas un dégradé le long de la longueur (planche 8, ratifiée).
  if (dessus) {
    pFeu = vec3(0.0);
  } else if (uGiExpo >= 0.0) {
    vec2 uvPied = uvDuChamp(vec2(uGiAncreX, uGiPied));
    vec3 aAstre, aFeu, aPlat;
    partsDuCorps(texture2D(uGiL, uvPied).rgb, texture2D(uGiF, uvPied).rgb,
                 texture2D(uGiS, uvPied).g, aAstre, aFeu, aPlat);
    // UNE SUBSTITUTION, JAMAIS UNE SOUSTRACTION (\`avecFeuDeLaFace\`) : le plat et l'astre restent
    // ceux du pixel. Soustraire est ce qui avait tourné les rubans au sarcelle.
    pFeu = aFeu * uGiExpo;
  }

  // ④ LES DEUX FACTEURS — au POINT LU pour les deux sources, même quand la part vient du pied
  // (\`planche9.mjs:177\`). Confondre les deux donnerait à toute une face le \`g\` de son pied.
  float fA = facteurDeNormale(n, p, uGiAstre);
  float fF = facteurDeNormale(n, p, uGiFeu);

  // LA COMPOSITION, ET SON ÉCRÊTAGE À DEUX NIVEAUX (\`planche9.mjs:115, 183-184, 186\`) :
  // chaque terme directionnel écrêté, puis le total. HAUT seulement — rien ici ne peut être négatif.
  vec3 t = fragColor.rgb;
  vec3 direct = min(vec3(1.0), t * pAstre * fA) + min(vec3(1.0), t * pFeu * fF);
  return vec4(min(vec3(1.0), t * pPlat + direct), fragColor.a);
}
`

/**
 * L'ADDITION, à substituer à `MakeApplyLighting` dans la liste d'un nœud de rendu à nous.
 *
 * ⚠ `disable` suit la convention de Phaser : une addition naît DÉSACTIVÉE et le nœud l'arme quand
 * l'éclairage entre en jeu. C'est ce qui permet à l'interrupteur GI de la couper sans reconstruire
 * le nœud — et ce qui fait qu'elle ne doit JAMAIS coexister, armée, avec celle de Phaser.
 */
export function faireAdditionCorps(desactivee?: boolean): {
  name: string
  additions: { fragmentHeader: string; fragmentProcess: string }
  tags: string[]
  disable: boolean
} {
  return {
    name: 'ApplyGiCorps',
    additions: {
      fragmentHeader: APPLIQUER_GI,
      fragmentProcess: 'fragColor = appliquerGi(fragColor, normal);',
    },
    tags: ['LIGHTING'],
    disable: !!desactivee,
  }
}

/** Le texte GLSL, pour qui veut le lire ou le comparer (la garde LG-A8, une planche). */
export const GLSL_CORPS = APPLIQUER_GI
