// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';
const Test = require('node:test');
const Assert = require('node:assert/strict');
const Relay = require('../Source/Net/VconlineRelay');
const { Audit } = require('../Tools/AuditRelay');

Test('traffic summaries bound console output without claiming client delivery', () => {
    const Summary = new Relay.TrafficSummary();
    Assert.equal(Summary.Take(), null);
    Summary.In = 1000;
    Summary.Attempted = 2000;
    Summary.Completed = 1999;
    Summary.Failed = 1;
    Assert.match(
        Summary.Take(),
        /1000 data datagrams in, 2000 sends attempted, 1999 OS send completions, 1 send errors/,
    );
    Assert.equal(Summary.Take(), null);
});

Test('captured native lockstep NAK relays unchanged to both machines', () => {
    const Rows = [];
    const Router = new Relay.Router(
        (Packet, Peer) => {
            Rows.push(`relay-out relay ${Packet.length} ${Packet.toString('hex')} ${Peer.Address}:${Peer.Port}`);
        },
        () => 0,
    );
    const Peers = [
        { address: '127.0.0.1', port: 40001 },
        { address: '127.0.0.1', port: 40002 },
    ];
    function Input(Packet, Peer) {
        Rows.push(`relay-in relay ${Packet.length} ${Packet.toString('hex')} ${Peer.address}:${Peer.port}`);
        Router.Handle(Packet, Peer);
    }
    Peers.forEach((Peer, Index) => {
        const Connect = Buffer.alloc(28, 1);
        Connect.writeUInt32BE(Relay.BuildHeader(0, 0, 28, 0));
        Connect.writeBigUInt64BE(0x68fcn + BigInt(Index), 20);
        Input(Connect, Peer);
    });
    Input(Buffer.from('7818000014000000c661e0defc68000000000000f0010100', 'hex'), Peers[0]);
    const Result = Audit(Rows.join('\n'));
    Assert.equal(Result.InboundDataDatagrams, 1);
    Assert.equal(Result.VerifiedOutboundDatagrams, 4);
    Assert.equal(Object.values(Result.Streams)[0].Retransmit['requester=1 machine=1 frameByte=0'], 1);
    Assert.throws(() => Audit(Rows.slice(0, -1).join('\n')), /differ from router replay/);
});
