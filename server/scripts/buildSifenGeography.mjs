import ExcelJS from 'exceljs';
import { mkdir, writeFile } from 'node:fs/promises';

const source = process.argv[2];
if (!source) throw new Error('Uso: node scripts/buildSifenGeography.mjs <planilla-DNIT.xlsx>');

const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile(source);
const sheet = workbook.worksheets[0];
const departments = new Map();
const districts = new Map();
const cities = new Map();

function add(map, code, value, label) {
  const previous = map.get(code);
  if (previous && JSON.stringify(previous) !== JSON.stringify(value)) {
    throw new Error(`${label} ${code} tiene dos ubicaciones diferentes`);
  }
  map.set(code, value);
}

for (let index = 16; index <= sheet.rowCount; index += 1) {
  const row = sheet.getRow(index);
  const [department, departmentName, district, districtName, city, cityName] =
    [2, 3, 4, 5, 6, 7].map((column) => row.getCell(column).value);
  if (![department, district, city].every(Number.isInteger)) continue;
  add(departments, department, [department, departmentName], 'Departamento');
  add(districts, district, [district, department, districtName], 'Distrito');
  add(cities, city, [city, district, cityName], 'Ciudad');
}

if (departments.size < 18 || districts.size < 250 || cities.size < 6000) {
  throw new Error('La planilla no contiene el catálogo geográfico completo');
}

const catalog = {
  source: 'DNIT - Código de Referencia Geográfica, noviembre 2025',
  url: 'https://www.dnit.gov.py/en/web/e-kuatia/tablas-y-codificaciones',
  departments: [...departments.values()],
  districts: [...districts.values()],
  cities: [...cities.values()],
};
const output = new URL('../src/data/sifenGeography.json', import.meta.url);
await mkdir(new URL('../src/data/', import.meta.url), { recursive: true });
await writeFile(output, `${JSON.stringify(catalog)}\n`);
console.log(`Generados ${departments.size} departamentos, ${districts.size} distritos y ${cities.size} ciudades`);
