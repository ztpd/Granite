// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Fs = require('node:fs');
const Assert = require('node:assert/strict');
const Relay = require('../Source/Net/VconlineRelay');

function Audit(Text) {
    const Expected = [],
        Actual = [],
        Streams = new Map();
    const Router = new Relay.Router(
        (Packet, Peer) => {
            Expected.push(`${Peer.Address}:${Peer.Port} ${Packet.toString('hex')}`);
        },
        () => 0,
    );
    let Datagrams = 0;
    for (const Line of Text.split(/\r?\n/)) {
        if (!Line.startsWith('relay-')) continue;
        const [Direction, , Length, Hex, Endpoint] = Line.split(/\s+/);
        const Packet = Buffer.from(Hex, 'hex');
        Assert.equal(Packet.length, Number(Length), 'capture length mismatch');
        if (Direction === 'relay-out') {
            Actual.push(`${Endpoint} ${Hex}`);
            continue;
        }
        Assert.equal(Direction, 'relay-in');
        const At = Endpoint.lastIndexOf(':');
        const Result = Router.Handle(Packet, { address: Endpoint.slice(0, At), port: Number(Endpoint.slice(At + 1)) });
        if (Result.Kind !== 'data') continue;
        Datagrams++;
        const Header = Relay.ParseHeader(Packet);
        let Offset = Header.Routing === Relay.Routing.List ? 8 + 8 * Packet.readUInt32BE(4) : 4;
        while (Offset < Packet.length) {
            Assert.ok(Packet.length - Offset >= 16, 'short native application header');
            const Size = Packet.readUInt32LE(Offset);
            Assert.ok(Size >= 16 && Offset + Size <= Packet.length, 'invalid native application length');
            const Type = Packet.readUInt32LE(Offset + 4)
                .toString(16)
                .toUpperCase();
            const Source = Packet.readBigUInt64LE(Offset + 8)
                .toString(16)
                .toUpperCase();
            const Key = `${Endpoint} source=${Source} type=${Type}`;
            if (!Streams.has(Key)) Streams.set(Key, { Packets: 0, InputStartBytes: [], Retransmit: {} });
            const Stream = Streams.get(Key);
            Stream.Packets++;
            const Body = Packet.subarray(Offset + 16, Offset + Size);
            if (Type === 'DEE061C6') {
                if (Body.length === 4 && Body[0] === 0xf0) {
                    const Req = `requester=${Body[1]} machine=${Body[2]} frameByte=${Body[3]}`;
                    Stream.Retransmit[Req] = (Stream.Retransmit[Req] || 0) + 1;
                } else if (Body.length >= 2) Stream.InputStartBytes.push(Body[1]);
            }
            Offset += Size;
        }
    }
    Assert.deepEqual(Actual, Expected, 'recorded relay sends differ from router replay');
    return {
        InboundDataDatagrams: Datagrams,
        VerifiedOutboundDatagrams: Actual.length,
        DeliveryMeaning: 'attempted sends only; client receipt is not established',
        Streams: Object.fromEntries(Streams),
    };
}

if (require.main === module) {
    if (!process.argv[2]) throw new Error('Usage: node tools/audit-relay.js <capture.txt>');
    console.log(JSON.stringify(Audit(Fs.readFileSync(process.argv[2], 'utf8')), null, 2));
}
module.exports = { Audit };
