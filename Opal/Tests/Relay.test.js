// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Assert = require('assert');
const Position = require('../Source/Protocol/Position');
const Roster = require('../Source/Protocol/Roster');

let Pass = 0,
    Fail = 0;
function Test(Name, Fn) {
    try {
        Fn();
        console.log(`  pass  ${Name}`);
        Pass++;
    } catch (E) {
        console.log(`  FAIL  ${Name}\n        ${E.message}`);
        Fail++;
    }
}

function Fake(Id, Puid) {
    return {
        Id: Id,
        Puid: Puid,
        Identifier: `player ${Id}`,
        State: 2,
        Userdata: Buffer.alloc(1),
        KnownPlayers: new Set(),
        Sent: [],
        Send(Buf) {
            this.Sent.push(Buffer.from(Buf));
            return true;
        },
    };
}

const A = Buffer.from('1e000000ce1c9e8cfa68000000000000fc370004f9b2843cf672c2000000', 'hex');

function WithRoster(Connections, Fn) {
    const Original = Roster.Peers;
    Roster.Peers = (Self) => Connections.filter((C) => C !== Self);
    try {
        return Fn();
    } finally {
        Roster.Peers = Original;
    }
}

console.log('\nPosition.Relay\n');

Test('raw POS_UPDATE relay is disabled for NBA2K19', () => {
    const AValue = Fake(1, 1n),
        B = Fake(2, 2n);
    B.KnownPlayers.add(AValue.Id);
    const Sent = WithRoster([AValue, B], () => Position.Relay(AValue, A));
    Assert.strictEqual(Sent, 0);
    Assert.strictEqual(B.Sent.length, 0, 'a client-only packet must not be sent to a client');
});

Test('the inbound position is still decoded for object replication', () => {
    const PositionValue = Position.ReadMovement(A);
    Assert.ok(PositionValue);
    Assert.strictEqual(PositionValue.X, -969);
    Assert.strictEqual(PositionValue.Y, 4);
    Assert.strictEqual(PositionValue.Z, -1614);
});

Test('short and foreign frames remain ignored', () => {
    Assert.strictEqual(Position.Relay(null, Buffer.alloc(12)), 0);
    Assert.strictEqual(Position.Relay(null, Buffer.alloc(40)), 0);
    Assert.strictEqual(Position.Relay(null, null), 0);
});

console.log(`\n${Pass} passing, ${Fail} failing\n`);
process.exit(Fail ? 1 : 0);
