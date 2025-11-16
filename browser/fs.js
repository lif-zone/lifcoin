import util from 'lif-kernel/util.js';
import {configure, InMemory, fs} from '@zenfs/core';
import {IndexedDB} from '@zenfs/dom';

await configure({
  mounts: {
    '/': {backend: IndexedDB, options: {storeName: 'fs1'}},
    '/media': {backend: InMemory, options: {name: 'media'}},
    '/mnt': {backend: InMemory, options: {name: 'mnt'}},
    '/proc': {backend: InMemory, options: {name: 'procfs'}},
    '/tmp': {backend: InMemory, options: {name: 'tmpfs'}}
  },
});

export default fs;
