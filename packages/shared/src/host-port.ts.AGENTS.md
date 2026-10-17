# host-port.ts — index

Dependency-free `formatHostPort(host,port)` (brackets IPv6) + `normalizeHostKey` (lowercase, strip brackets + trailing dot) + `isValidHost` (DNS-name / IP-literal only; rejects URL-authority tricks). Every URL builder for a discovered host uses it. See change: stabilize-mdns-server-identity.
