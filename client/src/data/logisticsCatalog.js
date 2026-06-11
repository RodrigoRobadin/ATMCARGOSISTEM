export const LOGISTICS_COUNTRIES = [
  { iso2: 'PY', iso3: 'PRY', iso_num: '600', name: 'Paraguay' },
  { iso2: 'AR', iso3: 'ARG', iso_num: '032', name: 'Argentina' },
  { iso2: 'BR', iso3: 'BRA', iso_num: '076', name: 'Brazil' },
  { iso2: 'UY', iso3: 'URY', iso_num: '858', name: 'Uruguay' },
  { iso2: 'CL', iso3: 'CHL', iso_num: '152', name: 'Chile' },
  { iso2: 'BO', iso3: 'BOL', iso_num: '068', name: 'Bolivia' },
  { iso2: 'PE', iso3: 'PER', iso_num: '604', name: 'Peru' },
  { iso2: 'US', iso3: 'USA', iso_num: '840', name: 'United States' },
  { iso2: 'ES', iso3: 'ESP', iso_num: '724', name: 'Spain' },
  { iso2: 'CN', iso3: 'CHN', iso_num: '156', name: 'China' },
  { iso2: 'PA', iso3: 'PAN', iso_num: '591', name: 'Panama' },
  { iso2: 'DE', iso3: 'DEU', iso_num: '276', name: 'Germany' },
  { iso2: 'NL', iso3: 'NLD', iso_num: '528', name: 'Netherlands' },
  { iso2: 'BE', iso3: 'BEL', iso_num: '056', name: 'Belgium' },
  { iso2: 'IT', iso3: 'ITA', iso_num: '380', name: 'Italy' },
  { iso2: 'MX', iso3: 'MEX', iso_num: '484', name: 'Mexico' },
  { iso2: 'CO', iso3: 'COL', iso_num: '170', name: 'Colombia' },
];

export const LOGISTICS_LOCATIONS = [
  { country_iso2: 'PY', code: 'ASU', name: 'Asuncion', type: 'city' },
  { country_iso2: 'PY', code: 'ASU', name: 'Aeropuerto Silvio Pettirossi', type: 'airport' },
  { country_iso2: 'PY', code: 'AGT', name: 'Ciudad del Este', type: 'city' },
  { country_iso2: 'PY', code: 'VLL', name: 'Villeta', type: 'port' },
  { country_iso2: 'AR', code: 'BUE', name: 'Buenos Aires', type: 'city' },
  { country_iso2: 'AR', code: 'EZE', name: 'Ezeiza', type: 'airport' },
  { country_iso2: 'AR', code: 'COR', name: 'Cordoba', type: 'city' },
  { country_iso2: 'BR', code: 'SSZ', name: 'Santos', type: 'port' },
  { country_iso2: 'BR', code: 'GRU', name: 'Sao Paulo Guarulhos', type: 'airport' },
  { country_iso2: 'BR', code: 'SAO', name: 'Sao Paulo', type: 'city' },
  { country_iso2: 'BR', code: 'RIO', name: 'Rio de Janeiro', type: 'city' },
  { country_iso2: 'UY', code: 'MVD', name: 'Montevideo', type: 'port' },
  { country_iso2: 'CL', code: 'SCL', name: 'Santiago', type: 'city' },
  { country_iso2: 'CL', code: 'SAI', name: 'San Antonio', type: 'port' },
  { country_iso2: 'BO', code: 'VVI', name: 'Santa Cruz Viru Viru', type: 'airport' },
  { country_iso2: 'PE', code: 'LIM', name: 'Lima', type: 'city' },
  { country_iso2: 'PE', code: 'CLL', name: 'Callao', type: 'port' },
  { country_iso2: 'US', code: 'MIA', name: 'Miami', type: 'airport' },
  { country_iso2: 'US', code: 'LAX', name: 'Los Angeles', type: 'airport' },
  { country_iso2: 'US', code: 'NYC', name: 'New York', type: 'city' },
  { country_iso2: 'US', code: 'JFK', name: 'John F. Kennedy', type: 'airport' },
  { country_iso2: 'ES', code: 'MAD', name: 'Madrid', type: 'airport' },
  { country_iso2: 'ES', code: 'BCN', name: 'Barcelona', type: 'port' },
  { country_iso2: 'CN', code: 'SHA', name: 'Shanghai', type: 'port' },
  { country_iso2: 'CN', code: 'PVG', name: 'Shanghai Pudong', type: 'airport' },
  { country_iso2: 'CN', code: 'NGB', name: 'Ningbo', type: 'port' },
  { country_iso2: 'CN', code: 'SZX', name: 'Shenzhen', type: 'port' },
  { country_iso2: 'PA', code: 'PTY', name: 'Panama City', type: 'airport' },
  { country_iso2: 'PA', code: 'PAM', name: 'Panama Canal', type: 'port' },
  { country_iso2: 'DE', code: 'HAM', name: 'Hamburg', type: 'port' },
  { country_iso2: 'DE', code: 'FRA', name: 'Frankfurt', type: 'airport' },
  { country_iso2: 'NL', code: 'RTM', name: 'Rotterdam', type: 'port' },
  { country_iso2: 'NL', code: 'AMS', name: 'Amsterdam Schiphol', type: 'airport' },
  { country_iso2: 'BE', code: 'ANR', name: 'Antwerp', type: 'port' },
  { country_iso2: 'IT', code: 'GOA', name: 'Genoa', type: 'port' },
  { country_iso2: 'MX', code: 'MEX', name: 'Mexico City', type: 'airport' },
  { country_iso2: 'MX', code: 'VER', name: 'Veracruz', type: 'port' },
  { country_iso2: 'CO', code: 'BOG', name: 'Bogota', type: 'airport' },
  { country_iso2: 'CO', code: 'CTG', name: 'Cartagena', type: 'port' },
];

export const LOGISTICS_CARRIERS = [
  { code: 'MAERSK', name: 'Maersk' },
  { code: 'MSC', name: 'Mediterranean Shipping Company' },
  { code: 'CMA CGM', name: 'CMA CGM' },
  { code: 'HAPAG', name: 'Hapag-Lloyd' },
  { code: 'ONE', name: 'Ocean Network Express' },
  { code: 'EVERGREEN', name: 'Evergreen' },
  { code: 'COSCO', name: 'COSCO Shipping' },
  { code: 'PIL', name: 'Pacific International Lines' },
  { code: 'ZIM', name: 'ZIM Integrated Shipping' },
  { code: 'AMERICAN', name: 'American Airlines Cargo' },
  { code: 'LATAM', name: 'LATAM Cargo' },
  { code: 'AVIANCA', name: 'Avianca Cargo' },
  { code: 'COPA', name: 'Copa Airlines Cargo' },
  { code: 'LUFTHANSA', name: 'Lufthansa Cargo' },
  { code: 'QATAR', name: 'Qatar Airways Cargo' },
  { code: 'EMIRATES', name: 'Emirates SkyCargo' },
];

const countryNameByIso2 = new Map(LOGISTICS_COUNTRIES.map((country) => [country.iso2, country.name]));

export function formatLogisticsLocation(location) {
  if (!location) return '';
  return `${location.country_iso2} - ${location.code}`;
}

export function formatLogisticsLocationLabel(location) {
  if (!location) return '';
  const countryName = countryNameByIso2.get(location.country_iso2) || location.country_iso2;
  return `${location.name}, ${countryName}`;
}

export function formatLogisticsCarrier(carrier) {
  if (!carrier) return '';
  return `${carrier.code} - ${carrier.name}`;
}

export const LOGISTICS_LOCATION_OPTIONS = LOGISTICS_LOCATIONS.map((location) => ({
  ...location,
  value: formatLogisticsLocation(location),
  label: formatLogisticsLocationLabel(location),
}));

export const LOGISTICS_CARRIER_OPTIONS = LOGISTICS_CARRIERS.map((carrier) => ({
  ...carrier,
  value: formatLogisticsCarrier(carrier),
}));
