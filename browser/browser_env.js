// LICENSE_CODE JPL browser compat layer for node.js
let browser_env = process.browser_env ||= {};
import {EventEmitter} from 'events';
browser_env.EventEmitter = EventEmitter;
export default browser_env;
