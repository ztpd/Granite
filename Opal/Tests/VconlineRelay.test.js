// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Assert = require('assert');
const Relay = require('../Source/Net/VconlineRelay');

let Passed = 0;
function Test(Name, Fn) {
    try {
        Fn();
        Passed++;
        process.stdout.write(`  pass  ${Name}\n`);
    } catch (Failure) {
        process.stdout.write(`  FAIL  ${Name}\n        ${Failure.message}\n`);
        process.exitCode = 1;
    }
}

function Connect(RelayId, MachineId, Fill = 0x55) {
    const Packet = Buffer.alloc(Relay.ConnectLength, Fill);
    Packet.writeUInt32BE(Relay.BuildHeader(Relay.Type.Connect, Relay.Routing.Delivered, Packet.length, RelayId), 0);
    Packet.writeBigUInt64BE(BigInt(MachineId), 20);
    return Packet;
}

function Data(Type, Routing, RelayId, Payload) {
    const Body = Buffer.from(Payload);
    const Packet = Buffer.alloc(4 + Body.length);
    Packet.writeUInt32BE(Relay.BuildHeader(Type, Routing, Packet.length, RelayId), 0);
    Body.copy(Packet, 4);
    return Packet;
}

const A = { address: '127.0.0.1', port: 40001 };
const B = { address: '127.0.0.1', port: 40002 };
const C = { address: '127.0.0.1', port: 40003 };

Test('the 2K19 connect header decodes exactly', () => {
    const Header = Relay.ParseHeader(Connect(10, 1008n));
    Assert.strictEqual(Header.Word, 0x001c000a);
    Assert.strictEqual(Header.Type, Relay.Type.Connect);
    Assert.strictEqual(Header.Routing, Relay.Routing.Delivered);
    Assert.strictEqual(Header.Length, 28);
    Assert.strictEqual(Header.RelayId, 10);
});

Test('a successful connect reply is the exact 16-byte layout the client validates', () => {
    const Reply = Relay.BuildConnectReply(10, 1008n);
    Assert.strictEqual(Reply.toString('hex'), '2010000a0000000000000000000003f0');
    Assert.strictEqual(Relay.ParseHeader(Reply).Type, Relay.Type.ConnectReply);
    Assert.strictEqual(Reply.readUInt32BE(4), 0);
    Assert.strictEqual(Reply.readBigUInt64BE(8), 1008n);
});

Test('connect registers a UDP endpoint and answers it', () => {
    const Sent = [];
    const Router = new Relay.Router((Packet, Client) => Sent.push({ Packet, Client }));
    const Result = Router.Handle(Connect(10, 1008n, 0x44), A);
    Assert.strictEqual(Result.Kind, 'connect');
    Assert.strictEqual(Router.Clients.size, 1);
    Assert.strictEqual(Sent.length, 1);
    Assert.strictEqual(Sent[0].Client.Port, A.port);
    Assert.strictEqual(Sent[0].Packet.readBigUInt64BE(8), 1008n);
});

Test('broadcast-to-all echoes the payload with server routing bits cleared', () => {
    const Sent = [];
    const Router = new Relay.Router((Packet, Client) => Sent.push({ Packet, Client }));
    Router.Handle(Connect(10, 1008n), A);
    Sent.length = 0;
    const Payload = Buffer.from('heartbeat');
    Router.Handle(Data(Relay.Type.Reliable, Relay.Routing.All, 10, Payload), A);
    Assert.strictEqual(Sent.length, 1);
    const Header = Relay.ParseHeader(Sent[0].Packet);
    Assert.strictEqual(Header.Routing, Relay.Routing.Delivered);
    Assert.deepStrictEqual(Sent[0].Packet.subarray(4), Payload);
});

Test('broadcast-to-others stays inside one match and excludes its sender', () => {
    const Sent = [];
    const Router = new Relay.Router((Packet, Client) => Sent.push({ Packet, Client }));
    Router.Handle(Connect(10, 1008n), A);
    Router.Handle(Connect(10, 1009n), B);
    Router.Handle(Connect(10, 9999n, 0x77), C);
    Sent.length = 0;
    Router.Handle(Data(Relay.Type.Unreliable, Relay.Routing.Others, 10, [1, 2, 3]), A);
    Assert.deepStrictEqual(
        Sent.map((X) => X.Client.Port),
        [B.port],
    );
    Assert.deepStrictEqual([...Sent[0].Packet.subarray(4)], [1, 2, 3]);
});

Test('disconnect removes only the matching registered endpoint', () => {
    const Router = new Relay.Router(() => {});
    Router.Handle(Connect(10, 1008n), A);
    const Packet = Buffer.alloc(Relay.DisconnectLength);
    Packet.writeUInt32BE(Relay.BuildHeader(Relay.Type.Disconnect, Relay.Routing.Delivered, Packet.length, 10), 0);
    Packet.writeBigUInt64BE(1008n, 4);
    Assert.strictEqual(Router.Handle(Packet, A).Kind, 'disconnect');
    Assert.strictEqual(Router.Clients.size, 0);
});

Test('a malformed declared length is rejected before any body is read', () => {
    const Packet = Connect(10, 1008n);
    Packet.writeUInt32BE(Relay.BuildHeader(Relay.Type.Connect, Relay.Routing.Delivered, 27, 10), 0);
    Assert.throws(() => Relay.ParseHeader(Packet), /declares 27 bytes but 28 arrived/);
});

Test('directed delivery selects the actual machine id, not token halves or match ids', () => {
    const Sent = [],
        Router = new Relay.Router((Packet, Client) => Sent.push({ Packet, Client }));
    Router.Handle(Connect(0, 0x68fan), A);
    Router.Handle(Connect(0, 0x79abn), B);
    Router.Handle(Connect(0, 0x79abn, 0x66), C);
    Sent.length = 0;
    const Body = Buffer.alloc(15);
    Body.writeUInt32BE(1);
    Body.writeBigUInt64BE(0x79abn, 4);
    Body.set([0xa1, 0xb2, 0xc3], 12);
    Router.Handle(Data(Relay.Type.Reliable, Relay.Routing.List, 0, Body), A);
    Assert.deepStrictEqual(
        Sent.map((X) => X.Client.Port),
        [B.port],
    );
    Assert.deepStrictEqual([...Sent[0].Packet.subarray(4)], [0xa1, 0xb2, 0xc3]);
    Assert.strictEqual(Relay.ParseHeader(Sent[0].Packet).Routing, Relay.Routing.Delivered);
    Assert.strictEqual(Relay.ParseHeader(Sent[0].Packet).Type, Relay.Type.Reliable);
});

Test('reconnect replaces only the same machine in the same token group', () => {
    const Sent = [],
        Router = new Relay.Router((Packet, Client) => Sent.push({ Packet, Client }));
    Router.Handle(Connect(0, 1n), A);
    Router.Handle(Connect(0, 2n), B);
    Router.Handle(Connect(0, 1n), C);
    Assert.equal(Router.Clients.size, 2);
    Assert.ok(!Router.Clients.has(Relay.EndpointKey(A)));
    Sent.length = 0;
    Router.Handle(Data(Relay.Type.Unreliable, Relay.Routing.Others, 0, [42]), B);
    Assert.deepStrictEqual(
        Sent.map((X) => X.Client.Port),
        [C.port],
    );
});

Test('six machines exchange unchanged traffic without crossing token or relay groups', () => {
    const Sent = [],
        Router = new Relay.Router((Packet, Client) => Sent.push({ Packet, Client }));
    const Peers = Array.from({ length: 6 }, (_, I) => ({ address: '127.0.0.1', port: 41000 + I }));
    Peers.forEach((Peer, I) => Router.Handle(Connect(3, BigInt(10 + I), 0x31), Peer));
    Router.Handle(Connect(3, 99n, 0x32), A);
    Router.Handle(Connect(4, 99n, 0x31), B);
    for (const Peer of Peers) {
        Sent.length = 0;
        Router.Handle(Data(Relay.Type.Unreliable, Relay.Routing.Others, 3, [5, 6, 7]), Peer);
        Assert.equal(Sent.length, 5);
        Assert.ok(Sent.every((X) => X.Client.Port !== Peer.port && X.Client.Port >= 41000));
        Assert.ok(Sent.every((X) => X.Packet.subarray(4).equals(Buffer.from([5, 6, 7]))));
    }
});

Test('lockstep mode preserves concatenated 2K19 connectivity and leader frames as one datagram', () => {
    const Sent = [];
    const Router = new Relay.Router(
        (Packet, ClientValue) => Sent.push({ Packet, Client: ClientValue }),
        () => 0,
        { LockstepDelayFrames: 12, LockstepPacing: false },
    );
    const Leader = 1008n,
        Client = 1009n;
    Router.Handle(Connect(10, Leader), A);
    Router.Handle(Connect(10, Client), B);
    Sent.length = 0;

    const Sequence = 5n;
    const Inner = (Type, Subject) => {
        const Frame = Buffer.alloc(24);
        Frame.writeUInt32LE(Frame.length, 0);
        Frame.writeUInt32LE(Type, 4);
        Frame.writeBigUInt64LE(Subject, 8);
        Frame.writeBigUInt64BE(Sequence, 16);
        return Frame;
    };
    const Payload = Buffer.concat([Inner(0x5c85bd15, Leader), Inner(0x6e225397, Leader)]);
    Router.Handle(Data(Relay.Type.Unreliable, Relay.Routing.Others, 10, Payload), A);

    Assert.strictEqual(Sent.length, 1, 'connectivity frames must stay in their original UDP datagram');
    Assert.strictEqual(Sent[0].Client.Port, B.port);
    Assert.deepStrictEqual(Sent[0].Packet.subarray(4), Payload);

    const Controls = Relay.ParseP2PControlFrames(Payload);
    Assert.deepStrictEqual(
        Controls.map((Control) => Control.Name),
        ['Leader', 'Connectivity'],
    );
    Assert.ok(Controls.every((Control) => Control.SubjectMachineId === Leader));
    Assert.ok(Controls.every((Control) => Control.MatchSequence === Sequence));
});

Test('relay reports the same lowest-id native leader regardless of connection order', () => {
    const Router = new Relay.Router(() => {});
    Router.Handle(Connect(10, 2000n), A);
    const Result = Router.Handle(Connect(10, 1000n), B);
    Assert.strictEqual(Result.SessionSize, 2);
    Assert.strictEqual(Result.LeaderMachineId, 1000n);
});

Test('zero credentials and malformed recipient lists cannot enter or route', () => {
    const Router = new Relay.Router(() => {});
    Assert.throws(() => Router.Handle(Connect(0, 0n), A), /nonzero token/);
    Assert.throws(() => Router.Handle(Connect(0, 1n, 0), A), /nonzero token/);
    Router.Handle(Connect(0, 1n), A);
    Assert.throws(() => Router.Handle(Data(Relay.Type.Reliable, Relay.Routing.List, 0, [0, 0, 0, 1]), A), /overruns/);
});

process.stdout.write(`\n${Passed} passing\n`);
