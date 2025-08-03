#!/bin/bash

pkill -9 lif_node
rm -rf ~/lif.store/
node --inspect-brk ~/lif-coin/lif-node/lif_node.js 
