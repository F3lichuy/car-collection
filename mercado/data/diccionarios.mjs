// Diccionarios del normalizador (Fase 3). Todo en minúsculas y sin acentos;
// el normalizador aplica norm() al texto antes de comparar.

// ── Transmisión ─────────────────────────────────────────────────────────
// Orden importa: se prueba de arriba abajo y gana la primera coincidencia.
export const TRANSMISSION = [
  ['pdk', [/\bpdk\b/, /doppelkupplung/]],
  ['automatizada', [/\be-?gear\b/, /\bisr\b/, /sportshift/, /\bsmg\b/, /sportomatic/, /automatizad/, /secuencial/]],
  ['dct', [/\bdct\b/, /doble embrague/, /dual[- ]clutch/, /\bssg\b/, /\bldf\b/, /\bdkg\b/]],
  ['f1', [/\bf1\b/, /caja f1/, /\bf-1\b/]],
  ['manual', [/\bmanual\b/, /\bestandar\b/, /\bstd\b/, /\bmt\b/, /\b[67] ?mt\b/, /\bstandard\b/, /stick/, /\bmecanic[oa]\b/, /\b[567] vel(ocidades)?\.? manual/]],
  ['automatica', [/\bautomatic[oa]\b/, /\btiptronic\b/, /\btriptonic\b/, /\bat\b/, /\baut\b/, /\bautomatic\b/, /\bauto\b/, /\bsteptronic\b/, /\bspeedshift\b/, /\b9g\b/, /\bmct\b/]],
];

// ── Colores ─────────────────────────────────────────────────────────────
// Familias genéricas (es / en / it / de)
export const COLOR_FAMILY = [
  ['negro', ['negro', 'negra', 'black', 'nero', 'schwarz', 'onyx', 'obsidian', 'ebony']],
  ['blanco', ['blanco', 'blanca', 'white', 'bianco', 'weiss', 'perla', 'pearl']],
  ['plata', ['plata', 'plateado', 'plateada', 'silver', 'argento', 'silber']],
  ['gris', ['gris', 'grey', 'gray', 'grigio', 'grau', 'grafito', 'graphite', 'titanio', 'titanium', 'gunmetal', 'chalk', 'crayon']],
  ['rojo', ['rojo', 'roja', 'red', 'rosso', 'rot', 'vino', 'guinda', 'burgundy', 'carmine', 'carmin']],
  ['azul', ['azul', 'blue', 'blu', 'blau', 'marino', 'navy']],
  ['verde', ['verde', 'green', 'grun', 'olivo', 'olive']],
  ['amarillo', ['amarillo', 'amarilla', 'yellow', 'giallo', 'gelb']],
  ['naranja', ['naranja', 'orange', 'arancio', 'papaya']],
  ['morado', ['morado', 'morada', 'purple', 'viola', 'violeta', 'lila']],
  ['cafe', ['cafe', 'marron', 'brown', 'chocolate', 'tabaco', 'cognac', 'coñac', 'havana', 'espresso', 'bronce', 'bronze']],
  ['beige', ['beige', 'arena', 'crema', 'cream', 'sand', 'hueso', 'champagne', 'champan', 'tan', 'camel']],
  ['dorado', ['dorado', 'dorada', 'gold', 'oro']],
  ['rosa', ['rosa', 'pink']],
];

// Nombres de fábrica → [nombre canónico, familia]. Se buscan primero.
export const FACTORY_COLORS = [
  // Porsche
  ['gt silver', 'GT Silver', 'plata'], ['gt silver metallic', 'GT Silver', 'plata'], ['guards red', 'Guards Red', 'rojo'], ['rojo indio', 'Guards Red', 'rojo'],
  ['carrara white', 'Carrara White', 'blanco'], ['blanco carrara', 'Carrara White', 'blanco'], ['chalk', 'Chalk', 'gris'], ['crayon', 'Crayon', 'gris'],
  ['shark blue', 'Shark Blue', 'azul'], ['python green', 'Python Green', 'verde'], ['lava orange', 'Lava Orange', 'naranja'],
  ['miami blue', 'Miami Blue', 'azul'], ['mexico blue', 'Mexico Blue', 'azul'], ['riviera blue', 'Riviera Blue', 'azul'],
  ['gentian blue', 'Gentian Blue', 'azul'], ['racing yellow', 'Racing Yellow', 'amarillo'], ['jet black', 'Jet Black', 'negro'],
  ['arctic grey', 'Arctic Grey', 'gris'], ['agate grey', 'Agate Grey', 'gris'], ['ruby star', 'Ruby Star', 'rojo'],
  ['signal green', 'Signal Green', 'verde'], ['oak green', 'Oak Green', 'verde'], ['ice grey', 'Ice Grey', 'gris'],
  ['aventurine green', 'Aventurine Green', 'verde'], ['gulf blue', 'Gulf Blue', 'azul'], ['acid green', 'Acid Green', 'verde'],
  // Ferrari
  ['rosso corsa', 'Rosso Corsa', 'rojo'], ['rosso scuderia', 'Rosso Scuderia', 'rojo'], ['rosso mugello', 'Rosso Mugello', 'rojo'],
  ['giallo modena', 'Giallo Modena', 'amarillo'], ['blu pozzi', 'Blu Pozzi', 'azul'], ['blu tour de france', 'Blu Tour de France', 'azul'],
  ['nero daytona', 'Nero Daytona', 'negro'], ['bianco avus', 'Bianco Avus', 'blanco'], ['bianco cervino', 'Bianco Cervino', 'blanco'],
  ['grigio silverstone', 'Grigio Silverstone', 'gris'], ['grigio titanio', 'Grigio Titanio', 'gris'], ['grigio alloy', 'Grigio Alloy', 'gris'],
  ['argento nurburgring', 'Argento Nürburgring', 'plata'], ['verde british', 'Verde British', 'verde'], ['rosso fiorano', 'Rosso Fiorano', 'rojo'],
  // Lamborghini
  ['verde mantis', 'Verde Mantis', 'verde'], ['arancio borealis', 'Arancio Borealis', 'naranja'], ['giallo orion', 'Giallo Orion', 'amarillo'],
  ['grigio telesto', 'Grigio Telesto', 'gris'], ['bianco monocerus', 'Bianco Monocerus', 'blanco'], ['nero noctis', 'Nero Noctis', 'negro'],
  ['blu cepheus', 'Blu Cepheus', 'azul'], ['giallo inti', 'Giallo Inti', 'amarillo'], ['grigio lynx', 'Grigio Lynx', 'gris'],
  // McLaren
  ['papaya spark', 'Papaya Spark', 'naranja'], ['volcano yellow', 'Volcano Yellow', 'amarillo'], ['silica white', 'Silica White', 'blanco'],
  ['storm grey', 'Storm Grey', 'gris'], ['onyx black', 'Onyx Black', 'negro'], ['ventura orange', 'Ventura Orange', 'naranja'],
];

// "Paint to Sample" y equivalentes de otras marcas
export const PAINT_TO_SAMPLE = [/paint to sample/, /\bpts\b/, /tailor made/, /ad personam/, /\bmso\b/, /pintura especial/, /color especial de fabrica/];

// ── Atributos mexicanos (se buscan en título + descripción) ──────────────
export const INVOICE = [
  ['aseguradora', [/factura (de |por )?(la )?aseguradora/, /factura de seguro/, /recuperad[oa] (de|por) (la )?aseguradora/, /\bsalvamento\b/]],
  ['refacturado', [/refactur/, /factura de (lote|empresa|persona moral|arrendadora)/, /segunda factura/]],
  ['agencia', [/factura (original )?de agencia/, /factura (de )?origen/, /factura original/, /primera factura/, /\bfactura agencia\b/]],
];
export const ORIGIN = [
  ['legalizado', [/legalizad/, /\bregularizad/, /\bonapafa\b/, /decreto de regularizacion/, /chocolate/]],
  ['fronterizo', [/fronteriz/, /placas? de frontera/, /\bzona libre\b/]],
  ['importado', [/importad[oa] (de|desde)/, /\bimportacion definitiva\b/, /\bpedimento\b/, /\bimportad[oa]\b/]],
  ['nacional', [/\bnacional\b/, /vendido en mexico/, /agencia mexicana/, /origen nacional/]],
];
export const OWNERS = [
  [1, [/unic[oa] (y primer )?due[nñ]o/, /\b1 due[nñ]o/, /primer due[nñ]o/, /\bun solo due[nñ]o/, /one owner/]],
  [2, [/\b2 due[nñ]os/, /segundo due[nñ]o/, /dos due[nñ]os/]],
  [3, [/\b3 due[nñ]os/, /tercer due[nñ]o/, /tres due[nñ]os/]],
];
export const SERVICE = [
  ['agencia_completo', [/todos (los )?servicios (de|en) (la )?agencia/, /servicios (de|en) agencia (al dia|completos)/, /historial (completo )?de agencia/, /servicios? de agencia\b/, /servicios en agencia/]],
  ['agencia_parcial', [/algunos servicios (de|en) agencia/, /servicios parciales/]],
  ['taller_externo', [/servicios? en taller/, /taller especializado/]],
];
export const ANTIQUE_PLATES = [/placas? (de )?(auto )?antigu/, /placas? de clasico/, /placa de auto antiguo/];

// Modelos de estas marcas que están FUERA de la taxonomía a propósito: si el
// anuncio los menciona, se descarta antes de buscar versión (evita que
// "Cayenne Turbo" termine como 911 Turbo).
export const OUT_OF_SCOPE_MODELS = {
  porsche: ['cayenne', 'macan', 'panamera', 'taycan', '924', '944', '968', '914'],
  ferrari: ['roma', 'portofino', 'california', 'purosangue', '12cilindri', 'gtc4lusso', 'ff', '599', '612', '550', '575', 'mondial', '348', '208', '400', '456', 'enzo', 'laferrari', 'f40', 'f50', 'amalfi'],
  lamborghini: ['revuelto', 'temerario', 'jalpa', 'espada', 'miura', 'islero', 'jarama', 'urraco', 'lm002'],
  mclaren: ['senna', 'p1', 'elva', 'speedtail', 'w1', 'sabre'],
  'aston-martin': ['db12', 'vanquish', 'rapide', 'db9', 'db7', 'virage', 'valkyrie', 'vanquish'],
  bentley: ['flying spur', 'mulsanne', 'arnage', 'azure', 'brooklands'],
  'rolls-royce': ['phantom', 'dawn', 'spectre', 'silver shadow', 'silver spur', 'silver cloud', 'corniche'],
};

// Frases que significan precio a negociar.
export const NEGOTIABLE = [/a tratar/, /negociable/, /\bescucho ofertas\b/, /\bprecio a convenir\b/, /\bconsulte?\b.*precio/, /\bprecio en privado\b/];
