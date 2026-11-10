import * as hashwasm from 'hash-wasm';
globalThis.hashwasm = hashwasm;

import { Session } from '../src/core/session.js';
import { MemoryStore } from '../src/core/store.js';

export const PASS_A = 'stat rosa pristina nomine';
export const PASS_B = 'nomina nuda tenemus 1327';

// Two people, each with their own device, and a pad delivered in person.
export async function pairOfDevices(size = 65536) {
  const alice = new Session(new MemoryStore());
  const bob = new Session(new MemoryStore());
  await alice.create(PASS_A);
  await bob.create(PASS_B);
  const pad = await alice.forgePad(size, 'Abbatia');
  const { file, code } = await alice.deliverPad(pad.id);
  await bob.receivePad(structuredClone(file), code);
  return { alice, bob, padId: pad.id, file, code };
}
