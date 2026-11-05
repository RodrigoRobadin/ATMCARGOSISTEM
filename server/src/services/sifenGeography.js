import { readFileSync } from 'node:fs';

export const sifenGeography = JSON.parse(readFileSync(new URL('../data/sifenGeography.json', import.meta.url), 'utf8'));

const departmentByCode = new Map(sifenGeography.departments.map(([code]) => [code, true]));
const districtByCode = new Map(sifenGeography.districts.map(([code, department]) => [code, department]));
const cityByCode = new Map(sifenGeography.cities.map(([code, district]) => [code, district]));

export function validSifenLocation(department, district, city) {
  return departmentByCode.has(department) && districtByCode.get(district) === department &&
    cityByCode.get(city) === district;
}
