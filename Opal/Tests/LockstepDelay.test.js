// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';
const Test = require('node:test');
const Assert = require('node:assert/strict');
const { DelayService, Frame, Decode, Startup, Input, History } = require('../Source/Net/LockstepDelay');
const Relay = require('../Source/Net/VconlineRelay');

const StartupBody = Buffer.from('01010301427000006001010000000000000000', 'hex');
const First = Buffer.from('11f1205300000000000000c04062a3c053a800000000e003c04062a3', 'hex');
const Last = Buffer.from('10ffe8daa8020000000000c04062a30f0f0f0f0f0f0f0f0f0f', 'hex');
function Setup(Count = 2) {
    const Service = new DelayService(15);
    const Peers = Array.from({ length: Count }, (_, I) => ({ MachineId: 100n + BigInt(I) }));
    Peers.forEach((Peer, I) => {
        const Body = Buffer.from(StartupBody);
        Body[0] = I;
        Body.fill(0, 9);
        Body.fill(1, 9, 9 + Count);
        Service.Process(Frame(Startup, Peer.MachineId, Body), Peer, Peers, Peers);
    });
    return { Service, Peers };
}

Test('native input decoder identifies the negative warmup and the ten delay bytes', () => {
    Assert.deepEqual(
        Decode(First, [1, 1]).map((R) => [R.Machine, R.Frame, R.Repeat]),
        [
            [1, 241, 1],
            [1, 242, 1],
        ],
    );
    Assert.deepEqual(Decode(Last, [1, 1])[0].Delays, Array(10).fill(15));
    Assert.throws(() => Decode(Last.subarray(0, -1), [1, 1]), /truncated/);
    Assert.throws(() => Decode(First, [1, 0]), /controllers/);
});

Test('candidate delivers real frame -15 as frame 0 and keeps controller bytes intact', () => {
    const { Service, Peers } = Setup();
    const Original = Buffer.from(First);
    const Out = Service.Process(Frame(Input, Peers[1].MachineId, First), Peers[1], Peers, Peers);
    Assert.deepEqual(
        Out.map((O) => O.Payload[17]),
        [0, 1],
    );
    Assert.deepEqual(Out[0].Payload.subarray(18), First.subarray(2, 15));
    Assert.deepEqual(Out[1].Payload.subarray(18), First.subarray(15));
    Assert.deepEqual(First, Original);
    Assert.equal(Out[0].Payload.readBigUInt64LE(8), Peers[1].MachineId);
});

Test('mode-3 NAK returns cached real inputs for every available machine to requester only', () => {
    const { Service, Peers } = Setup(4);
    for (let I = 0; I < Peers.length; I++) {
        const Body = Buffer.from(First);
        Body[0] = (I << 4) | 1;
        Service.Process(Frame(Input, Peers[I].MachineId, Body), Peers[I], Peers, Peers);
    }
    const Out = Service.Process(Frame(Input, Peers[3].MachineId, Buffer.from([0xf0, 3, 3, 0])), Peers[3], Peers, Peers);
    Assert.equal(Out.length, 4);
    for (const Reply of Out) {
        Assert.deepEqual(Reply.Recipients, [Peers[3]]);
        Assert.equal(Reply.Payload[17], 0);
    }
    Assert.equal(
        Service.Process(Frame(Input, Peers[3].MachineId, Buffer.from([0xf0, 3, 3, 80])), Peers[3], Peers, Peers).length,
        0,
    );
});

Test('history stays bounded across frame-byte wrap and rejects expired replay', () => {
    const { Service, Peers } = Setup();
    const Body = Buffer.concat([Buffer.from([0x10, 0]), First.subarray(2, 15)]);
    for (let I = 0; I < 600; I++) {
        Body[1] = I & 255;
        Service.Process(Frame(Input, Peers[1].MachineId, Body), Peers[1], Peers, Peers);
        Assert.ok(Peers[1].Lockstep.Frames.size <= History);
    }
    Assert.equal(Peers[1].Lockstep.Frames.size, History);
    Assert.ok(Peers[1].Lockstep.Frames.has((599 + 15) & 255));
    Assert.ok(!Peers[1].Lockstep.Frames.has((599 + 15 - History) & 255));
    Body[1] = (599 - 100) & 255;
    Assert.equal(Service.Process(Frame(Input, Peers[1].MachineId, Body), Peers[1], Peers, Peers).length, 0);
});

Test('RLE decoding and concatenated batches preserve all logical frames', () => {
    const { Service, Peers } = Setup();
    const Body = Buffer.concat([Buffer.from([0x10, 250]), First.subarray(2, 15)]);
    Body[2] |= 3;
    const Out = Service.Process(Frame(Input, Peers[1].MachineId, Body), Peers[1], Peers, Peers);
    Assert.deepEqual(
        Out.map((O) => O.Payload[17]),
        [9, 10, 11, 12],
    );
    Assert.equal(Decode(Buffer.concat([Body, Last]), [1, 1]).length, 2);
    const Mixed = Buffer.concat([Body, Buffer.from([0xf0, 1, 1, 9])]);
    Assert.equal(Service.Process(Frame(Input, Peers[1].MachineId, Mixed), Peers[1], Peers, Peers).length, 5);
});

Test('reject forged sources, wrong index, changed startup and bad delay; preserve mode 2', () => {
    const { Service, Peers } = Setup();
    Assert.throws(() => Service.Process(Frame(Input, 999n, First), Peers[1], Peers, Peers), /source/);
    Assert.throws(() => Service.Process(Frame(Input, Peers[0].MachineId, First), Peers[0], Peers, Peers), /index/);
    Assert.throws(() => new DelayService(50), /1..49/);
    const Mode2 = Frame(0x64912e4f, Peers[1].MachineId, First);
    Assert.equal(
        Service.Process(Mode2, Peers[1], Peers, Peers),
        null,
        'non-lockstep traffic is handed back to the relay for byte-identical delivery',
    );
    const Changed = Buffer.from(StartupBody);
    Changed[1]++;
    Assert.throws(
        () => Service.Process(Frame(Startup, Peers[1].MachineId, Changed), Peers[1], Peers, Peers),
        /changed/,
    );
});

Test('router experiment is opt-in, session-isolated, and reconnect clears history', () => {
    Assert.equal(new Relay.Router(() => {}).LockstepDelay, null);
    const Sent = [];
    const Router = new Relay.Router(
        (Packet, Peer) => Sent.push({ Packet, Peer }),
        () => 0,
        { LockstepDelayFrames: 15, LockstepPacing: false },
    );
    const Addresses = [
        { address: '127.0.0.1', port: 1 },
        { address: '127.0.0.1', port: 2 },
    ];
    function Connect(I) {
        const Packet = Buffer.alloc(28, I + 1);
        Packet.writeUInt32BE(Relay.BuildHeader(0, 0, 28, 0));
        Packet.writeBigUInt64BE(BigInt(I + 100), 20);
        Router.Handle(Packet, Addresses[I]);
    }
    Connect(0);
    Connect(1);
    function Send(Body) {
        const Packet = Buffer.alloc(4 + Body.length);
        Packet.writeUInt32BE(Relay.BuildHeader(3, 3, Packet.length, 0));
        Body.copy(Packet, 4);
        Router.Handle(Packet, Addresses[1]);
    }
    Send(Frame(Startup, 101n, StartupBody));
    Sent.length = 0;
    Send(Frame(Input, 101n, First));
    Assert.equal(Sent.length, 2);
    Assert.ok(Sent.every((O) => O.Peer.Port === 2));
    Assert.equal(Sent[0].Packet[21], 0);
    Connect(1);
    Assert.equal(Router.Clients.get('127.0.0.1:2').Lockstep, undefined);
});
