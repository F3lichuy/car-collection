// ════════════════════════════════════════════════════════════════════════
// Mercado MX · Taxonomía curada: marca > modelo > generación > versión
//
// Fuente única: de aquí salen supabase/mercado/002_taxonomia.sql
// (npm run build:taxonomia) y, en la Fase 3, los diccionarios del normalizador.
//
// Convenciones
//  · Años = años modelo aproximados. Todas las versiones nacen con
//    verified=false; las confirmas en el panel admin (Fase 7).
//  · Las generaciones con facelift que cambia el precio van separadas
//    (996.1/996.2, 991.1/991.2, 992.1/992.2…).
//  · Porsche: carrocería (coupé, cabriolet, targa) es un spec, no versión.
//    Ferrari, McLaren, etc.: se respeta el nombre del fabricante (Spider, GTS…).
//  · tx = transmisiones que existieron. [] = sin dato (no se valida).
//    manual · pdk · dct (doble embrague no Porsche) · f1 (Ferrari F1 de un
//    embrague) · automatizada (E-gear, ISR, Sportshift, Sportomatic) ·
//    automatica (convertidor de par: Tiptronic, ZF, etc.)
//  · Versión: [nombre, desde, hasta|null, tx?, nota?]. tx omitido = el de la generación.
// ════════════════════════════════════════════════════════════════════════

const M = ['manual'], MA = ['manual', 'automatica'], A = ['automatica'],
  D = ['dct'], P = ['pdk'], MP = ['manual', 'pdk'], MF = ['manual', 'f1'],
  F = ['f1'], ME = ['manual', 'automatizada'], AZ = ['automatizada'];

export const makes = [
  { id: 'porsche', name: 'Porsche', country: 'DE', sort: 1 },
  { id: 'ferrari', name: 'Ferrari', country: 'IT', sort: 2 },
  { id: 'lamborghini', name: 'Lamborghini', country: 'IT', sort: 3 },
  { id: 'mclaren', name: 'McLaren', country: 'GB', sort: 4 },
  { id: 'aston-martin', name: 'Aston Martin', country: 'GB', sort: 5 },
  { id: 'bentley', name: 'Bentley', country: 'GB', sort: 6 },
  { id: 'rolls-royce', name: 'Rolls-Royce', country: 'GB', sort: 7 },
  { id: 'mercedes-benz', name: 'Mercedes-Benz', country: 'DE', sort: 8 },
  { id: 'ford', name: 'Ford', country: 'US', sort: 20 },
  { id: 'chevrolet', name: 'Chevrolet', country: 'US', sort: 21 },
  { id: 'jaguar', name: 'Jaguar', country: 'GB', sort: 22 },
  { id: 'volvo', name: 'Volvo', country: 'SE', sort: 23 },
  { id: 'alfa-romeo', name: 'Alfa Romeo', country: 'IT', sort: 24 },
  { id: 'volkswagen', name: 'Volkswagen', country: 'DE', sort: 25 },
  { id: 'land-rover', name: 'Land Rover', country: 'GB', sort: 26 },
  { id: 'peugeot', name: 'Peugeot', country: 'FR', sort: 27 },
  { id: 'mini', name: 'Mini', country: 'GB', sort: 28 },
  { id: 'audi', name: 'Audi', country: 'DE', sort: 29 },
  { id: 'bmw', name: 'BMW', country: 'DE', sort: 30 },
];

export const makeAliases = {
  porsche: ['porsche'],
  ferrari: ['ferrari'],
  lamborghini: ['lamborghini', 'lambo', 'lamborgini'],
  mclaren: ['mclaren', 'mc laren', 'mc-laren'],
  'aston-martin': ['aston martin', 'aston', 'aston-martin'],
  bentley: ['bentley'],
  'rolls-royce': ['rolls royce', 'rolls-royce', 'rolls'],
  'mercedes-benz': ['mercedes', 'mercedes benz', 'mercedes-benz', 'mercedes amg', 'mercedes-amg', 'amg', 'mb'],
  ford: ['ford'],
  chevrolet: ['chevrolet', 'chevy'],
  jaguar: ['jaguar', 'jag'],
  volvo: ['volvo'],
  'alfa-romeo': ['alfa romeo', 'alfa-romeo', 'alfa'],
  volkswagen: ['volkswagen', 'vw'],
  'land-rover': ['land rover', 'land-rover', 'landrover'],
  peugeot: ['peugeot'],
  mini: ['mini', 'rover mini', 'austin mini', 'morris mini', 'austin morris mini'],
  audi: ['audi'],
  bmw: ['bmw'],
};

// segment: moderno | exotico | gran_turismo | ultra_lujo
// ("clásico" se calcula por año con mx_settings.classic_age_years)
export const models = [
  // ── PORSCHE ─────────────────────────────────────────────────────────
  { make: 'porsche', name: '911', segment: 'moderno', aliases: ['911', 'nueve once', 'carrera'], gens: [
    { code: 'F', name: 'Serie F (clásico)', from: 1964, to: 1973, tx: ['manual', 'automatizada'], notes: 'automatizada = Sportomatic', v: [
      ['911', 1964, 1969], ['911 L', 1968, 1968], ['911 T', 1968, 1973], ['911 E', 1969, 1973],
      ['911 S', 1967, 1973], ['Carrera RS 2.7', 1973, 1973, M]] },
    { code: 'G', name: 'Serie G', from: 1974, to: 1989, tx: ['manual', 'automatizada'], v: [
      ['911 2.7', 1974, 1977], ['Carrera 2.7', 1974, 1975, M], ['Carrera 3.0', 1976, 1977, M],
      ['911 SC', 1978, 1983, M], ['Carrera 3.2', 1984, 1989, M], ['Carrera 3.2 Clubsport', 1987, 1989, M],
      ['Speedster', 1989, 1989, M], ['Turbo (930)', 1975, 1989, M]] },
    { code: '964', name: '964', from: 1989, to: 1994, tx: MA, v: [
      ['Carrera 2', 1990, 1994], ['Carrera 4', 1989, 1994, M], ['Carrera RS', 1992, 1992, M],
      ['RS America', 1993, 1994, M], ['Turbo', 1991, 1992, M], ['Turbo 3.6', 1993, 1994, M],
      ['America Roadster', 1992, 1994], ['Speedster', 1993, 1994]] },
    { code: '993', name: '993', from: 1994, to: 1998, tx: MA, v: [
      ['Carrera', 1994, 1998], ['Carrera 4', 1995, 1998, M], ['Carrera S', 1997, 1998],
      ['Carrera 4S', 1996, 1998, M], ['Targa', 1996, 1998], ['Turbo', 1996, 1998, M],
      ['Turbo S', 1997, 1998, M], ['GT2', 1995, 1998, M], ['Carrera RS', 1995, 1996, M]] },
    { code: '996.1', name: '996.1', from: 1998, to: 2001, tx: MA, v: [
      ['Carrera', 1999, 2001], ['Carrera 4', 1999, 2001], ['GT3', 1999, 2001, M, 'No se vendió nuevo en Norteamérica']] },
    { code: '996.2', name: '996.2', from: 2001, to: 2005, tx: MA, v: [
      ['Carrera', 2002, 2004], ['Carrera 4', 2002, 2004], ['Carrera 4S', 2002, 2005], ['Targa', 2002, 2005],
      ['Carrera 40 Aniversario', 2004, 2004, M], ['Turbo', 2001, 2005, null, 'El Turbo 996 se presentó en 2001 con la carrocería ancha'],
      ['Turbo S', 2005, 2005], ['GT2', 2002, 2005, M], ['GT3', 2004, 2005, M], ['GT3 RS', 2004, 2005, M]] },
    { code: '997.1', name: '997.1', from: 2005, to: 2009, tx: MA, v: [
      ['Carrera', 2005, 2008], ['Carrera S', 2005, 2008], ['Carrera 4', 2006, 2008], ['Carrera 4S', 2006, 2008],
      ['Targa 4', 2007, 2008], ['Targa 4S', 2007, 2008], ['Turbo', 2007, 2009],
      ['GT3', 2007, 2008, M], ['GT3 RS', 2007, 2008, M], ['GT2', 2008, 2009, M]] },
    { code: '997.2', name: '997.2', from: 2009, to: 2013, tx: MP, v: [
      ['Carrera', 2009, 2012], ['Carrera S', 2009, 2012], ['Carrera 4', 2009, 2012], ['Carrera 4S', 2009, 2012],
      ['Targa 4', 2009, 2012], ['Targa 4S', 2009, 2012], ['Carrera GTS', 2011, 2012], ['Carrera 4 GTS', 2011, 2012],
      ['Turbo', 2010, 2013], ['Turbo S', 2011, 2013, P], ['GT3', 2010, 2011, M], ['GT3 RS', 2010, 2011, M],
      ['GT3 RS 4.0', 2011, 2011, M], ['GT2 RS', 2011, 2011, M], ['Sport Classic', 2010, 2010, M], ['Speedster', 2011, 2011, P]] },
    { code: '991.1', name: '991.1', from: 2012, to: 2016, tx: MP, v: [
      ['Carrera', 2012, 2016], ['Carrera S', 2012, 2016], ['Carrera 4', 2013, 2016], ['Carrera 4S', 2013, 2016],
      ['Targa 4', 2014, 2016], ['Targa 4S', 2014, 2016], ['Carrera GTS', 2015, 2016], ['Carrera 4 GTS', 2015, 2016],
      ['Turbo', 2014, 2016, P], ['Turbo S', 2014, 2016, P], ['GT3', 2014, 2016, P], ['GT3 RS', 2016, 2016, P],
      ['911 R', 2016, 2016, M], ['50 Aniversario', 2014, 2014]] },
    { code: '991.2', name: '991.2', from: 2017, to: 2019, tx: MP, v: [
      ['Carrera', 2017, 2019], ['Carrera S', 2017, 2019], ['Carrera 4', 2017, 2019], ['Carrera 4S', 2017, 2019],
      ['Carrera T', 2018, 2019], ['Targa 4', 2017, 2019], ['Targa 4S', 2017, 2019], ['Targa 4 GTS', 2017, 2019],
      ['Carrera GTS', 2017, 2019], ['Carrera 4 GTS', 2017, 2019], ['Turbo', 2017, 2019, P], ['Turbo S', 2017, 2019, P],
      ['Turbo S Exclusive Series', 2018, 2018, P], ['GT3', 2018, 2019], ['GT3 Touring', 2018, 2019, M],
      ['GT3 RS', 2019, 2019, P], ['GT2 RS', 2018, 2019, P], ['Speedster', 2019, 2019, M]] },
    { code: '992.1', name: '992.1', from: 2019, to: 2024, tx: MP, v: [
      ['Carrera', 2020, 2024, P], ['Carrera S', 2020, 2024], ['Carrera 4', 2020, 2024, P], ['Carrera 4S', 2020, 2024],
      ['Carrera T', 2023, 2024], ['Targa 4', 2021, 2024, P], ['Targa 4S', 2021, 2024, P], ['Targa 4 GTS', 2022, 2024, P],
      ['Carrera GTS', 2022, 2024], ['Carrera 4 GTS', 2022, 2024], ['Turbo', 2021, 2024, P], ['Turbo S', 2021, 2024, P],
      ['GT3', 2022, 2024], ['GT3 Touring', 2022, 2024], ['GT3 RS', 2023, null, P], ['S/T', 2024, 2024, M],
      ['Dakar', 2023, 2024, P], ['Sport Classic', 2023, 2023, M]] },
    { code: '992.2', name: '992.2', from: 2024, to: null, tx: [], notes: 'Generación reciente: años y transmisiones por verificar', v: [
      ['Carrera', 2025, null, P], ['Carrera S', 2026, null], ['Carrera 4S', 2025, null], ['Carrera T', 2025, null, M],
      ['Carrera GTS', 2025, null, P, 'T-Hybrid'], ['Carrera 4 GTS', 2025, null, P, 'T-Hybrid'],
      ['Turbo S', 2026, null, P, 'T-Hybrid'], ['GT3', 2025, null, MP], ['GT3 Touring', 2025, null, MP]] },
  ] },
  { make: 'porsche', name: '356', segment: 'moderno', gens: [
    { code: 'pre-A', name: '356 (pre-A)', from: 1948, to: 1955, tx: M, v: [['356', 1948, 1955]] },
    { code: 'A', name: '356 A', from: 1955, to: 1959, tx: M, v: [['1600', 1955, 1959], ['1600 Super', 1955, 1959], ['Carrera', 1955, 1959]] },
    { code: 'B', name: '356 B', from: 1959, to: 1963, tx: M, v: [['1600', 1959, 1963], ['1600 Super', 1959, 1963], ['Super 90', 1960, 1963], ['Carrera 2', 1962, 1963]] },
    { code: 'C', name: '356 C', from: 1963, to: 1965, tx: M, v: [['C', 1963, 1965], ['SC', 1963, 1965]] },
  ] },
  { make: 'porsche', name: '912', segment: 'moderno', gens: [
    { code: '912', name: '912', from: 1965, to: 1969, tx: M, v: [['912', 1965, 1969]] },
    { code: '912E', name: '912 E', from: 1976, to: 1976, tx: M, v: [['912 E', 1976, 1976]] },
  ] },
  { make: 'porsche', name: '928', segment: 'gran_turismo', gens: [
    { code: '928', name: '928', from: 1977, to: 1995, tx: MA, v: [
      ['928', 1978, 1982], ['928 S', 1980, 1986], ['928 S4', 1987, 1991], ['928 GT', 1989, 1991, M], ['928 GTS', 1992, 1995]] },
  ] },
  { make: 'porsche', name: 'Cayman', segment: 'moderno', aliases: ['cayman', '718 cayman', '718'], gens: [
    { code: '981', name: '981', from: 2013, to: 2016, tx: MP, v: [['Cayman GTS', 2015, 2016], ['Cayman GT4', 2016, 2016, M]] },
    { code: '982', name: '982 (718)', from: 2017, to: null, tx: MP, notes: 'Fin de producción por verificar', v: [
      ['718 Cayman GTS 4.0', 2021, null], ['718 Cayman GT4', 2020, null], ['718 Cayman GT4 RS', 2022, null, P]] },
  ] },
  { make: 'porsche', name: 'Boxster', segment: 'moderno', aliases: ['boxster', '718 boxster', '718 spyder', 'spyder'], gens: [
    { code: '981', name: '981', from: 2012, to: 2016, tx: MP, v: [['Boxster GTS', 2015, 2016], ['Boxster Spyder', 2016, 2016, M]] },
    { code: '982', name: '982 (718)', from: 2017, to: null, tx: MP, notes: 'Fin de producción por verificar', v: [
      ['718 Boxster GTS 4.0', 2021, null], ['718 Spyder', 2020, null], ['718 Spyder RS', 2024, null, P]] },
  ] },
  { make: 'porsche', name: 'Carrera GT', segment: 'exotico', gens: [
    { code: '980', name: '980', from: 2004, to: 2006, tx: M, v: [['Carrera GT', 2004, 2006]] },
  ] },
  { make: 'porsche', name: '918 Spyder', segment: 'exotico', aliases: ['918'], gens: [
    { code: '918', name: '918', from: 2013, to: 2015, tx: P, v: [['918 Spyder', 2013, 2015, P, 'Paquete Weissach = opción']] },
  ] },

  // ── FERRARI ─────────────────────────────────────────────────────────
  { make: 'ferrari', name: '308 / 328', segment: 'exotico', aliases: ['308', '328'], gens: [
    { code: '308', name: '308', from: 1975, to: 1985, tx: M, v: [
      ['308 GTB / GTS', 1975, 1980, M, 'GTS = targa'], ['308 GTBi / GTSi', 1980, 1982], ['308 Quattrovalvole', 1982, 1985]] },
    { code: '328', name: '328', from: 1985, to: 1989, tx: M, v: [['328 GTB / GTS', 1985, 1989]] },
  ] },
  { make: 'ferrari', name: 'Testarossa', segment: 'exotico', gens: [
    { code: 'testarossa', name: 'Testarossa', from: 1984, to: 1991, tx: M, v: [['Testarossa', 1984, 1991]] },
    { code: '512tr', name: '512 TR', from: 1991, to: 1994, tx: M, v: [['512 TR', 1991, 1994]] },
    { code: 'f512m', name: 'F512 M', from: 1994, to: 1996, tx: M, v: [['F512 M', 1994, 1996]] },
  ] },
  { make: 'ferrari', name: 'F355', segment: 'exotico', aliases: ['355', 'f355'], gens: [
    { code: 'f355', name: 'F355', from: 1994, to: 1999, tx: MF, notes: 'Caja F1 disponible desde 1997', v: [
      ['F355 Berlinetta', 1994, 1999], ['F355 GTS', 1995, 1999], ['F355 Spider', 1995, 1999]] },
  ] },
  { make: 'ferrari', name: '360', segment: 'exotico', gens: [
    { code: '360', name: '360', from: 1999, to: 2005, tx: MF, v: [
      ['360 Modena', 1999, 2005], ['360 Spider', 2000, 2005], ['360 Challenge Stradale', 2003, 2004, F]] },
  ] },
  { make: 'ferrari', name: 'F430', segment: 'exotico', aliases: ['430', 'f430'], gens: [
    { code: 'f430', name: 'F430', from: 2004, to: 2009, tx: MF, v: [
      ['F430', 2004, 2009], ['F430 Spider', 2005, 2009], ['430 Scuderia', 2007, 2009, F], ['Scuderia Spider 16M', 2009, 2009, F]] },
  ] },
  { make: 'ferrari', name: '458', segment: 'exotico', gens: [
    { code: '458', name: '458', from: 2009, to: 2015, tx: D, v: [
      ['458 Italia', 2010, 2015], ['458 Spider', 2012, 2015], ['458 Speciale', 2014, 2015], ['458 Speciale A', 2015, 2015]] },
  ] },
  { make: 'ferrari', name: '488', segment: 'exotico', gens: [
    { code: '488', name: '488', from: 2015, to: 2020, tx: D, v: [
      ['488 GTB', 2015, 2019], ['488 Spider', 2016, 2019], ['488 Pista', 2018, 2020], ['488 Pista Spider', 2019, 2020]] },
  ] },
  { make: 'ferrari', name: 'F8', segment: 'exotico', gens: [
    { code: 'f8', name: 'F8', from: 2019, to: 2023, tx: D, v: [['F8 Tributo', 2019, 2023], ['F8 Spider', 2020, 2023]] },
  ] },
  { make: 'ferrari', name: '296', segment: 'exotico', gens: [
    { code: '296', name: '296', from: 2022, to: null, tx: D, v: [
      ['296 GTB', 2022, null], ['296 GTS', 2023, null], ['296 Speciale', 2026, null, D, 'Años por verificar']] },
  ] },
  { make: 'ferrari', name: 'F12', segment: 'exotico', gens: [
    { code: 'f12', name: 'F12', from: 2012, to: 2017, tx: D, v: [['F12berlinetta', 2012, 2017], ['F12tdf', 2016, 2017]] },
  ] },
  { make: 'ferrari', name: '812', segment: 'exotico', gens: [
    { code: '812', name: '812', from: 2017, to: 2024, tx: D, v: [
      ['812 Superfast', 2017, 2023], ['812 GTS', 2020, 2024], ['812 Competizione', 2021, 2022], ['812 Competizione A', 2022, 2023]] },
  ] },
  { make: 'ferrari', name: 'SF90', segment: 'exotico', gens: [
    { code: 'sf90', name: 'SF90', from: 2020, to: null, tx: D, v: [
      ['SF90 Stradale', 2020, null], ['SF90 Spider', 2021, null], ['SF90 XX Stradale', 2024, null], ['SF90 XX Spider', 2024, null]] },
  ] },

  // ── LAMBORGHINI ─────────────────────────────────────────────────────
  { make: 'lamborghini', name: 'Countach', segment: 'exotico', gens: [
    { code: 'lp400-qv', name: 'Countach (1974–1990)', from: 1974, to: 1990, tx: M, v: [
      ['LP400', 1974, 1978], ['LP400 S', 1978, 1982], ['LP500 S', 1982, 1985], ['5000 Quattrovalvole', 1985, 1988],
      ['25th Anniversary', 1988, 1990]] },
    { code: 'lpi800-4', name: 'Countach LPI 800-4', from: 2022, to: 2022, tx: AZ, v: [['LPI 800-4', 2022, 2022]] },
  ] },
  { make: 'lamborghini', name: 'Diablo', segment: 'exotico', gens: [
    { code: 'diablo', name: 'Diablo', from: 1990, to: 2001, tx: M, v: [
      ['Diablo', 1990, 1998], ['VT', 1993, 1998], ['SE30', 1994, 1995], ['SV', 1995, 1999],
      ['VT Roadster', 1995, 1998], ['GT', 1999, 2000], ['VT 6.0', 2000, 2001]] },
  ] },
  { make: 'lamborghini', name: 'Murciélago', segment: 'exotico', aliases: ['murcielago'], gens: [
    { code: 'murcielago', name: 'Murciélago', from: 2001, to: 2010, tx: ME, notes: 'automatizada = E-gear', v: [
      ['Murciélago', 2001, 2006], ['Murciélago Roadster', 2004, 2006], ['LP640', 2006, 2010], ['LP640 Roadster', 2006, 2010],
      ['LP670-4 SuperVeloce', 2009, 2010], ['LP650-4 Roadster', 2010, 2010]] },
  ] },
  { make: 'lamborghini', name: 'Gallardo', segment: 'exotico', gens: [
    { code: 'lp500', name: 'Gallardo (1.ª fase)', from: 2003, to: 2008, tx: ME, notes: 'automatizada = E-gear', v: [
      ['Gallardo', 2003, 2008], ['Gallardo Spyder', 2006, 2008], ['Gallardo Superleggera', 2007, 2008]] },
    { code: 'lp560', name: 'Gallardo LP560 (2.ª fase)', from: 2008, to: 2013, tx: ME, v: [
      ['LP560-4', 2008, 2013], ['LP560-4 Spyder', 2009, 2013], ['LP550-2', 2009, 2013],
      ['LP570-4 Superleggera', 2010, 2013], ['LP570-4 Spyder Performante', 2011, 2013], ['LP570-4 Squadra Corse', 2013, 2013]] },
  ] },
  { make: 'lamborghini', name: 'Huracán', segment: 'exotico', aliases: ['huracan'], gens: [
    { code: 'lb724', name: 'Huracán', from: 2014, to: 2024, tx: D, v: [
      ['LP610-4', 2014, 2019], ['LP580-2', 2016, 2019], ['Performante', 2017, 2019], ['EVO', 2019, 2024],
      ['EVO RWD', 2020, 2024], ['STO', 2021, 2024], ['Tecnica', 2022, 2024], ['Sterrato', 2023, 2024]] },
  ] },
  { make: 'lamborghini', name: 'Aventador', segment: 'exotico', gens: [
    { code: 'lb834', name: 'Aventador', from: 2011, to: 2022, tx: AZ, notes: 'automatizada = ISR', v: [
      ['LP700-4', 2011, 2016], ['LP750-4 SV', 2015, 2017], ['S', 2017, 2021], ['SVJ', 2019, 2021], ['Ultimae', 2021, 2022]] },
  ] },
  { make: 'lamborghini', name: 'Urus', segment: 'ultra_lujo', gens: [
    { code: 'urus', name: 'Urus', from: 2018, to: null, tx: A, v: [
      ['Urus', 2018, 2022], ['Urus S', 2022, 2024], ['Urus Performante', 2022, 2024], ['Urus SE', 2024, null, A, 'Híbrido enchufable']] },
  ] },

  // ── McLAREN ─────────────────────────────────────────────────────────
  { make: 'mclaren', name: 'Super Series', segment: 'exotico', aliases: ['super series'], gens: [
    { code: '12c', name: '12C', from: 2011, to: 2014, tx: D, v: [['12C', 2011, 2014, D, 'También "MP4-12C"'], ['12C Spider', 2012, 2014]] },
    { code: '650s', name: '650S', from: 2014, to: 2017, tx: D, v: [
      ['650S', 2014, 2017], ['650S Spider', 2014, 2017], ['675LT', 2015, 2017], ['675LT Spider', 2016, 2017]] },
    { code: '720s', name: '720S', from: 2017, to: 2023, tx: D, v: [
      ['720S', 2017, 2023], ['720S Spider', 2019, 2023], ['765LT', 2020, 2022], ['765LT Spider', 2021, 2022]] },
    { code: '750s', name: '750S', from: 2023, to: null, tx: D, v: [['750S', 2023, null], ['750S Spider', 2023, null]] },
  ] },
  { make: 'mclaren', name: 'Sports Series', segment: 'exotico', aliases: ['sports series'], gens: [
    { code: 'sports-series', name: 'Sports Series', from: 2015, to: 2021, tx: D, v: [
      ['540C', 2015, 2021], ['570S', 2015, 2021], ['570GT', 2016, 2021], ['570S Spider', 2017, 2021],
      ['600LT', 2018, 2020], ['600LT Spider', 2019, 2020], ['620R', 2020, 2021]] },
  ] },
  { make: 'mclaren', name: 'Artura', segment: 'exotico', gens: [
    { code: 'artura', name: 'Artura', from: 2022, to: null, tx: D, v: [['Artura', 2022, null], ['Artura Spider', 2024, null]] },
  ] },
  { make: 'mclaren', name: 'GT', segment: 'gran_turismo', aliases: ['mclaren gt', 'gts'], gens: [
    { code: 'gt', name: 'GT', from: 2019, to: 2023, tx: D, v: [['GT', 2019, 2023]] },
    { code: 'gts', name: 'GTS', from: 2024, to: null, tx: D, v: [['GTS', 2024, null]] },
  ] },

  // ── ASTON MARTIN ────────────────────────────────────────────────────
  { make: 'aston-martin', name: 'Vantage', segment: 'gran_turismo', gens: [
    { code: 'v8v', name: 'V8 / V12 Vantage (2005–2017)', from: 2005, to: 2017, tx: ['manual', 'automatizada'], notes: 'automatizada = Sportshift', v: [
      ['V8 Vantage 4.3', 2005, 2008], ['V8 Vantage 4.7', 2008, 2017], ['V8 Vantage S', 2011, 2017],
      ['V12 Vantage', 2009, 2013, M], ['V12 Vantage S', 2013, 2017]] },
    { code: '2018', name: 'Vantage (2018–)', from: 2018, to: null, tx: MA, v: [
      ['Vantage', 2018, 2023], ['Vantage AMR', 2019, 2020, M], ['Vantage F1 Edition', 2021, 2022, A],
      ['V12 Vantage', 2022, 2023, A], ['Vantage (2024)', 2024, null, A, 'Facelift de 665 hp']] },
  ] },
  { make: 'aston-martin', name: 'DB11', segment: 'gran_turismo', gens: [
    { code: 'db11', name: 'DB11', from: 2016, to: 2023, tx: A, v: [['DB11 V12', 2016, 2018], ['DB11 V8', 2017, 2023], ['DB11 AMR', 2018, 2023]] },
  ] },
  { make: 'aston-martin', name: 'DBS', segment: 'gran_turismo', gens: [
    { code: 'dbs-2007', name: 'DBS (2007–2012)', from: 2007, to: 2012, tx: MA, v: [['DBS', 2007, 2012]] },
    { code: 'dbs-superleggera', name: 'DBS Superleggera', from: 2018, to: 2023, tx: A, v: [
      ['DBS Superleggera', 2018, 2023], ['DBS 770 Ultimate', 2023, 2023]] },
  ] },
  { make: 'aston-martin', name: 'DBX', segment: 'ultra_lujo', gens: [
    { code: 'dbx', name: 'DBX', from: 2020, to: null, tx: A, v: [['DBX', 2020, null], ['DBX707', 2022, null]] },
  ] },

  // ── BENTLEY ─────────────────────────────────────────────────────────
  { make: 'bentley', name: 'Continental GT', segment: 'gran_turismo', aliases: ['continental', 'continental gt', 'gtc'], gens: [
    { code: '1', name: '1.ª generación', from: 2003, to: 2011, tx: A, v: [['GT', 2003, 2011], ['GT Speed', 2007, 2011], ['Supersports', 2009, 2011]] },
    { code: '2', name: '2.ª generación', from: 2011, to: 2018, tx: A, v: [
      ['GT W12', 2011, 2018], ['GT V8', 2012, 2018], ['GT V8 S', 2014, 2018], ['GT Speed', 2013, 2018], ['Supersports', 2017, 2018]] },
    { code: '3', name: '3.ª generación', from: 2018, to: 2024, tx: A, v: [
      ['GT W12', 2018, 2024], ['GT V8', 2019, 2024], ['GT Speed', 2021, 2024], ['GT Mulliner', 2019, 2024]] },
    { code: '4', name: '4.ª generación', from: 2024, to: null, tx: A, notes: 'Versiones por verificar', v: [['GT Speed', 2024, null, A, 'Híbrido enchufable']] },
  ] },
  { make: 'bentley', name: 'Bentayga', segment: 'ultra_lujo', gens: [
    { code: '1', name: '1.ª fase', from: 2016, to: 2020, tx: A, v: [['W12', 2016, 2020], ['V8', 2018, 2020], ['Speed', 2019, 2020], ['Hybrid', 2019, 2020]] },
    { code: '2', name: '2.ª fase', from: 2021, to: null, tx: A, v: [
      ['V8', 2021, null], ['Speed', 2021, 2023], ['Hybrid', 2021, null], ['EWB', 2023, null]] },
  ] },

  // ── ROLLS-ROYCE ─────────────────────────────────────────────────────
  { make: 'rolls-royce', name: 'Ghost', segment: 'ultra_lujo', gens: [
    { code: 'i', name: 'Ghost I', from: 2010, to: 2020, tx: A, v: [['Ghost', 2010, 2020], ['Ghost EWB', 2011, 2020], ['Ghost Black Badge', 2016, 2020]] },
    { code: 'ii', name: 'Ghost II', from: 2021, to: null, tx: A, v: [['Ghost', 2021, null], ['Ghost EWB', 2021, null], ['Ghost Black Badge', 2022, null]] },
  ] },
  { make: 'rolls-royce', name: 'Cullinan', segment: 'ultra_lujo', gens: [
    { code: 'i', name: 'Cullinan', from: 2019, to: 2024, tx: A, v: [['Cullinan', 2019, 2024], ['Cullinan Black Badge', 2020, 2024]] },
    { code: 'ii', name: 'Cullinan Series II', from: 2025, to: null, tx: A, v: [['Cullinan', 2025, null], ['Cullinan Black Badge', 2025, null]] },
  ] },
  { make: 'rolls-royce', name: 'Wraith', segment: 'ultra_lujo', gens: [
    { code: 'wraith', name: 'Wraith', from: 2014, to: 2023, tx: A, v: [['Wraith', 2014, 2023], ['Wraith Black Badge', 2016, 2023]] },
  ] },

  // ── MERCEDES-BENZ / AMG ─────────────────────────────────────────────
  { make: 'mercedes-benz', name: 'Clase G AMG', segment: 'ultra_lujo', aliases: ['g63', 'g 63', 'g-wagon', 'clase g', 'g wagon'], gens: [
    { code: 'w463', name: 'W463', from: 2002, to: 2018, tx: A, v: [['G 55 AMG', 2002, 2012], ['G 63 AMG', 2013, 2018], ['G 65 AMG', 2013, 2018]] },
    { code: 'w463a', name: 'W463A', from: 2019, to: null, tx: A, v: [['G 63', 2019, null], ['G 63 4x4²', 2022, 2023]] },
  ] },
  { make: 'mercedes-benz', name: 'AMG GT', segment: 'moderno', aliases: ['amg gt'], gens: [
    { code: 'c190', name: 'C190', from: 2015, to: 2021, tx: D, v: [
      ['GT', 2016, 2021], ['GT S', 2015, 2021], ['GT C', 2017, 2021], ['GT R', 2017, 2021], ['GT R Pro', 2020, 2020],
      ['GT Black Series', 2021, 2021]] },
    { code: 'c192', name: 'C192', from: 2024, to: null, tx: A, notes: 'Versiones por verificar', v: [['GT 55', 2024, null], ['GT 63', 2024, null]] },
  ] },
  { make: 'mercedes-benz', name: 'SLS AMG', segment: 'exotico', aliases: ['sls'], gens: [
    { code: 'c197', name: 'C197 / R197', from: 2010, to: 2014, tx: D, v: [['SLS AMG', 2010, 2014], ['SLS AMG GT', 2013, 2014], ['SLS AMG Black Series', 2014, 2014]] },
  ] },
  { make: 'mercedes-benz', name: '300 SL', segment: 'gran_turismo', aliases: ['300sl', 'alas de gaviota', 'gullwing'], gens: [
    { code: 'w198', name: 'W198', from: 1954, to: 1963, tx: M, v: [['Gullwing', 1954, 1957, M, 'Coupé alas de gaviota'], ['Roadster', 1957, 1963]] },
  ] },
  { make: 'mercedes-benz', name: 'SL Pagoda', segment: 'gran_turismo', aliases: ['pagoda', 'w113', 'clase sl', 'sl'], gens: [
    { code: 'w113', name: 'W113', from: 1963, to: 1971, tx: MA, v: [['230 SL', 1963, 1967], ['250 SL', 1966, 1968], ['280 SL', 1967, 1971]] },
  ] },

  // ── CLÁSICOS DE COLECCIÓN ───────────────────────────────────────────
  { make: 'ford', name: 'Mustang', segment: 'moderno', gens: [
    { code: '1', name: '1.ª generación', from: 1964, to: 1973, tx: MA, v: [
      ['Mustang', 1964, 1973], ['Mustang GT', 1965, 1969], ['Shelby GT350', 1965, 1970], ['Shelby GT500', 1967, 1970],
      ['Mach 1', 1969, 1973], ['Boss 302', 1969, 1970, M], ['Boss 429', 1969, 1970, M]] },
  ] },
  { make: 'chevrolet', name: 'Corvette', segment: 'moderno', gens: [
    { code: 'c2', name: 'C2', from: 1963, to: 1967, tx: MA, v: [['Sting Ray', 1963, 1967], ['Sting Ray 427', 1966, 1967]] },
    { code: 'c3', name: 'C3', from: 1968, to: 1982, tx: MA, v: [['Corvette C3', 1968, 1982, MA, 'Se llamó "Stingray" de 1969 a 1976']] },
    { code: 'c8', name: 'C8', from: 2020, to: null, tx: D, v: [['Stingray', 2020, null], ['Z06', 2023, null], ['E-Ray', 2024, null], ['ZR1', 2025, null]] },
  ] },
  { make: 'jaguar', name: 'E-Type', segment: 'gran_turismo', aliases: ['e type', 'etype', 'xke', 'xk-e'], gens: [
    { code: 's1', name: 'Serie 1', from: 1961, to: 1968, tx: M, v: [['3.8', 1961, 1964], ['4.2', 1964, 1968]] },
    { code: 's2', name: 'Serie 2', from: 1968, to: 1971, tx: MA, v: [['4.2', 1968, 1971]] },
    { code: 's3', name: 'Serie 3', from: 1971, to: 1975, tx: MA, v: [['V12', 1971, 1975]] },
  ] },

  // ── Clásicos de colección agregados el 2026-11-11 (inventario real en México) ──
  { make: 'mercedes-benz', name: 'SL (R107)', segment: 'gran_turismo', aliases: ['r107', 'sl r107', 'clase sl', 'sl'], gens: [
    { code: 'r107', name: 'R107', from: 1971, to: 1989, tx: MA, v: [
      ['350 SL', 1971, 1980], ['450 SL', 1971, 1980], ['280 SL', 1974, 1985], ['380 SL', 1980, 1985],
      ['500 SL', 1980, 1989], ['300 SL', 1985, 1989, MA, 'R107: no confundir con el 300 SL W198'], ['420 SL', 1985, 1989], ['560 SL', 1986, 1989, A]] },
  ] },
  { make: 'mercedes-benz', name: 'Clase G clásica', segment: 'moderno', aliases: ['w460', 'w461', 'puch', 'steyr puch'], gens: [
    { code: 'w460', name: 'W460', from: 1979, to: 1991, tx: MA, notes: 'Años por verificar', v: [
      ['230 G', 1979, 1982], ['230 GE', 1982, 1991], ['280 GE', 1979, 1990], ['240 GD', 1979, 1987], ['300 GD', 1979, 1991]] },
    { code: 'w461', name: 'W461', from: 1992, to: 2001, tx: MA, notes: 'Años por verificar', v: [
      ['230 GE', 1992, 1994], ['290 GD', 1992, 2001], ['290 GDT', 1997, 2001]] },
  ] },
  { make: 'volvo', name: 'P1800', segment: 'gran_turismo', aliases: ['p1800', 'p 1800'], gens: [
    { code: 'p1800', name: 'P1800', from: 1961, to: 1973, tx: M, v: [
      ['P1800 (Jensen)', 1961, 1963], ['1800S', 1963, 1969], ['1800E', 1970, 1972], ['1800ES', 1972, 1973]] },
  ] },
  { make: 'alfa-romeo', name: 'Spider', segment: 'moderno', aliases: ['spider', 'duetto', 'spider veloce'], gens: [
    { code: 's1', name: 'Serie 1 (Duetto / Osso di Seppia)', from: 1966, to: 1969, tx: M, v: [['1600 Duetto', 1966, 1967], ['1750 Spider Veloce', 1967, 1969], ['1300 Junior', 1968, 1969]] },
    { code: 's2', name: 'Serie 2 (Coda Tronca)', from: 1970, to: 1982, tx: M, v: [['1300 Junior', 1970, 1977], ['1600', 1972, 1982], ['1750', 1970, 1971], ['2000', 1971, 1982, M, 'Spider Veloce 2000']] },
    { code: 's3', name: 'Serie 3 (Aerodinamica)', from: 1983, to: 1989, tx: M, v: [['1600', 1983, 1989], ['2000', 1983, 1989], ['Quadrifoglio Verde', 1986, 1989]] },
    { code: 's4', name: 'Serie 4', from: 1990, to: 1993, tx: MA, v: [['1600', 1990, 1993], ['2000', 1990, 1993]] },
  ] },
  { make: 'volkswagen', name: 'Karmann Ghia', segment: 'moderno', aliases: ['karmann ghia', 'karman ghia', 'karmann-ghia', 'typ 14'], gens: [
    { code: 'typ14', name: 'Typ 14', from: 1955, to: 1974, tx: MA, notes: 'automatica = Automatic Stick Shift (1968+)', v: [['Typ 14', 1955, 1974]] },
  ] },
  { make: 'land-rover', name: 'Defender', segment: 'moderno', aliases: ['defender', 'ninety', 'one ten'], gens: [
    { code: '90-110', name: 'Ninety / One Ten', from: 1983, to: 1990, tx: M, v: [['90', 1984, 1990], ['110', 1983, 1990], ['127', 1985, 1990]] },
    { code: '1991-2016', name: 'Defender (1991–2016)', from: 1991, to: 2016, tx: M, v: [['90', 1991, 2016], ['110', 1991, 2016], ['130', 1991, 2016]] },
  ] },
  { make: 'peugeot', name: '205 GTI', segment: 'moderno', aliases: ['205 gti', '205gti'], gens: [
    { code: '205gti', name: '205 GTI', from: 1984, to: 1994, tx: M, v: [['1.6', 1984, 1992], ['1.9', 1986, 1994]] },
  ] },
  { make: 'mini', name: 'Mini clásico', segment: 'moderno', aliases: ['mini'], gens: [
    { code: 'clasico', name: 'Mini (1959–2000)', from: 1959, to: 2000, tx: MA, v: [
      ['Cooper', 1961, 2000, MA, 'Cooper original 1961–1971; regresó en 1990'], ['Cooper S', 1963, 1971], ['British Open', 1992, 1992, MA, 'Edición especial']] },
  ] },
  { make: 'audi', name: 'RS6', segment: 'moderno', aliases: ['rs6', 'rs 6'], gens: [
    { code: 'c5', name: 'C5', from: 2002, to: 2004, tx: A, v: [['RS6 (C5)', 2002, 2004]] },
  ] },
  { make: 'bmw', name: 'Serie 3 (E30)', segment: 'moderno', aliases: ['e30'], gens: [
    { code: 'e30', name: 'E30', from: 1982, to: 1994, tx: MA, notes: 'Touring/Cabrio = carrocería', v: [
      ['318i', 1983, 1994], ['320i', 1982, 1991], ['325i', 1985, 1993], ['M3', 1986, 1991, M]] },
  ] },
];

// Opciones con prima potencial. make: null = genérica.
export const options = [
  ['frenos_carbono_ceramicos', 'Frenos carbono-cerámicos', null, ['pccb', 'ccb', 'ccm', 'frenos ceramicos', 'carbon ceramic']],
  ['lift_delantero', 'Elevación del eje delantero (lift)', null, ['lift', 'front axle lift', 'nose lift', 'suspension lifter', 'lifting system']],
  ['asientos_bucket', 'Asientos bucket', null, ['bucket', 'full bucket', 'buckets', 'racing seats', 'asientos de carbono']],
  ['techo_carbono', 'Techo de fibra de carbono', null, ['carbon roof', 'techo de carbono']],
  ['exterior_carbono', 'Paquete exterior de carbono', null, ['carbon exterior', 'paquete de carbono exterior']],
  ['interior_carbono', 'Paquete interior de carbono', null, ['carbon interior', 'interior de carbono']],
  ['escape_deportivo', 'Escape deportivo', null, ['pse', 'sport exhaust', 'escape deportivo']],
  ['rines_forjados', 'Rines forjados', null, ['forged wheels', 'rines forjados']],
  ['rines_magnesio', 'Rines de magnesio', null, ['magnesium wheels', 'rines de magnesio']],
  ['ppf', 'Película protectora de pintura (PPF)', null, ['ppf', 'xpel', 'paint protection film']],
  ['pintura_especial', 'Pintura especial del fabricante', null, ['paint to sample', 'pts', 'tailor made', 'ad personam', 'mso', 'q by aston martin', 'mulliner', 'bespoke', 'manufaktur']],
  ['audio_premium', 'Audio premium', null, ['burmester', 'bose', 'bowers', 'naim', 'bang & olufsen', 'sensonum']],
  ['jaula_antivuelco', 'Jaula antivuelco', null, ['roll cage', 'jaula', 'roll bar']],
  ['paquete_weissach', 'Paquete Weissach', 'porsche', ['weissach']],
  ['paquete_clubsport', 'Paquete Clubsport', 'porsche', ['clubsport', 'club sport']],
  ['sport_chrono', 'Sport Chrono', 'porsche', ['sport chrono', 'chrono']],
  ['asientos_18_vias', 'Asientos adaptativos de 18 vías', 'porsche', ['18 way', '18-way', '18 vias']],
  ['heritage_design', 'Paquete Heritage Design', 'porsche', ['heritage design', 'heritage']],
  ['volante_carbono_leds', 'Volante de carbono con LEDs', 'ferrari', ['carbon driver zone', 'carbon steering wheel leds', 'volante de carbono']],
  ['display_pasajero', 'Pantalla del pasajero', 'ferrari', ['passenger display', 'pantalla pasajero']],
  ['escudos_scuderia', 'Escudos Scuderia Ferrari', 'ferrari', ['scuderia shields', 'escudos scuderia']],
  ['asientos_daytona', 'Asientos Daytona', 'ferrari', ['daytona seats', 'asientos daytona']],
  ['assetto_fiorano', 'Paquete Assetto Fiorano', 'ferrari', ['assetto fiorano']],
];

// Fuentes genéricas (las agencias y portales llegan en la Fase 3 vía sources.yaml).
export const sources = [
  { id: 'contacto-directo', name: 'Contacto directo (WhatsApp, llamada, evento)', kind: 'directo', capture_mode: 'manual', status: 'captura_manual' },
  { id: 'facebook-marketplace', name: 'Facebook Marketplace', kind: 'marketplace', base_url: 'https://www.facebook.com/marketplace', capture_mode: 'script_local', status: 'pendiente' },
  { id: 'instagram', name: 'Instagram', kind: 'red_social', base_url: 'https://www.instagram.com', capture_mode: 'manual', status: 'captura_manual' },
];

export const settings = [
  ['disappear_days', 21, 'Días sin ver un listing activo para marcarlo desaparecido / vendido_inferido (Fase 5). PENDIENTE: confírmalo.'],
  ['classic_age_years', 30, 'Antigüedad (años) a partir de la cual un auto cuenta como Clásico. PENDIENTE: confírmalo.'],
  ['fingerprint_km_tolerance', 0.03, 'Tolerancia de km para el fingerprint de duplicados (±3%).'],
  ['phash_strong_distance', 8, 'Bits de diferencia máximos para "misma foto" (coincidencia fuerte). Calibrado en Fase 2 con imágenes sintéticas: 0 de 780 pares distintos quedaron ≤8. Recalibrar con fotos reales.'],
  ['phash_weak_distance', 12, 'Hasta estos bits la foto "se parece" (coincidencia débil): solo manda a revisión, nunca fusiona.'],
  ['phash_min_matches', 2, 'Fotos con coincidencia fuerte necesarias para fusionar automáticamente.'],
  ['phash_identical_distance', 2, 'Bits máximos para "la misma imagen". Con una sola foto por anuncio (tarjetas de Mercado Libre) se une solo si es la misma imagen y además coinciden año y km: autos distintos del mismo estudio salen a 4–8 bits (calibrado con Urus reales, 2026-11-12).'],
  ['fingerprint_exact_km_min', 1000, 'Km mínimos para unir por "mismos km exactos" (y precio igual o km no redondos); abajo de esto, autos nuevos de 10 km se confundirían.'],
  ['phash_generic_vehicles', 3, 'Si una misma foto aparece en este número de vehículos o más, es genérica (banner, foto de prensa) y se ignora.'],
  ['fingerprint_km_floor', 300, 'Tolerancia mínima absoluta de km (para autos casi nuevos, donde 3% es muy poco).'],
  ['fingerprint_km_per_day', 40, 'Km que se aceptan de más por cada día entre dos observaciones (el auto se sigue usando).'],
  ['snapshot_gap_days', 3, 'Días sin observación que se toleran sin partir un tramo de precio (por si falla un cron).'],
  ['min_n_for_stats', 5, 'n mínima para mostrar una estadística; abajo se muestra "datos insuficientes". PENDIENTE: confírmalo.'],
];
