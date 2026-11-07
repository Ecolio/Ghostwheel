import assert from 'node:assert/strict';
import test from 'node:test';
import { detectMachine, smallMachineReason } from '../server/machine.js';

test('un Raspberry Pi est une petite machine, un PC non', () => {
  for (const board of [
    'Raspberry Pi 5 Model B Rev 1.0',
    'Raspberry Pi 4 Model B Rev 1.4',
    'Raspberry Pi Compute Module 4 Rev 1.0',
  ])
    assert.deepEqual(
      detectMachine({}, () => board, 'arm64'),
      { arch: 'arm64', board, small: true },
      board,
    );
  assert.deepEqual(
    detectMachine({}, () => null, 'x64'),
    { arch: 'x64', board: null, small: false },
  );
  assert.equal(detectMachine({}, () => 'NVIDIA Jetson Orin Nano', 'arm64').small, false);
});

test('CORNELIUS_SMALL_MACHINE impose le choix dans les deux sens', () => {
  const pi = () => 'Raspberry Pi 5 Model B Rev 1.0';
  assert.equal(detectMachine({ CORNELIUS_SMALL_MACHINE: '0' }, pi).small, false);
  assert.equal(detectMachine({ CORNELIUS_SMALL_MACHINE: 'non' }, pi).small, false);
  assert.equal(detectMachine({ CORNELIUS_SMALL_MACHINE: '1' }, () => null).small, true);
  assert.equal(detectMachine({ CORNELIUS_SMALL_MACHINE: 'auto' }, pi).small, true);
  assert.match(smallMachineReason(detectMachine({}, pi)), /Raspberry Pi/u);
  assert.match(
    smallMachineReason(detectMachine({ CORNELIUS_SMALL_MACHINE: '1' }, () => null)),
    /CORNELIUS_SMALL_MACHINE/u,
  );
});
