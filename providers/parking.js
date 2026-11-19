import {parkingMode} from './config.js';
// Direct GPT search is the default; independent page fetching remains an explicit option.
export async function getParkingProvider() {
  return import(parkingMode()==='verified' ? './parking-verified.js' : './parking-search.js');
}
