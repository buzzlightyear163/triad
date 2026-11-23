# AGREE

Consensus, written by a machine.

AGREE runs A-GREEMENT, the consensus protocol from "The End of Consensus Research?"
(Burgelin et al., arXiv 2610.30114), as a five-replica network inside the visitor's browser tab:
Frankfurt, London, New York, São Paulo and Tokyo, with real inter-region delays between them.

Static site, no build step. Deploys on Vercel as is.

- `js/config.js`: contract address, X link and burn record. Edit this file after launch.
- `js/net.js`: the network (replicas, leader log, leases, the three write paths, failover).
- `js/viz.js`: the printout and the other drawings.
- `js/app.js`: pages and routing.

AGREE is an independent build of a published paper and is not affiliated with its authors.
