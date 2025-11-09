import browserfs from 'browserfs';
import util from 'lif-kernel/util.js';
let wait = util.ewait();
browserfs.configure({
  fs: "MountableFileSystem",
  options: {"/": {fs: "IndexedDB", options: {storeName: 'lif-coin'}}},
}, ()=>wait.return());
await wait;
let fs = browserfs.BFSRequire('fs');
fs.constants = fs.FS;
export default fs;
