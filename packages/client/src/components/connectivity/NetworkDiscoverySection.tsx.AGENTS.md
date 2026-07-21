# NetworkDiscoverySection.tsx — index

Settings section for mDNS server discovery. Exports `NetworkDiscoverySection`. Scan button calls `discoverServers`; renders discovered `DiscoveredServerInfo` rows with inline add-label confirm. Shows empty-state diagnostic (AP isolation, mesh multicast, VLAN, VPN, firewall) + manual-add form using `parseHostInput` when mDNS finds nothing. Calls `addKnownServer`.
