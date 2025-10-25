import browserfs from 'browserfs';
import util from 'lif-kernel/util.js';
browserfs.configure({
  fs: "MountableFileSystem",
  options: {"/": {fs: "IndexedDB", options: {storeName: 'lif-coin'}}},
}, ()=>wait.return());
let wait = util.ewait();
let fs = browserfs.BFSRequire('fs');
await wait;
export default fs;
